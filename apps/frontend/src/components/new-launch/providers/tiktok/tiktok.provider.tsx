'use client';

import {
  FC,
  useMemo,
  useEffect,
  useState,
  useRef,
} from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TikTokDto, TikTokContentPostingDto, TikTokCreatorInfo, parseTikTokCreatorInfo } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Input } from '@gitroom/react/form/input';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { TikTokMusicSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.music';
import { TikTokLocationSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.location';

// Latest creator constraints belong to the normal Content Posting API only.
export const TikTokContentPostingSettings: FC = () => {
  const { watch, setValue, getValues, register, formState: { isReady } } = useSettings();
  const { value, integration } = useIntegration();
  const fetch = useFetch();
  const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [metadataState, setMetadataState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [constraintNotice, setConstraintNotice] = useState('');
  const identity = integration?.id;
  const previousIdentity = useRef(identity);
  const media = value?.[0]?.image ?? [];
  const video = media.length === 1 && /\.mp4(?:[?#]|$)/i.test(media[0].path) ? media[0].path : null;
  const contentKey = JSON.stringify(value);
  const method = watch('content_posting_method');
  const upload = method === 'UPLOAD';
  const privacy = watch('privacy_level');
  const disclose = watch('disclose') === true;
  const branded = watch('brand_content_toggle') === true;
  const organic = watch('brand_organic_toggle') === true;

  useEffect(() => {
    if (!isReady) return;
    const changedAccount = previousIdentity.current !== identity;
    previousIdentity.current = identity;
    const saved = (field: string) => changedAccount ? undefined : getValues(field);
    setValue('privacy_level', typeof saved('privacy_level') === 'string' ? saved('privacy_level') : '');
    setValue('content_posting_method', saved('content_posting_method') === 'UPLOAD' ? 'UPLOAD' : 'DIRECT_POST');
    setValue('autoAddMusic', saved('autoAddMusic') === 'yes' ? 'yes' : 'no');
    for (const field of ['comment', 'duet', 'stitch', 'disclose', 'brand_organic_toggle', 'brand_content_toggle', 'video_made_with_ai']) setValue(field, saved(field) === true);
    setValue('content_posting_consent', false);
  }, [identity, isReady, setValue, getValues]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setCreator(null);
    setConstraintNotice('');
    setLoading(true);
    setValue('content_posting_consent', false);
    (async () => {
      try {
        if (!identity) throw new Error('missing integration');
        const response = await fetch('/integrations/function', {
          method: 'POST',
          body: JSON.stringify({ id: identity, name: 'creatorInfo', data: {} }),
          signal: controller.signal,
        });
        if (!response.ok || response.headers?.get('logout')) throw new Error('creator unavailable');
        const info = parseTikTokCreatorInfo(await response.json());
        if (!info) throw new Error('creator unavailable');
        if (current) setCreator(info);
      } catch {
        if (current) setCreator(null);
      } finally {
        clearTimeout(timeout);
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [identity, attempt, fetch, setValue]);

  useEffect(() => {
    setDuration(null);
    setMetadataState('loading');
    if (!video) return;
    const element = document.createElement('video');
    let current = true;
    const fail = () => {
      if (current) { setDuration(null); setMetadataState('failed'); }
    };
    const timeout = setTimeout(fail, 15000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      if (!current) return;
      clearTimeout(timeout);
      if (Number.isFinite(element.duration) && element.duration > 0) {
        setDuration(element.duration);
        setMetadataState('ready');
      } else fail();
    };
    element.onerror = () => { clearTimeout(timeout); fail(); };
    element.src = video;
    return () => {
      current = false;
      clearTimeout(timeout);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute('src');
      element.load();
    };
  }, [video, metadataAttempt]);

  useEffect(() => {
    // Keep saved choices while the latest constraints are loading or unavailable.
    if (!creator) return;
    let changed = false;
    if (privacy && !creator.privacy_level_options.includes(privacy)) {
      setValue('privacy_level', '');
      changed = true;
    }
    for (const field of ['comment', 'duet', 'stitch'] as const) {
      if ((creator[`${field}_disabled`] || (!video && field !== 'comment')) && getValues(field) === true) {
        setValue(field, false);
        changed = true;
      }
    }
    if (changed) setConstraintNotice('TikTok の投稿条件が変わりました。公開範囲と交流設定を確認し、同意し直してください。');
  }, [creator, privacy, video, setValue, getValues]);
  useEffect(() => {
    if (!disclose) {
      setValue('brand_organic_toggle', false);
      setValue('brand_content_toggle', false);
    }
  }, [disclose, setValue]);

  const settingsKey = JSON.stringify([method, privacy, disclose, organic, branded, watch('comment'), watch('duet'), watch('stitch'), watch('autoAddMusic'), watch('video_made_with_ai'), watch('title')]);
  useEffect(() => { setValue('content_posting_consent', false); }, [identity, contentKey, settingsKey, creator, setValue]);

  const durationValid = !video || (metadataState === 'ready' && duration !== null && !!creator && duration <= creator.max_video_post_duration_sec);
  const ready = !loading && !!creator && media.length > 0 && durationValid &&
    (upload || (creator.privacy_level_options.includes(privacy) && (!disclose || organic || branded) && !(branded && privacy === 'SELF_ONLY')));
  useEffect(() => { if (!ready) setValue('content_posting_consent', false); }, [ready, setValue]);
  const labels: Record<TikTokDto['privacy_level'], string> = {
    PUBLIC_TO_EVERYONE: '全員', MUTUAL_FOLLOW_FRIENDS: '相互フォローの友達', FOLLOWER_OF_CREATOR: 'フォロワー', SELF_ONLY: '自分のみ',
  };
  const checkbox = (field: string, label: string, disabled = false) => (
    <label className={clsx('flex items-center gap-2', disabled && 'opacity-50')}>
      <input type="checkbox" {...register(field)} checked={watch(field) === true} disabled={disabled}
        onChange={(event) => setValue(field, event.target.checked)} />{label}
    </label>
  );

  return <div className="flex flex-col gap-4" data-toybaco-tiktok-creator-settings>
    {loading ? <p role="status">TikTok の最新の投稿条件を確認しています…</p> : creator ?
      <p>TikTok 投稿先: {creator.creator_nickname} (@{creator.creator_username})</p> :
      <div role="alert"><p>TikTok の投稿条件を取得できません。時間をおいて再確認してください。</p>
        <button type="button" onClick={() => setAttempt((old) => old + 1)}>投稿条件を再確認</button></div>}
    {constraintNotice && <p role="status">{constraintNotice}</p>}
    <label className="flex flex-col gap-1">投稿方法
      <select className="bg-newBgColorInner h-[42px] border border-newTableBorder rounded-[8px] text-textColor px-3" {...register('content_posting_method')} value={method ?? 'DIRECT_POST'} disabled={!creator || loading}
        onChange={(event) => setValue('content_posting_method', event.target.value)}>
        <option value="DIRECT_POST">TikTok に直接投稿</option><option value="UPLOAD">TikTok アプリで編集して投稿</option>
      </select>
    </label>
    {!video && <Input label="タイトル" {...register('title')} maxLength={90} />}
    {!upload && <>
      <label className="flex flex-col gap-1">公開範囲
        <select className="bg-newBgColorInner h-[42px] border border-newTableBorder rounded-[8px] text-textColor px-3" {...register('privacy_level')} value={privacy ?? ''} disabled={!creator || loading}
          onChange={(event) => setValue('privacy_level', event.target.value)}>
          <option value="" disabled>公開範囲を選択してください</option>
          {creator?.privacy_level_options.map((option) => <option key={option} value={option} disabled={branded && option === 'SELF_ONLY'}>{labels[option]}</option>)}
        </select>
      </label>
      {checkbox('comment', 'コメントを許可', loading || !creator || creator.comment_disabled)}
      {video && <>{checkbox('duet', 'デュエットを許可', loading || !creator || creator.duet_disabled)}{checkbox('stitch', 'リミックス（Stitch）を許可', loading || !creator || creator.stitch_disabled)}{checkbox('video_made_with_ai', 'AI 生成コンテンツとして表示')}</>}
      {!video && <label>音楽を自動追加 <select className="bg-newBgColorInner h-[42px] border border-newTableBorder rounded-[8px] text-textColor px-3" {...register('autoAddMusic')}><option value="no">しない</option><option value="yes">する</option></select></label>}
      {checkbox('disclose', 'ブランド・商品・サービスを宣伝する投稿')}
      {disclose && <div className="flex flex-col gap-2">
        <p>該当する項目を1つ以上選択してください。</p>
        {checkbox('brand_organic_toggle', '自分のブランドを宣伝')}{checkbox('brand_content_toggle', '第三者のブランドを宣伝（有償パートナーシップ）')}
        {(organic || branded) && <p>{branded ? '「有償パートナーシップ」と表示されます。' : '「プロモーションコンテンツ」と表示されます。'}</p>}
        {branded && <p>第三者のブランドを宣伝する投稿では「自分のみ」を選択できません。</p>}
      </div>}
    </>}
    {video && creator && <p>動画は {creator.max_video_post_duration_sec} 秒以内です。{metadataState === 'loading' ? '動画の長さを確認しています。' : metadataState === 'ready' && !durationValid ? '動画が上限を超えています。短い動画を選択してください。' : ''}</p>}
    {video && metadataState === 'failed' && <div role="alert"><p>動画の長さを確認できません。接続を確認して再試行するか、別の動画を選択してください。</p><button type="button" onClick={() => setMetadataAttempt((old) => old + 1)}>動画の長さを再確認</button></div>}
    <p>内容とプレビューを確認してください。送信後、TikTok に表示されるまで数分かかる場合があります。{upload && 'この操作はアプリ内の受信箱へ送信します。公開するには TikTok アプリで編集・投稿を完了してください。'}</p>
    <p>TikTok の <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">音楽使用確認</a>
      {branded && !upload && <>と <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">ブランドコンテンツポリシー</a></>}に同意したうえで送信してください。</p>
    {checkbox('content_posting_consent', '上記を確認・同意し、この内容を TikTok へ送信します', !ready)}
  </div>;
};

const TikTokBusinessSettings: FC<{
  values?: any;
}> = (props) => {
  const { watch, register } = useSettings();
  const { value, integration } = useIntegration();
  const t = useT();

  // Music and location come from the Business API (v1.3) - the legacy Content
  // Posting API used by the "tiktok" identifier has no such fields.
  const isBusiness = integration?.identifier === 'tiktok-business';

  const isTitle = useMemo(() => {
    return value?.[0]?.image?.some((p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1);
  }, [value]);

  const hasMedia = (value?.[0]?.image?.length ?? 0) > 0;
  const isVideo = hasMedia && !isTitle;

  const disclose = watch('disclose');
  const autoAddMusic = watch('autoAddMusic');
  const brand_organic_toggle = watch('brand_organic_toggle');
  const brand_content_toggle = watch('brand_content_toggle');
  const content_posting_method = watch('content_posting_method');
  const isUploadMode = content_posting_method === 'UPLOAD';

  // TikTok ignores every setting except the title / content when the posting
  // method is UPLOAD, so we hide them rather than pretend they apply. The fields
  // stay mounted and registered: their values must survive the switch, and
  // TikTokDto still requires most of them at save time.
  const directPostOnly = clsx(isUploadMode && 'invisible h-0 overflow-hidden');

  const tiktokRestrictionNotice = useMemo(() => {
    if (!hasMedia || !isVideo) return null;
    if (!isUploadMode) {
      return t(
        'tiktok_restriction_direct_video',
        'TikTok restriction: For direct post with video, your post content is used as the title. A separate title field is not available.'
      );
    }
    return t(
      'tiktok_restriction_upload_video',
      'TikTok restriction: For upload-only video, TikTok does not accept a title or message. The content will default to "#Postiz" and you can edit it inside the TikTok app before publishing.'
    );
  }, [hasMedia, isUploadMode, isVideo, t]);

  const privacyLevel = [
    {
      value: 'PUBLIC_TO_EVERYONE',
      label: t('public_to_everyone', 'Public to everyone'),
    },
    {
      value: 'MUTUAL_FOLLOW_FRIENDS',
      label: t('mutual_follow_friends', 'Mutual follow friends'),
    },
    {
      value: 'FOLLOWER_OF_CREATOR',
      label: t('follower_of_creator', 'Follower of creator'),
    },
    {
      value: 'SELF_ONLY',
      label: t('self_only', 'Self only'),
    },
  ];
  const contentPostingMethod = [
    {
      value: 'DIRECT_POST',
      label: t(
        'post_content_directly_to_tiktok',
        'Post content directly to TikTok'
      ),
    },
    {
      value: 'UPLOAD',
      label: t(
        'upload_content_to_tiktok_without_posting',
        'Upload content to TikTok without posting it'
      ),
    },
  ];
  const yesNo = [
    {
      value: 'yes',
      label: t('yes', 'Yes'),
    },
    {
      value: 'no',
      label: t('no', 'No'),
    },
  ];

  return (
    <div className="flex flex-col">
      {/*<CheckTikTokValidity picture={props?.values?.[0]?.image?.[0]?.path} />*/}
      {tiktokRestrictionNotice && (
        <div className="bg-tableBorder p-[10px] mb-[18px] rounded-[10px] flex gap-[10px] items-start text-[13px] text-balance">
          <div className="shrink-0 mt-[2px]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>{tiktokRestrictionNotice}</div>
        </div>
      )}
      {isTitle && <Input label="Title" {...register('title')} maxLength={89} />}
      <div className={directPostOnly}>
        <Select
          label={t('label_who_can_see_this_video', 'Who can see this video?')}
          disabled={isUploadMode}
          {...register('privacy_level', {
            value: 'PUBLIC_TO_EVERYONE',
          })}
        >
          <option value="">{t('select', 'Select')}</option>
          {privacyLevel.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="text-[14px] mt-[10px] mb-[18px] text-balance">
        {t(
          'choose_upload_without_posting_description',
          `Choose upload without posting if you want to review and edit your content within TikTok's app before publishing.
        This gives you access to TikTok's built-in editing tools and lets you make final adjustments before posting. The additional settings are only available when posting directly to TikTok.`
        )}
      </div>
      <Select
        label={t('label_content_posting_method', 'Content posting method')}
        {...register('content_posting_method', {
          value: 'DIRECT_POST',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {contentPostingMethod.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      {isUploadMode && <div className="-mt-[23px] mb-[23px] text-red-600">After posting you fill find a notification inside your Inbox about your post (not content studio)</div>}
      <div className={clsx('flex flex-col', directPostOnly)}>
        <Select
          label={
            isBusiness
              ? t('label_add_random_music', 'Add random music')
              : t('label_auto_add_music', 'Auto add music')
          }
          disabled={isUploadMode}
          {...register('autoAddMusic', {
            value: 'no',
          })}
        >
          <option value="">{t('select', 'Select')}</option>
          {yesNo.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <div className="text-[14px] mt-[10px] mb-[24px] text-balance">
          {isBusiness
            ? t(
                'tiktok_random_music_only_for_photos',
                'This feature is available only for photos, it adds a random trending track from TikTok\'s commercial music library.'
              )
            : t(
                'this_feature_available_only_for_photos',
                'This feature available only for photos, it will add a default music that\n        you can change later.'
              )}
        </div>
        {isBusiness && (
          <div className="flex flex-col gap-[18px] mb-[24px]">
            {/* Random music replaces a manual choice for photos, so the
                selector is hidden (but stays registered) while it's on. */}
            <div
              className={clsx(
                !isVideo &&
                  autoAddMusic === 'yes' &&
                  'invisible h-0 overflow-hidden'
              )}
            >
              <TikTokMusicSelector
                label={t('tiktok_music_label', 'Music')}
                showVolumes={isVideo}
                {...register('music')}
              />
            </div>
            <TikTokLocationSelector
              label={t('tiktok_location_label', 'Location')}
              {...register('location')}
            />
          </div>
        )}
        <hr className="mb-[15px] border-tableBorder" />
        <div className="text-[14px] mb-[10px]">
          {t('tiktok_video_features', 'Video features')}
        </div>
        <div className="flex gap-[40px]">
          <Checkbox
            variant="hollow"
            label={t('label_duet', 'Allow Duet')}
            disabled={isUploadMode}
            {...register('duet', {
              value: false,
            })}
          />
          <Checkbox
            label={t('label_stitch', 'Allow Stitch')}
            variant="hollow"
            disabled={isUploadMode}
            {...register('stitch', {
              value: false,
            })}
          />
          <Checkbox
            label={t('video_made_with_ai', 'Video made with AI')}
            variant="hollow"
            disabled={isUploadMode}
            {...register('video_made_with_ai', {
              value: false,
            })}
          />
        </div>
        <hr className="my-[15px] mb-[25px] border-tableBorder" />
        <div className="flex flex-col gap-[20px]">
          <Checkbox
            label={t('label_comments', 'Allow Comments')}
            variant="hollow"
            disabled={isUploadMode}
            {...register('comment', {
              value: true,
            })}
          />
          <Checkbox
            variant="hollow"
            label={t('label_disclose_video_content', 'Disclose Video Content')}
            disabled={isUploadMode}
            {...register('disclose', {
              value: false,
            })}
          />
          {disclose && (
            <div className="bg-tableBorder p-[10px] mt-[10px] rounded-[10px] flex gap-[20px] items-center">
              <div>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                    fill="white"
                  />
                </svg>
              </div>
              <div>
                {t(
                  'your_video_will_be_labeled_promotional',
                  'Your video will be labeled "Promotional Content".'
                )}
                <br />
                {t(
                  'this_cannot_be_changed_once_posted',
                  'This cannot be changed once your video is posted.'
                )}
              </div>
            </div>
          )}
          <div className="text-[14px] my-[10px] text-balance">
            {t(
              'turn_on_to_disclose_video_promotes',
              'Turn on to disclose that this video promotes goods or services in\n          exchange for something of value. You video could promote yourself, a\n          third party, or both.'
            )}
          </div>
        </div>
        <div className={clsx(!disclose && 'invisible h-0 overflow-hidden', 'mt-[20px]')}>
          <Checkbox
            variant="hollow"
            label={t('label_your_brand', 'Your brand')}
            disabled={isUploadMode}
            {...register('brand_organic_toggle', {
              value: false,
            })}
          />
          <div className="text-balance my-[10px] text-[14px]">
            {t(
              'you_are_promoting_yourself',
              'You are promoting yourself or your own brand.'
            )}
            <br />
            {t(
              'this_video_will_be_classified_brand_organic',
              'This video will be classified as Brand Organic.'
            )}
          </div>
          <Checkbox
            variant="hollow"
            label={t('label_branded_content', 'Branded content')}
            disabled={isUploadMode}
            {...register('brand_content_toggle', {
              value: false,
            })}
          />
          <div className="text-balance my-[10px] text-[14px]">
            {t(
              'you_are_promoting_another_brand',
              'You are promoting another brand or a third party.'
            )}
            <br />
            {t(
              'this_video_will_be_classified_branded_content',
              'This video will be classified as Branded Content.'
            )}
          </div>
          {(brand_organic_toggle || brand_content_toggle) && (
            <div className="my-[10px] text-[14px] text-balance">
              {t(
                'by_posting_you_agree_to_tiktoks',
                "By posting, you agree to TikTok's"
              )}
              {[
                brand_organic_toggle || brand_content_toggle ? (
                  <a
                    target="_blank"
                    className="text-[#B69DEC] hover:underline"
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  >
                    {t('music_usage_confirmation', 'Music Usage Confirmation')}
                  </a>
                ) : undefined,
                brand_content_toggle ? <> {t('and', 'and')} </> : undefined,
                brand_content_toggle ? (
                  <a
                    target="_blank"
                    className="text-[#B69DEC] hover:underline"
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                  >
                    {t('branded_content_policy', 'Branded Content Policy')}
                  </a>
                ) : undefined,
              ].filter((f) => f)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export const TikTokBusinessProvider = withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokBusinessSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokDto,
  maximumCharacters: 2000,
});

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokContentPostingSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokContentPostingDto,
  maximumCharacters: 2000,
});
