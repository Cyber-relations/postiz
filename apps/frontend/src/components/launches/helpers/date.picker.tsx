import { CSSProperties, FC, useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ja';
import { Calendar, TimeInput } from '@mantine/dates';
import { useClickOutside } from '@mantine/hooks';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { CalendarIcon } from '@gitroom/frontend/components/ui/icons';
export function useFooterPopupPosition(open: boolean, ref: { current: HTMLElement | null }, preferredWidth = 320): CSSProperties {
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const anchor = ref.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
      const above = anchor.top >= window.innerHeight - anchor.bottom;
      setPopupStyle({
        position: 'fixed',
        left: Math.max(margin, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - margin)),
        width,
        ...(above
          ? { bottom: window.innerHeight - anchor.top + margin, top: 'auto', maxHeight: Math.max(0, anchor.top - margin * 2) }
          : { top: anchor.bottom + margin, bottom: 'auto', maxHeight: Math.max(0, window.innerHeight - anchor.bottom - margin * 2) }),
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        zIndex: 300,
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, ref, preferredWidth]);
  return popupStyle;
}

export const DatePicker: FC<{
  date: dayjs.Dayjs;
  onChange: (day: dayjs.Dayjs) => void;
}> = (props) => {
  const { date, onChange } = props;
  const [open, setOpen] = useState(false);
  const t = useT();

  const changeShow = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const ref = useClickOutside<HTMLDivElement>(() => {
    setOpen(false);
  });
  const popupStyle = useFooterPopupPosition(open, ref);
  const changeDate = useCallback(
    (type: 'date' | 'time') => (day: Date) => {
      onChange(
        newDayjs(
          type === 'time'
            ? date.format('YYYY-MM-DD') + ' ' + newDayjs(day).format('HH:mm:ss')
            : newDayjs(day).format('YYYY-MM-DD') + ' ' + date.format('HH:mm:ss')
        )
      );
    },
    [date]
  );
  return (
    <div
      className="px-[16px] border border-newTextColor/10 rounded-[8px] justify-center flex gap-[8px] items-center relative h-[44px] text-[15px] font-[600] ml-[7px] select-none flex-1"
      onClick={changeShow}
      ref={ref}
    >
      <div className="cursor-pointer">
        <CalendarIcon />
      </div>
      <div className="cursor-pointer">
        {date.format('YYYY/MM/DD HH:mm')}
      </div>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          data-toybaco-date-popup=""
          style={popupStyle}
          className="animate-fadeIn bg-sixth border border-tableBorder text-textColor rounded-[16px] p-[16px] flex flex-col"
        >
          <Calendar
            locale="ja"
            labelFormat="YYYY年M月"
            yearLabelFormat="YYYY年"
            weekdayLabelFormat="dd"
            nextMonthLabel="翌月"
            previousMonthLabel="前月"
            nextYearLabel="翌年"
            previousYearLabel="前年"
            nextDecadeLabel="次の10年"
            previousDecadeLabel="前の10年"
            renderDay={(day) => (
              <span>
                <span aria-hidden="true">{day.getDate()}</span>
                <span className="sr-only">{dayjs(day).locale('ja').format('YYYY年M月D日 dddd')}</span>
              </span>
            )}
            onChange={changeDate('date')}
            value={date.toDate()}
            dayClassName={(date, modifiers) => {
              if (modifiers.weekend) {
                return '!text-customColor28';
              }
              if (modifiers.outside) {
                return '!text-gray';
              }
              if (modifiers.selected) {
                return '!text-white !bg-seventh !outline-none';
              }
              return '!text-textColor';
            }}
            classNames={{
              day: 'hover:bg-seventh',
              calendarHeaderControl: 'text-textColor hover:bg-third',
              calendarHeaderLevel: 'text-textColor hover:bg-third', // cell: 'child:!text-textColor'
            }}
          />
          <TimeInput
            onChange={changeDate('time')}
            label="時刻を選択"
            classNames={{
              label: 'text-textColor py-[12px]',
              input:
                'bg-sixth h-[40px] border border-tableBorder text-textColor rounded-[4px] outline-none',
            }}
            defaultValue={date.toDate()}
          />
          <Button className="mt-[12px]" onClick={changeShow}>
            {t('close', 'Close')}
          </Button>
        </div>
      )}
    </div>
  );
};
