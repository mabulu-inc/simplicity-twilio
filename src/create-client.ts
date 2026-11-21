import { InvalidInputError, TwilioUnavailableError } from './errors.js';
import { noopLogger } from './internal/noop-logger.js';
import type {
  SendVerificationCodeInput,
  TwilioVerifyClient,
  TwilioVerifyConfig,
  VerifyVerificationCodeInput,
} from './types.js';

const DEFAULT_BASE_URL = 'https://verify.twilio.com/v2';

/** Twilio's "too many attempts for this one recipient" codes: a 429 that is about the number, not the account. */
const MAX_SEND_ATTEMPTS = 60203;
const MAX_CHECK_ATTEMPTS = 60202;

/**
 * Reads Twilio's numeric error code from a failed response and nothing else.
 * The body's `message` can quote the recipient, so it is never returned.
 */
async function readTwilioCode(response: Response): Promise<number | undefined> {
  try {
    const body = JSON.parse(await response.text()) as { code?: unknown };
    return typeof body?.code === 'number' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a failed response means Twilio can't serve anyone right now, as
 * opposed to refusing this one recipient or challenge. Bad credentials (401),
 * Twilio errors (5xx) and account-wide rate limits (429 other than the
 * per-recipient code) are outages. A 403 is not: Twilio uses it for a
 * blocked destination country (60605).
 */
function isOutage(status: number, twilioCode: number | undefined, perRecipientLimit: number): boolean {
  if (status === 401 || status >= 500) return true;
  if (status === 429) return twilioCode !== perRecipientLimit;
  return false;
}

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

    let response: Response;
    try {
      response = await fetchImpl(`${serviceUrl}/Verifications`, {
        method: 'POST',
        headers,
        body: params,
      });
    } catch (error) {
      log.error({ channel: input.channel }, 'verification code send failed (network error)');
      throw new TwilioUnavailableError('Twilio could not be reached', { cause: error });
    }

    if (!response.ok) {
      // Only Twilio's numeric code is read from the body. Its message can
      // quote the recipient, so it is never logged or returned.
      const twilioCode = await readTwilioCode(response);
      const { status } = response;
      // A 404 here means the Verify Service doesn't exist: no one can be sent a code.
      if (status === 404 || isOutage(status, twilioCode, MAX_SEND_ATTEMPTS)) {
        log.error({ channel: input.channel, status, twilioCode }, 'verification code send failed (twilio unavailable)');
        throw new TwilioUnavailableError(`Twilio refused the send with HTTP ${status}`, { status, twilioCode });
      }
      log.warn({ channel: input.channel, status, twilioCode }, 'verification code send rejected');
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
      log.error({}, 'verification check failed (network error)');
      throw new TwilioUnavailableError('Twilio could not be reached', { cause: error });
    }

    if (!response.ok) {
      const twilioCode = await readTwilioCode(response);
      const { status } = response;
      // A 404 here is the normal answer for an expired or already-used
      // challenge, so unlike a send it isn't treated as an outage.
      if (isOutage(status, twilioCode, MAX_CHECK_ATTEMPTS)) {
        log.error({ status, twilioCode }, 'verification check failed (twilio unavailable)');
        throw new TwilioUnavailableError(`Twilio refused the check with HTTP ${status}`, { status, twilioCode });
      }
      log.warn({ status, twilioCode }, 'verification check rejected by twilio');
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
