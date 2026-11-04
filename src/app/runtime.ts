import type { FamilyHubGateway } from '../data/gateway';
import type { HouseholdSnapshot, SessionInfo } from '../domain/types';

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
  if (import.meta.env.VITE_GATEWAY === 'http') {
    const { createHttpRuntime } = await import('./runtime.http');
    return createHttpRuntime();
  }
  const { createMockRuntime } = await import('./runtime.mock');
  return createMockRuntime();
}
