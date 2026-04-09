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
