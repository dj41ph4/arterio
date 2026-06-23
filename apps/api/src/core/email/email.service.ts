import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/configuration';

/**
 * Outbound email — optional. Self-hosted installs have no SMTP relay by
 * default, so this no-ops (logs and returns false) until an operator sets
 * SMTP_HOST/SMTP_USER/SMTP_PASSWORD. Callers must treat email as
 * best-effort and never make it the only path to an outcome (e.g. password
 * reset still falls back to an admin-triggered reset — see MembersService).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const host = this.config.get('SMTP_HOST', { infer: true });
    if (!host) return;
    this.transporter = createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: this.config.get('SMTP_USER', { infer: true })
        ? { user: this.config.get('SMTP_USER', { infer: true }), pass: this.config.get('SMTP_PASSWORD', { infer: true }) }
        : undefined,
    });
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent "${subject}" to ${to}`);
      return false;
    }
    try {
      await this.transporter.sendMail({ from: this.config.get('SMTP_FROM', { infer: true }), to, subject, html });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send "${subject}" to ${to}: ${String(err)}`);
      return false;
    }
  }
}
