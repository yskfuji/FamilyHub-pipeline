import { useId } from 'react';
import { useApp } from '../../app/AppContext';
import { setDevicePreferences, useDevicePreferences } from '../../app/devicePreferences';
import { memberScopeChoices, shownMemberScope } from '../../domain/memberScope';

/** 見出しに置く、表示する人の選択。選んだ人は端末に覚える。 */
export function MemberScopeSelect() {
  const { snapshot } = useApp();
  const { memberScope } = useDevicePreferences();
  const id = useId();
  const { membershipId } = snapshot.viewer;
  return <div className="member-scope">
    <label htmlFor={id}>表示する人</label>
    <select data-control-id="shell.member-scope" className="select" id={id} value={shownMemberScope(memberScope, membershipId, snapshot.memberships)} onChange={(event) => setDevicePreferences({ memberScope: event.target.value })}>
      {memberScopeChoices(membershipId, snapshot.memberships).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </div>;
}

/** 絞り込みで何も出ないときの説明。 */
export function ScopeNote() {
  return <>表示する人を「すべて」に戻すと、ほかの記録を確認できます。</>;
}
