import { useState } from 'react';
import { StatusBadge } from '../../design-system/components';
import { legendRules } from '../../domain/shift/roster';
import { customRule, isOvernight, parseAliases, ruleProblem } from '../../domain/shift/rules';
import type { ShiftTimeRule } from '../../domain/shift/rules';

function RuleRow({ rule, rules, onChange, onRemove }: { rule: ShiftTimeRule; rules: readonly ShiftTimeRule[]; onChange: (changes: Partial<ShiftTimeRule>) => void; onRemove: () => void }) {
  const [aliases, setAliases] = useState(rule.aliases.join('、'));
  const problem = ruleProblem(rule, rules);
  return <li className="shift-rule">
    <div className="shift-rule-names">
      <label className="field"><span>名前</span><input data-control-id={`calendar.shift.rule.label.${rule.id}`} className="input" maxLength={20} value={rule.label} onChange={(event) => onChange({ label: event.target.value })}/></label>
      <label className="field"><span>別名</span><input data-control-id={`calendar.shift.rule.aliases.${rule.id}`} className="input" value={aliases} onChange={(event) => { setAliases(event.target.value); onChange({ aliases: parseAliases(event.target.value) }); }}/></label>
    </div>
    {!rule.off && <div className="shift-rule-times">
      <label className="field"><span>開始</span><input data-control-id={`calendar.shift.rule.start.${rule.id}`} className="input" type="time" value={rule.start} onChange={(event) => { if (event.target.value) onChange({ start: event.target.value }); }}/></label>
      <label className="field"><span>終了</span><input data-control-id={`calendar.shift.rule.end.${rule.id}`} className="input" type="time" value={rule.end} onChange={(event) => { if (event.target.value) onChange({ end: event.target.value }); }}/></label>
    </div>}
    <div className="shift-rule-options">
      {!rule.off && <label className="check-row"><input data-control-id={`calendar.shift.rule.next-day.${rule.id}`} type="checkbox" checked={isOvernight(rule)} disabled={rule.end <= rule.start} onChange={(event) => onChange({ endsNextDay: event.target.checked })}/>翌日に終わる</label>}
      <label className="check-row"><input data-control-id={`calendar.shift.rule.off.${rule.id}`} type="checkbox" checked={rule.off} onChange={(event) => onChange({ off: event.target.checked })}/>休み</label>
      <button data-control-id={`calendar.shift.rule.remove.${rule.id}`} className="button" type="button" aria-label={`「${rule.label}」の規則を消す`} onClick={onRemove}>消す</button>
    </div>
    {problem && <p className="field-error mb-0" role="alert">{problem}</p>}
  </li>;
}

interface Props {
  rules: readonly ShiftTimeRule[];
  /** 表の凡例から読んだ規則。保存するまでこの読み取りにだけ使う。 */
  legend: readonly ShiftTimeRule[];
  open: boolean;
  onToggle: (open: boolean) => void;
  onChange: (rules: ShiftTimeRule[]) => void;
  onAdd: (rules: readonly ShiftTimeRule[]) => void;
  onReset: () => void;
}

/** 記号と時刻の対応の編集。変更はこの端末に残す。 */
export function ShiftRules({ rules, legend, open, onToggle, onChange, onAdd, onReset }: Props) {
  const [sample, setSample] = useState('');
  const [sampleNote, setSampleNote] = useState('');
  const saveSample = () => {
    const found = legendRules(sample);
    if (!found.length) { setSampleNote('規則を読み取れませんでした。「A=9:00-18:00」のように書いてください。'); return; }
    onAdd(found);
    setSample('');
    setSampleNote(`${found.length}件の規則を保存しました。`);
  };
  const addRule = () => onChange([...rules, customRule('', rules)]);
  return <details className="shift-rules" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary>時刻の規則（{rules.length}件）</summary>
    <p className="small muted">記号と時刻の対応を変えられます。この端末に残し、ほかの人の画面は変わりません。</p>
    {legend.length > 0 && <div className="callout info"><div><strong>表の凡例から{legend.length}件の規則を読みました</strong><p className="small muted mb-0">この読み取りに使っています。保存すると次回も使えます。</p></div><button data-control-id="calendar.shift.rules.save-legend" className="button" type="button" onClick={() => onAdd(legend)}>規則を保存</button></div>}
    <ul className="shift-rule-list">{rules.map((rule) => <RuleRow key={rule.id} rule={rule} rules={rules} onChange={(changes) => onChange(rules.map((item) => (item.id === rule.id ? { ...item, ...changes } : item)))} onRemove={() => onChange(rules.filter((item) => item.id !== rule.id))}/>)}</ul>
    <div className="shift-rule-actions">
      <button data-control-id="calendar.shift.rules.add" className="button" type="button" onClick={addRule}>規則を追加</button>
      <button data-control-id="calendar.shift.rules.reset" className="button" type="button" onClick={onReset}>初期の規則に戻す</button>
    </div>
    <label className="field"><span>見本から規則を作る</span><textarea data-control-id="calendar.shift.rules.sample-text" className="textarea" rows={2} maxLength={2000} placeholder="A=9:00-18:00" aria-describedby="shift-sample-help" value={sample} onChange={(event) => { setSample(event.target.value); setSampleNote(''); }}/><span className="field-help" id="shift-sample-help">凡例の行を貼り付けると、規則として端末に保存します。</span></label>
    <div className="shift-rule-actions">
      <button data-control-id="calendar.shift.rules.sample-save" className="button" type="button" disabled={!sample.trim()} onClick={saveSample}>見本から保存</button>
      {sampleNote && <StatusBadge>{sampleNote}</StatusBadge>}
    </div>
  </details>;
}
