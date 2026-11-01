import { useState } from 'react';
import { Dialog } from '../../design-system/components';
import type { CalendarView } from '../../domain/calendarDate';

const viewLabels: ReadonlyArray<readonly [CalendarView, string]> = [['month', '月'], ['week', '週'], ['day', '日'], ['list', '一覧']];
const stepLabels: Record<CalendarView, readonly [string, string, string]> = {
  month: ['前月', '今月', '次月'],
  list: ['前月', '今月', '次月'],
  week: ['前週', '今週', '次週'],
  day: ['前日', '今日', '翌日'],
};

interface Props {
  view: CalendarView;
  heading: string;
  monthKey: string;
  onView: (view: CalendarView) => void;
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
  onMonth: (monthKey: string) => void;
}

export function CalendarToolbar({ view, heading, monthKey, onView, onStep, onToday, onMonth }: Props) {
  const [picker, setPicker] = useState(false);
  const [year, setYear] = useState(Number(monthKey.slice(0, 4)));
  const [month, setMonth] = useState(Number(monthKey.slice(5, 7)));
  const openPicker = () => { setYear(Number(monthKey.slice(0, 4))); setMonth(Number(monthKey.slice(5, 7))); setPicker(true); };
  const [previous, today, next] = stepLabels[view];
  return <div className="calendar-toolbar">
    <div className="calendar-month-navigation" role="group" aria-label="表示する期間の移動">
      <button data-control-id="calendar.month.previous" className="button" type="button" onClick={() => onStep(-1)}>{previous}</button>
      <button data-control-id="calendar.month.choose" className="calendar-month-heading" type="button" aria-haspopup="dialog" aria-expanded={picker} onClick={openPicker}><span aria-live="polite">{heading}</span><span aria-hidden="true">⌄</span></button>
      <button data-control-id="calendar.month.today" className="button" type="button" onClick={onToday}>{today}</button>
      <button data-control-id="calendar.month.next" className="button" type="button" onClick={() => onStep(1)}>{next}</button>
    </div>
    <div className="segmented" role="group" aria-label="カレンダーの表示">
      {viewLabels.map(([value, label]) => <button data-control-id={`calendar.view.${value}`} key={value} type="button" aria-pressed={view === value} onClick={() => onView(value)}>{label}</button>)}
    </div>
    {picker && <Dialog title="表示する年月を選ぶ" description="1900年から2100年まで選べます。" onClose={() => setPicker(false)}>
      <div className="grid two">
        <label className="field"><span>年</span><input data-control-id="calendar.month-picker.year" data-autofocus className="input" type="number" min={1900} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))}/></label>
        <label className="field"><span>月</span><select data-control-id="calendar.month-picker.month" className="select" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}月</option>)}</select></label>
      </div>
      <div className="dialog-actions">
        <button data-control-id="calendar.month-picker.cancel" className="button" type="button" onClick={() => setPicker(false)}>キャンセル</button>
        <button data-control-id="calendar.month-picker.apply" className="button primary" type="button" disabled={!Number.isInteger(year) || year < 1900 || year > 2100} onClick={() => { onMonth(`${year}-${String(month).padStart(2, '0')}`); setPicker(false); }}>この年月を表示</button>
      </div>
    </Dialog>}
  </div>;
}
