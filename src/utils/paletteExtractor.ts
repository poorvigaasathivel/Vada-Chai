import type { PastelTheme } from '../types';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0'))
      .join('')
  );
}

function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastWithWhite(r: number, g: number, b: number): number {
  const lum = relativeLuminance(r, g, b);
  return 1.05 / (lum + 0.05);
}

function ensureAccessibleAccent(h: number, s: number): { accent: string; hover: string } {
  let l = 42;
  const sat = Math.max(38, Math.min(68, s));
  while (l > 22) {
    const [r, g, b] = hslToRgb(h, sat, l);
    if (contrastWithWhite(r, g, b) >= 4.7) {
      return {
        accent: rgbToHex(r, g, b),
        hover: hslToHex(h, sat, Math.max(18, l - 6)),
      };
    }
    l -= 2;
  }
  return {
    accent: hslToHex(h, sat, 32),
    hover: hslToHex(h, sat, 26),
  };
}

export async function extractPastelThemeFromImage(
  imageUrl: string,
  fallback?: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    accent: string;
    accentText: string;
    border: string;
  }
): Promise<PastelTheme> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    const width = 72;
    const height = 42;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    interface Bucket {
      rSum: number;
      gSum: number;
      bSum: number;
      count: number;
    }

    const buckets = new Map<string, Bucket>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 200) continue;

      const [, s, l] = rgbToHsl(r, g, b);
      // Skip near-white paper & deep black ink lines
      if (l > 91 || l < 16 || s < 12) continue;

      const rq = Math.floor(r / 28);
      const gq = Math.floor(g / 28);
      const bq = Math.floor(b / 28);
      const key = `${rq}-${gq}-${bq}`;
      const existing = buckets.get(key) ?? { rSum: 0, gSum: 0, bSum: 0, count: 0 };
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
      existing.count += 1;
      buckets.set(key, existing);
    }

    const clusters = Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((b) => {
        const r = Math.round(b.rSum / b.count);
        const g = Math.round(b.gSum / b.count);
        const bl = Math.round(b.bSum / b.count);
        const [h, s, l] = rgbToHsl(r, g, bl);
        return { r, g, b: bl, h, s, l, count: b.count };
      });

    if (clusters.length === 0) {
      throw new Error('No dominant hues extracted');
    }

    // Primary backdrop hue from largest soft cluster
    const primary = clusters[0];
    // Accent hue: pick the richest saturated cluster ideally distinct in hue
    const accentCluster =
      clusters.find((c) => c.s >= 32 && Math.abs(c.h - primary.h) > 18) ??
      clusters.reduce((best, cur) => (cur.s > best.s ? cur : best), primary);

    const { accent, hover } = ensureAccessibleAccent(accentCluster.h, accentCluster.s);

    const bg = hslToHex(primary.h, Math.min(34, Math.max(18, primary.s)), 95);
    const surface = hslToHex(primary.h, Math.min(24, Math.max(10, primary.s)), 99);
    const surfaceAlt = hslToHex(primary.h, Math.min(30, Math.max(16, primary.s)), 91);
    const accentSoft = hslToHex(accentCluster.h, Math.min(48, Math.max(28, accentCluster.s)), 90);
    const border = hslToHex(primary.h, Math.min(24, Math.max(14, primary.s)), 84);

    const swatches = clusters.slice(0, 4).map((c) => hslToHex(c.h, Math.min(62, Math.max(30, c.s)), 72));

    return {
      bg,
      surface,
      surfaceAlt,
      accent,
      accentHover: hover,
      accentSoft,
      accentText: '#FFFFFF',
      border,
      text: '#1F1D1A',
      muted: '#5D574F',
      swatches,
    };
  } catch {
    const f = fallback ?? {
      bg: '#FAF5EC',
      surface: '#FFFDF8',
      surfaceAlt: '#F3E9D8',
      accent: '#C96D3B',
      accentText: '#FFFFFF',
      border: '#E5D8C3',
    };
    return {
      bg: f.bg,
      surface: f.surface,
      surfaceAlt: f.surfaceAlt,
      accent: f.accent,
      accentHover: f.accent,
      accentSoft: f.surfaceAlt,
      accentText: f.accentText,
      border: f.border,
      text: '#1F1D1A',
      muted: '#5D574F',
      swatches: [f.accent, f.surfaceAlt, f.border, f.bg],
    };
  }
}

export function applyPastelThemeToDocument(theme: PastelTheme): void {
  const root = document.documentElement;
  root.style.setProperty('--theme-bg', theme.bg);
  root.style.setProperty('--theme-surface', theme.surface);
  root.style.setProperty('--theme-surface-alt', theme.surfaceAlt);
  root.style.setProperty('--theme-accent', theme.accent);
  root.style.setProperty('--theme-accent-hover', theme.accentHover);
  root.style.setProperty('--theme-accent-soft', theme.accentSoft);
  root.style.setProperty('--theme-accent-text', theme.accentText);
  root.style.setProperty('--theme-border', theme.border);
  root.style.setProperty('--theme-text', theme.text);
  root.style.setProperty('--theme-muted', theme.muted);
}
