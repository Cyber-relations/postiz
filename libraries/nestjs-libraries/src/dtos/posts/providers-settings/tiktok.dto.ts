import {
  IsBoolean, ValidateIf, IsIn, IsString, MaxLength, IsOptional, IsDefined, IsNumber, Min, Max, ValidateNested, Equals, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

export class TikTokMusic {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The commercial music library track id, taken from the "id" returned by the musicSearch function.',
  })
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}

export class TikTokLocation {
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The location tag id, taken from the "id" returned by the locationSearch function.',
  })
  id: string;

  @IsDefined()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

// TikTok only honors most of these settings on a DIRECT_POST. With
// content_posting_method=UPLOAD the media lands in the user's TikTok inbox as a
// draft, and TikTok's inbox/upload endpoints accept nothing but the title /
// description - every other field below is silently discarded.
// video_made_with_ai / duet / stitch are additionally video-only: TikTok's photo
// post_info has no is_aigc, disable_duet or disable_stitch field.
// music / location are TikTok Business only: the legacy TikTok provider ignores
// them (its Content Posting API has no music_sound_info / location fields).
// Fields stay required here (existing clients depend on it); the constraints are
// documented, not enforced.
export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  @JSONSchema({
    description:
      'Used as the title of the post. The only setting TikTok keeps when content_posting_method=UPLOAD.',
  })
  title: string;

  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  @IsString()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no duet setting for photo posts.',
  })
  duet: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no stitch setting for photo posts.',
  })
  stitch: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  comment: boolean;

  @IsIn(['yes', 'no'])
  @JSONSchema({
    description:
      'Photo posts only, and only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD. ' +
      'On TikTok Business, "yes" attaches a random commercial music library track and overrides the music setting; ' +
      'on legacy TikTok, "yes" lets TikTok auto-add its recommended music.',
  })
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  @JSONSchema({
    description:
      'Labels the post as AI generated. Video posts only, and only when content_posting_method=DIRECT_POST. TikTok has no AI-generated label for photo posts, and discards it on UPLOAD.',
  })
  video_made_with_ai: boolean;

  @IsBoolean()
  @JSONSchema({
    description:
      'Applied only when content_posting_method=DIRECT_POST. Ignored by TikTok on UPLOAD.',
  })
  brand_organic_toggle: boolean;

  @Type(() => TikTokMusic)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Attaches a commercial music library track to the post (use the musicSearch function to find one). audio_volume / video_volume apply to video posts only. For photos, ignored when autoAddMusic is "yes" (a random track is attached instead).',
  })
  music?: TikTokMusic;

  @Type(() => TikTokLocation)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'TikTok Business only, and only when content_posting_method=DIRECT_POST. Tags the post with a location (use the locationSearch function to find one).',
  })
  location?: TikTokLocation;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  @JSONSchema({
    description:
      'Required. Use "DIRECT_POST" to actually publish the post to TikTok. ' +
      '"UPLOAD" does NOT publish: it only sends the media to the user\'s TikTok app inbox, ' +
      'where they must manually finish and publish it within 24 hours or it is discarded, ' +
      'and it makes TikTok ignore every other setting here. ' +
      'Only use "UPLOAD" when the user explicitly asks to review or edit the post inside the TikTok app before publishing.',
  })
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
// Content Posting API only. Business keeps its existing DTO and API contract.
export type TikTokCreatorInfo = {
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: TikTokDto['privacy_level'][];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

export function parseTikTokCreatorInfo(value: unknown): TikTokCreatorInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const info = value as Record<string, unknown>;
  const options = info.privacy_level_options;
  if (
    typeof info.creator_username !== 'string' || !info.creator_username.trim() || info.creator_username.length > 256 ||
    typeof info.creator_nickname !== 'string' || !info.creator_nickname.trim() || info.creator_nickname.length > 256 ||
    !Array.isArray(options) || options.length === 0 || options.length > 4 || new Set(options).size !== options.length ||
    !options.every((option) => ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(option)) ||
    !['comment_disabled', 'duet_disabled', 'stitch_disabled'].every((key) => typeof info[key] === 'boolean') ||
    !Number.isSafeInteger(info.max_video_post_duration_sec) || (info.max_video_post_duration_sec as number) <= 0
  ) return null;
  return {
    creator_username: info.creator_username,
    creator_nickname: info.creator_nickname,
    privacy_level_options: [...options],
    comment_disabled: info.comment_disabled as boolean,
    duet_disabled: info.duet_disabled as boolean,
    stitch_disabled: info.stitch_disabled as boolean,
    max_video_post_duration_sec: info.max_video_post_duration_sec as number,
  };
}

export function hasTikTokPostingConsent(settings: Record<string, unknown>): boolean {
  if (settings.content_posting_consent !== true || typeof settings.disclose !== 'boolean') return false;
  if (settings.content_posting_method === 'UPLOAD') return true;
  if (settings.content_posting_method !== 'DIRECT_POST') return false;
  const organic = settings.brand_organic_toggle === true;
  const branded = settings.brand_content_toggle === true;
  return settings.disclose === (organic || branded) && !(branded && settings.privacy_level === 'SELF_ONLY');
}

@ValidatorConstraint({ name: 'tikTokPostingConsent', async: false })
class TikTokPostingConsentConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return hasTikTokPostingConsent(args.object as Record<string, unknown>);
  }
  defaultMessage(): string {
    return 'TikTok の公開範囲・商用表示を確認し、送信に同意してください。';
  }
}

export class TikTokContentPostingDto extends TikTokDto {
  @ValidateIf((settings) => settings.content_posting_method !== 'UPLOAD')
  declare privacy_level: TikTokDto['privacy_level'];

  @IsBoolean()
  disclose: boolean;

  @Equals(true)
  @Validate(TikTokPostingConsentConstraint)
  content_posting_consent: boolean;
}
