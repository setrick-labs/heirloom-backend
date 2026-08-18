import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from './auth-email.template';

describe('buildVerificationEmail', () => {
  it('puts the code in the subject, where a phone notification will show it', () => {
    const email = buildVerificationEmail('482913');
    expect(email.subject).toContain('482913');
  });

  it('states the expiry, so a stale code is self-explanatory', () => {
    expect(buildVerificationEmail('482913').body).toMatch(/expires in \d+ minutes/);
  });

  it('tells an unexpecting recipient they can ignore it', () => {
    expect(buildVerificationEmail('482913').body).toContain('ignore');
  });
});

describe('buildPasswordResetEmail', () => {
  it('never leaks the token into the subject line', () => {
    // Subjects show in notification previews and sync to places the body
    // doesn't; a single-use credential must not ride there.
    expect(buildPasswordResetEmail('secret-token').subject).not.toContain('secret-token');
  });

  it('always gives the recipient something actionable', () => {
    // With no APP_LINK_BASE_URL configured there is no deep link to offer, so
    // the raw token has to be in the body — an email referring to a button
    // that isn't there is worse than an ugly one.
    const body = buildPasswordResetEmail('secret-token').body;
    expect(body).toContain('secret-token');
  });

  it('reassures someone who did not request it', () => {
    expect(buildPasswordResetEmail('t').body).toContain('nothing has changed');
  });

  it('states single use and expiry', () => {
    const body = buildPasswordResetEmail('t').body;
    expect(body).toMatch(/expires in \d+ minutes/);
    expect(body).toContain('once');
  });
});
