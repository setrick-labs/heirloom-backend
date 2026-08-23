import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { env } from '../../config/env';
import type { Database } from '../../database/connection';
import type {
  MailerService,
  OutboundEmail,
} from '../../shared/services/mailer.service';
import {
  MAX_SCREENSHOT_BYTES,
  SupportService,
  type SupportScreenshot,
} from './support.service';

const USER = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
};

function makeService(options: { sent?: boolean } = {}) {
  // Typed against the real signature so the assertions below read
  // `send.mock.calls[0][0]` as an OutboundEmail rather than as `any`.
  const send: jest.MockedFunction<MailerService['send']> = jest.fn();
  send.mockResolvedValue(options.sent ?? true);
  const db = {
    query: { users: { findFirst: jest.fn().mockResolvedValue(USER) } },
  } as unknown as Database;

  const service = new SupportService(db, {
    send,
  } as unknown as MailerService);

  return { service, send };
}

/** The one message the mailer was handed. */
function sentEmail(
  send: jest.MockedFunction<MailerService['send']>,
): OutboundEmail {
  return send.mock.calls[0][0];
}

const REQUEST = {
  title: 'Photos will not upload',
  details: 'I picked four photos and the bar stopped at 30%.',
};

function screenshot(
  overrides: Partial<SupportScreenshot> = {},
): SupportScreenshot {
  return {
    buffer: Buffer.from('png bytes'),
    mimetype: 'image/png',
    size: 1024,
    ...overrides,
  };
}

describe('SupportService.submit', () => {
  const originalSupportEmail = env.SUPPORT_EMAIL;

  beforeEach(() => {
    env.SUPPORT_EMAIL = 'support@heirloom.app';
  });

  afterEach(() => {
    env.SUPPORT_EMAIL = originalSupportEmail;
  });

  it('emails the support inbox and reports delivery', async () => {
    const { service, send } = makeService();

    await expect(service.submit(USER.id, REQUEST)).resolves.toEqual({
      delivered: true,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@heirloom.app',
        subject: `[Heirloom support] ${REQUEST.title}`,
      }),
    );
  });

  it('puts the reporter in the body, so a reply has somewhere to go', async () => {
    const { service, send } = makeService();

    await service.submit(USER.id, REQUEST);

    const body: string = sentEmail(send).body;
    expect(body).toContain(REQUEST.details);
    expect(body).toContain(USER.email);
    expect(body).toContain(USER.id);
  });

  it('attaches the screenshot rather than inlining it', async () => {
    const { service, send } = makeService();

    await service.submit(USER.id, REQUEST, screenshot());

    expect(sentEmail(send).attachments).toEqual([
      expect.objectContaining({
        filename: 'screenshot.png',
        contentType: 'image/png',
      }),
    ]);
  });

  it('sends no attachments array at all when there is no screenshot', async () => {
    const { service, send } = makeService();

    await service.submit(USER.id, REQUEST);

    expect(sentEmail(send).attachments).toBeUndefined();
  });

  it.each(['image/heic', 'application/pdf', 'video/mp4', 'image/gif'])(
    'rejects a %s attachment — support inboxes have to be able to open it',
    async (mimetype) => {
      const { service, send } = makeService();

      await expect(
        service.submit(USER.id, REQUEST, screenshot({ mimetype })),
      ).rejects.toThrow(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects a screenshot past the size cap', async () => {
    const { service } = makeService();

    await expect(
      service.submit(
        USER.id,
        REQUEST,
        screenshot({ size: MAX_SCREENSHOT_BYTES + 1 }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails loudly when the mail never went out', async () => {
    // Unlike a verification email, nothing else has been committed here — a
    // silent failure would mean answering "thanks, we got it" to a report
    // that exists nowhere.
    const { service } = makeService({ sent: false });

    await expect(service.submit(USER.id, REQUEST)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails loudly when no destination is configured', async () => {
    env.SUPPORT_EMAIL = undefined;
    const originalFrom = env.MAIL_FROM;
    const originalUser = env.SMTP_USER;
    env.MAIL_FROM = undefined;
    env.SMTP_USER = undefined;

    const { service, send } = makeService();

    await expect(service.submit(USER.id, REQUEST)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(send).not.toHaveBeenCalled();

    env.MAIL_FROM = originalFrom;
    env.SMTP_USER = originalUser;
  });

  it('falls back to MAIL_FROM when SUPPORT_EMAIL is unset', async () => {
    env.SUPPORT_EMAIL = undefined;
    const originalFrom = env.MAIL_FROM;
    env.MAIL_FROM = 'hello@heirloom.app';

    const { service, send } = makeService();
    await service.submit(USER.id, REQUEST);

    expect(sentEmail(send).to).toBe('hello@heirloom.app');
    env.MAIL_FROM = originalFrom;
  });
});
