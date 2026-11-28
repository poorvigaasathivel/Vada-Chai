import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { attachLiveVoiceServer } from './server/live.ts';
import {
  clearSessionCookie,
  createSessionToken,
  forgetDeviceAccount,
  getDeviceRememberedAccounts,
  hashPassword,
  hasValidCsrfCheck,
  rememberUserOnDevice,
  requireAuth,
  revokeSessionToken,
  setSessionCookie,
  verifyDeviceAccountAccess,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/auth.ts';
import {
  db,
  sanitizeUser,
  type DailyStoryRow,
  type NotificationRow,
  type SnapshotRow,
  type TransactionRow,
  type UserRow,
} from './server/db.ts';
import {
  extractExpenseFromText,
  generateDailyCartoonStory,
  transcribeAudioExpense,
} from './server/gemini.ts';
import {
  DAILY_ILLUSTRATION_SCENES,
  getDateKey,
  getSceneIndexForDateKey,
} from './server/illustrations.ts';

const PORT = 3000;
const ALLOWED_LANGUAGES = new Set([
  'English',
  'Tamil',
  'Hindi',
  'Malayalam',
  'Kannada',
  'Telugu',
]);

const HUMOROUS_LOW_BALANCE_MESSAGES = [
  (bal: number) =>
    `Chai-pani alert! Your purse is down to ₹${bal.toLocaleString('en-IN')} — time to look at street vada from a respectful distance or top up your wallet.`,
  (bal: number) =>
    `Auto-meter warning! Only ₹${bal.toLocaleString('en-IN')} left in the pocket — even the neighbourhood chaiwala is offering credit out of pure sympathy.`,
  (bal: number) =>
    `Gentle rupee nudge: ₹${bal.toLocaleString('en-IN')} remaining (under 10% left). Your wallet is officially on a strict filter-kaapi-only diet until replenished!`,
  (bal: number) =>
    `Pocket status: ₹${bal.toLocaleString('en-IN')} left! Your kurta pockets are echoing — add fresh funds whenever you're ready.`,
];

function pickLowBalanceMessage(balance: number, userId: number): string {
  const fn = HUMOROUS_LOW_BALANCE_MESSAGES[userId % HUMOROUS_LOW_BALANCE_MESSAGES.length];
  return fn(Math.round(balance * 100) / 100);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth: Register
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, preferredLanguage, city } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      res.status(400).json({ error: 'Please enter your name (2 to 80 characters).' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanLang =
      typeof preferredLanguage === 'string' && ALLOWED_LANGUAGES.has(preferredLanguage)
        ? preferredLanguage
        : 'English';
    const cleanCity = typeof city === 'string' ? city.trim().slice(0, 60) : '';

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, preferred_language, city, balance, reference_amount, has_initialized_balance, low_balance_alert_sent, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
    `);
    const result = insertUser.run(cleanName, cleanEmail, passwordHash, cleanLang, cleanCity, now);
    const userId = Number(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
      VALUES (?, 'welcome', ?, ?, 0, ?)
    `).run(
      userId,
      'Namaste! Welcome to Vada & Chai',
      `Your private Vada & Chai wallet is ready, ${cleanName}. Enter your available money to begin tracking every rupee.`,
      now
    );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;
    const token = createSessionToken(user.id);
    setSessionCookie(req, res, token);
    rememberUserOnDevice(req, res, user.id);
    res.status(201).json({ token, user: sanitizeUser(user) });
  });

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as
      | UserRow
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = createSessionToken(user.id);
    setSessionCookie(req, res, token);
    rememberUserOnDevice(req, res, user.id);
    res.json({ token, user: sanitizeUser(user) });
  });

  // Auth: Remembered accounts on this browser
  app.get('/api/auth/remembered', (req, res) => {
    res.json({ accounts: getDeviceRememberedAccounts(req) });
  });

  // Auth: Immediate email login on a remembered browser
  app.post('/api/auth/quick-login', (req, res) => {
    if (!hasValidCsrfCheck(req)) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
    const { email } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const user = verifyDeviceAccountAccess(req, email);
    if (!user) {
      res.status(401).json({
        error: 'Please enter your password to sign in with this email on this browser.',
      });
      return;
    }

    const token = createSessionToken(user.id);
    setSessionCookie(req, res, token);
    rememberUserOnDevice(req, res, user.id);
    res.json({ token, user: sanitizeUser(user) });
  });

  // Auth: Forget a remembered account from this browser
  app.post('/api/auth/forget-device', (req, res) => {
    if (!hasValidCsrfCheck(req)) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
    const { email } = req.body ?? {};
    if (typeof email === 'string' && email.trim()) {
      forgetDeviceAccount(req, email);
    }
    res.json({ accounts: getDeviceRememberedAccounts(req) });
  });

  // Auth: Logout
  app.post('/api/auth/logout', (req, res) => {
    if (req.headers.cookie && !hasValidCsrfCheck(req)) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
    revokeSessionToken(req);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Auth: Current user (restores session on page reload / app reopen)
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const freshToken = req.sessionToken || createSessionToken(req.userId!);
    rememberUserOnDevice(req, res, req.userId!);
    res.json({ token: freshToken, user: sanitizeUser(req.currentUser!) });
  });

  // Auth: Update profile details
  app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const { name, preferredLanguage, city } = req.body ?? {};
    const user = req.currentUser!;

    const nextName =
      typeof name === 'string' && name.trim().length >= 2 ? name.trim().slice(0, 80) : user.name;
    const nextLang =
      typeof preferredLanguage === 'string' && ALLOWED_LANGUAGES.has(preferredLanguage)
        ? preferredLanguage
        : user.preferred_language;
    const nextCity = typeof city === 'string' ? city.trim().slice(0, 60) : user.city;

    db.prepare('UPDATE users SET name = ?, preferred_language = ?, city = ? WHERE id = ?').run(
      nextName,
      nextLang,
      nextCity,
      user.id
    );

    const updated = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(user.id) as unknown as UserRow;
    res.json({ user: sanitizeUser(updated) });
  });

  // Daily Indian Illustration & AI Story
  app.get('/api/daily-illustration', async (req, res) => {
    const offsetParam = Number(req.query.offset ?? 0);
    const safeOffset = Number.isInteger(offsetParam) ? Math.max(-30, Math.min(0, offsetParam)) : 0;
    const dateKey = getDateKey(safeOffset);
    const sceneIndex = getSceneIndexForDateKey(dateKey);
    const scene = DAILY_ILLUSTRATION_SCENES[sceneIndex];

    let story = db
      .prepare('SELECT * FROM daily_stories WHERE date_key = ?')
      .get(dateKey) as DailyStoryRow | undefined;

    if (!story) {
      const aiStory = await generateDailyCartoonStory({
        dateKey,
        sceneTheme: scene.sceneTheme,
        promptSummary: scene.promptSummary,
      });

      const title = aiStory?.title ?? scene.defaultTitle;
      const caption = aiStory?.caption ?? scene.defaultCaption;
      const characterQuote = aiStory?.characterQuote ?? scene.defaultQuote;
      const moneyTip = aiStory?.moneyTip ?? scene.defaultTip;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT OR IGNORE INTO daily_stories (date_key, illustration_index, title, caption, character_quote, money_tip, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(dateKey, scene.index, title, caption, characterQuote, moneyTip, now);

      story = db
        .prepare('SELECT * FROM daily_stories WHERE date_key = ?')
        .get(dateKey) as unknown as DailyStoryRow;
    }

    res.json({
      dateKey,
      sceneTheme: scene.sceneTheme,
      imageUrl: scene.imageUrl,
      title: story.title,
      caption: story.caption,
      characterQuote: story.character_quote,
      moneyTip: story.money_tip,
      fallbackPalette: scene.fallbackPalette,
      totalScenes: DAILY_ILLUSTRATION_SCENES.length,
    });
  });

  // Dashboard data bundle (protected per-user)
  app.get('/api/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;

    const transactions = db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100')
      .all(userId) as unknown as TransactionRow[];

    const snapshots = db
      .prepare('SELECT * FROM money_snapshots WHERE user_id = ? ORDER BY id DESC')
      .all(userId) as unknown as SnapshotRow[];

    const notifications = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60')
      .all(userId) as unknown as NotificationRow[];

    res.json({
      user: sanitizeUser(user),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        source: t.source,
        spokenLanguage: t.spoken_language,
        transcript: t.transcript,
        balanceAfter: Number(t.balance_after),
        createdAt: t.created_at,
      })),
      snapshots: snapshots.map((s) => ({
        id: s.id,
        previousBalance: Number(s.previous_balance),
        addedAmount: Number(s.added_amount),
        newBalance: Number(s.new_balance),
        totalSpentInPeriod: Number(s.total_spent_in_period),
        transactionCount: s.transaction_count,
        periodSummary: JSON.parse(s.period_summary) as Array<{
          type: string;
          amount: number;
          description: string;
          createdAt: string;
        }>,
        imageDataUrl: s.image_data_url,
        createdAt: s.created_at,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        message: n.message,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
    });
  });

  // Initialize starting money after login
  app.post('/api/money/initialize', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const { amount, clientRequestId } = req.body ?? {};
    const numAmount = Number(amount);

    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 100000000) {
      res.status(400).json({ error: 'Please enter a valid starting balance greater than ₹0.' });
      return;
    }

    const rounded = Math.round(numAmount * 100) / 100;
    const now = new Date().toISOString();
    const reqId = typeof clientRequestId === 'string' ? clientRequestId.slice(0, 80) : null;

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;
      if (user.has_initialized_balance) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Opening balance is already set. Use Add Money to update it.' });
        return;
      }

      if (reqId) {
        const dup = db
          .prepare('SELECT id FROM transactions WHERE user_id = ? AND client_request_id = ?')
          .get(userId, reqId);
        if (dup) {
          db.exec('ROLLBACK');
          res.json({ duplicate: true, user: sanitizeUser(user) });
          return;
        }
      }

      db.prepare(`
        UPDATE users
        SET balance = ?, reference_amount = ?, has_initialized_balance = 1, low_balance_alert_sent = 0
        WHERE id = ?
      `).run(rounded, rounded, userId);

      db.prepare(`
        INSERT INTO transactions (user_id, client_request_id, type, amount, description, source, balance_after, created_at)
        VALUES (?, ?, 'initial', ?, 'Opening Available Balance', 'manual', ?, ?)
      `).run(userId, reqId, rounded, rounded, now);

      db.prepare(`
        INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
        VALUES (?, 'addition', ?, ?, 0, ?)
      `).run(
        userId,
        'Opening Balance Set',
        `Started your Vada & Chai wallet with ₹${rounded.toLocaleString('en-IN')}. We will nudge you if it dips to ₹${(rounded * 0.1).toLocaleString('en-IN')}.`,
        now
      );

      db.exec('COMMIT');
      const updated = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as unknown as UserRow;
      res.json({ user: sanitizeUser(updated) });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to set balance.' });
    }
  });

  // Add money (automatically saves previous state snapshot image into append-only history!)
  app.post('/api/money/add', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const { amount, description, snapshotImageDataUrl, clientRequestId } = req.body ?? {};
    const numAmount = Number(amount);

    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 100000000) {
      res.status(400).json({ error: 'Please enter a valid amount greater than ₹0.' });
      return;
    }

    if (
      typeof snapshotImageDataUrl !== 'string' ||
      !snapshotImageDataUrl.startsWith('data:image/')
    ) {
      res.status(400).json({ error: 'Financial snapshot image is required when updating total money.' });
      return;
    }

    const cleanDesc =
      typeof description === 'string' && description.trim().length > 0
        ? description.trim().slice(0, 120)
        : 'Added Money to Wallet';
    const rounded = Math.round(numAmount * 100) / 100;
    const now = new Date().toISOString();
    const reqId = typeof clientRequestId === 'string' ? clientRequestId.slice(0, 80) : null;

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;

      if (reqId) {
        const dup = db
          .prepare('SELECT id FROM transactions WHERE user_id = ? AND client_request_id = ?')
          .get(userId, reqId);
        if (dup) {
          db.exec('ROLLBACK');
          res.json({ duplicate: true, user: sanitizeUser(user) });
          return;
        }
      }

      const previousBalance = Number(user.balance);
      const newBalance = Math.round((previousBalance + rounded) * 100) / 100;

      // Summarize recent transactions since the previous snapshot
      const lastSnapshot = db
        .prepare('SELECT created_at FROM money_snapshots WHERE user_id = ? ORDER BY id DESC LIMIT 1')
        .get(userId) as { created_at: string } | undefined;

      const periodTransactions = (
        lastSnapshot
          ? db
              .prepare(
                'SELECT * FROM transactions WHERE user_id = ? AND created_at > ? ORDER BY id DESC'
              )
              .all(userId, lastSnapshot.created_at)
          : db
              .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC')
              .all(userId)
      ) as unknown as TransactionRow[];

      const totalSpentInPeriod = periodTransactions
        .filter((t) => t.type === 'expense')
        .reduce((acc, t) => acc + Number(t.amount), 0);

      const periodSummary = periodTransactions.slice(0, 6).map((t) => ({
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        createdAt: t.created_at,
      }));

      // Save immutable financial state snapshot image BEFORE applying the update
      if (user.has_initialized_balance) {
        db.prepare(`
          INSERT INTO money_snapshots (user_id, previous_balance, added_amount, new_balance, total_spent_in_period, transaction_count, period_summary, image_data_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          previousBalance,
          rounded,
          newBalance,
          Math.round(totalSpentInPeriod * 100) / 100,
          periodTransactions.length,
          JSON.stringify(periodSummary),
          snapshotImageDataUrl,
          now
        );
      }

      // Replenish balance & reset low-balance alert threshold
      db.prepare(`
        UPDATE users
        SET balance = ?, reference_amount = ?, has_initialized_balance = 1, low_balance_alert_sent = 0
        WHERE id = ?
      `).run(newBalance, newBalance, userId);

      db.prepare(`
        INSERT INTO transactions (user_id, client_request_id, type, amount, description, source, balance_after, created_at)
        VALUES (?, ?, 'addition', ?, ?, 'manual', ?, ?)
      `).run(userId, reqId, rounded, cleanDesc, newBalance, now);

      db.prepare(`
        INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
        VALUES (?, 'addition', ?, ?, 0, ?)
      `).run(
        userId,
        'Money Added & Snapshot Archived',
        `Added ₹${rounded.toLocaleString('en-IN')} (${cleanDesc}). New balance: ₹${newBalance.toLocaleString('en-IN')}. Previous balance saved to Money History.`,
        now
      );

      db.exec('COMMIT');
      const updated = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as unknown as UserRow;
      res.json({ user: sanitizeUser(updated) });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add money.' });
    }
  });

  // Record an expense (manual or AI voice confirmed)
  app.post('/api/money/expense', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.userId!;
    const { amount, description, source, spokenLanguage, transcript, clientRequestId } =
      req.body ?? {};
    const numAmount = Number(amount);

    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 100000000) {
      res.status(400).json({ error: 'Please enter a valid expense amount greater than ₹0.' });
      return;
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      res.status(400).json({ error: 'Please enter an expense description.' });
      return;
    }

    const cleanDesc = description.trim().slice(0, 120);
    const cleanSource = source === 'voice' ? 'voice' : 'manual';
    const cleanLang = typeof spokenLanguage === 'string' ? spokenLanguage.slice(0, 40) : null;
    const cleanTranscript = typeof transcript === 'string' ? transcript.slice(0, 300) : null;
    const rounded = Math.round(numAmount * 100) / 100;
    const now = new Date().toISOString();
    const reqId = typeof clientRequestId === 'string' ? clientRequestId.slice(0, 80) : null;

    try {
      db.exec('BEGIN IMMEDIATE');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;

      if (!user.has_initialized_balance) {
        db.exec('ROLLBACK');
        res.status(400).json({ error: 'Please set your starting available balance first.' });
        return;
      }

      if (reqId) {
        const dup = db
          .prepare('SELECT id FROM transactions WHERE user_id = ? AND client_request_id = ?')
          .get(userId, reqId);
        if (dup) {
          db.exec('ROLLBACK');
          res.json({ duplicate: true, user: sanitizeUser(user), triggeredLowBalance: false });
          return;
        }
      }

      const currentBalance = Number(user.balance);
      if (rounded > currentBalance) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Insufficient balance: you tried to spend ₹${rounded.toLocaleString('en-IN')}, but only ₹${currentBalance.toLocaleString('en-IN')} is available. Add money first!`,
        });
        return;
      }

      const newBalance = Math.round((currentBalance - rounded) * 100) / 100;
      const threshold = Number(user.reference_amount) * 0.1;
      const shouldTriggerLowBalance =
        Number(user.reference_amount) > 0 &&
        newBalance <= threshold &&
        !user.low_balance_alert_sent;

      db.prepare(`
        UPDATE users
        SET balance = ?, low_balance_alert_sent = ?
        WHERE id = ?
      `).run(newBalance, shouldTriggerLowBalance ? 1 : user.low_balance_alert_sent, userId);

      db.prepare(`
        INSERT INTO transactions (user_id, client_request_id, type, amount, description, source, spoken_language, transcript, balance_after, created_at)
        VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        reqId,
        rounded,
        cleanDesc,
        cleanSource,
        cleanLang,
        cleanTranscript,
        newBalance,
        now
      );

      db.prepare(`
        INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
        VALUES (?, 'expense', ?, ?, 0, ?)
      `).run(
        userId,
        cleanSource === 'voice' ? 'Voice Expense Recorded' : 'Expense Recorded',
        `Spent ₹${rounded.toLocaleString('en-IN')} on ${cleanDesc}. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
        now
      );

      let lowBalanceMessage: string | null = null;
      if (shouldTriggerLowBalance) {
        lowBalanceMessage = pickLowBalanceMessage(newBalance, userId);
        db.prepare(`
          INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
          VALUES (?, 'low_balance', ?, ?, 0, ?)
        `).run(userId, 'Low Balance Alert (10% Reached)', lowBalanceMessage, now);
      }

      db.exec('COMMIT');
      const updated = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as unknown as UserRow;
      res.json({
        user: sanitizeUser(updated),
        triggeredLowBalance: shouldTriggerLowBalance,
        lowBalanceMessage,
      });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save expense.' });
    }
  });

  // Notifications: mark all read
  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId!);
    res.json({ ok: true });
  });

  // Notifications: mark one read
  app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid notification id.' });
      return;
    }
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
      id,
      req.userId!
    );
    res.json({ ok: true });
  });

  // AI Voice Expense Extraction (audio -> transcript + structured amount/description, NOT saved until user confirms)
  app.post('/api/ai/voice-expense', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { audioBase64, mimeType, preferredLanguage } = req.body ?? {};
    if (typeof audioBase64 !== 'string' || audioBase64.length < 32) {
      res.status(400).json({ error: 'No audio recording received. Please try speaking again.' });
      return;
    }

    try {
      const parsed = await transcribeAudioExpense({
        audioBase64,
        mimeType: typeof mimeType === 'string' ? mimeType : 'audio/webm',
        preferredLanguage: typeof preferredLanguage === 'string' ? preferredLanguage : undefined,
      });
      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to process voice recording right now.';
      res.status(422).json({ error: message });
    }
  });

  // AI Natural Text Expense Extraction (for typed multilingual input or Web Speech fallback)
  app.post('/api/ai/parse-expense', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { text, preferredLanguage } = req.body ?? {};
    if (typeof text !== 'string' || text.trim().length < 2) {
      res.status(400).json({ error: 'Please enter or speak an expense phrase.' });
      return;
    }

    try {
      const parsed = await extractExpenseFromText({
        text: text.trim().slice(0, 300),
        preferredLanguage: typeof preferredLanguage === 'string' ? preferredLanguage : undefined,
      });
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to interpret expense text.';
      res.status(422).json({ error: message });
    }
  });

  // Frontend serving (Vite dev middleware in dev, static dist in production)
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = http.createServer(app);
  attachLiveVoiceServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Vada & Chai server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
