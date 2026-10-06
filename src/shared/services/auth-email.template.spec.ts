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
    // The code is always in the body: the one-tap link is a convenience that
    // only works on a phone with the app, and only when links are configured.
    const email = buildPasswordResetEmail('482913');
    expect(email.body).toContain('482913');
    expect(email.html).toContain('482913');
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

describe('HTML parts', () => {
  it('every auth email ships an HTML part alongside the text one', () => {
    for (const email of [
      buildVerificationEmail('482913'),
      buildPasswordResetEmail('482913'),
    ]) {
      expect(email.html).toContain('<!DOCTYPE html>');
      expect(email.body.length).toBeGreaterThan(0);
    }
  });

  it('keeps store badges out of security mail', () => {
    expect(buildPasswordResetEmail('482913').html).not.toContain('app-store.png');
  });
});
