import type {
  AppNotification,
  DailyIllustration,
  MoneySnapshot,
  ParsedVoiceExpense,
  SupportedLanguage,
  Transaction,
  UserProfile,
} from './types';

let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const res = await fetch(path, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register(payload: {
    name: string;
    email: string;
    password: string;
    preferredLanguage: SupportedLanguage;
    city: string;
  }) {
    return apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(payload: { email: string; password: string }) {
    return apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProfile(payload: {
    name: string;
    preferredLanguage: SupportedLanguage;
    city: string;
  }) {
    return apiFetch<{ user: UserProfile }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  getDailyIllustration(offset = 0) {
    return apiFetch<DailyIllustration>(`/api/daily-illustration?offset=${offset}`);
  },

  getDashboard() {
    return apiFetch<{
      user: UserProfile;
      transactions: Transaction[];
      snapshots: MoneySnapshot[];
      notifications: AppNotification[];
    }>('/api/dashboard');
  },

  initializeBalance(payload: { amount: number; clientRequestId: string }) {
    return apiFetch<{ user: UserProfile }>('/api/money/initialize', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  addMoney(payload: {
    amount: number;
    description: string;
    snapshotImageDataUrl: string;
    clientRequestId: string;
  }) {
    return apiFetch<{ user: UserProfile }>('/api/money/add', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  addExpense(payload: {
    amount: number;
    description: string;
    source: 'manual' | 'voice';
    spokenLanguage?: string;
    transcript?: string;
    clientRequestId: string;
  }) {
    return apiFetch<{
      user: UserProfile;
      triggeredLowBalance: boolean;
      lowBalanceMessage: string | null;
    }>('/api/money/expense', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  markAllNotificationsRead() {
    return apiFetch<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' });
  },

  markNotificationRead(id: number) {
    return apiFetch<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' });
  },

  voiceExpense(payload: {
    audioBase64: string;
    mimeType: string;
    preferredLanguage?: string;
  }) {
    return apiFetch<ParsedVoiceExpense>('/api/ai/voice-expense', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  parseExpenseText(payload: { text: string; preferredLanguage?: string }) {
    return apiFetch<ParsedVoiceExpense>('/api/ai/parse-expense', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
