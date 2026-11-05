/**
 * バックアップの世代の数（A8）。日ごと7、週ごと4、月ごと6。
 * 月ごとの世代は6か月分なので、退会したアカウントは最長6か月、削除した記録は完全に消すまでの30日を足して最長でおよそ30日と6か月、バックアップに残る。規約とポリシーにも書く。
 */
export const BACKUP_GENERATIONS = { daily: 7, weekly: 4, monthly: 6 } as const;
export const BACKUP_RETENTION_MONTHS = BACKUP_GENERATIONS.monthly;
