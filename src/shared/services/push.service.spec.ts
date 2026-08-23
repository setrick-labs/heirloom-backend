import { env } from '../../config/env';
import { PushService } from './push.service';

describe('PushService', () => {
  const originalAppId = env.ONESIGNAL_APP_ID;
  const originalKey = env.ONESIGNAL_REST_API_KEY;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  function ok(body: unknown = { id: 'notification-1' }): Response {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  function rejected(status: number, text: string): Response {
    return {
      ok: false,
      status,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(text),
    } as unknown as Response;
  }

  beforeEach(() => {
    env.ONESIGNAL_APP_ID = 'app-id';
    env.ONESIGNAL_REST_API_KEY = 'rest-key';
    fetchMock = jest.spyOn(global, 'fetch') as jest.MockedFunction<
      typeof fetch
    >;
    fetchMock.mockResolvedValue(ok());
  });

  afterEach(() => {
    env.ONESIGNAL_APP_ID = originalAppId;
    env.ONESIGNAL_REST_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  /**
   * The JSON body of the nth outgoing request, typed as the OneSignal payload
   * this service builds — so the assertions below read fields rather than
   * indexing into `any`.
   */
  interface SentPayload {
    app_id?: string;
    target_channel?: string;
    include_aliases?: { external_id: string[] };
    headings?: { en: string };
    contents?: { en: string };
    data?: Record<string, string>;
    collapse_id?: string;
  }

  function bodyOf(call = 0): SentPayload {
    const body = fetchMock.mock.calls[call][1]?.body as string;
    return JSON.parse(body) as SentPayload;
  }

  function headersOf(call = 0): Record<string, string> {
    return fetchMock.mock.calls[call][1]?.headers as Record<string, string>;
  }

  const PUSH = {
    userIds: ['user-1'],
    title: 'Sunday at the lake',
    body: 'Maya added 3 memories.',
    logLabel: 'new memory',
  };

  it('targets users by external id, never by device token', async () => {
    await new PushService().send(PUSH);

    expect(bodyOf()).toMatchObject({
      app_id: 'app-id',
      target_channel: 'push',
      include_aliases: { external_id: ['user-1'] },
      headings: { en: PUSH.title },
      contents: { en: PUSH.body },
    });
  });

  it('authenticates with the REST key', async () => {
    await new PushService().send(PUSH);

    expect(headersOf()).toMatchObject({ Authorization: 'Key rest-key' });
  });

  it('passes the deep link through as custom data', async () => {
    await new PushService().send({
      ...PUSH,
      link: { path: '/milestone/m-1', params: { from: 'push' } },
    });

    expect(bodyOf().data).toEqual({ path: '/milestone/m-1', from: 'push' });
  });

  it('passes the collapse id through, so a batch upload is one row', async () => {
    await new PushService().send({ ...PUSH, collapseId: 'memory:j-1:u-1' });

    expect(bodyOf().collapse_id).toBe('memory:j-1:u-1');
  });

  it('deduplicates recipients', async () => {
    await new PushService().send({
      ...PUSH,
      userIds: ['user-1', 'user-1', 'user-2'],
    });

    expect(bodyOf().include_aliases?.external_id).toEqual(['user-1', 'user-2']);
  });

  it('sends nothing at all when the audience is empty', async () => {
    await expect(
      new PushService().send({ ...PUSH, userIds: [] }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chunks an audience past the per-request alias limit', async () => {
    const userIds = Array.from({ length: 2_500 }, (_, i) => `user-${i}`);

    await new PushService().send({ ...PUSH, userIds });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0).include_aliases?.external_id).toHaveLength(2_000);
    expect(bodyOf(1).include_aliases?.external_id).toHaveLength(500);
  });

  it('logs instead of sending when OneSignal is not configured', async () => {
    env.ONESIGNAL_APP_ID = undefined;
    env.ONESIGNAL_REST_API_KEY = undefined;

    await expect(new PushService().send(PUSH)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when OneSignal rejects the request', async () => {
    // The caller is an already-committed write: a failed push must not
    // become a 500 on a comment that was saved successfully.
    fetchMock.mockResolvedValue(rejected(400, '{"errors":["bad app_id"]}'));

    await expect(new PushService().send(PUSH)).resolves.toBe(false);
  });

  it('never throws when the network fails outright', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(new PushService().send(PUSH)).resolves.toBe(false);
  });

  it('reports a 200 with no id as "reached nobody", not as success', async () => {
    // OneSignal answers this way when every target is signed out or has
    // denied permission — the normal case, not a fault.
    fetchMock.mockResolvedValue(ok({}));

    await expect(new PushService().send(PUSH)).resolves.toBe(false);
  });
});
