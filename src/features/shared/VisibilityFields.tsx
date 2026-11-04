import { useApp } from '../../app/AppContext';
import { audienceHelp, audienceLabel } from '../../content/ja';
import { MAX_SELECTED_MEMBERS, audienceChoices, type SharedKind } from '../../domain/visibilityForm';
import type { HouseholdMembership, Id, VisibilityAudience } from '../../domain/types';

interface Props {
  kind: SharedKind;
  formId: string;
  audience: VisibilityAudience;
  selectedIds: Id[];
  /** 開いたときの範囲。今の範囲は選べなくても表示する。 */
  initialAudience: VisibilityAudience;
  people: readonly HouseholdMembership[];
  onChange: (changes: { audience?: VisibilityAudience; selectedIds?: Id[] }) => void;
}

/** 公開範囲の選択。予定、タスク、メモで共通。 */
export function VisibilityFields({ kind, formId, audience, selectedIds, initialAudience, people, onChange }: Props) {
  const { snapshot } = useApp();
  const key = `${kind}-${formId}`;
  return <>
    <div className="field">
      <label htmlFor={`audience-${key}`}>公開範囲</label>
      <select data-control-id={`shared.visibility.audience.${key}`} className="select" id={`audience-${key}`} aria-describedby={`audience-help-${key}`} value={audience} onChange={(event) => onChange({ audience: event.target.value as VisibilityAudience })}>
        {audienceChoices(snapshot.viewer.role, kind, initialAudience).map((value) => <option key={value} value={value}>{audienceLabel(kind, value)}</option>)}
      </select>
      <span className="field-help" id={`audience-help-${key}`}>{audienceHelp(kind, audience)}</span>
    </div>
    {audience === 'selected' && <fieldset className="fieldset"><legend>公開するメンバー（{MAX_SELECTED_MEMBERS}人まで）</legend><div className="choice-grid">{people.map((member) => {
      const checked = selectedIds.includes(member.id);
      return <label key={member.id}><input data-control-id={`shared.visibility.member.${key}.${member.id}`} type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= MAX_SELECTED_MEMBERS} onChange={(event) => onChange({ selectedIds: event.target.checked ? [...selectedIds, member.id] : selectedIds.filter((id) => id !== member.id) })}/>{member.displayName}</label>;
    })}</div></fieldset>}
  </>;
}
