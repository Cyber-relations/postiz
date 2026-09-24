import { Controller, Post, Req, Res, HttpException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  postingPaidUpgradeRequest,
  postingPaidUpgradeResponse,
} from '@gitroom/nestjs-libraries/toybaco/posting-authority-protocol';
@Controller('toybaco/internal/posting-paid-upgrade')
export class ToybacoPostingPaidUpgradeController {
  constructor(private readonly posts: PostsService) {}
  @Post()
  async handle(@Req() request: any, @Res() response: any) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const context = postingPaidUpgradeRequest(request);
      const result = await this.posts.postingPaidUpgrade(
        context.operation,
        context.handoff,
        context.application,
      );
      const output = postingPaidUpgradeResponse(context, result);
      response.status(200).setHeader('Content-Type', 'application/json');
      response.setHeader('X-Toybaco-Paid-Upgrade-Signature', output.signature);
      response.send(output.raw);
    } catch (error) {
      const status =
        error instanceof HttpException && error.getStatus() === 403 ? 403 : 503;
      response
        .status(status)
        .json({ code: 'TOYBACO_POSTING_PAID_UPGRADE_UNAVAILABLE' });
    }
  }
}
