import React from 'react';
import { AlertTriangle, Bell, CheckCheck, PlusCircle, Receipt, Sparkles } from 'lucide-react';
import type { AppNotification } from '../types';
import { formatDateTime } from '../utils/formatters';

interface NotificationCentreProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  compact?: boolean;
  onViewAll?: () => void;
}

export const NotificationCentre: React.FC<NotificationCentreProps> = ({
  notifications,
  onMarkAllRead,
  onMarkRead,
  compact = false,
  onViewAll,
}) => {
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const visible = compact ? notifications.slice(0, 5) : notifications;

  function renderIcon(kind: AppNotification['kind']) {
    switch (kind) {
      case 'low_balance':
        return <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />;
      case 'addition':
        return <PlusCircle className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />;
      case 'expense':
        return <Receipt className="w-4 h-4 text-[var(--theme-accent)] shrink-0 mt-0.5" />;
      default:
        return <Sparkles className="w-4 h-4 text-[var(--theme-accent)] shrink-0 mt-0.5" />;
    }
  }

  return (
    <section aria-labelledby="notifications-heading" className="pastel-card rounded-3xl p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 id="notifications-heading" className="font-display text-xl sm:text-2xl font-semibold">
            Notification Centre
          </h2>
          <p className="text-xs sm:text-sm text-[var(--theme-muted)] mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread updates` : 'All caught up'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs font-medium text-[var(--theme-accent)] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          )}
          {compact && notifications.length > 5 && onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs font-medium text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:underline cursor-pointer whitespace-nowrap"
            >
              View all
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="pastel-surface-alt rounded-2xl p-6 text-center border border-[var(--theme-border)]">
          <Bell className="w-7 h-7 text-[var(--theme-muted)] mx-auto mb-2 opacity-70" />
          <p className="text-sm text-[var(--theme-muted)]">
            Transaction alerts and humorous 10% low-balance nudges appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--theme-border)]">
          {visible.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                if (!item.isRead) onMarkRead(item.id);
              }}
              className={`py-3.5 first:pt-0 last:pb-0 flex items-start gap-3 transition-opacity ${
                item.isRead ? 'opacity-75' : 'cursor-pointer'
              }`}
            >
              <div
                className={`p-2 rounded-xl border border-[var(--theme-border)] ${
                  item.kind === 'low_balance'
                    ? 'bg-amber-50'
                    : item.kind === 'addition'
                      ? 'bg-emerald-50'
                      : 'bg-[var(--theme-surface-alt)]'
                }`}
              >
                {renderIcon(item.kind)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-sm ${item.isRead ? 'font-medium' : 'font-semibold'}`}>
                    {item.title}
                  </p>
                  <span className="text-xs text-[var(--theme-muted)] whitespace-nowrap shrink-0">
                    {formatDateTime(item.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-[var(--theme-muted)] mt-0.5 leading-relaxed">
                  {item.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
