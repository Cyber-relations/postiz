import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { toybacoNotificationJa } from '@gitroom/nestjs-libraries/toybaco/notification.ja';

@Injectable()
@Activity()
export class EmailActivity {
  constructor(
    private _emailService: EmailService,
    private _organizationService: OrganizationService
  ) {}

  @ActivityMethod()
  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    // 通常メールも workflow の外に出た activity で同じ変換表を通す。
    const notification = toybacoNotificationJa(subject, html);
    return this._emailService.sendEmailSync(
      to,
      notification.subject,
      notification.message,
      replyTo
    );
  }

  @ActivityMethod()
  async sendEmailAsync(to: string, subject: string, html: string, sendTo: 'top' | 'bottom', replyTo?: string) {
    // digest の固定件名もここを通るため、workflow を変えずに日本語化できる。
    const notification = toybacoNotificationJa(subject, html);
    return await this._emailService.sendEmail(
      to,
      notification.subject,
      notification.message,
      sendTo,
      replyTo
    );
  }

  @ActivityMethod()
  async getUserOrgs(id: string) {
    return this._organizationService.getTeam(id);
  }

  @ActivityMethod()
  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationService.setStreak(organizationId, type);
  }
}
