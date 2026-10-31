export type Status = 'ACTIVE' | 'PAUSED' | 'COMPLETED';
export type Pacing = 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'NOT_STARTED' | 'FINISHED';

export interface User {
  id: string;
  email: string;
  role: string;
}

export interface Totals {
  impressions: number;
  clicks: number;
  completions: number;
  ctr: number;
  completionRate: number;
}

export interface CampaignInput {
  title: string;
  advertiser: string;
  status?: 'ACTIVE' | 'PAUSED';
  budgetCents: number;
  cpmCents: number;
  impressionGoal: number;
  startsAt: string;
  endsAt: string;
  targetCountries: string[];
  targetGenres: string[];
  targetDevices: string[];
  targetSlots: string[];
}

export interface Campaign extends Totals, Omit<CampaignInput, 'status'> {
  id: string;
  status: Status;
  ownerEmail: string;
  spendCents: number;
  lifetimeImpressions: number;
  lifetimeSpendCents: number;
  deliveryRate: number;
  budgetUsedRate: number;
  pacing: Pacing;
}

export interface Point extends Totals {
  time: string;
}

export interface Row extends Totals {
  key: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  timeseries: Point[];
  breakdown: { slot: Row[]; country: Row[]; device: Row[]; show: Row[] };
}

export interface Show {
  id: string;
  title: string;
  genre: string;
}

export interface Range {
  from: string;
  to: string;
}

export interface Session {
  token: string;
  user: User;
}

const SESSION_KEY = 'campaign-analytics-session';

export const loadSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
};

const saveSession = (session: Session | null): void => {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The session then lasts until the page is closed or reloaded.
  }
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

let token = loadSession()?.token ?? '';
let onExpired = (): void => {};
export const setExpiredHandler = (handler: () => void): void => {
  onExpired = handler;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    message?: string;
    errors?: Record<string, string[]>;
  };
  if (!response.ok) {
    if (response.status === 401 && token) onExpired();
    throw new ApiError(response.status, body.message ?? 'Request failed.', body.errors);
  }
  return body.data as T;
}

const withRange = (path: string, range: Range): string =>
  `${path}?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;

export const api = {
  async login(email: string, password: string): Promise<Session> {
    const data = await request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    token = data.token;
    saveSession({ token: data.token, user: data.user });
    return data;
  },
  logout(): void {
    token = '';
    saveSession(null);
  },
  analytics: (range: Range) => request<Campaign[]>(withRange('/campaigns/analytics', range)),
  timeseries: (range: Range) =>
    request<Point[]>(withRange('/campaigns/analytics/timeseries', range)),
  campaign: (id: string, range: Range) =>
    request<CampaignDetail>(withRange(`/campaigns/${id}/analytics`, range)),
  options: () => request<{ demo: boolean }>('/auth/options'),
  shows: () => request<Show[]>('/shows'),
  create: (input: CampaignInput) =>
    request<{ id: string }>('/campaigns', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<CampaignInput>) =>
    request<{ id: string }>(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/campaigns/${id}`, { method: 'DELETE' }),
};
