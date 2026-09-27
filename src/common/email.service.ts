import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

function requireResendConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error(
      'RESEND_API_KEY/EMAIL_FROM não configurados — defina as variáveis de ambiente antes de iniciar a aplicação.',
    );
  }
  return { apiKey, from };
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend;
  private readonly from: string;

  constructor() {
    const { apiKey, from } = requireResendConfig();
    this.client = new Resend(apiKey);
    this.from = from;
  }

  /** Envia e-mail; nunca lança — falha de e-mail não pode derrubar o fluxo que a disparou (ex.: um lead). */
  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const { error } = await this.client.emails.send({ from: this.from, to, subject, html });
      if (error) {
        this.logger.error(`Falha ao enviar e-mail pra ${to}`, JSON.stringify(error));
      }
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail pra ${to}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
