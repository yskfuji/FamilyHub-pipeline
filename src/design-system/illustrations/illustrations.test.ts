import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import themesCss from '../themes.css?raw';
import tokensCss from '../tokens.css?raw';
import { EmptyAlbums } from './EmptyAlbums';
import { EmptyBudget } from './EmptyBudget';
import { EmptyDone } from './EmptyDone';
import { EmptyError } from './EmptyError';
import { EmptyEvents } from './EmptyEvents';
import { EmptyMemos } from './EmptyMemos';
import { EmptyOffline } from './EmptyOffline';
import { EmptyPlaces } from './EmptyPlaces';
import { EmptySearch } from './EmptySearch';
import { EmptyTasks } from './EmptyTasks';
import { OnboardingHousehold, OnboardingSharing, OnboardingWelcome } from './OnboardingScenes';
import { SeasonScene } from './SeasonScene';

/**
 * 描いた結果（ブラウザに届く SVG）で確かめる。scripts/audit-illustrations.mjs はソースで確かめる。
 * 10の空の状態・3つのはじめに・4つの季節の場面（ILLUS-0）。
 */
const art: Array<[string, ComponentType]> = [
  ['EmptyEvents', EmptyEvents], ['EmptyTasks', EmptyTasks], ['EmptyMemos', EmptyMemos], ['EmptyBudget', EmptyBudget], ['EmptyAlbums', EmptyAlbums],
  ['EmptyPlaces', EmptyPlaces], ['EmptySearch', EmptySearch], ['EmptyOffline', EmptyOffline], ['EmptyError', EmptyError], ['EmptyDone', EmptyDone],
  ['OnboardingHousehold', OnboardingHousehold], ['OnboardingSharing', OnboardingSharing], ['OnboardingWelcome', OnboardingWelcome],
  ...(['spring', 'summer', 'autumn', 'winter'] as const).map((season): [string, ComponentType] => [`SeasonScene ${season}`, () => createElement(SeasonScene, { season })]),
];
const themeCss = `${tokensCss}\n${themesCss}`;
/** gzip にしたバイト数（既定の圧縮の強さ。ゲートの -9 より大きくなる側）。 */
const gzipSize = async (text: string) => (await new Response(new Response(text).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()).byteLength;
const defined = new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name));

describe('illustrations as rendered (ILLUS-0)', () => {
  it('draws 17 pieces: 10 empty states, 3 onboarding scenes and 4 seasons', () => expect(art).toHaveLength(17));
  for (const [name, Component] of art) {
    describe(name, () => {
      const markup = renderToStaticMarkup(createElement(Component));
      it('is one decorative svg that assistive technology skips', () => {
        expect(markup.match(/<svg/g)).toHaveLength(1);
        expect(markup).toMatch(/^<svg[^>]* aria-hidden="true"/);
        expect(markup).toMatch(/^<svg[^>]* focusable="false"/);
        expect(markup).not.toMatch(/<title|<desc|role=|aria-label|tabindex/i);
      });
      it('takes every colour from a theme variable that exists in all themes', () => {
        const colours = [...markup.matchAll(/(?:fill|stroke|stop-color|color)="([^"]*)"/g)].map(([, value]) => value);
        expect(colours.length).toBeGreaterThan(0);
        for (const value of colours) expect(value, `${name}: ${value}`).toMatch(/^(var\(--[a-z0-9-]+\)|none|currentColor)$/);
        for (const [, variable] of markup.matchAll(/var\((--[a-z0-9-]+)\)/g)) expect(defined.has(variable), `${name}: ${variable} is not defined in tokens.css or themes.css`).toBe(true);
        expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      });
      it('is at most 4 KB gzip as rendered', async () => {
        expect(await gzipSize(markup)).toBeLessThanOrEqual(4096);
      });
    });
  }
});
