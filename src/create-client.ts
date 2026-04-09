import { InvalidInputError } from './errors.js';
import { noopLogger } from './internal/noop-logger.js';
import type {
  SendVerificationCodeInput,
  TwilioVerifyClient,
  TwilioVerifyConfig,
  VerifyVerificationCodeInput,
} from './types.js';

const DEFAULT_BASE_URL = 'https://verify.twilio.com/v2';

/**
 * Create a Twilio Verify v2 client.
 *
 * Stateless and safe to cache at module scope. Does NOT read environment
 * variables — pass credentials explicitly. This makes the library
 * trivially testable, supports multi-account use cases, and means a
 * stale env var can never silently break a production deploy.
 *
 * @example
 * ```ts
 * import { createTwilioVerifyClient } from '@smplcty/twilio';
 *
 * const twilio = createTwilioVerifyClient({
 *   accountSid: process.env.TWILIO_ACCOUNT_SID!,
 *   authToken: process.env.TWILIO_AUTH_TOKEN!,
 *   serviceSid: process.env.TWILIO_SERVICE_SID!,
 * });
 *
 * await twilio.sendVerificationCode({ channel: 'sms', to: '+15558675309' });
 * // ...later...
 * const ok = await twilio.verifyVerificationCode({
 *   to: '+15558675309',
 *   code: '123456',
 * });
 * ```
 *
 * @throws {InvalidInputError} If any required config field is missing
 *   or empty.
 */
export function createTwilioVerifyClient(
  config: TwilioVerifyConfig,
): TwilioVerifyClient {
  if (typeof config?.accountSid !== 'string' || config.accountSid.length === 0) {
    throw new InvalidInputError('config.accountSid must be a non-empty string');
  }
  if (typeof config?.authToken !== 'string' || config.authToken.length === 0) {
    throw new InvalidInputError('config.authToken must be a non-empty string');
  }
  if (typeof config?.serviceSid !== 'string' || config.serviceSid.length === 0) {
    throw new InvalidInputError('config.serviceSid must be a non-empty string');
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const log = config.logger ?? noopLogger;

  // Build the Authorization header once. The credentials are captured
  // in the closure — if the caller wants to rotate them they create a
  // new client.
  const basicAuth = Buffer.from(
    `${config.accountSid}:${config.authToken}`,
  ).toString('base64');

  const headers = {
    Authorization: `Basic ${basicAuth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  } as const;

  const serviceUrl = `${baseUrl}/Services/${config.serviceSid}`;

  async function sendVerificationCode(
    input: SendVerificationCodeInput,
  ): Promise<boolean> {
    if (typeof input?.channel !== 'string' || input.channel.length === 0) {
      throw new InvalidInputError('input.channel must be a non-empty string');
    }
    if (typeof input?.to !== 'string' || input.to.length === 0) {
      throw new InvalidInputError('input.to must be a non-empty string');
    }

    const params = new URLSearchParams();
    params.append('Channel', input.channel);
    params.append('To', input.to);

    log.debug({ channel: input.channel }, 'sending verification code');

    const response = await fetchImpl(`${serviceUrl}/Verifications`, {
      method: 'POST',
      headers,
      body: params,
    });

    if (!response.ok) {
      // Read the body to drain the connection but DO NOT log it —
      // Twilio error bodies can include the recipient address and
      // detailed account information. Log only the status code.
      try {
        await response.text();
      } catch {
        // ignore
      }
      log.warn(
        { channel: input.channel, status: response.status },
        'verification code send rejected',
      );
      return false;
    }

    log.debug(
      { channel: input.channel, status: response.status },
      'verification code sent',
    );
    return true;
  }

  async function verifyVerificationCode(
    input: VerifyVerificationCodeInput,
  ): Promise<boolean> {
    if (typeof input?.to !== 'string' || input.to.length === 0) {
      throw new InvalidInputError('input.to must be a non-empty string');
    }
    if (typeof input?.code !== 'string' || input.code.length === 0) {
      throw new InvalidInputError('input.code must be a non-empty string');
    }

    const params = new URLSearchParams();
    params.append('Code', input.code);
    params.append('To', input.to);

    // Note: deliberately do NOT log the code or `to` here. Logging the
    // code would record OTPs in CloudWatch; logging `to` is PII.
    log.debug({}, 'verifying verification code');

    let response: Response;
    try {
      response = await fetchImpl(`${serviceUrl}/VerificationCheck`, {
        method: 'POST',
        headers,
        body: params,
      });
    } catch (error) {
      // Network errors should not crash the request handler — return
      // false and let the caller decide whether to retry.
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'verification check failed (network error)',
      );
      return false;
    }

    if (!response.ok) {
      // Drain the body without logging it.
      try {
        await response.text();
      } catch {
        // ignore
      }
      log.warn(
        { status: response.status },
        'verification check rejected by twilio',
      );
      return false;
    }

    let body: { status?: unknown };
    try {
      body = (await response.json()) as { status?: unknown };
    } catch {
      log.warn({ status: response.status }, 'verification check returned invalid json');
      return false;
    }

    const approved = body?.status === 'approved';
    log.debug(
      { approved, status: response.status },
      'verification check complete',
    );
    return approved;
  }

  return { sendVerificationCode, verifyVerificationCode };
}
