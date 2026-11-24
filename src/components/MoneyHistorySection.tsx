import React, { useState } from 'react';
import { Download, Expand, History, X } from 'lucide-react';
import type { MoneySnapshot } from '../types';
import { formatDateTime, formatINR } from '../utils/formatters';

interface MoneyHistorySectionProps {
  snapshots: MoneySnapshot[];
  compact?: boolean;
  onViewAll?: () => void;
}

export const MoneyHistorySection: React.FC<MoneyHistorySectionProps> = ({
  snapshots,
  compact = false,
  onViewAll,
}) => {
  const [selectedSnapshot, setSelectedSnapshot] = useState<MoneySnapshot | null>(null);

  const visible = compact ? snapshots.slice(0, 3) : snapshots;

  function handleDownload(snapshot: MoneySnapshot) {
    const link = document.createElement('a');
    link.href = snapshot.imageDataUrl;
    link.download = `vada-chai-snapshot-${snapshot.id}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <section aria-labelledby="money-history-heading" className="pastel-card rounded-3xl p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 id="money-history-heading" className="font-display text-2xl font-semibold">
            Money History
          </h2>
          <p className="text-sm text-[var(--theme-muted)] mt-1">
            Immutable visual snapshots saved automatically whenever you replenish your balance.
          </p>
        </div>
        {compact && snapshots.length > 3 && onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-sm font-medium text-[var(--theme-accent)] hover:underline whitespace-nowrap cursor-pointer"
          >
            View all {snapshots.length} snapshots
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="pastel-surface-alt rounded-2xl p-8 text-center border border-[var(--theme-border)]">
          <History className="w-8 h-8 text-[var(--theme-muted)] mx-auto mb-3 opacity-70" />
          <p className="font-medium text-base mb-1">No historical snapshots archived yet</p>
          <p className="text-sm text-[var(--theme-muted)] max-w-md mx-auto">
            Whenever you use <strong>Add Money</strong> to update your total balance, your previous
            balance and transactions are permanently preserved here as an image.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((snap) => (
            <article
              key={snap.id}
              className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden flex flex-col"
            >
              <button
                type="button"
                onClick={() => setSelectedSnapshot(snap)}
                className="relative group aspect-[16/10] w-full overflow-hidden bg-[var(--theme-surface-alt)] cursor-pointer text-left"
                aria-label={`Inspect snapshot from ${formatDateTime(snap.createdAt)}`}
              >
                <img
                  src={snap.imageDataUrl}
                  alt={`Financial snapshot showing previous balance ${formatINR(snap.previousBalance)}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
                <span className="absolute bottom-2.5 right-2.5 p-2 rounded-lg bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <Expand className="w-4 h-4" />
                </span>
              </button>

              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {formatDateTime(snap.createdAt)} · {snap.transactionCount} entries
                  </p>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-[var(--theme-muted)]">Previous Balance</span>
                    <span className="font-num font-semibold text-base">
                      {formatINR(snap.previousBalance)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-[var(--theme-muted)]">Added</span>
                    <span className="font-num font-medium text-sm text-[var(--theme-accent)]">
                      + {formatINR(snap.addedAmount)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-[var(--theme-muted)]">Period Spent</span>
                    <span className="font-num text-sm text-[var(--theme-muted)]">
                      {formatINR(snap.totalSpentInPeriod)}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--theme-border)] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSnapshot(snap)}
                    className="text-xs font-medium text-[var(--theme-accent)] hover:underline cursor-pointer"
                  >
                    Inspect Image
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(snap)}
                    className="text-xs font-medium text-[var(--theme-muted)] hover:text-[var(--theme-text)] flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Lightbox Modal for Inspecting Saved Snapshot */}
      {selectedSnapshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Financial snapshot preview"
          onClick={() => setSelectedSnapshot(null)}
        >
          <div
            className="pastel-card rounded-3xl max-w-3xl w-full p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="font-display text-xl font-semibold">
                  Archived Snapshot · {formatDateTime(selectedSnapshot.createdAt)}
                </h3>
                <p className="text-xs text-[var(--theme-muted)] mt-0.5">
                  Previous Balance: {formatINR(selectedSnapshot.previousBalance)} · Added:{' '}
                  {formatINR(selectedSnapshot.addedAmount)} · New Balance:{' '}
                  {formatINR(selectedSnapshot.newBalance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSnapshot(null)}
                aria-label="Close snapshot preview"
                className="p-2 rounded-xl hover:bg-[var(--theme-surface-alt)] text-[var(--theme-muted)] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden border border-[var(--theme-border)] mb-4">
              <img
                src={selectedSnapshot.imageDataUrl}
                alt="Full financial state snapshot"
                referrerPolicy="no-referrer"
                className="w-full h-auto"
              />
            </div>

            {selectedSnapshot.periodSummary.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-[var(--theme-muted)] mb-2">
                  Transactions captured in this snapshot
                </p>
                <div className="divide-y divide-[var(--theme-border)] border-t border-b border-[var(--theme-border)]">
                  {selectedSnapshot.periodSummary.map((item, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between text-sm">
                      <span>{item.description}</span>
                      <span className="font-num font-medium">
                        {item.type === 'expense' ? '-' : '+'} {formatINR(item.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => handleDownload(selectedSnapshot)}
                className="py-2.5 px-4 rounded-xl pastel-btn-primary text-sm font-medium flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Snapshot</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
