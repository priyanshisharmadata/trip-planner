import { AiPlannerError } from '../_shared/ai-planner.ts';

type RecordValue = Record<string, unknown>;
type Quota = { metric?: string; limit?: string; value?: number };
export type ProviderDiagnostic = {
  event: 'ai_planner_provider_error';
  stage: 'discovery' | 'formatting';
  status: number;
  code: string;
  providerCode: 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'BILLING_REQUIRED' | 'KEY_REJECTED' | 'MODEL_UNAVAILABLE' | 'REQUEST_REJECTED' | 'CAPACITY_UNAVAILABLE';
  quota: Quota[];
  retrySeconds?: number;
};
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const number = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;

/** Classifies metadata only; never returns provider messages, keys, project IDs or quota dimensions. */
export function providerFailure(status: number, raw: unknown, stage: ProviderDiagnostic['stage'], retryAfter: string | null) {
  const error = record(record(raw).error);
  const details = Array.isArray(error.details) ? error.details.slice(0, 12).map(record) : [];
  const quota: Quota[] = [];
  const reasons: string[] = [];
  let retrySeconds: number | undefined;
  const setRetry = (value: unknown) => {
    const seconds = number(value);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400) retrySeconds = Math.ceil(seconds);
  };
  setRetry(retryAfter);
  for (const detail of details) {
    if (detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && typeof detail.reason === 'string') reasons.push(detail.reason.toUpperCase());
    if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && typeof detail.retryDelay === 'string') setRetry(detail.retryDelay.replace(/s$/, ''));
    if (detail['@type'] !== 'type.googleapis.com/google.rpc.QuotaFailure' || !Array.isArray(detail.violations)) continue;
    for (const rawViolation of detail.violations.slice(0, 8)) {
      const violation = record(rawViolation);
      const entry: Quota = {};
      if (typeof violation.quotaMetric === 'string' && /^generativelanguage\.googleapis\.com\/[a-zA-Z0-9_./-]{1,140}$/.test(violation.quotaMetric)) entry.metric = violation.quotaMetric;
      if (typeof violation.quotaId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(violation.quotaId) && /quota|request|token|ground|perminute|perday|perproject|permodel/i.test(violation.quotaId)) entry.limit = violation.quotaId;
      const value = number(violation.quotaValue);
      if (Number.isFinite(value) && value >= 0 && value <= 1e15) entry.value = value;
      if (Object.keys(entry).length) quota.push(entry);
    }
  }
  // Some API errors omit ErrorInfo. Inspect a bounded message for classification, never expose it.
  const message = typeof error.message === 'string' ? error.message.slice(0, 8000).toLowerCase() : '';
  const reason = reasons.join(' ');
  let code = 'UPSTREAM_UNAVAILABLE';
  let providerCode: ProviderDiagnostic['providerCode'] = 'CAPACITY_UNAVAILABLE';
  let publicMessage = 'The AI provider is temporarily unavailable. Try again later or use an offline plan.';
  if (/BILLING|PAYMENT|CREDIT_BALANCE/.test(reason) || /billing (?:is )?(?:disabled|not enabled|not active)|enable billing|paid tier|prepay|credit balance|spend cap/.test(message)) {
    code = 'PROVIDER_NOT_CONFIGURED'; providerCode = 'BILLING_REQUIRED';
    publicMessage = 'The Google AI project cannot serve this model with its current account setup. Use an offline plan while the app owner checks Google AI Studio.';
  } else if (status === 401 || /API_KEY|KEY_EXPIRED|KEY_INVALID/.test(reason) || /api key (?:not valid|is invalid|has expired|was reported as leaked)/.test(message)) {
    code = 'PROVIDER_NOT_CONFIGURED'; providerCode = 'KEY_REJECTED';
    publicMessage = 'The AI provider rejected the app connection. Use an offline plan while the app owner checks its API key.';
  } else if (status === 404 || /MODEL_NOT_FOUND|MODEL_NOT_SUPPORTED/.test(reason) || /model.{0,100}(?:not found|not supported|not available)/.test(message)) {
    code = 'PROVIDER_NOT_CONFIGURED'; providerCode = 'MODEL_UNAVAILABLE';
    publicMessage = 'The configured AI model is unavailable for this project. Use an offline plan while the app owner checks the model setup.';
  } else if (status === 429) {
    // Protobuf JSON can omit a zero-valued quotaValue; Gemini then reports "limit: 0" only in its message.
    const exhausted = /\blimit:\s*0(?:\D|$)/.test(message) || quota.some(item => item.value === 0 || /per.?day|daily/i.test(`${item.metric} ${item.limit}`));
    const transient = !exhausted && (retrySeconds !== undefined || quota.some(item => /per.?minute|per.?second/i.test(`${item.metric} ${item.limit}`)));
    code = transient ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_QUOTA_EXHAUSTED';
    providerCode = transient ? 'RATE_LIMITED' : 'QUOTA_EXHAUSTED';
    publicMessage = transient
      ? 'Google AI has temporarily limited this project. Try again later or use an offline plan.'
      : 'The Google AI project has no available quota for this model. Use an offline plan while the app owner checks its model quota in Google AI Studio.';
  } else if (status === 400 || status === 403) {
    code = 'PROVIDER_NOT_CONFIGURED'; providerCode = 'REQUEST_REJECTED';
    publicMessage = 'Google AI rejected the app configuration. Use an offline plan while the app owner checks its API access.';
  }
  const diagnostic: ProviderDiagnostic = { event: 'ai_planner_provider_error', stage, status, code, providerCode, quota, ...(retrySeconds ? { retrySeconds } : {}) };
  return { error: new AiPlannerError(code, publicMessage, 503), diagnostic, retrySeconds: code === 'PROVIDER_RATE_LIMITED' ? retrySeconds : undefined };
}
