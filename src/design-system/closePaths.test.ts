// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Drawer } from './components';
import { DetailSurface } from './DetailSurface';
import { finishLeaving, pendingLeave, stayHere } from './unsavedGuard';

/**
 * 重ね表示のどの閉じ方でも、保存していない入力があれば確かめる（計画 C「重ね表示」）。
 * 段階7まで、ドロワーは背景と × で onClose を直接呼び、確認を通らなかった。
 */
describe('every close path asks when a form inside has unsaved input (FRAME-4)', () => {
  let root: Root;
  let main: HTMLElement;
  beforeEach(() => {
    main = document.body.appendChild(document.createElement('main'));
    main.id = 'main';
    const host = document.body.appendChild(document.createElement('div'));
    host.id = 'root';
    root = createRoot(host);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    stayHere();
    document.body.replaceChildren();
  });

  const render = (node: ReactNode) => flushSync(() => root.render(node));
  const form = (dirty: boolean) => createElement('form', dirty ? { 'data-unsaved': 'true' } : {}, createElement('input', { 'aria-label': '名前' }));
  const press = (element: Element | null, type = 'click') => { flushSync(() => { element!.dispatchEvent(new MouseEvent(type, { bubbles: true })); }); };
  const escape = () => flushSync(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  const paths: Array<[string, () => void]> = [
    ['the close button', () => press(document.querySelector('[data-control-id="drawer.close"], [data-control-id="dialog.close"]'))],
    ['Escape', escape],
  ];

  for (const [name, close] of [...paths, ['the backdrop', () => press(document.querySelector('.backdrop'))] as [string, () => void]]) {
    it(`drawer: ${name} asks first, and discarding closes`, () => {
      const onClose = vi.fn();
      render(createElement(Drawer, { title: '詳細', eyebrow: '見出し', onClose }, form(true)));
      close();
      expect(onClose).not.toHaveBeenCalled();
      expect(pendingLeave()).not.toBeNull();
      finishLeaving();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`drawer: ${name} closes at once without unsaved input`, () => {
      const onClose = vi.fn();
      render(createElement(Drawer, { title: '詳細', eyebrow: '見出し', onClose }, form(false)));
      close();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(pendingLeave()).toBeNull();
    });
  }

  for (const [name, close] of [...paths, ['the backdrop', () => press(document.querySelector('.dialog-backdrop'), 'mousedown')] as [string, () => void]]) {
    it(`dialog: ${name} asks first`, () => {
      const onClose = vi.fn();
      render(createElement(Dialog, { title: '編集', onClose }, form(true)));
      close();
      expect(onClose).not.toHaveBeenCalled();
      expect(pendingLeave()).not.toBeNull();
    });
  }

  for (const [name, close] of paths) {
    it(`detail pane (wide): ${name} asks first`, () => {
      Object.defineProperty(main, 'clientWidth', { configurable: true, value: 1200 });
      const onClose = vi.fn();
      render(createElement(DetailSurface, { title: '詳細', eyebrow: '見出し', onClose }, form(true)));
      expect(document.querySelector('.detail-pane')).not.toBeNull();
      close();
      expect(onClose).not.toHaveBeenCalled();
      expect(pendingLeave()).not.toBeNull();
      stayHere();
      expect(onClose).not.toHaveBeenCalled();
    });
  }

  it('the detail surface is a sheet when narrow, a drawer when medium and a pane when wide', () => {
    const shown = (width: number) => {
      Object.defineProperty(main, 'clientWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
      render(createElement(DetailSurface, { key: width, title: '詳細', eyebrow: '見出し', onClose: () => undefined }, null));
      return document.querySelector('.detail-pane') ? 'pane' : document.querySelector('.drawer')?.getAttribute('data-presentation');
    };
    expect(shown(390)).toBe('sheet');
    expect(shown(599)).toBe('sheet');
    expect(shown(600)).toBe('drawer');
    expect(shown(1099)).toBe('drawer');
    expect(shown(1100)).toBe('pane');
  });
});
