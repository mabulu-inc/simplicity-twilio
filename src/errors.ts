/**
 * Base class for all errors thrown by `@smplcty/twilio`. Every error
 * has a `code` discriminator so consumers can `switch` on it without
 * `instanceof`.
 */
export class TwilioError extends Error {
  override readonly name: string = 'TwilioError';
  readonly code: string = 'TWILIO_ERROR';
}

/**
 * Thrown when a function input fails validation (empty string, wrong
 * type, etc.) before the library will hit Twilio.
 */
export class InvalidInputError extends TwilioError {
  override readonly name = 'InvalidInputError';
  override readonly code = 'INVALID_INPUT' as const;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when Twilio can't serve anyone right now: a network failure, bad
 * credentials, a missing Verify Service, an account-wide rate limit, or a
 * Twilio 5xx. Retrying with a different recipient wouldn't help.
 *
 * A refusal about one recipient or one challenge (an invalid number, a
 * blocked country, too many attempts for that number, a wrong code) is not
 * this error: those still return `false`.
 */
export class TwilioUnavailableError extends TwilioError {
  override readonly name = 'TwilioUnavailableError';
  override readonly code = 'TWILIO_UNAVAILABLE' as const;
  /** The HTTP status, or `undefined` when the request never got an answer. */
  readonly status: number | undefined;
  /** Twilio's numeric error code from the response body, when it sent one. */
  readonly twilioCode: number | undefined;

  constructor(
    message: string,
    details: { status?: number; twilioCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.status = details.status;
    this.twilioCode = details.twilioCode;
  }
}
