'use client';

import { FC, useCallback, useEffect } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { GmbSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';

const topicTypes = [
  {
    label: '通常のお知らせ',
    value: 'STANDARD',
  },
  {
    label: 'イベント',
    value: 'EVENT',
  },
  {
    label: '特典',
    value: 'OFFER',
  },
];

const callToActionTypes = [
  {
    label: 'なし',
    value: 'NONE',
  },
  {
    label: '予約',
    value: 'BOOK',
  },
  {
    label: 'オンライン注文',
    value: 'ORDER',
  },
  {
    label: '購入',
    value: 'SHOP',
  },
  {
    label: '詳細を見る',
    value: 'LEARN_MORE',
  },
  {
    label: '登録',
    value: 'SIGN_UP',
  },
  {
    label: '特典を利用',
    value: 'GET_OFFER',
  },
  {
    label: '電話',
    value: 'CALL',
  },
];

const GmbSettings: FC = () => {
  const { register, control } = useSettings();
  const topicType = useWatch({ control, name: 'topicType' });
  const callToActionType = useWatch({ control, name: 'callToActionType' });

  return (
    <div className="flex flex-col gap-[10px]">
      <Select
        label="投稿タイプ"
        {...register('topicType', {
          value: 'STANDARD',
        })}
      >
        {topicTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>

      <Select
        label="アクションボタン"
        {...register('callToActionType', {
          value: 'NONE',
        })}
      >
        {callToActionTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>

      {callToActionType &&
        callToActionType !== 'NONE' &&
        callToActionType !== 'CALL' && (
          <Input
            label="アクションボタンのURL"
            placeholder="https://example.com"
            {...register('callToActionUrl')}
          />
        )}

      {topicType === 'EVENT' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">イベントの詳細</div>
          <Input
            label="イベント名"
            placeholder="イベント名"
            {...register('eventTitle')}
          />
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label="開始日"
              type="date"
              {...register('eventStartDate')}
            />
            <Input label="終了日" type="date" {...register('eventEndDate')} />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label="開始時刻（任意）"
              type="time"
              {...register('eventStartTime')}
            />
            <Input
              label="終了時刻（任意）"
              type="time"
              {...register('eventEndTime')}
            />
          </div>
        </div>
      )}

      {topicType === 'OFFER' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">特典の詳細</div>
          <Input
            label="クーポンコード（任意）"
            placeholder="SAVE20"
            {...register('offerCouponCode')}
          />
          <Input
            label="オンライン利用URL（任意）"
            placeholder="https://example.com/redeem"
            {...register('offerRedeemUrl')}
          />
          <Input
            label="利用条件（任意）"
            placeholder="有効期限など..."
            {...register('offerTerms')}
          />
        </div>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: GmbSettings,
  CustomPreviewComponent: undefined,
  dto: GmbSettingsDto,
  maximumCharacters: 1500,
});
