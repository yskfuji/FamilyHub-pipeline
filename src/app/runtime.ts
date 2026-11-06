import type { FamilyHubGateway } from '../data/gateway';
import type { HouseholdSnapshot, SessionInfo } from '../domain/types';
import { createHttpRuntime } from './runtime.http';

/** 接続先ごとの違い。確認用データは VITE_GATEWAY が http のビルドには含めない。 */
export interface AppRuntime {
  mode: 'mock' | 'http';
  actorId: string;
  gateway: FamilyHubGateway;
  initialSnapshot: HouseholdSnapshot;
  /** 読み込み前に分かっている状態。分からなければ null。 */
  initialSession: SessionInfo | null;
  /** 内部監査のビルドの見本だけ: 最初から「接続できません」の画面にする（オフラインの空の状態の確認用）。 */
  initialUnreachable?: boolean;
  setPermissionRevision(revision: number): void;
}

export async function loadRuntime(): Promise<AppRuntime> {
  // http のビルドでは接続の部品を入口に入れる（別のファイルにすると、遅い回線で往復を1回待つ。docs/audits/lcp-assessment.md）。
  if (import.meta.env.VITE_GATEWAY === 'http') return createHttpRuntime();
  const { createMockRuntime } = await import('./runtime.mock');
  return createMockRuntime();
}
