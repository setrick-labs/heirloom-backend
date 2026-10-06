import { env } from '../../config/env';

/**
 * The one HTML shell every Heirloom email is poured into.
 *
 * Hand-written tables and inline styles rather than a templating library:
 * email clients (Outlook above all) still render HTML like it is 2005, and
 * the handful of patterns that survive them fit in this file. Colours come
 * straight from the app's theme/colors.ts so a code in an email looks like
 * the screen it gets typed into.
 *
 * Every value that could come from a person (family names, sender names,
 * journey titles) must reach the markup through `escapeHtml` or the `safe`
 * tag below — a family called `<img onerror=…>` is a real input.
 */

const color = {
  canvas: '#F7F2DE', // palette.cream
  canvasDeep: '#F0EAD6', // palette.creamDeep
  surface: '#FFFCF5', // palette.white
  ink: '#501D32', // palette.lightText / sage (oxblood)
  body: '#6B4556', // ink at ~0.8 over the card, flattened (clients mangle rgba)
  meta: '#756A66', // palette.lightMuted
  gold: '#B39A65',
  hairline: '#EADFCB',
  onAccent: '#F7F2DE',
  // Dark theme, for clients that honour prefers-color-scheme (Apple Mail, iOS).
  darkBase: '#261E22',
  darkSurface: '#33282E',
  darkInk: '#F7F2DE',
  darkBody: '#D9CFC0',
  darkMeta: '#A89C96',
  darkHairline: '#4A3A42',
} as const;

const fonts = {
  editorial: "'Newsreader', Georgia, 'Times New Roman', serif",
  body: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

// ------------------------------------------------------------ escaping

/** Markup that has already been escaped — the only thing `renderEmail` trusts. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Fragment = string | SafeHtml;

function toHtml(fragment: Fragment): string {
  return fragment instanceof SafeHtml ? fragment.value : escapeHtml(fragment);
}

/**
 * Tagged template for inline markup in email copy: the literal parts are
 * trusted, every interpolation is escaped unless it is already SafeHtml.
 * `safe`Joined <b>${familyName}</b>`` is safe for any familyName.
 */
export function safe(
  strings: TemplateStringsArray,
  ...values: Fragment[]
): SafeHtml {
  let out = strings[0];
  values.forEach((value, i) => {
    out += toHtml(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/** Bold, in the ink colour — the only emphasis the copy needs. */
export function strong(text: string): SafeHtml {
  return new SafeHtml(
    `<strong class="hl-ink" style="color:${color.ink};font-weight:700;">${escapeHtml(text)}</strong>`,
  );
}

// ------------------------------------------------------------ layout

export interface EmailLayoutInput {
  /** Hidden inbox-preview line shown after the subject. Never a credential. */
  preheader: string;
  /** Small gold label above the heading, e.g. "Family invite". */
  eyebrow?: string;
  heading: string;
  paragraphs: Fragment[];
  /** A one-time code, shown large. */
  code?: { value: string; caption?: string };
  cta?: { label: string; url: string };
  /** Muted small print below a hairline — expiry, "not you?" reassurance. */
  notes?: Fragment[];
  /**
   * Store badges in the footer. On for mail that may reach someone without
   * the app (invites, gifts); off for security mail, whose reader already
   * has it and should not be nudged toward tapping links.
   */
  showStoreBadges?: boolean;
}

export function renderEmail(input: EmailLayoutInput): string {
  const web = env.WEB_BASE_URL.replace(/\/$/, '');
  const assets = env.EMAIL_ASSET_BASE_URL.replace(/\/$/, '');
  const year = new Date().getFullYear();

  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p class="hl-body" style="margin:0 0 16px;font-family:${fonts.body};font-size:16px;line-height:26px;color:${color.body};">${toHtml(p)}</p>`,
    )
    .join('');

  const code = input.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr><td class="hl-code" align="center" style="background:${color.canvas};border:1px solid ${color.hairline};border-radius:16px;padding:22px 12px;">
          <div class="hl-ink" style="font-family:${fonts.body};font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;color:${color.ink};padding-left:10px;">${escapeHtml(input.code.value)}</div>
          ${
            input.code.caption
              ? `<div class="hl-meta" style="margin-top:6px;font-family:${fonts.body};font-size:13px;line-height:18px;color:${color.meta};">${escapeHtml(input.code.caption)}</div>`
              : ''
          }
        </td></tr>
      </table>`
    : '';

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
        <tr><td class="hl-button" align="center" bgcolor="${color.ink}" style="border-radius:999px;background:${color.ink};">
          <a class="hl-button-link" href="${escapeHtml(input.cta.url)}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${fonts.body};font-size:16px;line-height:20px;font-weight:700;color:${color.onAccent};text-decoration:none;border-radius:999px;">${escapeHtml(input.cta.label)}</a>
        </td></tr>
      </table>
      <p class="hl-meta" style="margin:0 0 16px;font-family:${fonts.body};font-size:13px;line-height:20px;color:${color.meta};">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(input.cta.url)}" class="hl-ink" style="color:${color.ink};word-break:break-all;">${escapeHtml(input.cta.url)}</a></p>`
    : '';

  const notes = input.notes?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        <tr><td class="hl-rule" style="border-top:1px solid ${color.hairline};padding-top:20px;">
          ${input.notes
            .map(
              (n) =>
                `<p class="hl-meta" style="margin:0 0 8px;font-family:${fonts.body};font-size:13px;line-height:20px;color:${color.meta};">${toHtml(n)}</p>`,
            )
            .join('')}
        </td></tr>
      </table>`
    : '';

  const badges = input.showStoreBadges
    ? `<tr><td align="center" style="padding:28px 16px 4px;">
        <p class="hl-body" style="margin:0 0 14px;font-family:${fonts.editorial};font-size:18px;line-height:24px;color:${color.ink};">Get Heirloom on your phone</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding:0 6px;"><a href="${escapeHtml(env.APP_STORE_URL)}" target="_blank"><img src="${assets}/app-store.png" width="150" height="43" alt="Download on the App Store" style="display:block;border:0;width:150px;height:43px;"></a></td>
          <td style="padding:0 6px;"><a href="${escapeHtml(env.PLAY_STORE_URL)}" target="_blank"><img src="${assets}/google-play.png" width="150" height="43" alt="Get it on Google Play" style="display:block;border:0;width:150px;height:43px;"></a></td>
        </tr></table>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:${color.ink}; }
  @media (max-width: 600px) {
    .hl-card { padding:32px 22px !important; border-radius:18px !important; }
    .hl-heading { font-size:26px !important; line-height:32px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .hl-canvas { background:${color.darkBase} !important; }
    .hl-card { background:${color.darkSurface} !important; }
    .hl-code { background:${color.darkBase} !important; border-color:${color.darkHairline} !important; }
    .hl-ink, .hl-heading { color:${color.darkInk} !important; }
    .hl-body { color:${color.darkBody} !important; }
    .hl-meta { color:${color.darkMeta} !important; }
    .hl-rule { border-color:${color.darkHairline} !important; }
    .hl-button { background:${color.darkInk} !important; }
    .hl-button-link { color:${color.ink} !important; }
  }
</style>
</head>
<body class="hl-canvas" style="margin:0;padding:0;background:${color.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" class="hl-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${color.canvas}" style="background:${color.canvas};">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="padding:0 0 24px;">
        <a href="${web}" target="_blank" style="text-decoration:none;">
          <img src="${assets}/logo.png" width="48" height="48" alt="Heirloom" style="display:block;border:0;width:48px;height:48px;border-radius:12px;margin:0 auto 10px;">
          <span class="hl-ink" style="font-family:${fonts.editorial};font-size:22px;line-height:26px;color:${color.ink};letter-spacing:0.2px;">Heirloom</span>
        </a>
      </td></tr>
      <tr><td class="hl-card" bgcolor="${color.surface}" style="background:${color.surface};border-radius:24px;padding:40px 40px 32px;">
        ${
          input.eyebrow
            ? `<p style="margin:0 0 12px;font-family:${fonts.body};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${color.gold};">${escapeHtml(input.eyebrow)}</p>`
            : ''
        }
        <h1 class="hl-heading" style="margin:0 0 20px;font-family:${fonts.editorial};font-size:30px;line-height:36px;font-weight:500;color:${color.ink};">${escapeHtml(input.heading)}</h1>
        ${paragraphs}
        ${code}
        ${cta}
        ${notes}
      </td></tr>
      ${badges}
      <tr><td align="center" style="padding:28px 16px 0;">
        <p class="hl-meta" style="margin:0 0 6px;font-family:${fonts.body};font-size:12px;line-height:18px;color:${color.meta};">Heirloom — your memories, your people.</p>
        <p class="hl-meta" style="margin:0;font-family:${fonts.body};font-size:12px;line-height:18px;color:${color.meta};">
          <a href="${web}/support" target="_blank" class="hl-meta" style="color:${color.meta};text-decoration:underline;">Help</a>
          &nbsp;·&nbsp;
          <a href="${web}/legal/privacy" target="_blank" class="hl-meta" style="color:${color.meta};text-decoration:underline;">Privacy</a>
          &nbsp;·&nbsp; © ${year} Heirloom Journey
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Footer lines for the plain-text part, mirroring the HTML badges. */
export function storeLinksText(): string[] {
  return [
    '',
    'Get Heirloom on your phone:',
    `App Store: ${env.APP_STORE_URL}`,
    `Google Play: ${env.PLAY_STORE_URL}`,
  ];
}
