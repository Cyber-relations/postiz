import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { toybacoPostingDraft, toybacoPostingPolicy } from '@gitroom/nestjs-libraries/toybaco/posting-draft-bridge';

@Controller('/toybaco/post-drafts')
export class ToybacoPostDraftsController {
  @Get('/policy')
  async policy(@GetUserFromRequest() user: User, @GetOrgFromRequest() organization: Organization,
    @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return toybacoPostingPolicy(user, organization);
  }

  @Post('/')
  async create(@GetUserFromRequest() user: User, @GetOrgFromRequest() organization: Organization,
    @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return toybacoPostingDraft(user, organization, body);
  }
}
