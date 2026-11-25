import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail, MapPin, User } from 'lucide-react';
import { api, setAuthToken } from '../api';
import {
  SUPPORTED_LANGUAGES,
  type DailyIllustration,
  type PastelTheme,
  type SupportedLanguage,
  type UserProfile,
} from '../types';

interface AuthViewProps {
  illustration: DailyIllustration | null;
  theme: PastelTheme;
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  illustration,
  theme,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>('English');
  const [city, setCity] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        const res = await api.login({ email, password });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.token);
      } else {
        const res = await api.register({
          name,
          email,
          password,
          preferredLanguage,
          city,
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-8 lg:p-10 relative overflow-hidden">
      {/* Subtle daily illustration wallpaper backdrop */}
      {illustration && !imgFailed && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 opacity-[0.09] bg-cover bg-center"
          style={{ backgroundImage: `url(${illustration.imageUrl})` }}
        />
      )}

      <div className="relative z-10 max-w-6xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Daily Indian Editorial Artwork & Story */}
        <section className="lg:col-span-7 pastel-card rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-6">
              <img
                src="/assets/aistudio/image_e66c6e1b.png"
                alt="Vada & Chai"
                referrerPolicy="no-referrer"
                className="h-14 sm:h-16 w-auto rounded-2xl object-contain border border-[var(--theme-border)] bg-[#FDF1D6] px-2 py-0.5 shrink-0"
              />
              <span className="text-xs font-medium text-[var(--theme-muted)]">
                Daily Edition · {illustration?.dateKey ?? 'Today'}
              </span>
            </div>

            <div className="relative rounded-2xl overflow-hidden border border-[var(--theme-border)] bg-[var(--theme-surface-alt)] aspect-[16/9] mb-6">
              {illustration && !imgFailed ? (
                <img
                  src={illustration.imageUrl}
                  alt={illustration.title}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <p className="font-display text-xl font-semibold mb-1">
                    {illustration?.sceneTheme ?? 'Everyday Indian Money Stories'}
                  </p>
                  <p className="text-sm text-[var(--theme-muted)]">
                    Hand-drawn editorial art refreshes daily
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--theme-accent)]">
                Today&apos;s Illustration · {illustration?.sceneTheme ?? 'Everyday Life'}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold leading-tight text-balance">
                {illustration?.title ?? 'Mindful rupees, served warm with everyday humour.'}
              </h1>
              <p className="text-sm sm:text-base text-[var(--theme-muted)] leading-relaxed max-w-2xl">
                {illustration?.caption ??
                  'Track your daily spending effortlessly by voice or tap, preserve visual snapshots of your balance history, and wake up to a new Indian editorial illustration each day.'}
              </p>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-[var(--theme-border)] flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs sm:text-sm italic text-[var(--theme-muted)] max-w-md">
              {illustration?.characterQuote ?? '"Small chai bills build big stories."'}
            </p>
            <div className="flex items-center gap-2" aria-label="Today's extracted pastel palette">
              <span className="text-xs text-[var(--theme-muted)]">Today&apos;s palette</span>
              <div className="flex items-center gap-1.5">
                {theme.swatches.map((hex, i) => (
                  <span
                    key={`${hex}-${i}`}
                    className="w-4 h-4 rounded-full border border-black/10"
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Right: Sign In / Registration Form */}
        <section className="lg:col-span-5 pastel-card rounded-3xl p-6 sm:p-8 flex flex-col justify-center">
          <div className="mb-6">
            <div
              className="grid grid-cols-2 p-1 rounded-xl pastel-surface-alt border border-[var(--theme-border)] mb-6"
              role="tablist"
              aria-label="Account access mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2.5 px-4 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2.5 px-4 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-xs'
                    : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                Create Account
              </button>
            </div>

            <h2 className="font-display text-2xl font-semibold mb-1">
              {mode === 'login' ? 'Welcome back' : 'Open your Vada & Chai wallet'}
            </h2>
            <p className="text-sm text-[var(--theme-muted)]">
              {mode === 'login'
                ? 'Sign in to access your private balance, voice ledger, and snapshot gallery.'
                : 'Your financial records stay private and linked only to your account.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="auth-name" className="block text-sm font-medium mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[var(--theme-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ananya Iyer"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--theme-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--theme-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="auth-lang" className="block text-sm font-medium mb-1.5">
                    Preferred Language
                  </label>
                  <select
                    id="auth-lang"
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value as SupportedLanguage)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="auth-city" className="block text-sm font-medium mb-1.5">
                    City (Optional)
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-[var(--theme-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Chennai, Pune..."
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                    />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm space-y-2"
              >
                <p>{error}</p>
                {mode === 'register' && error.toLowerCase().includes('already exists') && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className="text-xs font-semibold underline cursor-pointer"
                  >
                    Switch to Sign In with {email}
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-5 rounded-xl pastel-btn-primary font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <span>
                {submitting
                  ? 'Please wait...'
                  : mode === 'login'
                    ? 'Sign In to Vada & Chai'
                    : 'Create Personal Account'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="mt-6 text-xs text-[var(--theme-muted)] text-center">
            Supports voice expenses in Tamil, Hindi, Malayalam, Kannada, Telugu &amp; English.
          </p>
        </section>
      </div>
    </div>
  );
};
