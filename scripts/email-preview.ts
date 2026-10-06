/**
 * Renders every email template to disk so it can be opened in a browser —
 * the quick check before sending a real one through Resend.
 *
 * Run with: pnpm email:preview [outDir]   (default: ./email-preview)
 * Then open email-preview/index.html.
 *
 * For a real inbox test, send to delivered@resend.dev (Resend's sink) or
 * your own address from a deployment with SMTP configured.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildVaultPasscodeResetEmail,
  buildVaultRecoveryEmail,
  buildVerificationEmail,
} from '../src/shared/services/auth-email.template';
import { buildFamilyInviteEmail } from '../src/shared/services/family-email.template';
import {
  buildGiftInviteEmail,
  buildGiftUnlockedEmail,
} from '../src/shared/services/gift-email.template';
import { buildSupportRequestEmail } from '../src/shared/services/support-email.template';

const outDir = resolve(process.argv[2] ?? 'email-preview');
mkdirSync(outDir, { recursive: true });

const now = new Date();
const samples: Record<string, { subject: string; html: string; body: string }> =
  {
    verification: buildVerificationEmail('482913'),
    'password-reset': buildPasswordResetEmail('482913', 'amina@example.com'),
    'password-changed': buildPasswordChangedEmail({ name: 'Amina', when: now }),
    'vault-recovery': buildVaultRecoveryEmail({ code: '482913' }),
    'shared-vault-recovery': buildVaultRecoveryEmail({
      code: '482913',
      vaultName: 'Grandma’s letters',
    }),
    'vault-passcode-reset': buildVaultPasscodeResetEmail({
      name: 'Amina',
      when: now,
    }),
    'family-invite': buildFamilyInviteEmail({
      inviterName: 'Ahmed Tahir',
      familyName: 'The Tahirs',
      memberCount: 6,
      url: 'https://heirloom.setrick.com/i/abc123',
    }),
    'gift-invite': buildGiftInviteEmail({
      recipientEmail: 'amina@example.com',
      recipientName: 'Amina',
      senderName: 'Ahmed',
      journeyTitle: 'Your first year',
    }),
    'gift-unlocked': buildGiftUnlockedEmail({
      senderName: 'Ahmed',
      journeyTitle: 'Your first year',
    }),
    'support-request': buildSupportRequestEmail({
      title: 'Upload stuck at 90%',
      details: 'The video upload never finishes.\n\nTried twice on Wi-Fi.',
      reporterName: 'Amina',
      reporterEmail: 'amina@example.com',
      reporterId: '00000000-0000-0000-0000-000000000000',
      platform: 'ios',
      appVersion: '1.0.0',
      hasScreenshot: false,
    }),
  };

const links: string[] = [];
for (const [name, email] of Object.entries(samples)) {
  writeFileSync(join(outDir, `${name}.html`), email.html);
  writeFileSync(
    join(outDir, `${name}.txt`),
    `Subject: ${email.subject}\n\n${email.body}\n`,
  );
  links.push(
    `<li><a href="${name}.html">${name}</a> — <a href="${name}.txt">text</a> — ${email.subject}</li>`,
  );
}
writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Email previews</title><ul style="font:15px/1.8 system-ui">${links.join('')}</ul>`,
);
console.log(`Wrote ${links.length} previews to ${outDir}/index.html`);
