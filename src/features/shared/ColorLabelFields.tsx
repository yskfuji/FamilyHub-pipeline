import { useApp } from '../../app/AppContext';
import { labelStyle } from '../calendar/calendarLabels';

interface Props {
  formKey: string;
  value: string;
  onChange: (id: string) => void;
}

/** 色のリストの選択。予定とタスクで共通。 */
export function ColorLabelFields({ formKey, value, onChange }: Props) {
  const { snapshot } = useApp();
  if (!snapshot.colorLabels.length) return null;
  return <fieldset className="fieldset"><legend>リスト</legend><div className="choice-grid">
    <label><input data-control-id={`shared.color-label.${formKey}.none`} type="radio" name={`color-${formKey}`} checked={!value} onChange={() => onChange('')}/>なし</label>
    {snapshot.colorLabels.map((label) => <label key={label.id}><input data-control-id={`shared.color-label.${formKey}.${label.id}`} type="radio" name={`color-${formKey}`} checked={value === label.id} onChange={() => onChange(label.id)}/><span className="color-dot" style={labelStyle(snapshot.colorLabels, label.id)} aria-hidden="true"/>{label.name}</label>)}
  </div></fieldset>;
}
