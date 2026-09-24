import { Controller, Post, Req, Res, HttpException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { postingRenewalRequest, postingRenewalResponse } from '@gitroom/nestjs-libraries/toybaco/posting-authority-protocol';
@Controller('toybaco/internal/posting-renewal')
export class ToybacoPostingRenewalController {
  constructor(private readonly posts: PostsService) {}
  @Post()
  async handle(@Req() request:any,@Res() response:any) {
    response.setHeader('Cache-Control','no-store');
    try {
      const context=postingRenewalRequest(request),result=await this.posts.postingRenewal(context.renewal),output=postingRenewalResponse(context,result);
      response.status(200).setHeader('Content-Type','application/json');response.setHeader('X-Toybaco-Renewal-Signature',output.signature);response.send(output.raw);
    } catch(error) {
      const status=error instanceof HttpException&&error.getStatus()===403?403:503;
      response.status(status).json({code:'TOYBACO_POSTING_RENEWAL_UNAVAILABLE'});
    }
  }
}
