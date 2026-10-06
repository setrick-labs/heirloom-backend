import { escapeHtml, renderEmail, safe, strong } from './email-layout';

describe('email layout', () => {
  it('escapes user-supplied text everywhere it lands', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = renderEmail({
      preheader: hostile,
      heading: hostile,
      paragraphs: [hostile, safe`Joined ${strong(hostile)}`],
      notes: [hostile],
      cta: { label: hostile, url: `https://example.com/"${hostile}` },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(escapeHtml(hostile));
  });

  it('shows store badges only when asked', () => {
    const base = { preheader: 'p', heading: 'h', paragraphs: ['x'] };
    expect(renderEmail(base)).not.toContain('google-play.png');
    expect(renderEmail({ ...base, showStoreBadges: true })).toContain(
      'google-play.png',
    );
  });
});
