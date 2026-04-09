# @smplcty/twilio

Tiny TypeScript wrapper around the Twilio Verify v2 API for sending and checking OTP codes via SMS or email.

[![npm](https://img.shields.io/npm/v/@smplcty/twilio.svg)](https://www.npmjs.com/package/@smplcty/twilio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What this is

A 200-line, dependency-free wrapper around two Twilio Verify endpoints:

- `POST /v2/Services/{ServiceSid}/Verifications` — start an OTP challenge by sending a code via SMS or email.
- `POST /v2/Services/{ServiceSid}/VerificationCheck` — check whether a submitted code matches the most recent challenge.

That's the entire scope. There's no auth flow, no session management, no dev backdoor logic. If you need a sign-in bypass for developers whose phones can't receive SMS, that lives in [`@smplcty/auth`](https://www.npmjs.com/package/@smplcty/auth) as `verifyDevOtp` — call it before you call this library.

## Install

```sh
pnpm add @smplcty/twilio
```

Zero runtime dependencies. Requires Node 20+ (uses global `fetch`).

## Usage

```ts
import { createTwilioVerifyClient } from '@smplcty/twilio';

const twilio = createTwilioVerifyClient({
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  serviceSid: process.env.TWILIO_SERVICE_SID!,
});

// Send a code
const sent = await twilio.sendVerificationCode({
  channel: 'sms',
  to: '+15558675309',
});
if (!sent) {
  // Twilio rejected the request — rate limit, bad number, blocked recipient, etc.
}

// Later, check the code the user submits
const ok = await twilio.verifyVerificationCode({
  to: '+15558675309',
  code: '123456',
});
if (!ok) {
  // Wrong code, expired challenge, or Twilio rejected the check.
}
```

## API

### `createTwilioVerifyClient(config)`

Returns a stateless client object. Safe to cache at module scope.

```ts
interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  baseUrl?: string;             // override for testing; default https://verify.twilio.com/v2
  fetch?: typeof globalThis.fetch;  // inject a mock for tests
  logger?: Logger;              // optional, defaults to no-op
}

interface TwilioVerifyClient {
  sendVerificationCode(input: { channel: 'sms' | 'email'; to: string }): Promise<boolean>;
  verifyVerificationCode(input: { to: string; code: string }): Promise<boolean>;
}
```

Both methods return `Promise<boolean>` and **do not throw on Twilio rejection** — non-2xx responses, network errors, expired challenges, and rate limits all return `false`. The caller decides whether `false` means "retry" or "give up." This makes the most-common code path (`if (!ok) return 400`) trivial.

The only thing that throws is `InvalidInputError` for missing required fields.

## Why no environment variables

The library never reads `process.env`. Pass credentials explicitly to `createTwilioVerifyClient`.

This makes the library trivially testable, supports multi-account use cases, and means a stale env var can never silently break a production deploy. The boilerplate of constructing the client at module load is the right amount of explicitness:

```ts
// app.ts
import { createTwilioVerifyClient } from '@smplcty/twilio';

if (!process.env.TWILIO_ACCOUNT_SID) {
  throw new Error('TWILIO_ACCOUNT_SID is required');
}
// ...same for authToken and serviceSid...

export const twilio = createTwilioVerifyClient({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  serviceSid: process.env.TWILIO_SERVICE_SID!,
});
```

If you want a thin wrapper that reads env vars, write one in your app code — it's six lines.

## Why no dev backdoor

Earlier versions of this codebase (before extraction) included a `DEV_PHONE_NUMBERS` + `DEV_VERIFICATION_CODE` env var pair that bypassed Twilio for specific phone numbers when paired with a magic env var code. **That logic is not in this library and never will be.**

If you need a dev sign-in bypass (to handle Twilio's flaky SMS delivery to certain carriers), use `@smplcty/auth`'s `verifyDevOtp`:

```ts
import { verifyDevOtp } from '@smplcty/auth';
import { createTwilioVerifyClient } from '@smplcty/twilio';

const twilio = createTwilioVerifyClient({ ... });

// In your sign-in-verify handler, AFTER looking up the user's
// user_communication_method_id:
const devOk = await verifyDevOtp(db, ucmId, submittedCode);
if (devOk) {
  return createSession(...);
}

const twilioOk = await twilio.verifyVerificationCode({ to, code: submittedCode });
if (twilioOk) {
  return createSession(...);
}

return { statusCode: 400, body: 'Invalid code' };
```

This is strictly better than the env var approach: per-dev TOTP secrets, time-rotating codes, per-dev revocation, built-in audit trail, and no shared bypass code that compromises every dev account if it leaks. See the `@smplcty/auth` README for the full design rationale.

## Logging

The library never logs verification codes, recipient phone numbers, recipient email addresses, or Twilio response bodies. With LOG_LEVEL=debug it will only log structural events:

- `'sending verification code'` with `{ channel }`
- `'verification code sent'` with `{ channel, status }`
- `'verifying verification code'` with `{}` (no fields)
- `'verification check complete'` with `{ approved, status }`
- Warnings on rejection with `{ status }` only

The default logger is a no-op. To get the events, pass a logger that matches the pino-style `(data, msg)` shape (or pino itself):

```ts
import pino from 'pino';
const log = pino({ redact: ['*.password', '*.token'] });

const twilio = createTwilioVerifyClient({
  accountSid: '...',
  authToken: '...',
  serviceSid: '...',
  logger: log,
});
```

## Testing

The library is designed to be mocked at the `fetch` layer:

```ts
import { vi } from 'vitest';
import { createTwilioVerifyClient } from '@smplcty/twilio';

const fakeFetch = vi.fn(async () =>
  new Response(JSON.stringify({ status: 'approved' }), { status: 200 })
);

const twilio = createTwilioVerifyClient({
  accountSid: 'ACtest',
  authToken: 'test',
  serviceSid: 'VAtest',
  fetch: fakeFetch,
});

const ok = await twilio.verifyVerificationCode({ to: '+15555550100', code: '123456' });
expect(ok).toBe(true);
```

The library's own test suite uses this exact pattern — see `tests/create-client.test.ts`.

## License

MIT — see [LICENSE](LICENSE).
