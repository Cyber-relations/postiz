import {
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  PostsService,
  toybacoCanMutatePost,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { Response } from 'express';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';

@ApiTags('Posts')
@Controller('/posts')
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _agentGraphService: AgentGraphService,
    private _shortLinkService: ShortLinkService
  ) {}

  @Get('/:id/statistics')
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Post('/should-shortlink')
  async shouldShortlink(@Body() body: { messages: string[] }) {
    return { ask: this._shortLinkService.askShortLinkedin(body.messages) };
  }

  @Post('/:id/comments')
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: { comment: string }
  ) {
    return this._postsService.createComment(org.id, user.id, id, body.comment);
  }

  @Get('/tags')
  async getTags(@GetOrgFromRequest() org: Organization) {
    return { tags: await this._postsService.getTags(org.id) };
  }

  @Post('/tags')
  async createTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto
  ) {
    return this._postsService.createTag(org.id, body);
  }

  @Put('/tags/:id')
  async editTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto,
    @Param('id') id: string
  ) {
    return this._postsService.editTag(id, org.id, body);
  }

  @Delete('/tags/:id')
  async deleteTag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.deleteTag(id, org.id);
  }

  @Get('/')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    return this._postsService.getPostsMinified(org.id, query);
  }

  @Get('/find-slot')
  async findSlot(@GetOrgFromRequest() org: Organization) {
    return { date: await this._postsService.findFreeDateTime(org.id) };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/list')
  async getPostsList(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsListDto
  ) {
    return this._postsService.getPostsList(org.id, query);
  }

  @Get('/old')
  oldPosts(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string
  ) {
    return this._postsService.getOldPosts(org.id, date);
  }

  @Get('/group/:group/debug-export')
  async getPostGroupDebugExport(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('group') group: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Forbidden', 403);
    }
    return this._postsService.getPostGroupDebugExport(org.id, group);
  }

  @Get('/group/:group')
  getPostsByGroup(@GetOrgFromRequest() org: Organization, @Param('group') group: string) {
    return this._postsService.getPostsByGroup(org.id, group);
  }

  @Get('/:id')
  getPost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._postsService.getPost(org.id, id);
  }

  @Post('/valid')
  async validatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    return this._postsService.validatePosts(org.id, rawBody?.posts || []);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    // Server-side validation — never trust the client to have validated.
    const validation = await this._postsService.validatePosts(
      org.id,
      rawBody?.posts || []
    );

    const fail = (item: (typeof validation)[number], code: unknown) => {
      // toybaco_validation_boundary_v1: provider/DTO由来の自由文は返さない。
      const messages: Record<string, string> = {
        TOYBACO_POST_CONTENT_REQUIRED:
          '投稿内容または画像を1件以上入力してください。',
        TOYBACO_POST_SETTINGS_INVALID: '投稿設定を確認してください。',
        TOYBACO_POST_MEDIA_INVALID:
          '投稿に利用できないメディアが含まれています。',
        TOYBACO_POST_TOO_LONG: '投稿文が長すぎます。短くしてから保存してください。',
      };
      const error =
        typeof code === 'string' &&
        Object.prototype.hasOwnProperty.call(messages, code)
          ? messages[code]
          : '投稿内容を確認してください。';
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(item, 'TOYBACO_POST_CONTENT_REQUIRED');
      }
    }

    if (rawBody?.type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, 'TOYBACO_POST_SETTINGS_INVALID');
        }
        if (item.errors !== true) {
          fail(item, 'TOYBACO_POST_MEDIA_INVALID');
        }
        if (item.tooLong) {
          fail(item, 'TOYBACO_POST_TOO_LONG');
        }
      }
    }

    const toybacoIsUpdate = rawBody?.type === 'update';
    const toybacoRole = toybacoAssertControllerMutation(
      org,
      toybacoIsUpdate ? 'DRAFT' : 'NEW',
      toybacoIsUpdate ? 'content' : 'create',
      toybacoCreateTargetState(rawBody?.type)
    );

    const body = await this._postsService.mapTypeToPost(rawBody, org.id);
    return this._postsService.createPost(
      org.id,
      body,
      'WEB',
      false,
      toybacoRole
    );
  }

  @Post('/generator/draft')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  generatePostsDraft(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateGeneratedPostsDto
  ) {
    // 画面を隠すだけでは API を直接呼べてしまうため、ここでも止める。
    // 接続先を東京の Bedrock に向けたら、この環境変数を外して有効化する。
    if (process.env.TOYBACO_DISABLE_AI) {
      throw new ForbiddenException('この機能は利用できません');
    }
    // 文案生成APIには画像生成の分岐も含まれる。メディアAPIを閉じても
    // ここを直接呼ぶと外向きの画像生成へ到達するため、入力でも拒否する。
    if ((body as { isPicture?: boolean }).isPicture) {
      throw new ForbiddenException('画像生成機能は利用できません');
    }
    return this._postsService.generatePostsDraft(org.id, body);
  }

  @Post('/generator')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async generatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratorDto,
    @Res({ passthrough: false }) res: Response
  ) {
    // 画面を隠すだけでは API を直接呼べてしまうため、ここでも止める。
    // 接続先を東京の Bedrock に向けたら、この環境変数を外して有効化する。
    if (process.env.TOYBACO_DISABLE_AI) {
      throw new ForbiddenException('この機能は利用できません');
    }
    // 文案生成APIには画像生成の分岐も含まれる。メディアAPIを閉じても
    // ここを直接呼ぶと外向きの画像生成へ到達するため、入力でも拒否する。
    if ((body as { isPicture?: boolean }).isPicture) {
      throw new ForbiddenException('画像生成機能は利用できません');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // toybaco_stream_now: 工程が終わるたびに、その場で顧客へ送る。
    //
    // no-transform: 応答をまとめて圧縮する仕組みに「この応答は触るな」と
    //   伝える合図。これが無いと、小さな途中経過が圧縮の手元に溜まったまま
    //   送り出されず、顧客の画面は最後まで無反応になる。
    // X-Accel-Buffering: 手前の受付役にも同じことを伝える。受付役の設定でも
    //   溜め込みを止めているが、設定が失われても効くよう二重にしておく。
    res.setHeader('Cache-Control', 'no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const event of this._agentGraphService.start(org.id, body)) {
        res.write(JSON.stringify(event) + '\n');
      }
    } catch (err) {
      // The stream has already started, so we cannot surface a normal HTTP
      // error here. Emit a final error event on the open stream instead, so the
      // client can stop and show the message rather than hang on a truncated
      // stream. HttpExceptions carry a curated, user-facing message (e.g. the
      // AI safety rejection); anything else gets a generic message.
      const message =
        err instanceof HttpException
          ? err.message
          : '投稿文を生成できませんでした。時間をおいてもう一度お試しください。';
      res.write(JSON.stringify({ name: 'error', error: true, message }) + '\n');
    }

    res.end();
  }

  @Delete('/:group')
  deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    const toybacoRole = toybacoAssertControllerMutation(
      org,
      'UNKNOWN',
      'delete',
      'UNCHANGED'
    );
    return this._postsService.deletePost(org.id, group, toybacoRole);
  }

  @Put('/:id/date')
  changeDate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('date') date: string,
    // 'update' is the safe default: clients that don't send an action must
    // never requeue (and thereby republish) a post by accident
    @Body('action') action: 'schedule' | 'update' = 'update',
    @Body('republish') republish = false
  ) {
    const toybacoRole = toybacoActorRole(org);
    const toybacoAction =
      action === 'schedule' ? 'schedule' : action === 'update' ? 'date' : '';
    if (
      !toybacoAction ||
      !toybacoCanMutatePost(
        toybacoRole,
        'DRAFT',
        toybacoAction,
        action === 'schedule' ? 'QUEUE' : 'DRAFT'
      )
    ) {
      throw new HttpException(
        TOYBACO_APPROVAL_DENIED_MESSAGE,
        HttpStatus.FORBIDDEN
      );
    }

    return this._postsService.changeDate(
      org.id,
      id,
      date,
      action,
      republish,
      toybacoRole
    );
  }

  @Post('/separate-posts')
  async separatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { content: string; len: number }
  ) {
    return this._postsService.separatePosts(body.content, body.len);
  }
}

// toybaco_approval_flow_v5: requestの組織roleはDB解決済みの値だけを使う。
const TOYBACO_APPROVAL_DENIED_MESSAGE =
  'この操作は本部の管理者のみ実行できます。店舗担当者は下書きの作成・編集のみ可能です。';

function toybacoActorRole(org: any): string {
  const role = org?.users?.[0]?.role;
  return role === 'USER' || role === 'ADMIN' || role === 'SUPERADMIN'
    ? role
    : 'UNKNOWN';
}

function toybacoCreateTargetState(type: unknown): string {
  if (type === 'draft') return 'DRAFT';
  if (type === 'schedule' || type === 'now') return 'QUEUE';
  if (type === 'update') return 'DRAFT';
  return 'UNKNOWN';
}

function toybacoAssertControllerMutation(
  org: any,
  currentState: string,
  action: string,
  targetState: string
): string {
  const role = toybacoActorRole(org);
  if (toybacoCanMutatePost(role, currentState, action, targetState)) {
    return role;
  }

  throw new HttpException(
    TOYBACO_APPROVAL_DENIED_MESSAGE,
    HttpStatus.FORBIDDEN
  );
}
