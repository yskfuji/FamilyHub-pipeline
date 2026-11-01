import { memberScopeChoices } from '../domain/memberScope';
import { colorModes, themePalettes } from '../domain/theme';
import type { Capability, HouseholdSnapshot } from '../domain/types';
import { ja } from '../content/ja';
import { setDevicePreferences, type Density } from './devicePreferences';
import type { QuickCreateKind } from './AppContext';
import { navigateGuarded } from './router';

export interface PaletteCommand { id: string; label: string; group: string; keywords: string; run: () => void; current?: boolean }

export const densityLabels: Record<Density, string> = { comfortable: 'ゆったり', compact: 'コンパクト' };

const screens: ReadonlyArray<readonly [string, string, string, Capability?]> = [
  ['today', ja.navigation.today, '/today'],
  ['calendar', ja.navigation.calendar, '/calendar', 'event.read'],
  ['tasks', ja.navigation.tasks, '/tasks', 'task.read'],
  ['notes', ja.navigation.notes, '/notes', 'memo.read'],
  ['budget', ja.navigation.budget, '/budget', 'expense.read'],
  ['albums', ja.navigation.albums, '/albums', 'album.read'],
  ['places', ja.navigation.places, '/places', 'place.read'],
  ['insights', ja.navigation.insights, '/insights', 'insight.read'],
  ['settings', ja.navigation.settings, '/settings', 'settings.own'],
];

const additions: ReadonlyArray<readonly [string, string, QuickCreateKind, Capability]> = [
  ['task', 'タスクを追加', 'todo', 'task.create'],
  ['event', '予定を追加', 'event', 'event.create'],
  ['expense', '支出を追加', 'expense', 'expense.create'],
  ['memo', 'メモを追加', 'memo', 'memo.create'],
];

interface Sources {
  can: (capability: Capability) => boolean;
  snapshot: HouseholdSnapshot;
  requestQuickCreate: (kind: QuickCreateKind) => void;
  announce: (message: string) => void;
}

/** コマンドの一覧。使えない機能は出さない。 */
export function paletteCommands({ can, snapshot, requestQuickCreate, announce }: Sources): PaletteCommand[] {
  const { membershipId } = snapshot.viewer;
  return [
    ...screens.filter(([, , , capability]) => !capability || can(capability)).map(([id, label, href]) => ({
      id: `go.${id}`, label: `${label}を開く`, group: '画面を開く', keywords: `${label} 移動`, run: () => navigateGuarded(href),
    })),
    ...additions.filter(([, , , capability]) => can(capability)).map(([id, label, kind]) => ({
      id: `add.${id}`, label, group: '追加する', keywords: '追加 作成', run: () => requestQuickCreate(kind),
    })),
    ...memberScopeChoices(membershipId, snapshot.memberships).map(({ value, label }) => ({
      id: `scope.${value}`, label: `表示する人：${label}`, group: '表示する人', keywords: `${label} 絞り込み メンバー`,
      run: () => { setDevicePreferences({ memberScope: value }); announce(`表示する人を「${label}」にしました。`); },
    })),
    ...(Object.keys(densityLabels) as Density[]).map((density) => ({
      id: `density.${density}`, label: `表示の密度：${densityLabels[density]}`, group: '表示の密度', keywords: '密度 詰める 余白',
      run: () => { setDevicePreferences({ density }); announce(`表示の密度を「${densityLabels[density]}」にしました。`); },
    })),
    ...themePalettes.map(({ value, label }) => ({
      id: `theme.${value}`, label: `テーマ：${label}`, group: 'テーマ', keywords: `${label} 配色 色`,
      run: () => { setDevicePreferences({ palette: value }); announce(`テーマを「${label}」にしました。`); },
    })),
    ...colorModes.map(({ value, label }) => ({
      id: `mode.${value}`, label: `昼夜：${label}`, group: 'テーマ', keywords: `${label} 明るい 暗い 配色`,
      run: () => { setDevicePreferences({ colorMode: value }); announce(`昼夜の表示を「${label}」にしました。`); },
    })),
  ];
}

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase();

export const matchesCommand = (command: PaletteCommand, query: string) => normalize(`${command.label} ${command.group} ${command.keywords}`).includes(normalize(query));
