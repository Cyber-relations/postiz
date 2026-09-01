import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  Media,
  From,
  CreationMethod,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  minifyPostsList,
  minifyPosts,
} from '@gitroom/helpers/utils/posts.list.minify';
import { toybacoIsAllowedUploadUrl } from '@gitroom/helpers/utils/valid.url.path';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import sharp from 'sharp';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import {
  TypedSearchAttributes,
  WorkflowNotFoundError,
} from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { weightedLength } from '@gitroom/helpers/utils/count.length';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

// toybaco_approval_flow_v5_matrix_start
const TOYBACO_MANAGER_MUTATIONS = {
  ANY: {
    create: ['DRAFT', 'QUEUE', 'UNCHANGED'],
    content: ['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR', 'UNCHANGED'],
    date: ['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR'],
    schedule: ['QUEUE'],
    settings: ['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR', 'UNCHANGED'],
    status: ['DRAFT', 'QUEUE'],
    delete: ['UNCHANGED'],
  },
} as const;

const TOYBACO_DRAFT_MUTATIONS = {
  NEW: {
    create: ['DRAFT'],
  },
  DRAFT: {
    content: ['DRAFT'],
    date: ['DRAFT'],
    settings: ['DRAFT'],
  },
} as const;

export const TOYBACO_POST_MUTATION_MATRIX = {
  USER: TOYBACO_DRAFT_MUTATIONS,
  TOYBACO_AI_DRAFT: TOYBACO_DRAFT_MUTATIONS,
  SYSTEM_DRAFT: TOYBACO_DRAFT_MUTATIONS,
  ADMIN: TOYBACO_MANAGER_MUTATIONS,
  SUPERADMIN: TOYBACO_MANAGER_MUTATIONS,
} as const;

export function toybacoCanMutatePost(
  role: string,
  currentState: string,
  action: string,
  targetState: string
): boolean {
  if (
    ![
      'USER',
      'TOYBACO_AI_DRAFT',
      'SYSTEM_DRAFT',
      'ADMIN',
      'SUPERADMIN',
    ].includes(role) ||
    !['NEW', 'DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR', 'UNKNOWN'].includes(
      currentState
    ) ||
    ![
      'create',
      'content',
      'date',
      'schedule',
      'settings',
      'status',
      'delete',
    ].includes(action) ||
    !['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR', 'UNCHANGED'].includes(targetState)
  ) {
    return false;
  }
  const roleMatrix = (TOYBACO_POST_MUTATION_MATRIX as any)[role];
  const stateMatrix = roleMatrix?.[currentState] || roleMatrix?.ANY;
  const allowedTargets = stateMatrix?.[action];
  return Array.isArray(allowedTargets) && allowedTargets.includes(targetState);
}
// toybaco_approval_flow_v5_matrix_end

// service層の全channel DB書き込みは、1つのPrisma transactionのみを境界とする。
export async function toybacoRunCreatePostServiceTransaction(
  repository: any,
  preparedPosts: any[],
  writeOne: any
) {
  return repository.runPostTransaction(async (database: any) => {
    const committed: any[] = [];
    for (const post of preparedPosts) {
      committed.push(await writeOne(database, post));
    }
    return committed;
  });
}

export async function toybacoDispatchCommittedWorkflows(
  repository: any,
  orgId: string,
  workflows: any[],
  dispatch: any
) {
  for (let index = 0; index < workflows.length; index += 1) {
    const workflow = workflows[index];
    try {
      await dispatch(workflow);
      await repository.completeWorkflowDispatch(orgId, [workflow]);
    } catch (error: any) {
      await repository.recordWorkflowDispatchFailure(
        orgId,
        workflows.slice(index),
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}

const TOYBACO_APPROVAL_DENIED_MESSAGE =
  'この操作は本部の管理者のみ実行できます。店舗担当者は下書きの作成・編集のみ可能です。';
const TOYBACO_DRAFT_CHANGED_MESSAGE =
  '下書き以外の投稿は編集できません。画面を再読み込みして状態を確認してください。';

function toybacoWorkflowAlreadyClosed(error: unknown) {
  return (
    error instanceof WorkflowNotFoundError ||
    (error as any)?.cause instanceof WorkflowNotFoundError
  );
}

@Injectable()
export class PostsService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  async recoverWorkflowStops() {
    const rows = await this._postRepository.recoverWorkflowStops();
    for (const row of rows) {
      try {
        await this.terminatePostWorkflows(row.workflowIds);
        await this._postRepository.completeWorkflowStop(
          row.organizationId,
          row.id,
          row.error
        );
      } catch (_) {
        // ackしなければ次回も同じexact IDだけを再試行する。
        continue;
      }
    }
  }

  completeWorkflowStop(orgId: string, postId: string, marker: string) {
    return this._postRepository.completeWorkflowStop(orgId, postId, marker);
  }

  recoverClaimedComments() {
    return this._postRepository.recoverClaimedComments();
  }

  completeWorkflowDispatch(
    orgId: string,
    dispatches: Array<{ postId: string; marker: string }>
  ) {
    return this._postRepository.completeWorkflowDispatch(orgId, dispatches);
  }

  getWorkflowReadiness(
    orgId: string,
    postId: string,
    expectedPublishMarker: string
  ) {
    return this._postRepository.getWorkflowReadiness(
      orgId,
      postId,
      expectedPublishMarker
    );
  }

  claimProviderPost(
    orgId: string,
    postId: string,
    expectedPublishMarker: string,
    expectedState: State
  ) {
    return this._postRepository.claimProviderPost(
      orgId,
      postId,
      expectedPublishMarker,
      expectedState
    );
  }

  claimProviderStep(
    orgId: string,
    rootPostId: string,
    stepPostId: string,
    expectedPublishMarker: string,
    step: 'FINALIZE' | 'COMMENT'
  ) {
    return this._postRepository.claimProviderStep(
      orgId,
      rootPostId,
      stepPostId,
      expectedPublishMarker,
      step
    );
  }

  completeProviderCommentStep(
    orgId: string,
    childPostId: string,
    expectedPublishMarker: string,
    outcome: 'ERROR' | 'UNCONFIRMED',
    reason: unknown
  ) {
    return this._postRepository.completeProviderCommentStep(
      orgId,
      childPostId,
      expectedPublishMarker,
      outcome,
      reason
    );
  }

  updatePostFromWorkflow(
    orgId: string,
    id: string,
    postId: string,
    releaseURL: string,
    expectedPublishMarker: string,
    finalStep: 'MAIN' | 'FINALIZE' | 'COMMENT'
  ) {
    return this._postRepository.updatePostFromWorkflow(
      orgId,
      id,
      postId,
      releaseURL,
      expectedPublishMarker,
      finalStep
    );
  }

  changeStateFromWorkflow(
    orgId: string,
    id: string,
    state: State,
    expectedPublishMarker: string,
    err?: any,
    body?: any
  ) {
    return this._postRepository.changeStateFromWorkflow(
      orgId,
      id,
      state,
      expectedPublishMarker,
      err,
      body
    );
  }

  prepareRepeatWorkflow(
    orgId: string,
    postId: string,
    expectedPublishMarker: string
  ) {
    return this._postRepository.prepareRepeatWorkflow(
      orgId,
      postId,
      expectedPublishMarker
    );
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this._postRepository.updatePost(id, postId, releaseURL);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    // const getIntegrationData = await ioRedis.get(
    //   `integration:${orgId}:${post.id}:${date}`
    // );
    // if (getIntegrationData) {
    //   return JSON.parse(getIntegrationData);
    // }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body?.type,
      posts: await Promise.all(
        body?.posts?.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `Integration with id ${post.integration.id} not found`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body?.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        }) || []
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(id: string, imagesList: any[], convertToJPEG = false) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.path && p.id) {
                imageUpdateNeeded = true;
                return this._mediaService.getMediaById(p.id);
              }

              return p;
            })
          )
        )
          .map((m) => {
            return {
              ...m,
              url:
                m.path.indexOf('http') === -1
                  ? process.env.FRONTEND_URL +
                    '/' +
                    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                    m.path
                  : m.path,
              type: 'image',
              path:
                m.path.indexOf('http') === -1
                  ? process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (!convertToJPEG) {
              return m;
            }

            if (hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              // 保存時のDTO検証だけに依存しない。既存DB値や将来の別入口から
              // 到達しても、正規media URL以外を外向きfetchしない。
              if (!toybacoIsAllowedUploadUrl(m.url)) {
                throw new BadRequestException(
                  'アップロード済みのメディアを指定してください'
                );
              }
              const response = await fetch(m.url, {
                redirect: 'manual',
                // DNS解決結果をpublic IPへ固定し、rebinding/private IPを拒否する。
                // @ts-ignore — undici option, not in lib.dom fetch types
                dispatcher: getSsrfSafeDispatcher(),
              });
              if (!response.ok) {
                throw new BadRequestException('メディアを取得できませんでした');
              }

              const imageBuffer = Buffer.from(await response.arrayBuffer());

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer)
                .jpeg({ quality: 100 })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              return {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      return imagesList;
    }
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async terminatePostWorkflows(workflowIds: string[]) {
    // DB transaction commit後のみ呼び出す外部副作用。失敗は呼び出し元へ返す。
    const rawClient = this._temporalService.client.getRawClient();
    if (!rawClient) {
      throw new ServiceUnavailableException(
        '投稿ワークフローの停止サービスに接続できません。'
      );
    }
    for (const workflowId of workflowIds) {
      try {
        const workflow =
          await this._temporalService.client.getWorkflowHandle(workflowId);
        await workflow.terminate();
      } catch (error: any) {
        if (!toybacoWorkflowAlreadyClosed(error)) throw error;
      }
    }
  }

  async deletePost(
    orgId: string,
    group: string,
    toybacoActorRole = 'UNKNOWN'
  ) {
    if (
      !toybacoCanMutatePost(toybacoActorRole, 'UNKNOWN', 'delete', 'UNCHANGED')
    ) {
      throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
    }
    const post = await this._postRepository.deletePost(orgId, group);
    await this.terminatePostWorkflows(post?.workflowIds || []);
    if (post?.id && post?.stopMarker) {
      await this._postRepository.completeWorkflowStop(
        orgId,
        post.id,
        post.stopMarker
      );
    }
    return { error: true };
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string) {
    return this._postRepository.getPostByForWebhookId(id);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State,
    expectedMarker: string
  ) {
    const rawClient = this._temporalService.client.getRawClient();
    if (!rawClient) {
      throw new ServiceUnavailableException(
        '投稿ワークフローサービスに接続できません。'
      );
    }
    const parsed = await this._postRepository.claimWorkflowDispatch(
      orgId,
      postId,
      expectedMarker
    );
    const { operation: mode, generation } = parsed;
    if (parsed.previousWorkflowId) {
      if (
        !parsed.previousToken ||
        !parsed.previousGeneration ||
        parsed.previousPostId !== postId ||
        parsed.previousWorkflowId !==
          `post_${postId}_g${parsed.previousGeneration}_t${parsed.previousToken}`
      ) {
        throw new ForbiddenException('prior workflow identityが不正です。');
      }
      try {
        const previousWorkflow =
          await this._temporalService.client.getWorkflowHandle(
            parsed.previousWorkflowId
          );
        await previousWorkflow.terminate();
      } catch (error: any) {
        // Temporal TypeScript SDKはclosed/missing executionのNOT_FOUNDを
        // WorkflowNotFoundErrorへ変換する。その型以外は握りつぶさない。
        if (!toybacoWorkflowAlreadyClosed(error)) throw error;
      }
    }
    // terminate待ちの間に新mutationがcommitしていれば、stale callerをここで止める。
    await this._postRepository.claimWorkflowDispatch(
      orgId,
      postId,
      expectedMarker
    );
    if (mode === 'CANCEL') return;
    if (state !== 'QUEUE') {
      throw new ServiceUnavailableException(
        'QUEUE以外の投稿ワークフローは開始できません。'
      );
    }
    await rawClient.workflow.signalWithStart('postWorkflowV110', {
      workflowId: `post_${postId}_g${generation}_t${parsed.token}`,
      taskQueue: 'main',
      signal: 'poke',
      signalArgs: [],
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      args: [{
        taskQueue,
        postId,
        organizationId: orgId,
        expectedPublishMarker:
          `TOYBACO_PUBLISH_V2|${generation}|${parsed.token}|READY`,
      }],
      typedSearchAttributes: new TypedSearchAttributes([
        { key: postIdSearchParam, value: postId },
        { key: organizationId, value: orgId },
      ]),
    });
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value: Array<{
        content?: string;
        image?: Array<{ path: string; thumbnail?: string }>;
      }>;
      settings?: any;
    }>
  ) {
    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = await this._integrationService.getIntegrationById(
          orgId,
          post?.integration?.id
        );

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post?.integration?.id} not found`
          );
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: false,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          // 顧客境界へclass-validatorの自由文やproperty名を出さない。
          settingsError =
            validationErrors.length === 0
              ? ''
              : 'TOYBACO_POST_SETTINGS_INVALID';
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: 'TOYBACO_POST_MEDIA_INVALID' | true = true;
        try {
          const providerResult = await provider.checkValidity(
            media,
            settings,
            additionalSettings
          );
          errors =
            providerResult === true ? true : 'TOYBACO_POST_MEDIA_INVALID';
        } catch {
          errors = 'TOYBACO_POST_MEDIA_INVALID';
        }

        const maximumCharacters = provider.maxLength(additionalSettings, settings);
        const isX = integration.providerIdentifier === 'x';

        const emptyContent = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const length = isX ? weightedLength(strip) : strip.length;
          return length === 0 && (a.image || []).length === 0;
        });

        const tooLong = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const weighted = isX ? weightedLength(strip) : strip.length;
          const totalCharacters =
            weighted > strip.length ? weighted : strip.length;
          return totalCharacters > (maximumCharacters || 1000000);
        });

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          // 顧客が付けたアカウント名(PII)ではなく固定ラベルだけを返す。
          name:
            integration.providerIdentifier === 'instagram-standalone' ||
            integration.providerIdentifier === 'instagram'
              ? 'Instagram'
              : integration.providerIdentifier === 'threads'
              ? 'Threads'
              : integration.providerIdentifier === 'gmb'
              ? 'Google ビジネスプロフィール'
              : '連携先',
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          // UIはこの閉じたコードだけを日本語へ変換する。raw provider errorは禁止。
          toybacoErrorCode: emptyContent
            ? 'TOYBACO_POST_CONTENT_REQUIRED'
            : !valid
            ? 'TOYBACO_POST_SETTINGS_INVALID'
            : errors !== true
            ? 'TOYBACO_POST_MEDIA_INVALID'
            : tooLong
            ? 'TOYBACO_POST_TOO_LONG'
            : null,
          maximumCharacters,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  // A schedule-type save targeting an already-PUBLISHED post republishes it to
  // the platform: require the explicit `republish` opt-in instead. The message
  // doubles as the confirmation dialog for API/MCP automation.
  private guardAgainstRepublish(
    post: { state: State; publishDate: Date; integration?: { providerIdentifier: string } } | null,
    source: 'createPost' | 'changeDate'
  ) {
    if (post?.state !== 'PUBLISHED') {
      return;
    }

    const howToUpdate =
      source === 'createPost' ? `use type 'update'` : `use action 'update'`;

    throw new BadRequestException(
      `This post was already published on ${dayjs
        .utc(post.publishDate)
        .format('YYYY-MM-DD HH:mm')} UTC. Saving it this way would publish it again to ${
        post.integration?.providerIdentifier || 'the channel'
      }. To edit without republishing, ${howToUpdate}. To intentionally publish again, pass republish: true.`
    );
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod,
    keepGroup = false,
    toybacoActorRole = 'UNKNOWN'
  ): Promise<any[]> {
    const toybacoIsUpdate = body.type === 'update';
    const toybacoCreateTarget =
      body.type === 'draft' || toybacoIsUpdate
        ? 'DRAFT'
        : body.type === 'schedule' || body.type === 'now'
        ? 'QUEUE'
        : 'UNKNOWN';
    if (
      !toybacoCanMutatePost(
        toybacoActorRole,
        toybacoIsUpdate ? 'DRAFT' : 'NEW',
        toybacoIsUpdate ? 'content' : 'create',
        toybacoCreateTarget
      )
    ) {
      throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
    }

    const toybacoDraftOnly = [
      'USER',
      'TOYBACO_AI_DRAFT',
      'SYSTEM_DRAFT',
    ].includes(toybacoActorRole);
    const suppliedIds = body.posts.flatMap((post) =>
      (post.value || []).flatMap((value) => (value.id ? [value.id] : []))
    );
    if (new Set(suppliedIds).size !== suppliedIds.length) {
      throw new ForbiddenException(TOYBACO_DRAFT_CHANGED_MESSAGE);
    }
    if (body.shortLink) {
      // 外部短縮URL providerへの書き込みはDB transactionでrollbackできない。
      // トイバコではproviderを構成しないため、製品境界でも明示的に拒否する。
      throw new BadRequestException(
        'トイバコでは短縮URLを利用できません。元のURLのまま保存してください。'
      );
    }

    if (toybacoDraftOnly) {
      if (body.type !== 'draft' && body.type !== 'update') {
        throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
      }

      // 既存/新規の判定とDRAFT条件更新は同じDB transaction内で行う。
      // MCP・UIは新規投稿にも一時idを付けるため、ここでnot-foundを拒否しない。
    }

    const toybacoPreparedPosts = [];
    for (const post of body.posts) {
      const provider = this._integrationManager.getSocialIntegration(
        (post.settings as any)?.__type
      );
      const removeLinks = !!provider?.stripLinks?.();
      const messages = (post.value || []).map((p) => p.content);
      const updateContent = messages;
      post.value = (post.value || []).map((p, i) => ({
        ...p,
        content: removeLinks ? stripLinks(updateContent[i]) : updateContent[i],
      }));
      toybacoPreparedPosts.push(post);
    }

    const committed = await toybacoRunCreatePostServiceTransaction(
      this._postRepository,
      toybacoPreparedPosts,
      async (toybacoDatabase: any, post: any) => {
        const { posts } = await this._postRepository.createOrUpdatePost(
          body.type,
          orgId,
          body.type === 'now'
            ? dayjs().format('YYYY-MM-DDTHH:mm:00')
            : (post as any).__toybacoDate || body.date,
          post,
          body.tags,
          creationMethod,
          body.inter,
          keepGroup,
          toybacoDraftOnly,
          !!body.republish,
          toybacoDatabase
        );
        return {
          postList: posts?.length
            ? [{ postId: posts[0].id, integration: post.integration.id }]
            : [],
          workflow:
            posts?.length &&
            (body.type !== 'update' || posts[0].state === 'QUEUE')
              ? {
                  taskQueue: post.settings.__type.split('-')[0].toLowerCase(),
                  postId: posts[0].id,
                  state: posts[0].state,
                  marker: posts[0].error,
                }
              : null,
        };
      }
    );

    // TemporalはDB commit後にdispatchし、失敗時は全対象をERRORへ記録して
    // 同じpost idで安全に再試行できるようにする。API成功でQUEUEだけ残さない。
    const postList = committed.flatMap((item: any) => item.postList);
    const workflows = committed
      .map((item: any) => item.workflow)
      .filter((workflow: any) => workflow && workflow.state !== 'DRAFT');
    try {
      await toybacoDispatchCommittedWorkflows(
        this._postRepository,
        orgId,
        workflows,
        (workflow: any) =>
          this.startWorkflow(
          workflow.taskQueue,
          workflow.postId,
          orgId,
          workflow.state,
          workflow.marker
          )
      );
    } catch (error: any) {
      throw new ServiceUnavailableException(
        '投稿ワークフローを開始できませんでした。投稿は再試行待ちとして保存されました。'
      );
    }
    for (const item of committed) {
      for (const _post of item.postList) {
        Sentry.metrics.count('post_created', 1);
      }
    }
    return postList;
  }

  // Update ONLY the provider settings of a not-yet-published post (scheduled or
  // draft). The passed keys are merged into the existing settings; content and
  // publish date stay as they are, so the running publish workflow is left
  // untouched (type "update"). Shared by the agent/MCP tool and the public API
  // PUT /posts/:id/settings so both go through one path.
  async updatePostSettings(
    orgId: string,
    postId: string,
    settings: Record<string, any>,
    creationMethod: CreationMethod,
    toybacoActorRole = 'UNKNOWN'
  ): Promise<{ postId: string; publishDate: string }> {
    // Ordered as post -> comments, root includes integration and tags.
    const ordered = await this.getPostsRecursively(postId, true, orgId, true);

    const [root] = ordered;
    if (!root) {
      throw new NotFoundException('Post not found');
    }

    if (root.parentPostId) {
      throw new BadRequestException(
        'This id belongs to a comment, pass the id of the main post'
      );
    }

    if (
      !toybacoCanMutatePost(
        toybacoActorRole,
        root.state,
        'settings',
        root.state
      )
    ) {
      throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
    }

    if (root.state !== 'QUEUE' && root.state !== 'DRAFT') {
      throw new BadRequestException(
        'Only scheduled posts that were not published yet (or drafts) can be updated'
      );
    }

    if (
      root.state === 'QUEUE' &&
      dayjs.utc(root.publishDate).isBefore(dayjs.utc())
    ) {
      throw new BadRequestException(
        'The publish time of this post already passed, it cannot be updated'
      );
    }

    const integration = (root as any).integration;

    let existingSettings: Record<string, any>;
    try {
      existingSettings = JSON.parse(root.settings || '{}');
    } catch (err) {
      existingSettings = {};
    }

    // Merge: only the passed keys change, everything else stays.
    const mergedSettings = {
      ...existingSettings,
      ...(settings || {}),
      __type: integration.providerIdentifier,
    };

    // Keep the existing content/ids so the posts are updated in place (the
    // workflow identity is preserved) - only the settings differ.
    const value = ordered.map((p) => {
      let image = [];
      try {
        image = JSON.parse(p.image || '[]');
      } catch (err) {}
      return {
        id: p.id,
        content: p.content,
        delay: p.delay || 0,
        image,
      };
    });

    // Same server-side validation as the dashboard / public create route.
    const [validation] = await this.validatePosts(orgId, [
      {
        integration: { id: integration.id },
        settings: mergedSettings,
        value: value.map((p) => ({ content: p.content, image: p.image })),
      },
    ]);

    if (validation.emptyContent) {
      throw new BadRequestException(
        '投稿内容または画像を1件以上入力してください。'
      );
    }

    if (root.state !== 'DRAFT') {
      if (!validation.valid) {
        throw new BadRequestException('投稿設定を確認してください。');
      }

      if (validation.errors !== true) {
        throw new BadRequestException(
          '投稿に利用できないメディアが含まれています。'
        );
      }

      if (validation.tooLong) {
        throw new BadRequestException(
          '投稿文が長すぎます。短くしてから保存してください。'
        );
      }
    }

    const date = dayjs.utc(root.publishDate).format('YYYY-MM-DDTHH:mm:ss');

    const [output] = await this.createPost(
      orgId,
      {
        date,
        // Settings-only update: keep the current state and leave the running
        // publish workflow alone.
        type: 'update',
        shortLink: false,
        tags: ((root as any).tags || []).map((t: any) => ({
          value: t.tag.name,
          label: t.tag.name,
        })),
        posts: [
          {
            integration,
            group: root.group,
            settings: mergedSettings,
            value,
          },
        ],
      } as any,
      creationMethod,
      // Keep the group stable: a client may have the calendar open while the
      // settings are updated out of band, and the calendar links posts by group.
      true,
      toybacoActorRole
    );

    if (!output) {
      throw new BadRequestException('Failed to update the post');
    }

    return {
      postId: output.postId,
      publishDate: date,
    };
  }

  async separatePosts(content: string, len: number) {
    return this._openaiService.separatePosts(content, len);
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, err, body);
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule',
    toybacoActorRole = 'UNKNOWN'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    if (
      (status !== 'draft' && status !== 'schedule') ||
      !toybacoCanMutatePost(
        toybacoActorRole,
        getPostById.state,
        'status',
        state
      )
    ) {
      throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
    }
    const toybacoChanged = await this._postRepository.changeState(id, state);

    try {
      await this.startWorkflow(
        getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
        getPostById.id,
        orgId,
        state,
        toybacoChanged.error
      );
      await this._postRepository.completeWorkflowDispatch(
        orgId,
        [{ postId: getPostById.id, marker: toybacoChanged.error }]
      );
    } catch (error: any) {
      await this._postRepository.recordWorkflowDispatchFailure(
        orgId,
        [{ postId: getPostById.id, marker: toybacoChanged.error }],
        error instanceof Error ? error.message : String(error)
      );
      throw new ServiceUnavailableException(
        '投稿ワークフローを開始できませんでした。投稿は再試行待ちとして保存されました。'
      );
    }

    return { id, state };
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule',
    republish = false,
    toybacoActorRole = 'UNKNOWN'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('投稿が見つかりません。');
    }

    const toybacoAction =
      action === 'schedule' ? 'schedule' : action === 'update' ? 'date' : '';
    if (
      !toybacoAction ||
      !toybacoCanMutatePost(
        toybacoActorRole,
        getPostById.state,
        toybacoAction,
        action === 'schedule' ? 'QUEUE' : getPostById.state
      )
    ) {
      throw new ForbiddenException(TOYBACO_APPROVAL_DENIED_MESSAGE);
    }

    if (action === 'schedule' && !republish) {
      this.guardAgainstRepublish(getPostById, 'changeDate');
    }

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state,
      action,
      ['USER', 'TOYBACO_AI_DRAFT', 'SYSTEM_DRAFT'].includes(
        toybacoActorRole
      ),
      republish
    );

    if (action === 'schedule') {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier
            .split('-')[0]
            .toLowerCase(),
          getPostById.id,
          orgId,
          newDate.state,
          newDate.error
        );
        await this._postRepository.completeWorkflowDispatch(
          orgId,
          [{ postId: getPostById.id, marker: newDate.error }]
        );
      } catch (error: any) {
        await this._postRepository.recordWorkflowDispatchFailure(
          orgId,
          [{ postId: getPostById.id, marker: newDate.error }],
          error instanceof Error ? error.message : String(error)
        );
        throw new ServiceUnavailableException(
          '投稿ワークフローを開始できませんでした。投稿は再試行待ちとして保存されました。'
        );
      }
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    const findTime = (): string => {
      const totalMinutes = Math.floor(Math.random() * 144) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (dayjs(randomDate).isBefore(dayjs())) {
        return findTime();
      }

      return randomDate;
    };

    const toybacoGeneratedPosts = getAllIntegrations.flatMap(
      (integration) =>
        body.posts.map((toPost) => {
          const randomDate = findTime();
          return {
            __toybacoDate: randomDate,
            group: makeId(10),
            integration: { id: integration.id },
            settings: {
              __type: integration.providerIdentifier as any,
              title: '',
              tags: [],
              subreddit: [],
            },
            value: [
              ...toPost.list.map((item) => ({
                id: '',
                content: item.post,
                delay: 0,
                image: [],
              })),
              {
                id: '',
                delay: 0,
                content: `Check out the full story here:
${
                  body.postId || body.url
                }`,
                image: [],
              },
            ],
          };
        })
    );
    if (toybacoGeneratedPosts.length === 0) {
      return;
    }
    await this.createPost(
      orgId,
      {
        type: 'draft',
        date: toybacoGeneratedPosts[0].__toybacoDate,
        order: '',
        shortLink: false,
        tags: [],
        posts: toybacoGeneratedPosts,
      },
      'WEB',
      false,
      'SYSTEM_DRAFT'
    );
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const findTimes = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    return this.findFreeDateTimeRecursive(
      orgId,
      findTimes,
      dayjs.utc().startOf('day')
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs,
    depth = 0
  ): Promise<string> {
    // toybaco_free_slot_guard: 空き枠を探す旅に終わりを設ける。
    //
    // 候補の時刻が一つも無いと、この処理は空き枠を見つけられないまま
    // 永久に翌日を探し続ける（1日ぶんごとにデータベースへ問い合わせながら）。
    // 候補はチャネルごとの投稿時間帯から作られるので、チャネルを一つも
    // 繋いでいない状態がまさにそれにあたる。顧客が最初に触る場面である。
    //
    // 見つからないときは翌日の朝を返す。日時はあとから顧客が直せるので、
    // 固まって何も返らないより、ひとまず下書きを届けきる方がよい。
    // 01:00 UTC = 日本時間の 10:00。
    if (!times.length || depth >= 60) {
      return date
        .clone()
        .add(1, 'day')
        .startOf('day')
        .add(1, 'hour')
        .format('YYYY-MM-DDTHH:mm:00');
    }

    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(
        orgId,
        times,
        date.add(1, 'day'),
        depth + 1
      );
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    return date.clone().add(num, 'minutes').format('YYYY-MM-DDTHH:mm:00');
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }
}
