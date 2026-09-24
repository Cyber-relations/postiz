import { Controller, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { Request, Response } from 'express';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PREPARATION_PATH, preparationRequest, preparationResponse } from '@gitroom/nestjs-libraries/toybaco/posting-preparation-bridge';

// Authentication allows only a non-executable preparation, never publication.
@Controller(PREPARATION_PATH)
export class ToybacoPostingPreparationController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  async prepare(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    const context = preparationRequest(request);
    try {
      const receipt = await this.posts.preparePostingRelease(context.preparation.organizationId, context.preparation);
      const result = preparationResponse(context, receipt);
      response.setHeader('X-Toybaco-Preparation-Signature', result.signature);
      response.type('application/json').status(200).send(result.raw);
    } catch {
      throw new ServiceUnavailableException('再開の準備状態を確認してください。');
    }
  }
}
