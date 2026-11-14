import { AUTH_ERROR_CODES } from '@welyt/shared';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';
import type { ApiEnv, SmtpConfig } from '../config/env.ts';
import { AppError } from './errors.ts';

export interface VerificationEmailMessage {
  to: string;
  name: string;
  code: string;
  deepLinkUrl: string;
  expiresInMinutes: number;
}

export interface PasswordResetEmailMessage {
  to: string;
  name: string;
  code: string;
  deepLinkUrl: string;
  expiresInMinutes: number;
}

export interface Mailer {
  sendVerificationEmail(message: VerificationEmailMessage): Promise<void>;
  sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void>;
  verifyConnection?(): Promise<void>;
  close?(): void;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderOtpEmailHtml(params: {
  heading: string;
  greetingName: string;
  intro: string;
  code: string;
  expiresInMinutes: number;
  footerNote: string;
}): string {
  const safeName = escapeHtml(params.greetingName);
  const safeCode = escapeHtml(params.code);

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background-color:#f7f8f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#162027;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background-color:#ffffff;border:1px solid #dce2e7;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background-color:#26333c;padding:20px 24px;">
          <span style="font-size:20px;font-weight:700;color:#efb397;letter-spacing:0.4px;">Welyt</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#26333c;">${escapeHtml(params.heading)}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#546470;">Hi ${safeName},</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#546470;">${escapeHtml(params.intro)}</p>
          <div style="margin:0 0 20px;padding:16px;text-align:center;background-color:#fdf1eb;border:1px solid #f4c7b1;border-radius:12px;">
            <span style="font-size:30px;font-weight:700;letter-spacing:6px;color:#26333c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${safeCode}</span>
          </div>
          <p style="margin:0 0 12px;font-size:13px;line-height:20px;color:#546470;">This code expires in ${params.expiresInMinutes} minutes.</p>
          <p style="margin:0;font-size:13px;line-height:20px;color:#7f8e99;">${escapeHtml(params.footerNote)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly logger: FastifyBaseLogger | undefined;

  constructor(config: SmtpConfig, logger?: FastifyBaseLogger, customTransporter?: Transporter) {
    this.from = config.from;
    this.logger = logger;
    this.transporter =
      customTransporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });
  }

  async sendVerificationEmail(message: VerificationEmailMessage): Promise<void> {
    const subject = `${message.code} is your Welyt verification code`;
    const text = [
      `Hi ${message.name},`,
      '',
      `Your Welyt email verification code is: ${message.code}`,
      '',
      `This code expires in ${message.expiresInMinutes} minutes.`,
      `Open in Welyt: ${message.deepLinkUrl}`,
      '',
      'If you did not create a Welyt account, you can safely ignore this email.',
    ].join('\n');

    const html = renderOtpEmailHtml({
      heading: 'Verify your email address',
      greetingName: message.name,
      intro: 'Enter this 6-digit verification code in the Welyt app to activate your account:',
      code: message.code,
      expiresInMinutes: message.expiresInMinutes,
      footerNote: 'If you did not create a Welyt account, you can safely ignore this email.',
    });

    await this.dispatchMail({
      to: message.to,
      subject,
      text,
      html,
      kind: 'email_verification',
    });
  }

  async sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void> {
    const subject = `${message.code} is your Welyt password reset code`;
    const text = [
      `Hi ${message.name},`,
      '',
      `Your Welyt password reset code is: ${message.code}`,
      '',
      `This code expires in ${message.expiresInMinutes} minutes.`,
      `Open in Welyt: ${message.deepLinkUrl}`,
      '',
      'If you did not request a password reset, no changes have been made to your account.',
    ].join('\n');

    const html = renderOtpEmailHtml({
      heading: 'Reset your password',
      greetingName: message.name,
      intro: 'Enter this 6-digit code in the Welyt app to choose a new password:',
      code: message.code,
      expiresInMinutes: message.expiresInMinutes,
      footerNote:
        'If you did not request a password reset, no changes have been made to your account.',
    });

    await this.dispatchMail({
      to: message.to,
      subject,
      text,
      html,
      kind: 'password_reset',
    });
  }

  async verifyConnection(): Promise<void> {
    await this.transporter.verify();
  }

  close(): void {
    this.transporter.close();
  }

  private async dispatchMail(payload: {
    to: string;
    subject: string;
    text: string;
    html: string;
    kind: 'email_verification' | 'password_reset';
  }): Promise<void> {
    try {
      const info = (await this.transporter.sendMail({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      })) as { messageId?: string };

      this.logger?.info(
        { type: payload.kind, to: payload.to, messageId: info.messageId },
        'Sent transactional email via SMTP',
      );
    } catch (err) {
      this.logger?.error(
        { err, type: payload.kind, to: payload.to },
        'Failed to send transactional email via SMTP',
      );
      throw new AppError(
        500,
        AUTH_ERROR_CODES.INTERNAL_ERROR,
        'Unable to send email right now. Please try again shortly.',
      );
    }
  }
}

export function createMailer(env: ApiEnv, logger?: FastifyBaseLogger): Mailer {
  if (env.mailerProvider === 'smtp' && env.smtp) {
    logger?.info(
      { host: env.smtp.host, port: env.smtp.port, secure: env.smtp.secure, from: env.smtp.from },
      'Using SMTP mailer',
    );
    return new SmtpMailer(env.smtp, logger);
  }

  logger?.info('Using ConsoleMailer (set SMTP_USER and SMTP_PASS in .env to send real emails)');
  return new ConsoleMailer(logger);
}

export class ConsoleMailer implements Mailer {
  private readonly logger: FastifyBaseLogger | undefined;

  constructor(logger?: FastifyBaseLogger) {
    this.logger = logger;
  }

  async sendVerificationEmail(message: VerificationEmailMessage): Promise<void> {
    const summary = {
      type: 'email_verification',
      to: message.to,
      code: message.code,
      deepLinkUrl: message.deepLinkUrl,
      expiresInMinutes: message.expiresInMinutes,
    };

    if (this.logger) {
      this.logger.info(summary, 'Dispatched email verification code');
    } else {
      console.info('[Mailer] Email verification:', summary);
    }
  }

  async sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void> {
    const summary = {
      type: 'password_reset',
      to: message.to,
      code: message.code,
      deepLinkUrl: message.deepLinkUrl,
      expiresInMinutes: message.expiresInMinutes,
    };

    if (this.logger) {
      this.logger.info(summary, 'Dispatched password reset code');
    } else {
      console.info('[Mailer] Password reset:', summary);
    }
  }
}

export class MemoryMailer implements Mailer {
  readonly verifications: VerificationEmailMessage[] = [];
  readonly passwordResets: PasswordResetEmailMessage[] = [];

  async sendVerificationEmail(message: VerificationEmailMessage): Promise<void> {
    this.verifications.push(message);
  }

  async sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void> {
    this.passwordResets.push(message);
  }

  clear(): void {
    this.verifications.length = 0;
    this.passwordResets.length = 0;
  }
}
