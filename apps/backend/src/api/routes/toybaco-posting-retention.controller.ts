import { Controller, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { Request, Response } from 'express';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { RETENTION_PATH, retentionRequest, retentionResponse } from '@gitroom/nestjs-libraries/toybaco/posting-retention-bridge';

// Dedicated HMAC boundary. No cookie/user/body DTO can authorize this route.
@Controller(RETENTION_PATH)
export class ToybacoPostingRetentionController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  async hold(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    const context = retentionRequest(request);
    try {
      const receipt = await this.posts.holdPostingForRetention(context.policy.organizationId, context.policy);
      const result = retentionResponse(context, receipt);
      response.setHeader('X-Toybaco-Retention-Signature', result.signature);
      response.type('application/json').status(200).send(result.raw);
    } catch {
      // Unknown delivery/DB errors carry no body, token, or database diagnostics.
      throw new ServiceUnavailableException('保留状態を再確認してください。');
    }
  }
}
