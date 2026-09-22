import { instagramCommentProviderDenied, INSTAGRAM_COMMENT_PROVIDER_DENIED_CODE } from '@gitroom/nestjs-libraries/toybaco/instagram-comment-policy';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  BadBody,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

import { REQUIRED_INSTAGRAM_SCOPES, parseInstagramResponseText, parseInstagramOAuthResponse, createInstagramPermissionSnapshot, instagramAuthDiagnostic } from '@gitroom/nestjs-libraries/toybaco/instagram-comment-permissions';

const instagramProvider = new InstagramProvider();

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramStandaloneProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram-standalone';
  // toybaco_instagram_jpeg_v2: Instagram向け画像をJPEGへ変換する
  convertToJPEG = true;
  name = 'Instagram\n(Standalone)';
  isBetweenSteps = false;
  refreshCron = true;
  scopes = [...REQUIRED_INSTAGRAM_SCOPES];
    override maxConcurrentJob = 200; // Instagram standalone has stricter limits
  dto = InstagramDto;

  editor = 'normal' as const;
  maxLength() {
    return 2200;
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (this.assetBoolean(settings?.is_trial_reel)) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    return true;
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (instagramCommentProviderDenied(body, status)) {
      return { type: 'bad-body', value: INSTAGRAM_COMMENT_PROVIDER_DENIED_CODE };
    }
    return instagramProvider.handleErrors(body, status);
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { access_token } = await (
      await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refresh_token}`
      )
    ).json();

    if (typeof access_token !== 'string' || !access_token.trim()) {
      throw new Error('Instagram token response is invalid');
    }
    const {
      id: appScopedUserId,
      user_id,
      name,
      username,
      profile_picture_url = '',
    } = parseInstagramResponseText(await (
      await fetch(
        `https://graph.instagram.com/${META_GRAPH_API_VERSION}/me?fields=id,user_id,username,name,profile_picture_url&access_token=${access_token}`
      )
    ).text());

    if (typeof user_id !== 'string' || !/^[0-9]+$/.test(user_id)) {
      throw new Error('Instagram identity response is invalid');
    }
    return {
      id: String(user_id),
      toybacoInstagramAppScopedUserId: appScopedUserId == null ? undefined : String(appScopedUserId),
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: profile_picture_url || '',
      username,
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        `https://www.instagram.com/oauth/authorize?enable_fb_login=0&client_id=${
          process.env.INSTAGRAM_APP_ID
        }&redirect_uri=${encodeURIComponent(
          `${
            process?.env.FRONTEND_URL?.indexOf('https') == -1
              ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
              : `${process?.env.FRONTEND_URL}`
          }/integrations/social/instagram-standalone`
        )}&response_type=code&scope=${encodeURIComponent(
          this.scopes.join(',')
        )}` + `&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    let diagnosticStage = 'short_token_exchange';
    let diagnosticResponse: unknown;
    let diagnosticStatus: unknown;
    let expectedAppScopedId: string | undefined;
    try {
      const formData = new FormData();
      formData.append('client_id', process.env.INSTAGRAM_APP_ID!);
      formData.append('client_secret', process.env.INSTAGRAM_APP_SECRET!);
      formData.append('grant_type', 'authorization_code');
      formData.append(
        'redirect_uri',
        `${
          process?.env.FRONTEND_URL?.indexOf('https') == -1
            ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
            : `${process?.env.FRONTEND_URL}`
        }/integrations/social/instagram-standalone`
      );
      formData.append('code', params.code);

      const shortResponse = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: formData,
      });
      diagnosticStatus = shortResponse.status;
      const getAccessToken = parseInstagramResponseText(await shortResponse.text());
      diagnosticResponse = getAccessToken;
      diagnosticStage = 'short_token_validation';

      const oauth = parseInstagramOAuthResponse(getAccessToken);
      diagnosticStage = 'long_token_exchange';
      diagnosticResponse = undefined;
      diagnosticStatus = undefined;
      const longResponse = await fetch(
          'https://graph.instagram.com/access_token' +
            '?grant_type=ig_exchange_token' +
            `&client_id=${process.env.INSTAGRAM_APP_ID}` +
            `&client_secret=${process.env.INSTAGRAM_APP_SECRET}` +
            `&access_token=${oauth.accessToken}`
      );
      diagnosticStatus = longResponse.status;
      diagnosticResponse = await longResponse.json();
      diagnosticStage = 'long_token_validation';
      const { access_token } = diagnosticResponse as { access_token?: string };

      if (typeof access_token !== 'string' || !access_token.trim()) {
        throw new Error('Instagram token response is invalid');
      }
      diagnosticStage = 'identity_lookup';
      diagnosticResponse = undefined;
      diagnosticStatus = undefined;
      const identityResponse = await fetch(
          `https://graph.instagram.com/${META_GRAPH_API_VERSION}/me?fields=id,user_id,username,name,profile_picture_url&access_token=${access_token}`
      );
      diagnosticStatus = identityResponse.status;
      const identity = parseInstagramResponseText(await identityResponse.text());
      diagnosticResponse = identity;
      diagnosticStage = 'identity_validation';
      expectedAppScopedId = oauth.appScopedUserId;
      const { id: appScopedUserId, user_id, name, username, profile_picture_url } = identity;

      // OAuth user_id is app-scoped; /me.user_id is the professional account.
      if (typeof user_id !== 'string' || !/^[0-9]+$/.test(user_id) ||
          typeof appScopedUserId !== 'string' || appScopedUserId !== oauth.appScopedUserId) {
        throw new Error('Instagram authorization identity mismatch');
      }
      diagnosticStage = 'permission_snapshot';
      const toybacoInstagramPermissionSnapshot = createInstagramPermissionSnapshot({
        appId: process.env.INSTAGRAM_APP_ID!,
        internalId: String(user_id),
        appScopedUserId: oauth.appScopedUserId,
        token: access_token,
        permissions: oauth.permissions,
      });
      return {
        id: String(user_id),
        toybacoInstagramAppScopedUserId: oauth.appScopedUserId,
        toybacoInstagramPermissionSnapshot,
        name,
        accessToken: access_token,
        refreshToken: access_token,
        expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
        picture: profile_picture_url,
        username,
      };
    } catch (error) {
      console.warn(JSON.stringify(instagramAuthDiagnostic(
        diagnosticStage, diagnosticResponse, diagnosticStatus, expectedAppScopedId
      )));
      throw error;
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.post(
      id,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    );
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.postPending(
      id,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    );
  }

  // the graph domain travels inside pendingData, so these are pure delegations
  override async checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ) {
    return instagramProvider.checkPostStatus(
      accessToken,
      pendingData,
      integration
    );
  }

  override async finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ) {
    return instagramProvider.finalizePost(accessToken, pendingData, integration);
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return instagramProvider.comment(
      id,
      postId,
      lastCommentId,
      accessToken,
      postDetails,
      integration,
      'graph.instagram.com'
    ).catch((error: unknown) => {
      if (error instanceof BadBody) {
        const detail = error.details?.[0] as { json?: string } | undefined;
        if (instagramCommentProviderDenied(detail?.json || '{}')) {
          throw new BadBody('instagram-standalone', '{}', '{}', INSTAGRAM_COMMENT_PROVIDER_DENIED_CODE);
        }
      }
      throw error;
    });
  }

  async analytics(id: string, accessToken: string, date: number) {
    return instagramProvider.analytics(
      id,
      accessToken,
      date,
      'graph.instagram.com'
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ) {
    return instagramProvider.postAnalytics(
      integrationId,
      accessToken,
      postId,
      date,
      'graph.instagram.com'
    );
  }
}
