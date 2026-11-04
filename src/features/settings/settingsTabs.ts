import { ja } from '../../content/ja';
import type { settingsRoutes } from '../../content/settingsRoutes';
import type { Capability } from '../../domain/types';

/** 設定のタブと、その表示に必要な能力。経路の許可（App.tsx）とタブの表示はこの表だけを参照する。 */
export const settingsTabs: ReadonlyArray<{ href: typeof settingsRoutes[number]; label: string; capability: Capability }> = [
  { href: '/settings/household', label: '家族', capability: 'household.members.read' },
  { href: '/settings/security', label: 'サインインとセキュリティ', capability: 'settings.own' },
  { href: '/settings/account', label: 'アカウント', capability: 'settings.own' },
  { href: '/settings/privacy', label: '共有とプライバシー', capability: 'settings.own' },
  { href: '/settings/notifications', label: '通知', capability: 'notification.manage' },
  { href: '/settings/location', label: ja.place.settings.tab, capability: 'place.read' },
  { href: '/settings/accessibility', label: '表示・操作', capability: 'settings.own' },
  { href: '/settings/resources', label: '関連リンク', capability: 'resource.read' },
  { href: '/settings/recently-deleted', label: '最近削除', capability: 'settings.own' },
  // 変更の記録は管理者だけ（audit.read）。ほかの人にはタブも出さず、URL で開いても表示しない。
  { href: '/settings/audit', label: '変更の記録', capability: 'audit.read' },
  { href: '/settings/help', label: 'ヘルプ', capability: 'settings.own' },
  { href: '/settings/legal', label: '規約（草案）', capability: 'settings.own' },
];
export const settingsTabFor = (path: string) => settingsTabs.find((tab) => path === tab.href || path.startsWith(`${tab.href}/`));
