import type { Theme } from './types';

/** 配色の組。standard が今までの見た目で、既定。 */
export type ThemePalette = 'standard' | 'warm' | 'modern' | 'matcha' | 'sakura';
/** 昼、夜、端末に合わせる。 */
export type ColorMode = 'day' | 'night' | 'system';

export const themePalettes: ReadonlyArray<{ value: ThemePalette; label: string }> = [
  { value: 'standard', label: '標準' },
  { value: 'matcha', label: '抹茶' },
  { value: 'sakura', label: '桜' },
  { value: 'warm', label: '紅葉' },
  { value: 'modern', label: '川' },
];
export const colorModes: ReadonlyArray<{ value: ColorMode; label: string }> = [
  { value: 'day', label: '昼' },
  { value: 'night', label: '夜' },
  { value: 'system', label: '端末に合わせる' },
];

export const themeFor = (palette: ThemePalette, night: boolean): Theme => {
  if (palette === 'standard') return night ? 'dusk' : 'light';
  return night ? `${palette}-night` : palette;
};

export const allThemes: readonly Theme[] = themePalettes.flatMap(({ value }) => [themeFor(value, false), themeFor(value, true)]);

export const isNightTheme = (theme: Theme) => theme === 'dusk' || theme.endsWith('-night');

export const paletteOf = (theme: Theme): ThemePalette => (theme === 'light' || theme === 'dusk' ? 'standard' : theme.replace('-night', '') as ThemePalette);

export const parseTheme = (value: string | null | undefined): Theme => (allThemes.includes(value as Theme) ? value as Theme : 'light');

export const themeLabel = (palette: ThemePalette) => themePalettes.find((item) => item.value === palette)?.label ?? '';
