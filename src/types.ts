/**
 * Configuration for a Twilio Verify v2 client.
 *
 * Get these values from your Twilio Console:
 *   https://console.twilio.com/us1/develop/verify/services
 */
export interface TwilioVerifyConfig {
  /** Twilio Account SID. Begins with `AC`. */
  accountSid: string;
  /** Twilio Auth Token. Treat as a bearer credential. */
  authToken: string;
  /** Verify Service SID. Begins with `VA`. Each Service has its own
   *  template settings, brand name, and rate limits. */
  serviceSid: string;
  /** Optional override for the Twilio API base URL. Defaults to
   *  `https://verify.twilio.com/v2`. Useful for testing against
   *  a local mock server. */
  baseUrl?: string;
  /** Optional fetch implementation. Defaults to `globalThis.fetch`.
   *  Used by tests to inject a mock without monkey-patching globals. */
  fetch?: typeof globalThis.fetch;
  /** Optional structured logger. Defaults to a no-op. The library
   *  never logs the verification code, the Twilio JSON body, or any
   *  request/response that could leak PII — only structural events
   *  with safe identifiers (channel, status code). */
  logger?: Logger;
}

/**
 * The supported delivery channels for `sendVerificationCode`.
 *
 * Twilio Verify supports more (`call`, `whatsapp`, `auto`, etc.) but
 * this library exposes the two we use in production. Add more if
 * needed — they pass straight through to the API.
 */
export type VerificationChannel = 'sms' | 'email';

/**
 * Input to `sendVerificationCode`.
 */
export interface SendVerificationCodeInput {
  /** How to deliver the code. */
  channel: VerificationChannel;
  /** Recipient. For `sms`, an E.164 phone number (e.g. `+15558675309`).
   *  For `email`, an email address. */
  to: string;
}

/**
 * Input to `verifyVerificationCode`.
 */
export interface VerifyVerificationCodeInput {
  /** Same `to` value used in the original `sendVerificationCode` call. */
  to: string;
  /** The code the user submitted from their SMS / email. */
  code: string;
}

/**
 * The Twilio Verify client.
 *
 * Build with `createTwilioVerifyClient(config)`. Stateless and safe to
 * cache at module scope.
 */
export interface TwilioVerifyClient {
  /**
   * Send a verification code to a phone or email address. Returns
   * `true` if Twilio accepted the request (HTTP 2xx), `false` otherwise.
   *
   * Does NOT throw on HTTP failures — Twilio returns 4xx for many
   * common cases (rate-limited, recipient blocked, invalid number)
   * that are not exceptional from the caller's perspective. The
   * caller decides whether `false` means "retry" or "give up."
   *
   * @throws {InvalidInputError} If `channel` or `to` is missing/empty.
   */
  sendVerificationCode(input: SendVerificationCodeInput): Promise<boolean>;

  /**
   * Verify a code against a previously-sent challenge. Returns `true`
   * if Twilio reports the code as approved, `false` otherwise.
   *
   * Does NOT throw on rejection or expiration — these are normal
   * outcomes, not exceptions.
   *
   * @throws {InvalidInputError} If `to` or `code` is missing/empty.
   */
  verifyVerificationCode(input: VerifyVerificationCodeInput): Promise<boolean>;
}

/**
 * A pluggable structured logger. The argument order matches `pino`'s
 * idiomatic shape so a pino logger can be passed directly without
 * adaptation.
 *
 * The library never logs the verification code, the recipient's
 * phone/email, or any HTTP body content. Only structural events with
 * safe identifiers (channel, HTTP status code).
 */
export interface Logger {
  debug(data: Record<string, unknown>, msg: string): void;
  info(data: Record<string, unknown>, msg: string): void;
  warn(data: Record<string, unknown>, msg: string): void;
  error(data: Record<string, unknown>, msg: string): void;
}
