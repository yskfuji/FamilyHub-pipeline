import { audienceLabel } from '../../content/ja';
import type { SharedKind } from '../../domain/visibilityForm';
import type { VisibilityPolicy } from '../../domain/types';

/** 公開範囲の説明。選択したメンバーの場合は名前も示す。 */
export const audienceText = (kind: SharedKind, visibility: VisibilityPolicy, nameOf: (id: string) => string) => (visibility.audience === 'selected'
  ? `${audienceLabel(kind, 'selected')}（${visibility.selectedMembershipIds.map(nameOf).join('、')}）`
  : audienceLabel(kind, visibility.audience));
