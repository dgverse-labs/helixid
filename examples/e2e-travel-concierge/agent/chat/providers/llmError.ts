// Normalized LLM-provider error handling. Each provider adapter (Gemini's raw
// REST call, the OpenAI/Anthropic SDKs) throws its own shape of error on
// failure — this maps all of them onto one small, closed set of codes so the
// rest of the agent (runChatTurn, the /chat route, the web UI) only ever has
// to handle five cases, with a message that's safe to show a user, instead of
// a raw provider stack trace / JSON body landing in the chat transcript.

export type LlmErrorCode =
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN';

const HTTP_STATUS_BY_CODE: Record<LlmErrorCode, number> = {
  RATE_LIMITED: 429,
  AUTH_FAILED: 500,
  INVALID_REQUEST: 500,
  PROVIDER_UNAVAILABLE: 503,
  UNKNOWN: 500,
};

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly provider: string;
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;
  /** One line, safe to render directly in the chat transcript. */
  readonly userMessage: string;

  constructor(params: {
    code: LlmErrorCode;
    provider: string;
    userMessage: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(`[${params.provider}] ${params.code}: ${params.userMessage}`);
    this.name = 'LlmError';
    this.code = params.code;
    this.provider = params.provider;
    this.httpStatus = HTTP_STATUS_BY_CODE[params.code];
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.userMessage = params.userMessage;
    if (params.cause !== undefined) this.cause = params.cause;
  }
}

function classifyHttpStatus(status: number): LlmErrorCode {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 400 || status === 404 || status === 422) return 'INVALID_REQUEST';
  if (status >= 500 || status === 408) return 'PROVIDER_UNAVAILABLE';
  return 'UNKNOWN';
}

function defaultUserMessage(provider: string, code: LlmErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case 'RATE_LIMITED':
      return retryAfterSeconds
        ? `${provider} rate-limited this request — try again in about ${retryAfterSeconds}s.`
        : `${provider} rate-limited this request — try again shortly.`;
    case 'AUTH_FAILED':
      return `${provider} rejected the API key — check LLM_API_KEY in .env.`;
    case 'INVALID_REQUEST':
      return `${provider} rejected the request as malformed.`;
    case 'PROVIDER_UNAVAILABLE':
      return `${provider} is temporarily unavailable — try again shortly.`;
    case 'UNKNOWN':
      return `${provider} returned an unexpected error.`;
  }
}

/** Google's RetryInfo detail, when present: { "@type": "...RetryInfo", "retryDelay": "45s" }. */
function extractGeminiRetryDelaySeconds(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as { error?: { details?: unknown } }).error;
  const details = error && typeof error === 'object' ? (error as { details?: unknown }).details : undefined;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (
      detail &&
      typeof detail === 'object' &&
      (detail as { '@type'?: unknown })['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
    ) {
      const raw = (detail as { retryDelay?: unknown }).retryDelay;
      if (typeof raw === 'string') {
        const match = /^(\d+(?:\.\d+)?)s$/.exec(raw);
        if (match) return Math.ceil(Number(match[1]));
      }
    }
  }
  return undefined;
}

/** Builds an LlmError from a raw HTTP status + response body (Gemini's REST adapter). */
export function llmErrorFromHttp(provider: string, status: number, bodyText: string): LlmError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }
  const code = classifyHttpStatus(status);
  const retryAfterSeconds = code === 'RATE_LIMITED' ? extractGeminiRetryDelaySeconds(parsed) : undefined;
  return new LlmError({
    code,
    provider,
    userMessage: defaultUserMessage(provider, code, retryAfterSeconds),
    retryAfterSeconds,
    cause: parsed ?? bodyText,
  });
}

/** Builds an LlmError from an SDK exception (OpenAI's or Anthropic's client both throw an APIError-shaped object with a numeric `.status`). */
export function llmErrorFromSdkError(provider: string, err: unknown): LlmError {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
  if (status === undefined) {
    // Not an API-level error (e.g. a network failure before a response came back).
    return new LlmError({
      code: 'PROVIDER_UNAVAILABLE',
      provider,
      userMessage: defaultUserMessage(provider, 'PROVIDER_UNAVAILABLE'),
      cause: err,
    });
  }
  const retryAfterHeader = (err as { headers?: Record<string, string> })?.headers?.['retry-after'];
  const retryAfterSeconds =
    status === 429 && retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  const code = classifyHttpStatus(status);
  return new LlmError({
    code,
    provider,
    userMessage: defaultUserMessage(provider, code, retryAfterSeconds),
    retryAfterSeconds,
    cause: err,
  });
}
