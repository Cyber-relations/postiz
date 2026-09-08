import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import clsx from 'clsx';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { FC } from 'react';
import { textSlicer } from '@gitroom/helpers/utils/count.length';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

export const GeneralPreviewComponent: FC<{
  maximumCharacters?: number;
}> = (props) => {
  const { value: topValue, integration } = useIntegration();
  const current = useLaunchStore((state) => state.current);
  const mediaDir = useMediaDirectory();

  const renderContent = topValue.map((p) => {
    const newContent = stripHtmlValidation(
      'normal',
      p.content.replace(
        /<span.*?data-mention-id="([.\s\S]*?)"[.\s\S]*?>([.\s\S]*?)<\/span>/gi,
        (match, match1, match2) => {
          return `[[[${match2}]]]`;
        }
      ),
      true
    );

    const { start, end } = textSlicer(
      integration?.identifier || '',
      props.maximumCharacters || 10000,
      newContent
    );

    const finalValue =
      newContent
        .slice(start, end)
        .replace(/\[\[\[([.\s\S]*?)]]]/, (match, match1) => {
          return `<span class="font-bold font-[arial]" style="color: #ae8afc">${match1}</span>`;
        }) +
      `<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="この部分は文字数上限のため切り取られます">` +
      newContent.slice(end).replace(/\[\[\[([.\s\S]*?)]]]/, (match, match1) => {
        return `<span class="font-bold font-[arial]" style="color: #ae8afc">${match1}</span>`;
      }) +
      `</mark>`;

    return { text: finalValue, images: p.image };
  });

  return (
    <div className={clsx('w-full p-[15px]')}>
      <div className="w-full h-full relative flex flex-col">
        {renderContent.map((value, index) => (
          <div
            key={`tweet_${index}`}
            style={{}}
            className={clsx(
              `flex gap-[8px] relative`,
              index === renderContent.length - 1 ? 'pb-[12px]' : 'pb-[24px]'
            )}
          >
            <div className="min-w-[40px] h-[40px] min-h-[40px] w-[40px] flex flex-col items-center">
              <div className="relative">
                <img
                  src={
                    current === 'global'
                      ? '/no-picture.jpg'
                      : integration?.picture || '/no-picture.jpg'
                  }
                  alt="プロフィール画像"
                  className="rounded-full relative z-[2]"
                />

                {current !== 'global' && (
                  <SafeImage
                    src={`/icons/platforms/${integration?.identifier}.png`}
                    className="min-w-[20px] min-h-[20px] rounded-full absolute z-10 -bottom-[5px] -end-[5px] border border-fifth"
                    alt={integration.identifier}
                    width={20}
                    height={20}
                  />
                )}
              </div>
              {index !== topValue.length - 1 && (
                <div className="flex-1 w-[2px] h-[calc(100%-10px)] bg-customColor25 absolute top-[10px] z-[1]" />
              )}
            </div>
            <div className="min-w-0 flex-1 flex flex-col gap-[4px]">
              <div data-toybaco-preview-identity="" className="min-w-0 flex flex-col gap-[2px]">
                <div className="min-w-0 break-words [overflow-wrap:anywhere] text-[15px] font-[700] leading-[22px]">
                  {current === 'global' ? '全体編集' : integration?.name}
                </div>
                <div className="min-w-0 break-words [overflow-wrap:anywhere] text-[13px] font-[400] text-customColor27">
                  {current === 'global'
                    ? ''
                    : integration?.display || ''}
                </div>
              </div>
              <div
                className={clsx('min-w-0 break-words [overflow-wrap:anywhere] whitespace-pre-wrap', 'preview')}
                dangerouslySetInnerHTML={{
                  __html: value.text,
                }}
              />
              {!!value?.images?.length && (
                <div
                  className={clsx(
                    'w-full rounded-[16px] overflow-hidden mt-[12px]',
                    value?.images?.length > 3
                      ? 'grid grid-cols-2 gap-[4px]'
                      : 'flex gap-[4px]'
                  )}
                >
                  {value.images.map((image, index) => (
                    <a
                      key={`image_${index}`}
                      className="flex-1"
                      href={mediaDir.set(image.path)}
                      target="_blank"
                    >
                      <VideoOrImage
                        autoplay={true}
                        src={mediaDir.set(image.path)}
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
