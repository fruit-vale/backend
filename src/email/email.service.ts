import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mensagem {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

/**
 * Envio de e-mail por SMTP (nodemailer). Sem SMTP_HOST o envio fica desligado:
 * `enviar` devolve false e a API segue funcionando.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporte?: Transporter;
  private readonly remetente: string;

  constructor() {
    // Atalho para Gmail: conta + "senha de app" (não a senha normal da conta)
    const gmail = process.env.GMAIL_USER;
    if (gmail) {
      this.remetente = `FruitVale <${gmail}>`;
      this.transporte = createTransport({
        service: 'gmail',
        auth: {
          user: gmail,
          // a senha de app aparece com espaços ("abcd efgh ..."): remove
          pass: (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, ''),
        },
      });
      return;
    }

    const host = process.env.SMTP_HOST;
    const usuario = process.env.SMTP_USER;
    this.remetente =
      process.env.SMTP_FROM ??
      usuario ??
      'FruitVale <nao-responda@fruitvale.com.br>';

    if (!host) {
      this.logger.warn('SMTP_HOST não definido; envio de e-mails desativado.');
      return;
    }
    const porta = Number(process.env.SMTP_PORT ?? 587);
    this.transporte = createTransport({
      host,
      port: porta,
      // 465 usa TLS direto; as demais portas negociam STARTTLS
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : porta === 465,
      auth: usuario
        ? { user: usuario, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  get ativo() {
    return !!this.transporte;
  }

  /** true se o servidor SMTP aceitou a mensagem. Nunca lança. */
  async enviar(mensagem: Mensagem) {
    if (!this.transporte) return false;
    try {
      await this.transporte.sendMail({
        from: this.remetente,
        to: mensagem.para,
        subject: mensagem.assunto,
        html: mensagem.html,
        text: mensagem.texto,
      });
      return true;
    } catch (erro) {
      this.logger.error(
        `Falha ao enviar e-mail: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return false;
    }
  }
}
