import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import styles from './preview.module.scss';
import Link from 'next/link';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { CopyClient } from '@gitroom/frontend/components/preview/copy.client';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { RenderPreviewDateClient } from '@gitroom/frontend/components/preview/render.preview.date.client';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';

dayjs.extend(utc);
export const metadata: Metadata = {
  title: `トイバコ プレビュー`,
  description: '',
};
export default async function Auth(
  props: {
    params: Promise<{
      id: string;
    }>;
    searchParams?: Promise<{
      share?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    id
  } = params;

  const post = await (await internalFetch(`/public/posts/${id}`)).json();
  const t = await getT();
  if (!post.length) {
    return (
      <div className="min-h-screen flex justify-center items-center p-6 text-[20px]">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="トイバコのホーム" className={styles.brand}>
          <LogoTextComponent />
        </Link>
        <div className={styles.heading}>
          <h1>投稿プレビュー</h1>
          <p>投稿内容を確認・共有できます。</p>
        </div>
        {!!searchParams?.share && <CopyClient />}
      </header>
      <div className={styles.date}>
        {t('publication_date', 'Publication Date:')}{' '}
        <RenderPreviewDateClient date={post[0].publishDate} />
      </div>
      <div className={styles.content}>
        <div className={styles.posts}>
          <div className="gap-[20px] flex flex-col">
            {post.map((p: any, index: number) => (
              <div
                key={String(p.id)}
                className={`${styles.post} relative px-4 py-4 bg-third border border-tableBorder`}
              >
                <div className="flex space-x-3">
                  <div>
                    <div className="flex shrink-0 rounded-full h-30 w-30 relative">
                      <div className="w-[50px] h-[50px] z-[20]">
                        {post[0].integration.picture?.trim() ? (
                          <img
                            className="w-full h-full relative z-[20] bg-black aspect-square rounded-full border-tableBorder"
                            alt={post[0].integration.name}
                            src={post[0].integration.picture}
                          />
                        ) : (
                          <span className={styles.avatarFallback} role="img" aria-label={post[0].integration.name || '連携先'}>
                            {Array.from(post[0].integration.name?.trim() || '連携先')[0]}
                          </span>
                        )}
                      </div>
                      <div className="absolute -end-[5px] -bottom-[5px] w-[30px] h-[30px] z-[20]">
                        <img
                          className="w-full h-full bg-black aspect-square rounded-full border-tableBorder"
                          alt={post[0].integration.providerIdentifier}
                          src={`/icons/platforms/${post[0].integration.providerIdentifier}.png`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center space-x-2">
                      <h2 className="text-sm font-semibold">
                        {post[0].integration.name}
                      </h2>
                      <span className="text-sm text-gray-500">
                        @{post[0].integration.profile}
                      </span>
                      {index === 0 && (
                        <CreationMethodBadge
                          creationMethod={p.creationMethod}
                          size="md"
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-[20px]">
                      <div
                        className="text-sm whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{
                          __html: sanitizePostContent(p.content),
                        }}
                      />
                      <div className="flex w-full gap-[10px]">
                        {JSON.parse(p?.image || '[]').map((p: any) => (
                          <div
                            key={p.name}
                            className="flex-1 rounded-[10px] max-h-[500px] overflow-hidden"
                          >
                            <VideoOrImage
                              isContain={true}
                              src={p.path}
                              autoplay={true}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.comments}>
          <div>
            <CommentsComponents postId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
