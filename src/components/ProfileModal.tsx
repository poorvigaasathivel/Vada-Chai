import React, { useEffect, useState } from 'react';
import { LogOut, Save, X } from 'lucide-react';
import { api } from '../api';
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  type UserProfile,
} from '../types';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile;
  onUpdated: (user: UserProfile) => void;
  onSignOut: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  open,
  onClose,
  user,
  onUpdated,
  onSignOut,
}) => {
  const [name, setName] = useState(user.name);
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>(
    user.preferredLanguage
  );
  const [city, setCity] = useState(user.city);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(user.name);
    setPreferredLanguage(user.preferredLanguage);
    setCity(user.city);
    setError(null);
  }, [user, open]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateProfile({
        name: name.trim(),
        preferredLanguage,
        city: city.trim(),
      });
      onUpdated(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div className="pastel-card rounded-3xl w-full max-w-md p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 id="profile-modal-title" className="font-display text-2xl font-semibold">
              Account Details
            </h2>
            <p className="text-xs text-[var(--theme-muted)] mt-1">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account details"
            className="p-2 rounded-xl hover:bg-[var(--theme-surface-alt)] text-[var(--theme-muted)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className="block text-sm font-medium mb-1.5">
              Full Name
            </label>
            <input
              id="profile-name"
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label htmlFor="profile-lang" className="block text-sm font-medium mb-1.5">
              Primary Voice Language
            </label>
            <select
              id="profile-lang"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as SupportedLanguage)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="profile-city" className="block text-sm font-medium mb-1.5">
              City
            </label>
            <input
              id="profile-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Bengaluru"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          {error && (
            <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--theme-border)]">
            <button
              type="button"
              onClick={onSignOut}
              className="py-2.5 px-3.5 rounded-xl text-sm font-medium text-red-700 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>

            <button
              type="submit"
              disabled={saving}
              className="py-2.5 px-5 rounded-xl pastel-btn-primary text-sm font-medium flex items-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
