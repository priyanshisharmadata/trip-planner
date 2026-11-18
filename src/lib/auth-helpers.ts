export function validateCredentials(email: string, password: string, signingUp = false): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) return 'Enter a valid email address.';
  if (!password) return 'Enter your password.';
  if (signingUp && password.length < 8) return 'Use a password with at least 8 characters.';
  if (password.length > 128) return 'Keep your password within 128 characters.';
  return null;
}

type EmailVerification = { kind: 'code'; token: string } | { kind: 'link'; tokenHash: string };

export function parseEmailVerification(input: string, projectUrl: string): EmailVerification | null {
  const value = input.trim();
  if (/^\d{6,10}$/.test(value)) return { kind: 'code', token: value };
  if (value.length > 4096 || /[\s\\]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return null;
  try {
    const project = new URL(projectUrl);
    const link = new URL(value);
    // Compare the literal authority/path too: URL normalizes default ports and dot segments.
    const literal = /^https:\/\/([^/?#]+)(\/[^?#]*)\?[^#]*$/i.exec(value);
    if (!literal || project.protocol !== 'https:' || project.username || project.password || project.port || project.pathname !== '/' || project.search || project.hash) return null;
    if (literal[1].toLowerCase() !== project.hostname.toLowerCase() || literal[2] !== '/auth/v1/verify' || link.origin !== project.origin) return null;
    const seen = new Set<string>();
    let invalidParameter = false;
    link.searchParams.forEach((_value, key) => {
      if (seen.has(key) || !['token', 'type', 'redirect_to'].includes(key)) invalidParameter = true;
      seen.add(key);
    });
    if (invalidParameter) return null;
    const tokenHash = link.searchParams.get('token');
    const type = link.searchParams.get('type');
    if (!tokenHash || !/^[A-Za-z0-9_-]{20,512}$/.test(tokenHash) || (type !== 'signup' && type !== 'email')) return null;
    // Only the proof of email ownership is used. Never follow or pass along redirect_to.
    return { kind: 'link', tokenHash };
  } catch { return null; }
}

export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    invalid_credentials: 'Email or password is incorrect. Please try again.',
    email_not_confirmed: 'Verify your email first, then sign in.',
    email_address_not_authorized: 'Signups are currently limited to approved test email addresses. Try your test account email.',
    user_already_exists: 'An account may already use this email. Try signing in.',
    weak_password: 'Choose a stronger password with at least 8 characters.',
    over_email_send_rate_limit: 'Too many emails requested. Please wait a few minutes and try again.',
    over_request_rate_limit: 'Too many attempts. Please wait and try again.',
    invalid_verification_input: 'Enter the code from your email or paste its full confirmation link.',
    otp_expired: 'That verification code or link has expired or is incorrect. Request a new email, or sign in if you already opened the link.',
    signup_disabled: 'New accounts are temporarily unavailable. Please try again later.',
  };
  if (messages[code]) return messages[code];
  // Supabase wraps fetch failures and preserves their message, but not their code.
  if (code === 'auth_request_timeout' || (error instanceof Error && /timed out/i.test(error.message))) return 'The connection took too long. Check your internet or switch between Wi-Fi and mobile data, then try again. If you were creating an account, check your inbox first.';
  if (error instanceof Error && /network|fetch|timeout|connection/i.test(error.message)) return 'Could not connect. Check your internet connection and try again.';
  return 'This account action could not be completed. Please try again.';
}

// A service-role JWT must never be embedded in a mobile app.
function legacyKeyRole(key: string): string | null {
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const part = key.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!part) return null;
    let bits = 0, value = 0, decoded = '';
    for (const char of part.replace(/=+$/, '')) {
      const index = alphabet.indexOf(char);
      if (index < 0) return null;
      value = (value << 6) | index;
      bits += 6;
      if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((value >> bits) & 255); }
    }
    return JSON.parse(decoded).role ?? null;
  } catch { return null; }
}

export function isPublicSupabaseConfig(url: string, key: string): boolean {
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.port || endpoint.pathname !== '/') return false;
    if (!endpoint.hostname.endsWith('.supabase.co') && !endpoint.hostname.endsWith('.supabase.in')) return false;
    return /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || (key.split('.').length === 3 && legacyKeyRole(key) === 'anon');
  } catch { return false; }
}
