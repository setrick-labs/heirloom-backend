import { MailerService } from './mailer.service';
import { env } from '../../config/env';

describe('MailerService without SMTP configured', () => {
  let service: MailerService;

  beforeEach(() => {
    service = new MailerService();
  });

  it('reports itself unconfigured rather than pretending to be ready', () => {
    // The suite runs against .env, which has no SMTP block. If this ever
    // fails, these tests are talking to a real mail server — stop.
    expect(env.SMTP_HOST).toBeUndefined();
    expect(service.isConfigured).toBe(false);
  });

  it('returns false instead of throwing, so a signup still succeeds', async () => {
    // The contract that matters: an account has already been created by the
    // time this runs. A delivery failure must degrade to "no email arrived",
    // never to a 500 on work that actually committed.
    await expect(
      service.send({ to: 'someone@example.com', subject: 'Hi', body: 'Body' }),
    ).resolves.toBe(false);
  });

  it('logs the full message so the code is recoverable locally', async () => {
    // `logger` is a per-instance property, not on the prototype.
    const logger = (service as unknown as { logger: { warn: (m: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await service.send({ to: 'a@b.com', subject: 'Your code', body: '482913' });

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('482913');
    expect(logged).toContain('a@b.com');
    // And it must be unmistakable that nothing was actually delivered.
    expect(logged).toContain('NOT sent');
    warn.mockRestore();
  });
});
