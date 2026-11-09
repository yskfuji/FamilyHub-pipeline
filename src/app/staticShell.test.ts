import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RestoringScreen } from './StageScreens';
import indexHtml from '../../index.html?raw';

/**
 * index.html の #root に置いた読み込み中の画面（JS を読む前に出す。docs/audits/lcp-assessment.md）が、
 * React が最初に描く読み込み中の画面と同じであること。違うと、描き替えたときに表示がずれる。
 */
describe('static loading screen in index.html', () => {
  it('matches the RestoringScreen that React draws first', () => {
    const root = indexHtml.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/)?.[1]?.trim();
    expect(root).toBe(renderToStaticMarkup(createElement(RestoringScreen)));
  });
});
