import assert from 'node:assert/strict';
import test from 'node:test';
import { authErrorMessage, isPublicSupabaseConfig, parseEmailVerification, validateCredentials } from '../src/lib/auth-helpers';

const url = 'https://exampleproject.supabase.co';
const publishable = 'sb_publishable_example-key_123';
const tokenHash = '0123456789abcdef'.repeat(4);
const confirmationLink = `${url}/auth/v1/verify?token=${tokenHash}&type=signup`;
function legacyKey(role: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp: 4102444800 })}.test-signature`;
}

test('credential checks validate email and enforce signup password length', () => {
  assert.equal(validateCredentials(' person@example.com ', 'correct-password', true), null);
  for (const email of ['', 'person', '@example.com', 'person@', 'a b@example.com', 'person@example', `${'x'.repeat(250)}@example.com`]) {
    assert.match(validateCredentials(email, 'correct-password', true) ?? '', /email/i);
  }
  assert.match(validateCredentials('person@example.com', '') ?? '', /password/i);
  assert.match(validateCredentials('person@example.com', 'short', true) ?? '', /8 characters/i);
  assert.equal(validateCredentials('person@example.com', '12345678', true), null);
  assert.equal(validateCredentials('person@example.com', 'old', false), null);
  assert.match(validateCredentials('person@example.com', 'x'.repeat(129)) ?? '', /128 characters/i);
});

test('public Supabase configuration accepts publishable and legacy anonymous keys', () => {
  assert.equal(isPublicSupabaseConfig(url, publishable), true);
  assert.equal(isPublicSupabaseConfig(`${url}/`, publishable), true);
  assert.equal(isPublicSupabaseConfig('https://exampleproject.supabase.in', publishable), true);
  assert.equal(isPublicSupabaseConfig(url, legacyKey('anon')), true);
});

test('service-role JWTs, secret keys, malformed keys and nonpublic roles are rejected', () => {
  for (const key of [
    '', 'sb_secret_never-embed-this', 'sb_publishable_', 'not-a-jwt',
    legacyKey('service_role'), legacyKey('authenticated'), legacyKey('admin'),
    'header.%%%invalid.signature', 'header.e30.signature', 'only.two',
  ]) assert.equal(isPublicSupabaseConfig(url, key), false, key.split('.')[0]);
});

test('invalid endpoints cannot pass the public configuration guard', () => {
  for (const endpoint of [
    '', 'not a URL', 'http://exampleproject.supabase.co', 'https://supabase.co',
    'https://evil.example', 'https://exampleproject.supabase.co.evil.example',
    'https://user:password@exampleproject.supabase.co', `${url}?key=unexpected`, `${url}#fragment`,
  ]) assert.equal(isPublicSupabaseConfig(endpoint, publishable), false, endpoint);
});

test('verification accepts six to ten digit codes and preserves leading zeroes', () => {
  for (const token of ['012345', '0123456789']) {
    assert.deepEqual(parseEmailVerification(` ${token} `, url), { kind: 'code', token });
  }
  for (const input of ['', '12345', '12345678901', '123 456', 'abcdef', '123456\n789']) {
    assert.equal(parseEmailVerification(input, url), null);
  }
});

test('default confirmation links yield only a token hash, never their redirect', () => {
  for (const type of ['signup', 'email']) {
    for (const redirect of ['', 'http://localhost:3000', 'https://untrusted.example/path']) {
      const link = `${url}/auth/v1/verify?token=${tokenHash}&type=${type}${redirect ? `&redirect_to=${encodeURIComponent(redirect)}` : ''}`;
      assert.deepEqual(parseEmailVerification(` ${link} `, `${url}/`), { kind: 'link', tokenHash });
    }
  }
});

test('confirmation links reject foreign origins, credentials, ports and normalized paths', () => {
  for (const link of [
    confirmationLink.replace('https:', 'http:'),
    confirmationLink.replace('exampleproject', 'anotherproject'),
    confirmationLink.replace('.supabase.co', '.supabase.co.evil.example'),
    confirmationLink.replace('https://', 'https://user:password@'),
    confirmationLink.replace('.supabase.co', '.supabase.co:443'),
    confirmationLink.replace('.supabase.co', '.supabase.co:8443'),
    confirmationLink.replace('/auth/v1/verify', '/auth/v1/other/../verify'),
    confirmationLink.replace('/auth/v1/verify', '/auth/v1/other/%2e%2e/verify'),
    confirmationLink.replace('/auth/v1/verify', '/auth/v1/verify/'),
    confirmationLink.replace('/auth/v1/verify', '/auth/v1/%76erify'),
    confirmationLink.replace('https://', 'https:\\\\'),
    `${confirmationLink}#access_token=unexpected`,
    `${confirmationLink}#`,
    confirmationLink.replace('exampleproject', 'example\nproject'),
  ]) assert.equal(parseEmailVerification(link, url), null);
  for (const endpoint of ['', 'not a URL', 'http://exampleproject.supabase.co', `${url}/other`, `${url}?key=value`, `https://user:password@exampleproject.supabase.co`]) {
    assert.equal(parseEmailVerification(confirmationLink, endpoint), null);
  }
});

test('confirmation links reject missing, malformed, duplicate or unexpected parameters', () => {
  for (const link of [
    `${url}/auth/v1/verify`,
    `${url}/auth/v1/verify?type=email`,
    `${url}/auth/v1/verify?token=${tokenHash}`,
    confirmationLink.replace(tokenHash, ''),
    confirmationLink.replace(tokenHash, '123456'),
    confirmationLink.replace(tokenHash, 'x'.repeat(513)),
    confirmationLink.replace(tokenHash, 'x'.repeat(4100)),
    confirmationLink.replace(tokenHash, `${tokenHash}%`),
    confirmationLink.replace(tokenHash, `${tokenHash}%00`),
    `${confirmationLink}&token=${tokenHash}`,
    `${confirmationLink}&%74oken=${tokenHash}`,
    `${confirmationLink}&type=email`,
    `${confirmationLink}&redirect_to=a&redirect_to=b`,
    `${confirmationLink}&token_hash=${tokenHash}`,
    `${confirmationLink}&extra=unexpected`,
    ...['recovery', 'invite', 'magiclink', 'email_change', 'sms', 'EMAIL'].map(type => confirmationLink.replace('type=signup', `type=${type}`)),
  ]) assert.equal(parseEmailVerification(link, url), null);
});

test('auth messages explain common failures without echoing raw server details', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /Email or password/i);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /Verify your email/i);
  assert.match(authErrorMessage({ code: 'over_request_rate_limit' }), /wait/i);
  assert.equal(authErrorMessage({ code: 'email_address_not_authorized' }), 'Signups are currently limited to approved test email addresses. Try your test account email.');
  assert.match(authErrorMessage({ code: 'invalid_verification_input' }), /full confirmation link/i);
  assert.match(authErrorMessage({ code: 'otp_expired' }), /code or link.*expired/i);
  assert.match(authErrorMessage({ code: 'otp_expired' }), /sign in if you already opened the link/i);
  assert.match(authErrorMessage(new Error('Network request failed')), /internet connection/i);
  for (const error of [{ code: 'auth_request_timeout' }, new Error('Account request timed out.')]) {
    assert.match(authErrorMessage(error), /connection took too long/i);
    assert.match(authErrorMessage(error), /check your inbox first/i);
  }
  const detail = 'private token or database detail';
  const message = authErrorMessage(new Error(detail));
  assert.ok(!message.includes(detail));
  assert.match(message, /could not be completed/i);
  assert.doesNotThrow(() => authErrorMessage(null));
});
