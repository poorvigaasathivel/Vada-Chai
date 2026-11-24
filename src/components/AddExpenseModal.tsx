import React, { useState } from 'react';
import { Receipt, X } from 'lucide-react';
import { api } from '../api';
import type { UserProfile } from '../types';
import { formatINR, generateRequestId } from '../utils/formatters';

interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
  availableBalance: number;
  onSuccess: (result: {
    user: UserProfile;
    triggeredLowBalance: boolean;
    lowBalanceMessage: string | null;
  }) => void;
}

export const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
  open,
  onClose,
  availableBalance,
  onSuccess,
}) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Please enter a valid rupee amount greater than 0.');
      return;
    }
    if (!description.trim()) {
      setError('Please enter what you spent on.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.addExpense({
        amount: numAmount,
        description: description.trim(),
        source: 'manual',
        clientRequestId: generateRequestId(),
      });
      setAmount('');
      setDescription('');
      onSuccess(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record expense.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-expense-title"
    >
      <div className="pastel-card rounded-3xl w-full max-w-md p-6 sm:p-7 relative">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 id="add-expense-title" className="font-display text-2xl font-semibold">
              Add Expense
            </h2>
            <p className="text-sm text-[var(--theme-muted)] mt-1">
              Available: <span className="font-num font-semibold">{formatINR(availableBalance)}</span>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="expense-amount" className="block text-sm font-medium mb-1.5">
              Amount Spent (₹)
            </label>
            <input
              id="expense-amount"
              type="number"
              step="0.01"
              min="1"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50"
              className="w-full px-4 py-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] font-num text-lg focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label htmlFor="expense-desc" className="block text-sm font-medium mb-1.5">
              Description
            </label>
            <input
              id="expense-desc"
              type="text"
              required
              maxLength={120}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Masala chai and bun maska"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

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
              <Receipt className="w-4 h-4" />
              <span>{submitting ? 'Recording...' : 'Record Expense'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
