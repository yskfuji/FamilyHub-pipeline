// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { focusReturnTarget, useModalTriggerTracking } from './components';

function Tracker() {
  useModalTriggerTracking();
  return null;
}

const press = (element: Element) => element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
const byId = (id: string) => document.getElementById(id)!;

describe('focusReturnTarget', () => {
  let root: Root;
  let page: HTMLElement;

  beforeEach(() => {
    const host = document.body.appendChild(document.createElement('div'));
    page = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    flushSync(() => root.render(createElement(Tracker)));
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    document.body.replaceChildren();
  });

  it('keeps the focused control when a control has focus', () => {
    page.innerHTML = '<button id="clicked"></button><button id="focused"></button>';
    press(byId('clicked'));
    byId('focused').focus();
    expect(focusReturnTarget()?.id).toBe('focused');
  });

  it('uses the pressed control when Safari moved focus to the page region instead', () => {
    page.innerHTML = '<main id="main" tabindex="-1"><button id="clicked"></button></main>';
    press(byId('clicked'));
    byId('main').focus();
    expect(focusReturnTarget()?.id).toBe('clicked');
  });

  it('falls back to the focused region when the pressed control is gone', () => {
    page.innerHTML = '<main id="main" tabindex="-1"><button id="clicked"></button></main>';
    press(byId('clicked'));
    byId('clicked').remove();
    byId('main').focus();
    expect(focusReturnTarget()?.id).toBe('main');
  });
});
