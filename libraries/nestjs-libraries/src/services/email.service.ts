import { Injectable } from '@nestjs/common';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { ResendProvider } from '@gitroom/nestjs-libraries/emails/resend.provider';
import { EmptyProvider } from '@gitroom/nestjs-libraries/emails/empty.provider';
import { NodeMailerProvider } from '@gitroom/nestjs-libraries/emails/node.mailer.provider';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';

// トイバコ: 宛先・件名・本文・provider の応答は log へ出さない。
// 形を確かめた分類だけを返し、provider の error がどんな形でも例外を投げない。
function toybacoEmailErrorClass(err: any): string {
  const closed = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
  let name = 'Error';
  let code = 'none';
  let responseCode = 'none';
  try {
    const rawName = err?.name;
    if (typeof rawName === 'string' && closed.test(rawName)) {
      name = rawName;
    }
    const rawCode = err?.code;
    if (typeof rawCode === 'string' && closed.test(rawCode)) {
      code = rawCode;
    }
    const rawResponseCode = err?.responseCode;
    if (
      Number.isInteger(rawResponseCode) &&
      rawResponseCode >= 100 &&
      rawResponseCode <= 999
    ) {
      responseCode = String(rawResponseCode);
    }
  } catch {
    // 読めない値は既定の分類のままにする。
  }
  return `name=${name} code=${code} responseCode=${responseCode}`;
}

@Injectable()
export class EmailService {
  emailService: EmailInterface;
  constructor(private _temporalService: TemporalService) {
    this.emailService = this.selectProvider(process.env.EMAIL_PROVIDER!);
    console.log('Email service provider:', this.emailService.name);
    for (const key of this.emailService.validateEnvKeys) {
      if (!process.env[key]) {
        console.error(`Missing environment variable: ${key}`);
      }
    }
  }

  hasProvider() {
    return !(this.emailService instanceof EmptyProvider);
  }

  selectProvider(provider: string) {
    switch (provider) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      default:
        return new EmptyProvider();
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    return this._temporalService.client
      .getRawClient()
      ?.workflow.signalWithStart('sendEmailWorkflow', {
        taskQueue: 'main',
        workflowId: 'send_email',
        signal: 'sendEmail',
        args: [{ queue: [] }],
        signalArgs: [{ to, subject, html, replyTo, addTo }],
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string
  ) {
    if (to.indexOf('@') === -1) {
      return;
    }

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      console.log(
        'Email sender information not found in environment variables'
      );
      return;
    }

    const modifiedHtml = `
    <div style="
        background: #FAF7F2;
        font-family: 'Hiragino Kaku Gothic ProN', 'Hiragino Sans',
          'Noto Sans JP', 'Yu Gothic', Meiryo, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    ">
        <div style="
            background-color: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(4px);
            border-radius: 0.5rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 48rem;
            width: 100%;
            padding: 2rem;
        ">
            <h1 style="
                font-size: 1.875rem;
                font-weight: bold;
                margin-bottom: 1.5rem;
                text-align: left;
                color: #1F3A5F;
            ">${subject}</h1>
            
            <div style="
                margin-bottom: 2rem;
                color: #24303F;
            ">
                ${html}
            </div>
            
            <div style="
                display: flex;
                align-items: center;
                border-top: 1px solid #E8E2D8;
                padding-top: 1.5rem;
            ">
                <div>
                    <h2 style="
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1F3A5F;
                        margin: 0;
                    ">${process.env.EMAIL_FROM_NAME}</h2>
                    <div style="font-size: 12px">
                      通知の設定は<a href="${process.env.FRONTEND_URL}/settings">設定画面</a>から変更できます。
                     </div>
                </div>
            </div>
        </div>
    </div>
    `;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sends = await this.emailService.sendEmail(
          to,
          subject,
          modifiedHtml,
          process.env.EMAIL_FROM_NAME,
          process.env.EMAIL_FROM_ADDRESS,
          replyTo
        );
        console.log(`TOYBACO_EMAIL_SENT attempt=${attempt + 1}/3`);
        return;
      } catch (err) {
        lastErr = err;
        console.log(`TOYBACO_EMAIL_ATTEMPT_FAILED attempt=${attempt + 1}/3 ${toybacoEmailErrorClass(err)}`);
        if (attempt < 2) {
          await timer(700);
        }
      }
    }
    console.log(`TOYBACO_EMAIL_FAILED attempts=3 ${toybacoEmailErrorClass(lastErr)}`);
  }
}
