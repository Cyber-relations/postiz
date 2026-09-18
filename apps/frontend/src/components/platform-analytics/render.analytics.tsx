import { FC, useCallback, useMemo } from 'react';
import { ConnectionReason, connectionMessage, lookupFailure } from './channel.connection.result';
import { Integration } from '@prisma/client';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

interface AnalyticsDataItem {
  label: string;
  data: Array<{ total: number; date: string }>;
  average?: boolean;
  percentageChange?: number;
}

// API由来の指標名をそのまま表示すると、上流追加時に英語が顧客画面へ漏れる。
// 提供する6媒体の指標名を日本語化する。未知値だけを総称へ閉じる。
const analyticsLabelJa = (label: string): string => {
  const key = label.trim().toLowerCase().replace(/[ _-]+/g, ' ');
  const labels: Record<string, string> = {
    likes: 'いいね',
    followers: 'フォロワー',
    reach: 'リーチ',
    'follower count': 'フォロワー数',
    views: '閲覧数',
    comments: 'コメント',
    shares: 'シェア',
    saves: '保存',
    replies: '返信',
    reposts: '再投稿',
    quotes: '引用',
    'page impressions': 'メディアのユニーク閲覧数',
    'posts engagement': '投稿への反応数',
    'page followers': '新規フォロワー数',
    'media views': 'メディアの閲覧数',
    impression: '表示回数',
    bookmark: 'ブックマーク',
    like: 'いいね',
    quote: '引用',
    reply: '返信',
    retweet: 'リポスト',
    following: 'フォロー数',
    'total likes': '累計いいね数',
    videos: '動画数',
    'recent likes': '直近の動画へのいいね数',
    'recent comments': '直近の動画へのコメント数',
    'recent shares': '直近の動画のシェア数',
    'website clicks': 'ウェブサイトのクリック数',
    'phone calls': '電話ボタンのクリック数',
    'direction requests': '経路検索数',
    'desktop map views': 'Google マップの表示数（パソコン）',
    'mobile map views': 'Google マップの表示数（モバイル）',
  };
  return labels[key] || '指標';
};

const AnalyticsCard: FC<{
  item: AnalyticsDataItem;
  total: string | number;
  index: number;
}> = ({ item, total, index }) => {
  const colorVariants = ['purple', 'green', 'blue'] as const;
  const color = colorVariants[index % colorVariants.length];

  const hasDataPoints = item.data.length >= 1;

  return (
    <div className="group relative">
      <div
        className={`
          flex flex-col h-full
          bg-newTableHeader
          border border-newTableBorder
          rounded-[12px]
          overflow-hidden
          transition-all duration-200
          hover:border-[#1F3A5F]/50
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
          <div className="flex items-center gap-[10px]">
            <div
              className={`
                w-[8px] h-[8px] rounded-full toybaco-chart-accent
                ${color === 'purple' ? 'bg-[#1F3A5F]' : ''}
                ${color === 'green' ? 'bg-[#32d583]' : ''}
                ${color === 'blue' ? 'bg-[#1d9bf0]' : ''}
              `}
            />
            <span className="text-[15px] font-medium text-newTableText">
              {analyticsLabelJa(item.label)}
            </span>
          </div>
        </div>

        {/* Content */}
        {hasDataPoints ? (
          <>
            {/* Chart */}
            <div className="flex-1 px-[12px] py-[8px]">
              <div className="h-[120px] relative">
                <ChartSocial data={item.data} color={color} key={`chart-${index}`} />
              </div>
            </div>

            {/* Value */}
            <div className="px-[16px] pb-[14px]">
              <div className="text-[36px] leading-[42px] font-semibold tracking-tight">
                {total}
              </div>
            </div>
          </>
        ) : (
          /* Single value display */
          <div className="flex-1 flex flex-col items-center justify-center py-[32px] px-[16px]">
            <div className="text-[48px] leading-[56px] font-semibold tracking-tight">
              {total}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AnalyticsNotice: FC<{ message: string; action: string; onAction: () => void; failed?: boolean }> = ({ message, action, onAction, failed }) => (
  <div role={failed ? 'alert' : 'status'} className="col-span-full flex flex-col items-center gap-[16px] rounded-[12px] border border-newTableBorder bg-newTableHeader px-[24px] py-[32px] text-center">
    <p className="text-[15px] leading-[1.6]">{message}</p>
    <button type="button" onClick={onAction} className="min-h-[44px] rounded-[8px] bg-btnPrimary text-white px-[16px] text-[14px]">{action}</button>
  </div>
);

// The deadline covers both fetch and JSON; errors are not valid empty analytics.
export async function readAnalytics(fetch: ReturnType<typeof useFetch>, path: string): Promise<AnalyticsDataItem[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(path, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error('ANALYTICS_UNAVAILABLE'), { reason: lookupFailure(body) });
      if (!Array.isArray(body) || body.some(item =>
        !item || typeof item.label !== 'string' || !Array.isArray(item.data) ||
        (item.average !== undefined && typeof item.average !== 'boolean') ||
        (item.percentageChange !== undefined && (typeof item.percentageChange !== 'number' || !Number.isFinite(item.percentageChange))) ||
        item.data.some((point: { total?: unknown; date?: unknown } | null) =>
          !point || !['number', 'string'].includes(typeof point.total) || String(point.total).trim() === '' || !Number.isFinite(Number(point.total)) ||
          typeof point.date !== 'string' || !Number.isFinite(Date.parse(point.date)))
      )) throw new Error('ANALYTICS_UNAVAILABLE');
      return body.map(item => ({ ...item, data: item.data.map((point: { total: number | string; date: string }) => ({ ...point, total: Number(point.total) })) }));
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('ANALYTICS_UNAVAILABLE')); }, 15000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export const RenderAnalytics: FC<{
  integration: Integration;
  date: number;
  onRefresh: () => void;
}> = (props) => {
  const { integration, date, onRefresh } = props;
  const fetch = useFetch();

  const load = useCallback(() => readAnalytics(fetch, `/analytics/${integration.id}?date=${date}`), [fetch, integration.id, date]);

  const { data, error, isLoading, mutate } = useSWR(`/analytics-${integration?.id}-${date}`, load, {
    refreshInterval: 0,
    shouldRetryOnError: false,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    revalidateOnMount: true,
  });


  const totals = useMemo(() => {
    return data?.map((p: AnalyticsDataItem) => {
      const value =
        (p?.data.reduce((acc: number, curr: { total: number }) => acc + curr.total, 0) || 0) /
        (p.average && p.data.length ? p.data.length : 1);
      if (p.average) {
        return value.toFixed(2) + '%';
      }
      return new Intl.NumberFormat().format(Math.round(value));
    });
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[48px]">
        <LoadingComponent />
      </div>
    );
  }

  if (error) {
    const reason: ConnectionReason = error.reason || 'unavailable';
    const message = reason === 'unavailable'
      ? '分析データを取得できませんでした。時間をおいて、もう一度お試しください。'
      : connectionMessage({ outcome: 'failed', reason });
    return <AnalyticsNotice failed message={message} action={reason === 'reauthenticate' ? 'チャンネルを再接続' : '再確認'} onAction={reason === 'reauthenticate' ? onRefresh : () => { void mutate(); }} />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
      {data?.length === 0 && (
        <AnalyticsNotice
          message={integration.refreshNeeded ? 'チャンネルの認証を更新してから、分析データを確認してください。' : 'この期間の分析データはありません。期間を変えるか、時間をおいて再確認してください。'}
          action={integration.refreshNeeded ? 'チャンネルを再接続' : '再確認'}
          onAction={integration.refreshNeeded ? onRefresh : () => { void mutate(); }}
        />
      )}
      {data?.map((item: AnalyticsDataItem, index: number) => (
        <AnalyticsCard
          key={`analytics-${index}`}
          item={item}
          total={totals[index]}
          index={index}
        />
      ))}
    </div>
  );
};
