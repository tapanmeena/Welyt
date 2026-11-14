import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import nodemailer from 'nodemailer';
import { loadApiEnv } from '../config/env.ts';
import { ConsoleMailer, SmtpMailer, createMailer } from '../lib/mailer.ts';

describe('SMTP & Gmail mailer configuration', () => {
  it('falls back to ConsoleMailer when SMTP credentials are empty and selects SmtpMailer when set', () => {
    const fallbackEnv = loadApiEnv({
      NODE_ENV: 'development',
      SMTP_USER: '',
      SMTP_PASS: '',
    });
    assert.equal(fallbackEnv.mailerProvider, 'console');
    assert.equal(fallbackEnv.smtp, null);
    assert.ok(createMailer(fallbackEnv) instanceof ConsoleMailer);

    const gmailEnv = loadApiEnv({
      NODE_ENV: 'development',
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: 'abcd efgh ijkl mnop',
    });
    assert.equal(gmailEnv.mailerProvider, 'smtp');
    assert.deepEqual(gmailEnv.smtp, {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'sender@gmail.com',
      pass: 'abcdefghijklmnop',
      from: 'Welyt <sender@gmail.com>',
    });

    const mailer = createMailer(gmailEnv);
    assert.ok(mailer instanceof SmtpMailer);
    mailer.close?.();
  });

  it('rejects partial SMTP configuration when only SMTP_USER or SMTP_PASS is set', () => {
    assert.throws(() =>
      loadApiEnv({
        NODE_ENV: 'development',
        SMTP_USER: 'sender@gmail.com',
      }),
    );

    assert.throws(() =>
      loadApiEnv({
        NODE_ENV: 'development',
        MAILER_PROVIDER: 'smtp',
      }),
    );
  });

  it('formats HTML-safe verification and password reset emails via Nodemailer transport', async () => {
    const capturedMessages: string[] = [];
    const jsonTransporter = nodemailer.createTransport({ jsonTransport: true });
    const originalSendMail = jsonTransporter.sendMail.bind(jsonTransporter);
    jsonTransporter.sendMail = (async (mailOptions) => {
      const info = (await originalSendMail(mailOptions)) as { message: string; messageId: string };
      capturedMessages.push(info.message);
      return info;
    }) as typeof jsonTransporter.sendMail;

    const smtpMailer = new SmtpMailer(
      {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'sender@gmail.com',
        pass: 'abcdefghijklmnop',
        from: 'Welyt <sender@gmail.com>',
      },
      undefined,
      jsonTransporter,
    );

    await smtpMailer.sendVerificationEmail({
      to: 'user@example.com',
      name: 'Riya <Admin>',
      code: '482910',
      deepLinkUrl: 'welyt://verify-email?email=user%40example.com&code=482910',
      expiresInMinutes: 15,
    });

    await smtpMailer.sendPasswordResetEmail({
      to: 'user@example.com',
      name: 'Riya <Admin>',
      code: '910284',
      deepLinkUrl: 'welyt://reset-password?email=user%40example.com&code=910284',
      expiresInMinutes: 15,
    });

    assert.equal(capturedMessages.length, 2);

    const verifyJson = JSON.parse(capturedMessages[0]!) as {
      subject: string;
      html: string;
      text: string;
    };
    assert.equal(verifyJson.subject, '482910 is your Welyt verification code');
    assert.ok(verifyJson.html.includes('Hi Riya &lt;Admin&gt;,'));
    assert.ok(!verifyJson.html.includes('<Admin>'));
    assert.ok(verifyJson.text.includes('482910'));

    const resetJson = JSON.parse(capturedMessages[1]!) as {
      subject: string;
      html: string;
    };
    assert.equal(resetJson.subject, '910284 is your Welyt password reset code');
    assert.ok(resetJson.html.includes('910284'));
  });
});
