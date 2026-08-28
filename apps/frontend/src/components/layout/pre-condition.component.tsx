import React, { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';

export const PreConditionComponentModal: FC = () => {
  const modal = useModals();
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="whitespace-pre-line">
        このチャンネルは別のトイバコ組織に接続されています。
        {'\n'}
        元の組織で接続を解除してから、もう一度お試しください。
        解決しない場合はトイバコ管理者へお問い合わせください。
      </div>
      <div className="flex gap-[2px] justify-center">
        <Button onClick={modal.closeCurrent}>閉じる</Button>
      </div>
    </div>
  );
};
export const PreConditionComponent: FC = () => {
  const modal = useModals();
  const query = useSearchParams();
  useEffect(() => {
    if (query.get('precondition')) {
      modal.openModal({
        title: 'チャンネルを接続できません',
        withCloseButton: true,
        classNames: {
          modal: 'text-textColor',
        },
        children: <PreConditionComponentModal />,
      });
    }
  }, []);
  return null;
};
