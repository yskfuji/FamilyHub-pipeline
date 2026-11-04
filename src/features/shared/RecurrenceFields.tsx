import type { EventDraft, RecurrenceChoice } from '../../domain/eventForm';

const recurrenceOptions: ReadonlyArray<readonly [RecurrenceChoice, string]> = [['none', '繰り返さない'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['month-end', '毎月の末日'], ['every-n-days', '日数を指定']];

type Rule = Pick<EventDraft, 'recurrence' | 'intervalDays' | 'until'>;

interface Props {
  /** 操作の ID の末尾に使う。 */
  formKey: string;
  value: Rule;
  /** 最初の回の日付。分かっていなければ空。 */
  startDate: string;
  /** 今の規則がこの画面で作れないときの表示名。あれば「今の設定のまま」を選べる。 */
  keptRuleLabel?: string;
  onChange: (changes: Partial<Rule>) => void;
}

/** 繰り返しの選択。予定とタスクで共通。 */
export function RecurrenceFields({ formKey, value, startDate, keptRuleLabel, onChange }: Props) {
  return <>
    <div className="field">
      <label htmlFor={`recurrence-${formKey}`}>繰り返し</label>
      <select data-control-id={`shared.recurrence.choice.${formKey}`} className="select" id={`recurrence-${formKey}`} value={value.recurrence} onChange={(event) => onChange({ recurrence: event.target.value as RecurrenceChoice })}>
        {recurrenceOptions.map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}
        {keptRuleLabel !== undefined && <option value="keep">今の設定のまま（{keptRuleLabel}）</option>}
      </select>
      {value.recurrence === 'month-end' && <span className="field-help">31日がない月は、その月の最後の日に入ります。最初の回は開始日以降の月末です。</span>}
      {value.recurrence === 'monthly' && Number(startDate.slice(8, 10)) > 28 && <span className="field-help">その日がない月には入りません。月の最後の日に入れるときは「毎月の末日」を選びます。</span>}
    </div>
    {value.recurrence === 'every-n-days' && <label className="field"><span>何日ごと</span><input data-control-id={`shared.recurrence.interval.${formKey}`} className="input" type="number" min={1} max={366} step={1} value={value.intervalDays} onChange={(event) => onChange({ intervalDays: Number(event.target.value) })}/></label>}
    {value.recurrence !== 'none' && value.recurrence !== 'keep' && <label className="field"><span>繰り返しの終了日（任意）</span><input data-control-id={`shared.recurrence.until.${formKey}`} className="input" type="date" value={value.until} onChange={(event) => onChange({ until: event.target.value })}/></label>}
  </>;
}
