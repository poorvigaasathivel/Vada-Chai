import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Mic,
  Plus,
  Radio,
  Receipt,
  UserCircle2,
  X,
} from 'lucide-react';
import { api, setAuthToken } from './api';
import { AddExpenseModal } from './components/AddExpenseModal';
import { AddMoneyModal } from './components/AddMoneyModal';
import { AuthView } from './components/AuthView';
import { LiveConversationModal } from './components/LiveConversationModal';
import { MoneyHistorySection } from './components/MoneyHistorySection';
import { NotificationCentre } from './components/NotificationCentre';
import { OnTheGoVoiceBar } from './components/OnTheGoVoiceBar';
import { ProfileModal } from './components/ProfileModal';
import { VoiceExpenseModal } from './components/VoiceExpenseModal';
import type {
  AppNotification,
  DailyIllustration,
  MoneySnapshot,
  PastelTheme,
  Transaction,
  UserProfile,
} from './types';
import { formatDateTime, formatINR, generateRequestId } from './utils/formatters';
import {
  applyPastelThemeToDocument,
  extractPastelThemeFromImage,
} from './utils/paletteExtractor';

type ActiveSection = 'dashboard' | 'transactions' | 'history' | 'notifications';

const DEFAULT_THEME: PastelTheme = {
  bg: '#FAF5EC',
  surface: '#FFFDF8',
  surfaceAlt: '#F3E9D8',
  accent: '#C96D3B',
  accentHover: '#AF592B',
  accentSoft: '#F5E2D4',
  accentText: '#FFFFFF',
  border: '#E5D8C3',
  text: '#1F1D1A',
  muted: '#5D574F',
  swatches: ['#C96D3B', '#E5D8C3', '#F3E9D8', '#FAF5EC'],
};

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [snapshots, setSnapshots] = useState<MoneySnapshot[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [illustration, setIllustration] = useState<DailyIllustration | null>(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [theme, setTheme] = useState<PastelTheme>(DEFAULT_THEME);
  const [activeSection, setActiveSection] = useState<ActiveSection>('dashboard');

  const [initialAmountInput, setInitialAmountInput] = useState('');
  const [initializingBalance, setInitializingBalance] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [onTheGoVoiceOn, setOnTheGoVoiceOn] = useState(false);
  const [liveChatOpen, setLiveChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [bannerToast, setBannerToast] = useState<{
    kind: 'info' | 'warning';
    title: string;
    message: string;
  } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Load daily illustration & automatically extract dynamic pastel palette
  useEffect(() => {
    let active = true;
    setImgFailed(false);
    api
      .getDailyIllustration(dayOffset)
      .then(async (daily) => {
        if (!active) return;
        setIllustration(daily);
        const extracted = await extractPastelThemeFromImage(
          daily.imageUrl,
          daily.fallbackPalette
        );
        if (!active) return;
        setTheme(extracted);
        applyPastelThemeToDocument(extracted);
      })
      .catch(() => {
        if (!active) return;
        applyPastelThemeToDocument(DEFAULT_THEME);
      });

    return () => {
      active = false;
    };
  }, [dayOffset]);

  // Restore active session from HttpOnly cookie on load
  useEffect(() => {
    let active = true;
    api
      .me()
      .then((res) => {
        if (!active) return;
        setAuthToken(res.token);
        setUser(res.user);
      })
      .catch(() => {
        // Not signed in yet
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    const data = await api.getDashboard();
    setUser(data.user);
    setTransactions(data.transactions);
    setSnapshots(data.snapshots);
    setNotifications(data.notifications);
  }, []);

  useEffect(() => {
    if (user) {
      refreshDashboard().catch(() => {});
    }
  }, [user?.id, refreshDashboard]);

  function showToast(kind: 'info' | 'warning', title: string, message: string) {
    setBannerToast({ kind, title, message });
  }

  async function handleInitializeBalance(e: React.FormEvent) {
    e.preventDefault();
    if (initializingBalance) return;
    const num = Number(initialAmountInput);
    if (!Number.isFinite(num) || num <= 0) {
      setInitError('Please enter an opening balance greater than ₹0.');
      return;
    }

    setInitializingBalance(true);
    setInitError(null);
    try {
      await api.initializeBalance({
        amount: num,
        clientRequestId: generateRequestId(),
      });
      setInitialAmountInput('');
      await refreshDashboard();
      showToast(
        'info',
        'Opening Balance Saved',
        `Your Vada & Chai wallet starts with ${formatINR(num)}. Happy mindful spending!`
      );
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Unable to save opening balance.');
    } finally {
      setInitializingBalance(false);
    }
  }

  async function handleSignOut() {
    setOnTheGoVoiceOn(false);
    try {
      await api.logout();
    } catch {
      // ignore network error during logout
    }
    setAuthToken(null);
    setUser(null);
    setTransactions([]);
    setSnapshots([]);
    setNotifications([]);
    setProfileOpen(false);
    setActiveSection('dashboard');
    setBannerToast(null);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="pastel-card rounded-3xl px-8 py-6 flex flex-col items-center gap-3">
          <img
            src="/assets/aistudio/image_e66c6e1b.png"
            alt="Vada & Chai"
            referrerPolicy="no-referrer"
            className="h-14 w-auto rounded-xl object-contain"
          />
          <p className="text-sm text-[var(--theme-muted)]">Restoring your wallet...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        illustration={illustration}
        theme={theme}
        onAuthenticated={(loggedInUser, token) => {
          setAuthToken(token);
          setUser(loggedInUser);
        }}
      />
    );
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const lowThreshold = user.referenceAmount * 0.1;
  const balanceRatio =
    user.referenceAmount > 0
      ? Math.max(0, Math.min(100, Math.round((user.balance / user.referenceAmount) * 100)))
      : 0;
  const isLowBalance = user.hasInitializedBalance && user.referenceAmount > 0 && user.balance <= lowThreshold;

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Daily Illustration Wallpaper Backdrop */}
      {illustration && !imgFailed && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 opacity-[0.12] bg-cover bg-center transition-all duration-700"
          style={{ backgroundImage: `url(${illustration.imageUrl})` }}
        />
      )}

      {/* Clean 3-Zone Top Navigation Bar */}
      <header
        className="sticky top-0 z-30 border-b border-[var(--theme-border)] backdrop-blur-md"
        style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg) 88%, transparent)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Illustrated Vada & Chai Brand Emblem */}
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            aria-label="Vada & Chai Dashboard"
            className="flex items-center shrink-0 cursor-pointer"
          >
            <img
              src="/assets/aistudio/image_e66c6e1b.png"
              alt="Vada & Chai"
              referrerPolicy="no-referrer"
              className="h-11 sm:h-12 w-auto rounded-xl object-contain border border-[var(--theme-border)] bg-[#FDF1D6] px-1.5 py-0.5 shrink-0"
            />
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav
            className="hidden md:flex items-center gap-6 text-sm font-medium"
            aria-label="Primary navigation"
          >
            {(
              [
                ['dashboard', 'Dashboard'],
                ['transactions', 'Transactions'],
                ['history', 'Money History'],
                ['notifications', unreadCount > 0 ? `Notifications (${unreadCount})` : 'Notifications'],
              ] as Array<[ActiveSection, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSection(key)}
                className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                  activeSection === key
                    ? 'border-[var(--theme-accent)] text-[var(--theme-text)]'
                    : 'border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Account Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="py-2 px-4 rounded-xl pastel-btn-soft text-sm font-medium flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserCircle2 className="w-4 h-4 text-[var(--theme-accent)]" />
              <span className="max-w-[120px] truncate">{user.name.split(' ')[0]}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-12 space-y-8">
        {/* Live Notification Banner */}
        {bannerToast && (
          <div
            role="status"
            className={`pastel-card rounded-2xl p-4 flex items-start justify-between gap-4 ${
              bannerToast.kind === 'warning' ? 'bg-amber-50 border-amber-300' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              {bannerToast.kind === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <Bell className="w-5 h-5 text-[var(--theme-accent)] shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-semibold">{bannerToast.title}</p>
                <p className="text-sm text-[var(--theme-muted)] mt-0.5">{bannerToast.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBannerToast(null)}
              aria-label="Dismiss notification"
              className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--theme-muted)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* On-the-Go Voice Expense Panel (stays active across tabs when turned ON) */}
        {user.hasInitializedBalance && (
          <OnTheGoVoiceBar
            active={onTheGoVoiceOn}
            onToggleOff={() => setOnTheGoVoiceOn(false)}
            defaultLanguage={user.preferredLanguage}
            availableBalance={user.balance}
            onExpenseSaved={async (result) => {
              await refreshDashboard();
              if (result.triggeredLowBalance && result.lowBalanceMessage) {
                showToast('warning', 'Low Balance Alert (10% Reached)', result.lowBalanceMessage);
              } else {
                showToast(
                  'info',
                  'Voice Expense Recorded',
                  `Deducted ${formatINR(result.amount)} for ${result.description}. Balance: ${formatINR(result.user.balance)}.`
                );
              }
            }}
          />
        )}

        {/* DASHBOARD VIEW */}
        {activeSection === 'dashboard' && (
          <>
            {/* Welcome + Balance & Daily Illustration Hero Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left Column: Welcome + Prominent Balance + Core Actions */}
              <section className="lg:col-span-6 pastel-card rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-6">
                <div>
                  <p className="text-sm text-[var(--theme-muted)]">
                    Namaste, <span className="font-medium text-[var(--theme-text)]">{user.name}</span>
                    {user.city ? ` · ${user.city}` : ''} · {user.preferredLanguage}
                  </p>

                  {!user.hasInitializedBalance ? (
                    <form onSubmit={handleInitializeBalance} className="mt-5 space-y-4">
                      <h1 className="font-display text-3xl font-semibold text-balance">
                        How much money is in your wallet today?
                      </h1>
                      <p className="text-sm text-[var(--theme-muted)]">
                        Enter your total available balance to begin tracking expenses by hand or
                        multilingual voice.
                      </p>
                      <div>
                        <label htmlFor="init-balance-input" className="sr-only">
                          Total available money in rupees
                        </label>
                        <input
                          id="init-balance-input"
                          type="number"
                          step="0.01"
                          min="1"
                          required
                          value={initialAmountInput}
                          onChange={(e) => setInitialAmountInput(e.target.value)}
                          placeholder="e.g. 2500"
                          className="w-full px-4 py-3.5 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] font-num text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                        />
                      </div>
                      {initError && (
                        <p className="text-sm text-red-700">{initError}</p>
                      )}
                      <button
                        type="submit"
                        disabled={initializingBalance}
                        className="w-full py-3.5 px-5 rounded-2xl pastel-btn-primary text-sm font-semibold cursor-pointer disabled:opacity-60"
                      >
                        {initializingBalance ? 'Setting Up Wallet...' : 'Set Available Balance'}
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="mt-5">
                        <p className="text-xs font-medium text-[var(--theme-muted)]">
                          Current Available Balance
                        </p>
                        <h1 className="font-display text-4xl sm:text-5xl font-semibold font-num tracking-tight mt-1.5">
                          {formatINR(user.balance)}
                        </h1>

                        {/* 10% Low-balance cushion indicator */}
                        <div className="mt-4 space-y-1.5">
                          <div className="h-2 rounded-full bg-[var(--theme-surface-alt)] overflow-hidden border border-[var(--theme-border)]">
                            <div
                              className="h-full transition-all duration-300"
                              style={{
                                width: `${balanceRatio}%`,
                                backgroundColor: isLowBalance ? '#D97706' : 'var(--theme-accent)',
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-[var(--theme-muted)]">
                            <span>
                              {isLowBalance
                                ? 'Low-balance zone reached (≤ 10%)'
                                : `${balanceRatio}% of ${formatINR(user.referenceAmount)} pool`}
                            </span>
                            <span className="font-num">10% alert at {formatINR(lowThreshold)}</span>
                          </div>
                        </div>
                      </div>

                      {isLowBalance && (
                        <div className="mt-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-amber-900 text-xs sm:text-sm">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                          <span>
                            Your wallet reached the 10% mark! Replenish via Add Money whenever
                            you&apos;re ready.
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Primary Action Buttons */}
                {user.hasInitializedBalance && (
                  <div className="space-y-3 pt-2">
                    {/* Prominent On-the-Go Voice Expense Toggle */}
                    <div className="pastel-surface-alt rounded-2xl px-4 py-3 border border-[var(--theme-border)] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Voice Expense on the Go</p>
                        <p className="text-xs text-[var(--theme-muted)] truncate">
                          Turn on to log expenses hands-free in Tamil, Hindi, Malayalam, Kannada, Telugu &amp; English
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={onTheGoVoiceOn}
                        aria-label="Toggle Voice Expense on the Go"
                        onClick={() => setOnTheGoVoiceOn((v) => !v)}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          onTheGoVoiceOn
                            ? 'pastel-btn-primary'
                            : 'bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-black/5'
                        }`}
                      >
                        {onTheGoVoiceOn ? 'Voice: ON' : 'Turn ON Voice'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setAddMoneyOpen(true)}
                        className="py-3 px-4 rounded-2xl pastel-btn-soft text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-[var(--theme-accent)]" />
                        <span>Add Money</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAddExpenseOpen(true)}
                        className="py-3 px-4 rounded-2xl pastel-btn-soft text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Receipt className="w-4 h-4 text-[var(--theme-accent)]" />
                        <span>Add Expense</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoiceOpen(true)}
                        className="py-3 px-4 rounded-2xl pastel-btn-primary text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Mic className="w-4 h-4" />
                        <span>Quick Voice Clip</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setLiveChatOpen(true)}
                        className="py-3 px-4 rounded-2xl pastel-btn-soft text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Radio className="w-4 h-4 text-[var(--theme-accent)]" />
                        <span>Live Voice Chat</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Right Column: Daily Indian Editorial Illustration Card */}
              <section className="lg:col-span-6 pastel-card rounded-3xl p-6 sm:p-7 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-xs font-medium text-[var(--theme-accent)]">
                        Daily Illustration · {illustration?.dateKey ?? 'Today'}
                      </p>
                      <p className="text-xs text-[var(--theme-muted)]">
                        {illustration?.sceneTheme ?? 'Everyday Indian Street Scene'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDayOffset((d) => Math.max(-4, d - 1))}
                        disabled={dayOffset <= -4}
                        aria-label="Previous day illustration"
                        className="p-2 rounded-xl pastel-btn-soft disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDayOffset((d) => Math.min(0, d + 1))}
                        disabled={dayOffset >= 0}
                        aria-label="Next day illustration"
                        className="p-2 rounded-xl pastel-btn-soft disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl overflow-hidden border border-[var(--theme-border)] bg-[var(--theme-surface-alt)] aspect-[16/9] mb-4">
                    {illustration && !imgFailed ? (
                      <img
                        src={illustration.imageUrl}
                        alt={illustration.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImgFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-6 text-center text-sm text-[var(--theme-muted)]">
                        Daily Indian Illustration
                      </div>
                    )}
                  </div>

                  <h2 className="font-display text-xl font-semibold leading-snug text-balance">
                    {illustration?.title ?? 'Today on the Street'}
                  </h2>
                  <p className="text-sm text-[var(--theme-muted)] mt-1.5 leading-relaxed">
                    {illustration?.caption}
                  </p>
                </div>

                <div className="mt-4 pt-3.5 border-t border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs italic text-[var(--theme-muted)]">
                    {illustration?.characterQuote}
                  </p>
                  <div className="flex items-center gap-1.5" title="Extracted daily pastel theme">
                    {theme.swatches.map((hex, idx) => (
                      <span
                        key={`${hex}-${idx}`}
                        className="w-3.5 h-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* Middle Split: Recent Transactions + Notification Centre */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section
                aria-labelledby="recent-tx-heading"
                className="lg:col-span-7 pastel-card rounded-3xl p-6 sm:p-7"
              >
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <h2 id="recent-tx-heading" className="font-display text-2xl font-semibold">
                      Recent Transactions
                    </h2>
                    <p className="text-xs sm:text-sm text-[var(--theme-muted)] mt-0.5">
                      Every rupee added or spent, recorded accurately.
                    </p>
                  </div>
                  {transactions.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('transactions')}
                      className="text-xs font-medium text-[var(--theme-accent)] hover:underline cursor-pointer whitespace-nowrap"
                    >
                      View all ({transactions.length})
                    </button>
                  )}
                </div>

                {transactions.length === 0 ? (
                  <div className="pastel-surface-alt rounded-2xl p-6 text-center border border-[var(--theme-border)]">
                    <p className="text-sm text-[var(--theme-muted)]">
                      No transactions yet. Record an expense manually or tap{' '}
                      <strong>Voice Expense</strong> to speak in your language.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--theme-border)]">
                    {transactions.slice(0, 6).map((tx) => (
                      <div
                        key={tx.id}
                        className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{tx.description}</p>
                          <p className="text-xs text-[var(--theme-muted)] mt-0.5">
                            {tx.source === 'voice'
                              ? `Voice${tx.spokenLanguage ? ` · ${tx.spokenLanguage}` : ''}`
                              : tx.type === 'initial'
                                ? 'Opening Balance'
                                : tx.type === 'addition'
                                  ? 'Added Money'
                                  : 'Manual Expense'}{' '}
                            · {formatDateTime(tx.createdAt)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`font-num text-sm font-semibold ${
                              tx.type === 'expense' ? 'text-red-800' : 'text-emerald-800'
                            }`}
                          >
                            {tx.type === 'expense' ? '-' : '+'} {formatINR(tx.amount)}
                          </p>
                          <p className="font-num text-xs text-[var(--theme-muted)]">
                            Bal: {formatINR(tx.balanceAfter)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="lg:col-span-5">
                <NotificationCentre
                  notifications={notifications}
                  compact
                  onViewAll={() => setActiveSection('notifications')}
                  onMarkAllRead={async () => {
                    await api.markAllNotificationsRead();
                    await refreshDashboard();
                  }}
                  onMarkRead={async (id) => {
                    await api.markNotificationRead(id);
                    await refreshDashboard();
                  }}
                />
              </div>
            </div>

            {/* Bottom Section: Money History Gallery Preview */}
            <MoneyHistorySection
              snapshots={snapshots}
              compact
              onViewAll={() => setActiveSection('history')}
            />
          </>
        )}

        {/* FULL TRANSACTIONS VIEW */}
        {activeSection === 'transactions' && (
          <section className="pastel-card rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="font-display text-3xl font-semibold">All Transactions</h1>
                <p className="text-sm text-[var(--theme-muted)] mt-1">
                  Complete ledger for {user.name} · Current Balance:{' '}
                  <span className="font-num font-semibold text-[var(--theme-text)]">
                    {formatINR(user.balance)}
                  </span>
                </p>
              </div>
              {user.hasInitializedBalance && (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAddExpenseOpen(true)}
                    className="py-2.5 px-4 rounded-xl pastel-btn-soft text-sm font-medium cursor-pointer whitespace-nowrap"
                  >
                    + Add Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceOpen(true)}
                    className="py-2.5 px-4 rounded-xl pastel-btn-primary text-sm font-medium flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Voice Expense</span>
                  </button>
                </div>
              )}
            </div>

            {transactions.length === 0 ? (
              <p className="text-sm text-[var(--theme-muted)] py-8 text-center">
                No transactions recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-[var(--theme-border)]">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="py-4 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-medium">{tx.description}</p>
                      <p className="text-xs text-[var(--theme-muted)] mt-0.5">
                        {tx.source === 'voice'
                          ? `Voice (${tx.spokenLanguage ?? 'Multilingual'})`
                          : tx.type === 'initial'
                            ? 'Opening Balance'
                            : tx.type === 'addition'
                              ? 'Money Added'
                              : 'Manual Expense'}{' '}
                        · {formatDateTime(tx.createdAt)}
                      </p>
                      {tx.transcript && (
                        <p className="text-xs italic text-[var(--theme-muted)] mt-1">
                          Heard: &ldquo;{tx.transcript}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`font-num text-base font-semibold ${
                          tx.type === 'expense' ? 'text-red-800' : 'text-emerald-800'
                        }`}
                      >
                        {tx.type === 'expense' ? '-' : '+'} {formatINR(tx.amount)}
                      </p>
                      <p className="font-num text-xs text-[var(--theme-muted)]">
                        Balance after: {formatINR(tx.balanceAfter)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* FULL MONEY HISTORY GALLERY VIEW */}
        {activeSection === 'history' && <MoneyHistorySection snapshots={snapshots} />}

        {/* FULL NOTIFICATIONS VIEW */}
        {activeSection === 'notifications' && (
          <NotificationCentre
            notifications={notifications}
            onMarkAllRead={async () => {
              await api.markAllNotificationsRead();
              await refreshDashboard();
            }}
            onMarkRead={async (id) => {
              await api.markNotificationRead(id);
              await refreshDashboard();
            }}
          />
        )}
      </main>

      {/* Mobile Compact Bottom Navigation (<= 15% height) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--theme-border)] backdrop-blur-md grid grid-cols-4 h-14"
        style={{ backgroundColor: 'color-mix(in srgb, var(--theme-surface) 94%, transparent)' }}
      >
        {(
          [
            ['dashboard', 'Home'],
            ['transactions', 'Ledger'],
            ['history', 'History'],
            ['notifications', unreadCount > 0 ? `Alerts (${unreadCount})` : 'Alerts'],
          ] as Array<[ActiveSection, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSection(key)}
            className={`text-xs font-medium flex items-center justify-center whitespace-nowrap ${
              activeSection === key
                ? 'text-[var(--theme-accent)] font-semibold'
                : 'text-[var(--theme-muted)]'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Modals */}
      <AddMoneyModal
        open={addMoneyOpen}
        onClose={() => setAddMoneyOpen(false)}
        user={user}
        transactions={transactions}
        theme={theme}
        illustrationUrl={illustration?.imageUrl ?? ''}
        onSuccess={async (updatedUser) => {
          await refreshDashboard();
          showToast(
            'info',
            'Balance Updated & Snapshot Saved',
            `Your previous balance was archived to Money History. Current balance: ${formatINR(updatedUser.balance)}.`
          );
        }}
      />

      <AddExpenseModal
        open={addExpenseOpen}
        onClose={() => setAddExpenseOpen(false)}
        availableBalance={user.balance}
        onSuccess={async (result) => {
          await refreshDashboard();
          if (result.triggeredLowBalance && result.lowBalanceMessage) {
            showToast('warning', 'Low Balance Alert (10% Reached)', result.lowBalanceMessage);
          } else {
            showToast(
              'info',
              'Expense Recorded',
              `Balance updated to ${formatINR(result.user.balance)}.`
            );
          }
        }}
      />

      <VoiceExpenseModal
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        defaultLanguage={user.preferredLanguage}
        availableBalance={user.balance}
        onSuccess={async (result) => {
          await refreshDashboard();
          if (result.triggeredLowBalance && result.lowBalanceMessage) {
            showToast('warning', 'Low Balance Alert (10% Reached)', result.lowBalanceMessage);
          } else {
            showToast(
              'info',
              'Voice Expense Saved',
              `Balance updated to ${formatINR(result.user.balance)}.`
            );
          }
        }}
      />

      <LiveConversationModal
        open={liveChatOpen}
        onClose={() => setLiveChatOpen(false)}
        user={user}
        onBalanceUpdated={refreshDashboard}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onUpdated={(updated) => setUser(updated)}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
