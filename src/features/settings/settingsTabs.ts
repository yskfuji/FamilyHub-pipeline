import { auditIntro } from '../../content/auditIntro';
import { ja } from '../../content/ja';
import type { settingsRoutes } from '../../content/settingsRoutes';
import type { Capability } from '../../domain/types';

/**
 * 設定のタブと、その表示に必要な能力。経路の許可（App.tsx）とタブの表示はこの表だけを参照する。
 * description は見出しの下の説明（段階12でタブごとにした。前はどのタブも同じ説明だった）。
 */
export const settingsTabs: ReadonlyArray<{ href: typeof settingsRoutes[number]; label: string; capability: Capability; description: string }> = [
  { href: '/settings/household', label: '家族', capability: 'household.members.read', description: '家族のメンバーと役割、招待、予定やタスクに付ける色のリストを管理します。' },
  { href: '/settings/security', label: 'サインインとセキュリティ', capability: 'settings.own', description: 'パスキーとパスワード、サインインしている端末を確かめて変更します。' },
  { href: '/settings/account', label: 'アカウント', capability: 'settings.own', description: '名前やメールアドレスなど、自分のアカウントの情報を変更します。' },
  { href: '/settings/privacy', label: '共有とプライバシー', capability: 'settings.own', description: '新しく作る記録の共有範囲と、この端末での通知や画面の扱いを決めます。' },
  { href: '/settings/notifications', label: '通知', capability: 'notification.manage', description: '受け取る通知と、夜間に通知を控えるかどうかを選びます。' },
  { href: '/settings/location', label: ja.place.settings.tab, capability: 'place.read', description: ja.place.settings.description },
  { href: '/settings/accessibility', label: '表示・操作', capability: 'settings.own', description: 'テーマや文字の詰め具合、動きの量など、この端末での見え方と操作を変えます。' },
  { href: '/settings/resources', label: '関連リンク', capability: 'resource.read', description: '学校や自治体など、家族でよく使うリンクを開きます。' },
  { href: '/settings/recently-deleted', label: '最近削除', capability: 'settings.own', description: '削除した記録を、完全に消える前に元に戻せます。' },
  // 変更の記録は管理者だけ（audit.read）。ほかの人にはタブも出さず、URL で開いても表示しない。
  { href: '/settings/audit', label: '変更の記録', capability: 'audit.read', description: `${auditIntro.description}${auditIntro.retention}。` },
  { href: '/settings/help', label: 'ヘルプ', capability: 'settings.own', description: 'よくある質問と、それぞれの画面の使い方を探せます。' },
  { href: '/settings/legal', label: '規約（草案）', capability: 'settings.own', description: '利用規約とプライバシーポリシーの草案を確認できます。' },
];
export const settingsTabFor = (path: string) => settingsTabs.find((tab) => path === tab.href || path.startsWith(`${tab.href}/`));
