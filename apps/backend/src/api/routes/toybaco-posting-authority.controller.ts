import { Controller, Post, Req, Res, HttpException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  postingAuthorityRequest,
  postingAuthorityResponse,
} from '@gitroom/nestjs-libraries/toybaco/posting-authority-protocol';
@Controller('toybaco/internal/posting-authority')
export class ToybacoPostingAuthorityController {
  constructor(private readonly posts: PostsService) {}
  @Post()
  async handle(@Req() request: any, @Res() response: any) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const context = postingAuthorityRequest(request);
      const result = await this.posts.postingAuthority(
        context.operation,
        context.authority,
      );
      const output = postingAuthorityResponse(context, result);
      response.status(200).setHeader('Content-Type', 'application/json');
      response.setHeader('X-Toybaco-Authority-Signature', output.signature);
      response.send(output.raw);
    } catch (error) {
      const status =
        error instanceof HttpException && error.getStatus() === 403 ? 403 : 503;
      response
        .status(status)
        .json({ code: 'TOYBACO_POSTING_AUTHORITY_UNAVAILABLE' });
    }
  }
}
