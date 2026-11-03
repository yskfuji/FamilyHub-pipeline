/**
 * バックアップの世代の数（A8）。日ごと7、週ごと4、月ごと6。
 * 月ごとの世代は6か月分なので、削除したアカウントや記録も、最長6か月はバックアップに残る。規約とポリシーにも書く。
 */
export const BACKUP_GENERATIONS = { daily: 7, weekly: 4, monthly: 6 } as const;
export const BACKUP_RETENTION_MONTHS = BACKUP_GENERATIONS.monthly;
