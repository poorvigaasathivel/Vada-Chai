export type SupportedLanguage =
  | 'English'
  | 'Tamil'
  | 'Hindi'
  | 'Malayalam'
  | 'Kannada'
  | 'Telugu';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'English',
  'Tamil',
  'Hindi',
  'Malayalam',
  'Kannada',
  'Telugu',
];

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  preferredLanguage: SupportedLanguage;
  city: string;
  balance: number;
  referenceAmount: number;
  hasInitializedBalance: boolean;
  lowBalanceAlertSent: boolean;
  createdAt: string;
}

export interface Transaction {
  id: number;
  type: 'initial' | 'addition' | 'expense';
  amount: number;
  description: string;
  source: 'manual' | 'voice';
  spokenLanguage: string | null;
  transcript: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface SnapshotSummaryItem {
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

export interface MoneySnapshot {
  id: number;
  previousBalance: number;
  addedAmount: number;
  newBalance: number;
  totalSpentInPeriod: number;
  transactionCount: number;
  periodSummary: SnapshotSummaryItem[];
  imageDataUrl: string;
  createdAt: string;
}

export interface AppNotification {
  id: number;
  kind: 'expense' | 'addition' | 'low_balance' | 'welcome';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface PastelTheme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentText: string;
  border: string;
  text: string;
  muted: string;
  swatches: string[];
}

export interface DailyIllustration {
  dateKey: string;
  sceneTheme: string;
  imageUrl: string;
  title: string;
  caption: string;
  characterQuote: string;
  moneyTip: string;
  fallbackPalette: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    accent: string;
    accentText: string;
    border: string;
  };
  totalScenes: number;
}

export interface ParsedVoiceExpense {
  amount: number;
  description: string;
  detectedLanguage: string;
  transcript: string;
}
