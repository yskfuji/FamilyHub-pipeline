import nodemailer from 'nodemailer';
import type { ServerConfig } from '../config';

export interface Mailer {
  /** 送信の手段が設定されているか。false の間はメールを使う機能を画面に出さない。 */
  available: boolean;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(config: ServerConfig): Mailer {
  const { smtp } = config;
  if (!smtp) return { available: false, send: async () => undefined };
  const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}) });
  return { available: true, send: async (message) => { await transport.sendMail({ from: smtp.from, ...message }); } };
}
