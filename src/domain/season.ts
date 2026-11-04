export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 暦の月から決める季節。3〜5月が春、6〜8月が夏、9〜11月が秋、12〜2月が冬。 */
export function seasonOf(dateOrMonthKey: string): Season {
  const month = Number(dateOrMonthKey.slice(5, 7));
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
