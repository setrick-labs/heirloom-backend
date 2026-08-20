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
    expect(buildPasswordResetEmail('482913').subject).not.toContain('482913');
  });

  it('always gives the recipient something actionable', () => {
    // The reset code is typed back into the app by hand, so the body is the
    // only place it can live — there is no link, by design.
    const body = buildPasswordResetEmail('482913').body;
    expect(body).toContain('482913');
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
