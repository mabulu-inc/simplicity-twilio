import { describe, expect, it, vi } from 'vitest';
import {
  InvalidInputError,
  TwilioUnavailableError,
  createTwilioVerifyClient,
  type TwilioVerifyConfig,
} from '../src/index.js';

const VALID_CONFIG: Omit<TwilioVerifyConfig, 'fetch'> = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'test_auth_token',
  serviceSid: 'VA00000000000000000000000000000000',
};

function mockFetch(
  responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string }>,
): { fetch: typeof globalThis.fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;

  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const r = responses[i++];
    if (!r) {
      throw new Error(`No mock response queued for fetch call ${i}`);
    }
    return new Response(
      r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? ''),
      {
        status: r.status ?? (r.ok === false ? 400 : 200),
        headers: r.json !== undefined ? { 'content-type': 'application/json' } : {},
      },
    );
  });

  return { fetch: fakeFetch as unknown as typeof globalThis.fetch, calls };
}

describe('createTwilioVerifyClient — config validation', () => {
  it('throws InvalidInputError if accountSid is missing', () => {
    expect(() =>
      createTwilioVerifyClient({ ...VALID_CONFIG, accountSid: '' }),
    ).toThrow(InvalidInputError);
  });

  it('throws InvalidInputError if authToken is missing', () => {
    expect(() =>
      createTwilioVerifyClient({ ...VALID_CONFIG, authToken: '' }),
    ).toThrow(InvalidInputError);
  });

  it('throws InvalidInputError if serviceSid is missing', () => {
    expect(() =>
      createTwilioVerifyClient({ ...VALID_CONFIG, serviceSid: '' }),
    ).toThrow(InvalidInputError);
  });

  it('returns a client object with both methods', () => {
    const client = createTwilioVerifyClient({
      ...VALID_CONFIG,
      fetch: globalThis.fetch,
    });
    expect(typeof client.sendVerificationCode).toBe('function');
    expect(typeof client.verifyVerificationCode).toBe('function');
  });
});

describe('sendVerificationCode', () => {
  it('POSTs Channel and To to the Verifications endpoint', async () => {
    const { fetch, calls } = mockFetch([{ ok: true, json: { status: 'pending' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.sendVerificationCode({
      channel: 'sms',
      to: '+15558675309',
    });

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://verify.twilio.com/v2/Services/VA00000000000000000000000000000000/Verifications',
    );
    expect(calls[0]?.init.method).toBe('POST');

    const body = String(calls[0]?.init.body);
    expect(body).toContain('Channel=sms');
    expect(body).toContain(`To=${encodeURIComponent('+15558675309')}`);
  });

  it('sets a Basic Authorization header from accountSid + authToken', async () => {
    const { fetch, calls } = mockFetch([{ ok: true, json: { status: 'pending' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    await client.sendVerificationCode({ channel: 'sms', to: '+15551234567' });

    const headers = calls[0]?.init.headers as Record<string, string>;
    const expected =
      'Basic ' +
      Buffer.from(`${VALID_CONFIG.accountSid}:${VALID_CONFIG.authToken}`).toString('base64');
    expect(headers.Authorization).toBe(expected);
  });

  it('returns false when Twilio refuses this recipient, without throwing', async () => {
    const { fetch } = mockFetch([{ status: 400, json: { code: 21211 } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.sendVerificationCode({
      channel: 'sms',
      to: '+15558675309',
    });
    expect(result).toBe(false);
  });

  it('uses an overridden baseUrl', async () => {
    const { fetch, calls } = mockFetch([{ ok: true, json: { status: 'pending' } }]);
    const client = createTwilioVerifyClient({
      ...VALID_CONFIG,
      fetch,
      baseUrl: 'http://localhost:9999/v2',
    });

    await client.sendVerificationCode({ channel: 'email', to: 'user@example.com' });

    expect(calls[0]?.url).toBe(
      'http://localhost:9999/v2/Services/VA00000000000000000000000000000000/Verifications',
    );
  });

  it('throws InvalidInputError on empty channel', async () => {
    const { fetch } = mockFetch([]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    await expect(
      client.sendVerificationCode({ channel: '' as 'sms', to: '+15555550100' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError on empty to', async () => {
    const { fetch } = mockFetch([]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    await expect(
      client.sendVerificationCode({ channel: 'sms', to: '' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('verifyVerificationCode', () => {
  it('returns true when twilio returns status: approved', async () => {
    const { fetch, calls } = mockFetch([{ ok: true, json: { status: 'approved' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.verifyVerificationCode({
      to: '+15558675309',
      code: '123456',
    });
    expect(result).toBe(true);
    expect(calls[0]?.url).toBe(
      'https://verify.twilio.com/v2/Services/VA00000000000000000000000000000000/VerificationCheck',
    );

    const body = String(calls[0]?.init.body);
    expect(body).toContain('Code=123456');
    expect(body).toContain(`To=${encodeURIComponent('+15558675309')}`);
  });

  it('returns false when twilio returns status: pending', async () => {
    const { fetch } = mockFetch([{ ok: true, json: { status: 'pending' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.verifyVerificationCode({
      to: '+15558675309',
      code: '000000',
    });
    expect(result).toBe(false);
  });

  it('returns false on non-2xx response (e.g. expired challenge)', async () => {
    const { fetch } = mockFetch([{ ok: false, status: 404, text: 'not found' }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.verifyVerificationCode({
      to: '+15558675309',
      code: '123456',
    });
    expect(result).toBe(false);
  });

  it('throws TwilioUnavailableError on a network error, so a correct code is not called wrong', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const err = await client
      .verifyVerificationCode({ to: '+15558675309', code: '123456' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwilioUnavailableError);
    expect((err as TwilioUnavailableError).status).toBeUndefined();
  });

  it('returns false on invalid JSON in the response', async () => {
    const fetch = vi.fn(async () =>
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof globalThis.fetch;
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });

    const result = await client.verifyVerificationCode({
      to: '+15558675309',
      code: '123456',
    });
    expect(result).toBe(false);
  });

  it('throws InvalidInputError on empty to', async () => {
    const { fetch } = mockFetch([]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    await expect(
      client.verifyVerificationCode({ to: '', code: '123456' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError on empty code', async () => {
    const { fetch } = mockFetch([]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    await expect(
      client.verifyVerificationCode({ to: '+15555550100', code: '' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('logging', () => {
  it('does not log the verification code', async () => {
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const { fetch } = mockFetch([{ ok: true, json: { status: 'approved' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch, logger: log });

    await client.verifyVerificationCode({
      to: '+15558675309',
      code: 'SECRET-CODE-12345',
    });

    const allLogged = JSON.stringify([
      log.debug.mock.calls,
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);

    expect(allLogged).not.toContain('SECRET-CODE-12345');
    expect(allLogged).not.toContain('+15558675309');
  });

  it('does not log the recipient on send', async () => {
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const { fetch } = mockFetch([{ ok: true, json: { status: 'pending' } }]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch, logger: log });

    await client.sendVerificationCode({ channel: 'sms', to: '+15558675309' });

    const allLogged = JSON.stringify([
      log.debug.mock.calls,
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);

    expect(allLogged).not.toContain('+15558675309');
  });

  it('does not log the twilio response body on failure', async () => {
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'sensitive twilio error', code: 60200 }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof globalThis.fetch;
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch, logger: log });

    await client.sendVerificationCode({ channel: 'sms', to: '+15558675309' });

    const allLogged = JSON.stringify([
      log.debug.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);

    expect(allLogged).not.toContain('sensitive twilio error');
    expect(allLogged).not.toContain('+15558675309');
  });

  it("logs Twilio's numeric error code, which is safe and says why the send failed", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { fetch } = mockFetch([
      { status: 400, json: { code: 21211, message: "The 'To' number +15558675309 is not valid." } },
    ]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch, logger: log });

    await client.sendVerificationCode({ channel: 'sms', to: '+15558675309' });

    expect(log.warn).toHaveBeenCalledWith(
      { channel: 'sms', status: 400, twilioCode: 21211 },
      'verification code send rejected',
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('+15558675309');
  });
});

describe('telling an outage from a refusal of one recipient', () => {
  const send = async (response: { status: number; json?: unknown; text?: string }) => {
    const { fetch } = mockFetch([response]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    return client.sendVerificationCode({ channel: 'sms', to: '+15558675309' }).catch((e: unknown) => e);
  };
  const check = async (response: { status: number; json?: unknown; text?: string }) => {
    const { fetch } = mockFetch([response]);
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    return client.verifyVerificationCode({ to: '+15558675309', code: '123456' }).catch((e: unknown) => e);
  };

  it.each([
    ['bad credentials', { status: 401, json: { code: 20003 } }],
    ['a missing Verify Service', { status: 404, json: { code: 20404 } }],
    ['an account-wide rate limit', { status: 429, json: { code: 20429 } }],
    ['a 429 with no body', { status: 429, text: '' }],
    ['a Twilio 500', { status: 500, text: 'oops' }],
    ['a Twilio 503', { status: 503, text: '' }],
  ])('a send throws TwilioUnavailableError for %s', async (_name, response) => {
    const err = await send(response);
    expect(err).toBeInstanceOf(TwilioUnavailableError);
    expect(err).toMatchObject({ code: 'TWILIO_UNAVAILABLE', status: response.status });
  });

  it.each([
    ['an invalid number', { status: 400, json: { code: 21211 } }],
    ['a landline', { status: 400, json: { code: 60205 } }],
    ['a blocked destination country', { status: 403, json: { code: 60605 } }],
    ['too many sends to this recipient', { status: 429, json: { code: 60203 } }],
  ])('a send returns false for %s', async (_name, response) => {
    expect(await send(response)).toBe(false);
  });

  it('a send throws TwilioUnavailableError on a network error, keeping the cause', async () => {
    const cause = new TypeError('fetch failed');
    const fetch = vi.fn(async () => {
      throw cause;
    }) as unknown as typeof globalThis.fetch;
    const client = createTwilioVerifyClient({ ...VALID_CONFIG, fetch });
    const err = await client.sendVerificationCode({ channel: 'sms', to: '+15558675309' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwilioUnavailableError);
    expect((err as Error).cause).toBe(cause);
  });

  it('carries the Twilio code on the error', async () => {
    expect(await send({ status: 401, json: { code: 20003 } })).toMatchObject({ twilioCode: 20003 });
  });

  it("never puts Twilio's message on the error", async () => {
    const err = await send({ status: 500, json: { code: 20500, message: 'failed for +15558675309' } });
    expect(JSON.stringify(err)).not.toContain('+15558675309');
    expect(String((err as Error).message)).not.toContain('+15558675309');
  });

  it.each([
    ['bad credentials', { status: 401, json: { code: 20003 } }],
    ['an account-wide rate limit', { status: 429, json: { code: 20429 } }],
    ['a Twilio 500', { status: 500, text: '' }],
  ])('a check throws TwilioUnavailableError for %s', async (_name, response) => {
    expect(await check(response)).toBeInstanceOf(TwilioUnavailableError);
  });

  it.each([
    ['an expired or used challenge', { status: 404, json: { code: 20404 } }],
    ['too many checks for this challenge', { status: 429, json: { code: 60202 } }],
    ['a bad request', { status: 400, json: { code: 60200 } }],
  ])('a check returns false for %s', async (_name, response) => {
    expect(await check(response)).toBe(false);
  });
});
