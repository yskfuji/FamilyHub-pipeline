import type { GatewayError, RecurrenceScope } from '../domain/types';

export const ja = {
  brandTagline: '家族の暮らしをひとつに',
  task: 'タスク',
  settings: '設定',
  recurrence: {
    this: 'この予定だけ',
    future: 'これ以降の予定',
    series: 'すべての予定',
  } satisfies Record<RecurrenceScope, string>,
  errors: {
    UNAUTHENTICATED: 'もう一度サインインしてください。',
    FORBIDDEN: 'この操作を行う権限がありません。',
    NOT_FOUND: '対象が見つからないか、表示する権限がありません。',
    REAUTH_REQUIRED: '安全のため、もう一度本人確認をしてください。',
    INVALID_INPUT: '入力内容を確認してください。',
    CONFLICT: '別の端末で更新されています。最新の内容を確認してください。',
    OFFLINE: 'ネットワークに接続できません。',
    RATE_LIMITED: '操作が集中しています。少し待ってから再試行してください。',
    UPSTREAM_FAILURE: '外部サービスに接続できません。時間をおいて再試行してください。',
    ATTACHMENT_REJECTED: 'このファイルは受け付けられませんでした。',
  } satisfies Record<GatewayError['code'], string>,
};

export function errorGuidance(error: GatewayError): string {
  if (error.code === 'OFFLINE') return '入力内容は保持されています。接続を確認してから再試行してください。';
  if (error.code === 'CONFLICT') return '上書きせず、現在の内容と変更内容を見比べてください。';
  if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') return '管理者に共有範囲または権限を確認してください。';
  if (error.retryable) return '入力内容は保持されています。しばらくしてから再試行してください。';
  return '入力内容を確認し、必要な箇所を修正してください。';
}
