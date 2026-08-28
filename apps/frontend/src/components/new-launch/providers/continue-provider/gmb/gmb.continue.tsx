'use client';

import { withContinueProvider } from '../with-continue-provider';

interface GmbItem {
  id: string;
  name: string;
  accountName: string;
  locationName: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

interface GmbSelection {
  id: string;
  accountName: string;
  locationName: string;
}

export const GmbContinue = withContinueProvider<GmbItem, GmbSelection>({
  endpoint: 'pages',
  swrKey: 'load-gmb-locations',
  titleKey: 'select_location',
  titleDefault: 'ビジネスの所在地を選択：',
  emptyStateMessages: [
    {
      key: 'gmb_no_locations_found',
      text: "アカウントに接続されたビジネスの所在地が見つかりませんでした。",
    },
    {
      key: 'gmb_ensure_business_verified',
      text: 'Google ビジネスプロフィールでビジネスの確認が完了しているかご確認ください。',
    },
    {
      key: 'gmb_try_again',
      text: 'この画面を閉じて連携を削除し、もう一度お試しください。',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({
    id: item.id,
    accountName: item.accountName,
    locationName: item.locationName,
  }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div className="flex justify-center">
        {item.picture?.data?.url ? (
          <img
            className="w-[80px] h-[80px] object-cover rounded-[8px]"
            src={item.picture.data.url}
            alt={item.name}
          />
        ) : (
          <div className="w-[80px] h-[80px] bg-input rounded-[8px] flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="text-sm font-medium">{item.name}</div>
    </>
  ),
});
