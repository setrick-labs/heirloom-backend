/**
 * These tests mock BOTH the env module and nodemailer.
 *
 * An earlier version did neither: it asserted `env.SMTP_HOST` was undefined,
 * which held only while nobody had configured SMTP. The moment real Resend
 * credentials landed in `.env`, the suite picked them up and `send()`
 * delivered an actual email to the fixture address `a@b.com` before the
 * assertion failed. Reading ambient config was the first mistake; reaching
 * the network at all was the second.
 *
 * So the transport is stubbed outright — these tests assert this class's
 * decisions, and nodemailer's ability to open a socket is not one of them.
 */
const mockEnv: Record<string, unknown> = {};
jest.mock('../../config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args: unknown[]) => mockSendMail(...args),
  })),
}));

import { MailerService } from './mailer.service';

beforeEach(() => {
  mockSendMail.mockReset();
});

function configure(values: Record<string, unknown>) {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
}

function loggerOf(service: MailerService) {
  return (service as unknown as { logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock } })
    .logger;
}

describe('MailerService with no SMTP configured', () => {
  let service: MailerService;

  beforeEach(() => {
    configure({ SMTP_HOST: undefined, SMTP_PORT: 587, SMTP_SECURE: false });
    service = new MailerService();
  });

  it('reports itself unconfigured rather than pretending to be ready', () => {
    expect(service.isConfigured).toBe(false);
  });

  it('returns false instead of throwing, so a signup still succeeds', async () => {
    // The contract that matters: the account has already been created by the
    // time this runs. A delivery failure must degrade to "no email arrived",
    // never to a 500 on work that actually committed.
    await expect(
      service.send({ to: 'someone@example.com', subject: 'Hi', body: 'Body', logLabel: 'test' }),
    ).resolves.toBe(false);
  });

  it('logs the full message so the code is recoverable locally', async () => {
    const warn = jest.spyOn(loggerOf(service), 'warn').mockImplementation(() => undefined);

    await service.send({
      to: 'a@b.com',
      subject: 'Your code',
      body: '482913',
      logLabel: 'verification code',
    });

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('482913');
    expect(logged).toContain('a@b.com');
    // And it must be unmistakable that nothing was actually delivered.
    expect(logged).toContain('NOT sent');
  });
});

describe('MailerService with SMTP configured', () => {
  beforeEach(() => {
    configure({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
      MAIL_FROM: 'Heirloom <support@example.com>',
    });
  });

  it('reports itself ready once a host is present', () => {
    expect(new MailerService().isConfigured).toBe(true);
  });

  it('sends through the transport, from the configured address', async () => {
    mockSendMail.mockResolvedValueOnce({});
    const service = new MailerService();

    await expect(
      service.send({ to: 'someone@example.com', subject: 'Hi', body: 'Body', logLabel: 'test' }),
    ).resolves.toBe(true);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'Heirloom <support@example.com>',
      to: 'someone@example.com',
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('resolves false rather than throwing when the server rejects', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('550 rejected'));
    const service = new MailerService();
    jest.spyOn(loggerOf(service), 'error').mockImplementation(() => undefined);

    await expect(
      service.send({ to: 'a@example.com', subject: 'Hi', body: 'Body', logLabel: 'test' }),
    ).resolves.toBe(false);
  });

  it('never logs the subject either — it carries the code', async () => {
    mockSendMail.mockResolvedValueOnce({});
    const service = new MailerService();
    const log = jest.spyOn(loggerOf(service), 'log').mockImplementation(() => undefined);

    await service.send({
      to: 'a@example.com',
      // Verification subjects carry the code on purpose, so it shows in a
      // phone's notification preview. That makes the subject a credential.
      subject: '482913 is your Heirloom code',
      body: '482913',
      logLabel: 'verification code',
    });

    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('verification code');
    expect(logged).toContain('a@example.com');
    expect(logged).not.toContain('482913');
  });

  it('never logs the message body once a transport exists', async () => {
    mockSendMail.mockResolvedValueOnce({});
    const service = new MailerService();
    const warn = jest.spyOn(loggerOf(service), 'warn').mockImplementation(() => undefined);

    await service.send({
      to: 'a@example.com',
      subject: '482913 is your Heirloom code',
      body: '482913',
      logLabel: 'verification code',
    });

    // The log fallback exists so codes are recoverable with no provider. With
    // one configured, printing the code would be a needless secret in the logs.
    expect(warn).not.toHaveBeenCalled();
  });
});
