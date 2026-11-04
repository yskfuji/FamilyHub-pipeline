import { AUDIT_RETENTION_MONTHS } from '../domain/auditRetention';

/** 変更の記録の説明。設定のタブの説明（settingsTabs.ts、最初に読む JS）と記録の画面（auditLabels.ts）が共有する。 */
export const auditIntro = {
  description: '家族の記録を誰がいつ変えたかを、新しい順に表示します。記録の中身や入力した値は残していません。',
  retention: `変更の記録は${AUDIT_RETENTION_MONTHS}か月残し、その後は消します`,
} as const;
