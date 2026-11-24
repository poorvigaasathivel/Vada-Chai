import React, { useState } from 'react';
import { Camera, Plus, X } from 'lucide-react';
import { api } from '../api';
import type { PastelTheme, Transaction, UserProfile } from '../types';
import { formatINR, generateRequestId } from '../utils/formatters';
import { renderFinancialSnapshotImage } from '../utils/snapshotRenderer';

interface AddMoneyModalProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile;
  transactions: Transaction[];
  theme: PastelTheme;
  illustrationUrl: string;
  onSuccess: (updatedUser: UserProfile) => void;
}

export const AddMoneyModal: React.FC<AddMoneyModalProps> = ({
  open,
  onClose,
  user,
  transactions,
  theme,
  illustrationUrl,
  onSuccess,
}) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const parsedAmount = Number(amount);
  const projectedBalance =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? user.balance + parsedAmount : user.balance;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid rupee amount greater than 0.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const snapshotImageDataUrl = await renderFinancialSnapshotImage({
        userName: user.name,
        userCity: user.city,
        previousBalance: user.balance,
        addedAmount: parsedAmount,
        newBalance: projectedBalance,
        transactions,
        theme,
        illustrationUrl,
      });

      const res = await api.addMoney({
        amount: parsedAmount,
        description: description.trim() || 'Added Money to Wallet',
        snapshotImageDataUrl,
        clientRequestId: generateRequestId(),
      });

      setAmount('');
      setDescription('');
      onSuccess(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add money right now.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-money-title"
    >
      <div className="pastel-card rounded-3xl w-full max-w-md p-6 sm:p-7 relative">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 id="add-money-title" className="font-display text-2xl font-semibold">
              Add Money
            </h2>
            <p className="text-sm text-[var(--theme-muted)] mt-1">
              Current balance: <span className="font-num font-semibold">{formatINR(user.balance)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-xl hover:bg-[var(--theme-surface-alt)] text-[var(--theme-muted)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="pastel-surface-alt rounded-2xl p-3.5 mb-5 flex items-start gap-3 border border-[var(--theme-border)]">
          <Camera className="w-5 h-5 text-[var(--theme-accent)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--theme-muted)] leading-relaxed">
            Updating your total money automatically saves a visual snapshot of your current balance
            ({formatINR(user.balance)}) and recent expenses to <strong>Money History</strong>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="add-money-amount" className="block text-sm font-medium mb-1.5">
              Amount to Add (₹)
            </label>
            <input
              id="add-money-amount"
              type="number"
              step="0.01"
              min="1"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1000"
              className="w-full px-4 py-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] font-num text-lg focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label htmlFor="add-money-desc" className="block text-sm font-medium mb-1.5">
              Source / Note
            </label>
            <input
              id="add-money-desc"
              type="text"
              maxLength={120}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monthly pocket money, Freelance payout"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          {Number.isFinite(parsedAmount) && parsedAmount > 0 && (
            <div className="flex items-center justify-between text-sm pt-1">
              <span className="text-[var(--theme-muted)]">Updated Balance</span>
              <span className="font-num font-semibold text-base text-[var(--theme-accent)]">
                {formatINR(projectedBalance)}
              </span>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl pastel-btn-soft text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="py-2.5 px-5 rounded-xl pastel-btn-primary text-sm font-medium flex items-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Saving Snapshot...' : 'Save & Add Money'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
