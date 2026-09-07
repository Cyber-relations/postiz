'use client';

import { FC, useMemo, useState } from 'react';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useClickOutside } from '@mantine/hooks';
import { useFooterPopupFocus, useFooterPopupPosition } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import clsx from 'clsx';
import { RepeatIcon, DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';
const getList = (t: (key: string, fallback: string) => string) => [
  {
    value: 1,
    label: t('day', 'Day'),
  },
  {
    value: 2,
    label: t('two_days', 'Two Days'),
  },
  {
    value: 3,
    label: t('three_days', 'Three Days'),
  },
  {
    value: 4,
    label: t('four_days', 'Four Days'),
  },
  {
    value: 5,
    label: t('five_days', 'Five Days'),
  },
  {
    value: 6,
    label: t('six_days', 'Six Days'),
  },
  {
    value: 7,
    label: t('week', 'Week'),
  },
  {
    value: 14,
    label: t('two_weeks', 'Two Weeks'),
  },
  {
    value: 30,
    label: t('month', 'Month'),
  },
  {
    value: null,
    label: t('cancel', 'Cancel'),
  },
];
export const RepeatComponent: FC<{
  repeat: number | null;
  onChange: (newVal: number) => void;
}> = (props) => {
  const { repeat } = props;
  const t = useT();
  const list = getList(t);
  const [isOpen, setIsOpen] = useState(false);

  const ref = useClickOutside(() => {
    if (!isOpen) {
      return;
    }
    setIsOpen(false);
  });

  const popupStyle = useFooterPopupPosition(isOpen, ref, 240);
  const keyboard = useFooterPopupFocus(isOpen, setIsOpen);
  const everyLabel = useMemo(() => {
    if (!repeat) {
      return '';
    }
    return list.find((p) => p.value === repeat)?.label;
  }, [repeat, list]);

  return (
    <div
      ref={ref}
      onKeyDown={keyboard.onKeyDown}
      onBlur={keyboard.onBlur}
      className={clsx(
        'border rounded-[8px] justify-center flex items-center relative h-[44px] text-[15px] font-[600] select-none',
        isOpen ? 'border-[#612BD3]' : 'border-newTextColor/10',
      )}
    >
      <button
        type="button"
        ref={keyboard.triggerRef}
        onClick={keyboard.toggle}
        onKeyDown={keyboard.onTriggerKeyDown}
        aria-expanded={isOpen}
        aria-controls={keyboard.popupId}
        className="px-[16px] justify-center flex gap-[8px] items-center h-full select-none flex-1 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B5B]"
      >
        <span className="cursor-pointer">
          <RepeatIcon />
        </span>
        <span className="cursor-pointer">
          {repeat
            ? `${t('repeat_post_every_label', 'Repeat Post Every')} ${everyLabel}`
            : t('repeat_post_every', 'Repeat Post Every...')}
        </span>
        <span className="cursor-pointer">
          <DropdownArrowIcon rotated={isOpen} />
        </span>
      </button>
      {isOpen && (
        <div data-toybaco-footer-popup="repeat" id={keyboard.popupId} ref={keyboard.popupRef} style={popupStyle} className="bg-newBgColorInner p-[12px] menu-shadow flex flex-col">
          {list.map((p) => (
            <button
              type="button"
              onClick={() => {
                props.onChange(Number(p.value));
                keyboard.closeAndFocus();
              }}
              key={p.label}
              className="h-[40px] py-[8px] px-[20px] -mx-[12px] hover:bg-newBgColor text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF6B5B]"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
