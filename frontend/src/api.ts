import { getAccessToken } from './auth';
import { getConfig } from './config';

export interface PublicEvent {
  eventId: string;
  name: string;
  tagline: string;
  description: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  capacity: number;
  registeredCount: number;
  availableSeats: number;
  capacityPercent: number;
  registrationOpen: boolean;
}

export interface Registration {
  confirmationId: string;
  eventId: string;
  name: string;
  email: string;
  organization: string;
  status: 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  cancelledAt?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (auth) {
    const token = await getAccessToken();
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    headers.set('Authorization', `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${getConfig().apiUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error – please check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    const message = res.status === 401 ? 'Your session has expired. Please sign in again.' : e.message ?? data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, e.code ?? 'ERROR', message, e.details);
  }
  return data as T;
}

const ev = () => encodeURIComponent(getConfig().eventId);

export const api = {
  getEvent: () => request<PublicEvent>(`/events/${ev()}`),
  register: (input: { name: string; email: string; organization: string }) =>
    request<Registration>(`/events/${ev()}/registrations`, { method: 'POST', body: JSON.stringify(input) }),
  listRegistrations: () => request<{ event: PublicEvent; registrations: Registration[] }>(`/events/${ev()}/registrations`, {}, true),
  cancelRegistration: (confirmationId: string) =>
    request<{ confirmationId: string; status: string }>(`/events/${ev()}/registrations/${encodeURIComponent(confirmationId)}`, { method: 'DELETE' }, true),
};

export function formatEventDates(e: Pick<PublicEvent, 'startDate' | 'endDate' | 'timezone'>): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', timeZone: e.timezone || undefined };
  const start = new Date(e.startDate);
  const end = new Date(e.endDate);
  const year = start.toLocaleDateString('en-US', { year: 'numeric', timeZone: e.timezone || undefined });
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { day: 'numeric', timeZone: e.timezone || undefined })}, ${year}`;
}
