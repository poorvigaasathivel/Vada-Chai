import type { PastelTheme, Transaction } from '../types';
import { formatDateTime, formatINR } from './formatters';

export async function renderFinancialSnapshotImage(params: {
  userName: string;
  userCity: string;
  previousBalance: number;
  addedAmount: number;
  newBalance: number;
  transactions: Transaction[];
  theme: PastelTheme;
  illustrationUrl: string;
}): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 580;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas for financial snapshot.');
  }

  const { theme } = params;

  // Background fill
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer ledger card
  ctx.fillStyle = theme.surface;
  roundRect(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 22);
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner ornamental hairline frame
  ctx.strokeStyle = theme.accentSoft;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 42, 42, canvas.width - 84, canvas.height - 84, 14);
  ctx.stroke();

  // Optional subtle corner illustration watermark
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = params.illustrationUrl;
    });
    ctx.save();
    roundRect(ctx, 640, 66, 252, 142, 12);
    ctx.clip();
    ctx.drawImage(img, 640, 66, 252, 142);
    ctx.restore();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 640, 66, 252, 142, 12);
    ctx.stroke();
  } catch {
    // Fallback swatch accent block
    ctx.fillStyle = theme.surfaceAlt;
    roundRect(ctx, 640, 66, 252, 142, 12);
    ctx.fill();
  }

  // Brand & Snapshot metadata
  ctx.fillStyle = theme.accent;
  ctx.font = '600 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('VADA & CHAI  ·  FINANCIAL SNAPSHOT', 68, 88);

  ctx.fillStyle = theme.text;
  ctx.font = '700 28px Georgia, serif';
  ctx.fillText(`${params.userName}'s Ledger Archive`, 68, 128);

  ctx.fillStyle = theme.muted;
  ctx.font = '400 14px "Plus Jakarta Sans", sans-serif';
  const metaLine = `${params.userCity ? params.userCity + ' · ' : ''}Saved ${formatDateTime(new Date().toISOString())}`;
  ctx.fillText(metaLine, 68, 156);

  // Previous Balance Highlight Box
  ctx.fillStyle = theme.surfaceAlt;
  roundRect(ctx, 68, 224, 268, 134, 14);
  ctx.fill();
  ctx.fillStyle = theme.muted;
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('PREVIOUS BALANCE', 90, 254);
  ctx.fillStyle = theme.text;
  ctx.font = '700 32px "JetBrains Mono", monospace';
  ctx.fillText(formatINR(params.previousBalance), 90, 300);
  ctx.fillStyle = theme.muted;
  ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Before replenishment', 90, 332);

  // Added Amount Box
  ctx.fillStyle = theme.accentSoft;
  roundRect(ctx, 356, 224, 254, 134, 14);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ADDED TO WALLET', 378, 254);
  ctx.font = '700 30px "JetBrains Mono", monospace';
  ctx.fillText(`+ ${formatINR(params.addedAmount)}`, 378, 300);
  ctx.fillStyle = theme.text;
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`New total: ${formatINR(params.newBalance)}`, 378, 332);

  // Period Spend Summary Box
  const expenses = params.transactions.filter((t) => t.type === 'expense');
  const totalSpent = expenses.reduce((sum, t) => sum + t.amount, 0);
  ctx.fillStyle = theme.surfaceAlt;
  roundRect(ctx, 630, 224, 262, 134, 14);
  ctx.fill();
  ctx.fillStyle = theme.muted;
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('RECENT ACTIVITY', 652, 254);
  ctx.fillStyle = theme.text;
  ctx.font = '700 28px "JetBrains Mono", monospace';
  ctx.fillText(formatINR(totalSpent), 652, 300);
  ctx.fillStyle = theme.muted;
  ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Spent across ${expenses.length} expenses`, 652, 332);

  // Recent transactions ledger lines
  ctx.fillStyle = theme.muted;
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('TRANSACTIONS RECORDED PRIOR TO UPDATE', 68, 396);

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(68, 408);
  ctx.lineTo(892, 408);
  ctx.stroke();

  const recent = params.transactions.slice(0, 3);
  if (recent.length === 0) {
    ctx.fillStyle = theme.muted;
    ctx.font = '400 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('No prior expense entries in this period.', 68, 444);
  } else {
    recent.forEach((tx, idx) => {
      const y = 438 + idx * 34;
      ctx.fillStyle = theme.text;
      ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
      const desc = tx.description.length > 42 ? tx.description.slice(0, 40) + '...' : tx.description;
      ctx.fillText(desc, 68, y);

      ctx.fillStyle = theme.muted;
      ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(formatDateTime(tx.createdAt), 480, y);

      ctx.fillStyle = tx.type === 'expense' ? '#9B2C2C' : theme.accent;
      ctx.font = '600 15px "JetBrains Mono", monospace';
      const sign = tx.type === 'expense' ? '-' : '+';
      const amtStr = `${sign} ${formatINR(tx.amount)}`;
      const w = ctx.measureText(amtStr).width;
      ctx.fillText(amtStr, 892 - w, y);
    });
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
