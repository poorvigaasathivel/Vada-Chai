import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'khata.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'English',
    city TEXT NOT NULL DEFAULT '',
    balance REAL NOT NULL DEFAULT 0,
    reference_amount REAL NOT NULL DEFAULT 0,
    has_initialized_balance INTEGER NOT NULL DEFAULT 0,
    low_balance_alert_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_request_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('initial', 'addition', 'expense')),
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    spoken_language TEXT,
    transcript TEXT,
    balance_after REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, client_request_id)
  );

  CREATE TABLE IF NOT EXISTS money_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    previous_balance REAL NOT NULL,
    added_amount REAL NOT NULL,
    new_balance REAL NOT NULL,
    total_spent_in_period REAL NOT NULL,
    transaction_count INTEGER NOT NULL,
    period_summary TEXT NOT NULL,
    image_data_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('expense', 'addition', 'low_balance', 'welcome')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_stories (
    date_key TEXT PRIMARY KEY,
    illustration_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    caption TEXT NOT NULL,
    character_quote TEXT NOT NULL,
    money_tip TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  preferred_language: string;
  city: string;
  balance: number;
  reference_amount: number;
  has_initialized_balance: number;
  low_balance_alert_sent: number;
  created_at: string;
}

export interface TransactionRow {
  id: number;
  user_id: number;
  client_request_id: string | null;
  type: 'initial' | 'addition' | 'expense';
  amount: number;
  description: string;
  source: 'manual' | 'voice';
  spoken_language: string | null;
  transcript: string | null;
  balance_after: number;
  created_at: string;
}

export interface SnapshotRow {
  id: number;
  user_id: number;
  previous_balance: number;
  added_amount: number;
  new_balance: number;
  total_spent_in_period: number;
  transaction_count: number;
  period_summary: string;
  image_data_url: string;
  created_at: string;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  kind: 'expense' | 'addition' | 'low_balance' | 'welcome';
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface DailyStoryRow {
  date_key: string;
  illustration_index: number;
  title: string;
  caption: string;
  character_quote: string;
  money_tip: string;
  created_at: string;
}

export function sanitizeUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    preferredLanguage: user.preferred_language,
    city: user.city,
    balance: Number(user.balance),
    referenceAmount: Number(user.reference_amount),
    hasInitializedBalance: Boolean(user.has_initialized_balance),
    lowBalanceAlertSent: Boolean(user.low_balance_alert_sent),
    createdAt: user.created_at,
  };
}
