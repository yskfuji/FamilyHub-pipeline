/**
 * 変更の記録を残す月数の既定（FAMILY_HUB_AUDIT_RETENTION_MONTHS で変えられる）。規約とポリシーにも書く。
 * 設定のタブの説明（最初に読む JS に入る）からも使うので、検証の規則（auditLog.ts）とは別の小さなファイルに置く。
 */
export const AUDIT_RETENTION_MONTHS = 24;
