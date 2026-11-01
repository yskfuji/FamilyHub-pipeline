import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { Dialog, StatusBadge } from '../../design-system/components';
import { useUnsavedGuard } from '../../design-system/unsavedGuard';
import { monthKeyFromRfc3339, shiftMonthKey } from '../../domain/calendarDate';
import { defaultAudience } from '../../domain/visibilityForm';
import { includedByDefault, proposalTimeText, saveProposals, shiftEventInput, toProposals } from '../../domain/shift/proposal';
import type { ShiftProposal } from '../../domain/shift/proposal';
import { detectRosterMonth, parseRoster } from '../../domain/shift/roster';
import { customRule, loadShiftRules, mergeRules, resetShiftRules, ruleProblem, saveShiftRules } from '../../domain/shift/rules';
import type { ShiftTimeRule } from '../../domain/shift/rules';
import { samePerson } from '../../domain/shift/text';
import { dayLabel, monthHeading } from './calendarLabels';
import { ShiftRules } from './ShiftRules';

const NEARBY_MONTHS = [-2, -1, 0, 1, 2, 3, 4];

function ShiftRow({ row, included, busy, failure, onToggle, onAddRule }: { row: ShiftProposal; included: boolean; busy: boolean; failure?: string; onToggle: (on: boolean) => void; onAddRule: () => void }) {
  const unknown = row.kind === 'unknown';
  return <tr data-kind={row.kind}>
    <td className="shift-include"><label className="shift-check"><input data-control-id={`calendar.shift.row.${row.id}`} type="checkbox" checked={included} disabled={unknown || busy} aria-label={`${dayLabel(row.date)}の${row.title}を保存する`} onChange={(event) => onToggle(event.target.checked)}/></label></td>
    <td className="shift-date">{dayLabel(row.date)}</td>
    <td className="shift-detail">
      <strong>{row.title}</strong> <span className="shift-time">{proposalTimeText(row)}</span>
      {row.duplicate && <span className="shift-flag"><StatusBadge>同じ予定があります</StatusBadge></span>}
      {row.warning && <span className="shift-flag"><StatusBadge tone="attention">{row.warning}</StatusBadge></span>}
      {unknown && <button data-control-id={`calendar.shift.add-rule.${row.id}`} className="button shift-add-rule" type="button" disabled={busy} onClick={onAddRule}>「{row.symbol}」の規則を追加</button>}
      {failure && <span className="field-error shift-failure" role="alert">{failure}</span>}
    </td>
  </tr>;
}

function ShiftDialog({ onClose }: { onClose: () => void }) {
  const { snapshot, gateway, refresh, announce, privacy } = useApp();
  const [text, setText] = useState('');
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const [chosenPerson, setChosenPerson] = useState<string | null>(null);
  const [memberId, setMemberId] = useState(snapshot.viewer.membershipId);
  const [rules, setRules] = useState<ShiftTimeRule[]>(() => loadShiftRules(localStorage));
  const [rulesVersion, setRulesVersion] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [workLabelId, setWorkLabelId] = useState('');
  const [offLabelId, setOffLabelId] = useState('');
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const busy = progress !== null;
  const unsaved = useUnsavedGuard(saved.size ? '' : text.trim(), busy);

  const currentMonth = monthKeyFromRfc3339(snapshot.context.asOf);
  const detectedMonth = useMemo(() => detectRosterMonth(text, currentMonth), [text, currentMonth]);
  const month = chosenMonth ?? detectedMonth ?? currentMonth;
  const months = [...new Set([...NEARBY_MONTHS.map((delta) => shiftMonthKey(currentMonth, delta)), month])].sort();
  const members = snapshot.memberships.filter((member) => member.status === 'active');
  const memberName = useMemo(() => snapshot.memberships.find((member) => member.id === memberId)?.displayName ?? '', [snapshot.memberships, memberId]);

  // まず全員の名前を読み、選ばれていなければ予定に入れる人と同じ名前を選ぶ。
  const { people, person, result } = useMemo(() => {
    const found = parseRoster(text, { month, rules }).people;
    const chosen = chosenPerson !== null && found.includes(chosenPerson) ? chosenPerson : found.find((name) => samePerson(name, memberName)) ?? '';
    return { people: found, person: chosen, result: parseRoster(text, { month, rules, person: chosen }) };
  }, [text, month, rules, chosenPerson, memberName]);
  const rows = useMemo(() => toProposals(result.rows, snapshot.events, memberId).filter((row) => !saved.has(row.id)), [result.rows, snapshot.events, memberId, saved]);
  const included = (row: ShiftProposal) => row.kind !== 'unknown' && (choices[row.id] ?? includedByDefault(row));
  const selected = rows.filter(included);
  const offRows = rows.some((row) => row.kind === 'off');

  const changeRules = (next: ShiftTimeRule[]) => {
    setRules(next);
    if (next.every((rule) => !ruleProblem(rule, next))) saveShiftRules(localStorage, next);
  };
  const addRules = (additions: readonly ShiftTimeRule[]) => { changeRules(mergeRules(rules, additions)); setRulesVersion((value) => value + 1); };
  const addRuleFor = (symbol: string) => {
    addRules([customRule(symbol, rules)]);
    setRulesOpen(true);
  };
  const resetRules = () => { setRules(resetShiftRules(localStorage)); setRulesVersion((value) => value + 1); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !selected.length) return;
    const audience = defaultAudience(snapshot.viewer.role, 'event', privacy?.defaultAudience);
    const target = { memberId, workLabelId, offLabelId, audience, selectedIds: [] };
    setFailures({}); setSummary(''); setProgress({ done: 0, total: selected.length });
    const outcome = await saveProposals(selected, (row) => {
      // 応答だけが届かなかった行を送り直しても、予定が2つにならないようにする。
      const signature = `${row.id}|${memberId}|${workLabelId}|${offLabelId}`;
      const key = operationKeys.current.get(signature) ?? crypto.randomUUID();
      operationKeys.current.set(signature, key);
      return gateway.events.createEvent(shiftEventInput(row, target), { idempotencyKey: key, expectedPermissionRevision: snapshot.viewer.permissionRevision });
    }, (done) => setProgress({ done, total: selected.length }));
    const added = outcome.saved.length;
    setSaved(new Set([...saved, ...outcome.saved])); setFailures(outcome.failures); setProgress(null);
    if (added) await refresh();
    const failed = Object.keys(outcome.failures).length;
    if (!failed) { announce(`${added}件の予定を保存しました`); onClose(); return; }
    setSummary(`${added}件を保存しました。${failed}件は保存できなかったので、表に残しています。`);
  };

  return <Dialog title="シフトを読み取る" description="勤務表の文字を貼り付けると、予定の候補を表にします。確かめて保存するまで、何も追加しません。" onClose={() => { if (!busy) onClose(); }}>
    <form {...unsaved.formProps} className="stack shift-reader" aria-busy={busy} onSubmit={(event) => void save(event)}>
      <label className="field"><span>勤務表の文字</span><textarea data-control-id="calendar.shift.text" className="textarea shift-text" rows={6} maxLength={40_000} disabled={busy} aria-describedby="shift-text-help" placeholder={'10/1 早番\n10/2 遅番\n10/3 休み'} value={text} onChange={(event) => { setText(event.target.value); setSummary(''); }}/><span className="field-help" id="shift-text-help">表計算、チャット、メールからの貼り付けに対応します。読み取りはこの端末の中だけで行います。</span></label>
      <div className="grid two">
        <label className="field"><span>対象の月</span><select data-control-id="calendar.shift.month" className="select" disabled={busy} value={month} onChange={(event) => setChosenMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthHeading(value)}</option>)}</select></label>
        <label className="field"><span>予定に入れる人</span><select data-control-id="calendar.shift.member" className="select" disabled={busy} value={memberId} onChange={(event) => setMemberId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
      </div>
      {people.length > 1 && <label className="field"><span>表の中の人</span><select data-control-id="calendar.shift.person" className="select" disabled={busy} value={person} onChange={(event) => setChosenPerson(event.target.value)}><option value="">選んでください</option>{people.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
      {snapshot.colorLabels.length > 0 && <div className="grid two">
        <label className="field"><span>勤務のリスト</span><select data-control-id="calendar.shift.work-label" className="select" disabled={busy} value={workLabelId} onChange={(event) => setWorkLabelId(event.target.value)}><option value="">なし</option>{snapshot.colorLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
        <label className="field"><span>休みのリスト</span><select data-control-id="calendar.shift.off-label" className="select" disabled={busy} value={offLabelId} onChange={(event) => setOffLabelId(event.target.value)}><option value="">なし</option>{snapshot.colorLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
      </div>}
      <ShiftRules key={rulesVersion} rules={rules} legend={result.legend} open={rulesOpen} onToggle={setRulesOpen} onChange={changeRules} onAdd={addRules} onReset={resetRules}/>
      {text.trim() && people.length > 1 && !person && <p className="small muted mb-0" role="status">表に{people.length}人の名前があります。読み取る人を選んでください。</p>}
      {text.trim() && !rows.length && !saved.size && (people.length <= 1 || person) && <p className="small muted mb-0" role="status">シフトを読み取れませんでした。日付と記号が入っているか確かめてください。</p>}
      {rows.length > 0 && <section aria-labelledby="shift-review-title">
        <div className="section-head"><h3 id="shift-review-title">保存する予定の確認</h3><span className="meta">{rows.length}件中{selected.length}件</span></div>
        {offRows && !offLabelId && snapshot.colorLabels.length > 0 && <p className="field-help">休みの日は終日の予定になります。不要な行は外してください。</p>}
        <div className="shift-table-wrap"><table className="shift-table">
          <thead><tr><th scope="col"><span className="sr-only">保存する</span></th><th scope="col">日付</th><th scope="col">内容と時刻</th></tr></thead>
          <tbody>{rows.map((row) => <ShiftRow key={row.id} row={row} included={included(row)} busy={busy} failure={failures[row.id]} onToggle={(on) => setChoices((current) => ({ ...current, [row.id]: on }))} onAddRule={() => addRuleFor(row.symbol)}/>)}</tbody>
        </table></div>
      </section>}
      {result.skipped.map((note) => <p className="small muted mb-0" key={note}>{note}</p>)}
      {summary && <p className="notice error mb-0" role="alert">{summary}</p>}
      {progress && <p className="small muted mb-0" role="status">{progress.total}件中{progress.done}件を保存しました。</p>}
      <div className="dialog-actions">
        <button data-control-id="calendar.shift.cancel" className="button" type="button" disabled={busy} onClick={() => unsaved.leave(onClose)}>{saved.size ? ja.actions.close : ja.actions.cancel}</button>
        <button data-control-id="calendar.shift.save" className="button primary" type="submit" disabled={busy || !selected.length}>{busy ? ja.actions.saving : `${selected.length}件を保存`}</button>
      </div>
    </form>
  </Dialog>;
}

/** 予定を作れる人に出す。貼り付けた文字は端末の外へ出さず、保存を押すまで予定を作らない。 */
export function ShiftReader() {
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  if (!can('event.create')) return null;
  return <>
    <button data-control-id="calendar.shift.open" className="button" type="button" onClick={() => setOpen(true)}>シフトを読み取る</button>
    {open && <ShiftDialog onClose={() => setOpen(false)}/>}
  </>;
}
