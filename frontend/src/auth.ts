import { getConfig } from './config';

/**
 * Minimal Cognito User Pools client (no SDK needed). Tokens live in sessionStorage only,
 * so closing the tab signs the organizer out. No secrets exist in the browser – the app client is public.
 */
interface Tokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export type SignInResult = { status: 'SIGNED_IN' } | { status: 'NEW_PASSWORD_REQUIRED'; session: string; username: string };

const KEY = 'eventflow.tokens';
const listeners = new Set<() => void>();

export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { region } = getConfig();
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.__type ?? 'Error').split('#').pop()!;
    const friendly: Record<string, string> = {
      NotAuthorizedException: 'Incorrect email or password.',
      UserNotFoundException: 'Incorrect email or password.',
      InvalidPasswordException: data.message ?? 'Password does not meet the policy requirements.',
      PasswordResetRequiredException: 'A password reset is required for this account.',
      TooManyRequestsException: 'Too many attempts. Please wait a moment and try again.',
      LimitExceededException: 'Too many attempts. Please wait a moment and try again.',
    };
    throw new AuthError(code, friendly[code] ?? data.message ?? 'Sign-in failed.');
  }
  return data as T;
}

interface AuthResult {
  AuthenticationResult?: { AccessToken: string; IdToken: string; RefreshToken?: string; ExpiresIn: number };
  ChallengeName?: string;
  Session?: string;
}

function store(r: NonNullable<AuthResult['AuthenticationResult']>, previousRefresh?: string) {
  const t: Tokens = {
    accessToken: r.AccessToken,
    idToken: r.IdToken,
    refreshToken: r.RefreshToken ?? previousRefresh,
    expiresAt: Date.now() + (r.ExpiresIn - 60) * 1000,
  };
  sessionStorage.setItem(KEY, JSON.stringify(t));
  listeners.forEach((l) => l());
}

function read(): Tokens | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : undefined;
  } catch {
    return undefined;
  }
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const r = await cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: getConfig().userPoolClientId,
    AuthParameters: { USERNAME: email.trim().toLowerCase(), PASSWORD: password },
  });
  if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED' && r.Session) {
    return { status: 'NEW_PASSWORD_REQUIRED', session: r.Session, username: email.trim().toLowerCase() };
  }
  if (!r.AuthenticationResult) throw new AuthError('UnsupportedChallenge', `Unsupported sign-in challenge: ${r.ChallengeName}`);
  store(r.AuthenticationResult);
  return { status: 'SIGNED_IN' };
}

export async function completeNewPassword(username: string, newPassword: string, session: string): Promise<void> {
  const r = await cognito<AuthResult>('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: getConfig().userPoolClientId,
    Session: session,
    ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
  });
  if (!r.AuthenticationResult) throw new AuthError('UnsupportedChallenge', 'Unable to complete sign-in.');
  store(r.AuthenticationResult);
}

/** Returns a valid access token, refreshing it if needed; undefined when signed out. */
export async function getAccessToken(): Promise<string | undefined> {
  const t = read();
  if (!t) return undefined;
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) {
    signOutLocal();
    return undefined;
  }
  try {
    const r = await cognito<AuthResult>('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: getConfig().userPoolClientId,
      AuthParameters: { REFRESH_TOKEN: t.refreshToken },
    });
    if (!r.AuthenticationResult) throw new Error('refresh failed');
    store(r.AuthenticationResult, t.refreshToken);
    return r.AuthenticationResult.AccessToken;
  } catch {
    signOutLocal();
    return undefined;
  }
}

function decode(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch {
    return {};
  }
}

export interface CurrentUser {
  email: string;
  groups: string[];
}

export function currentUser(): CurrentUser | undefined {
  const t = read();
  if (!t) return undefined;
  const id = decode(t.idToken);
  return { email: String(id.email ?? ''), groups: (id['cognito:groups'] as string[]) ?? [] };
}

function signOutLocal() {
  sessionStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export async function signOut(): Promise<void> {
  const t = read();
  signOutLocal();
  if (t?.refreshToken) {
    await cognito('RevokeToken', { ClientId: getConfig().userPoolClientId, Token: t.refreshToken }).catch(() => undefined);
  }
}

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
