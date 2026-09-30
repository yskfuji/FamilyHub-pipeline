import { useEffect } from 'react';

type Risk = 'navigation' | 'reversible' | 'high-impact';

function slug(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 72) || 'unnamed';
}

function readableName(element: HTMLElement) {
  return element.getAttribute('aria-label')
    || element.getAttribute('title')
    || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : '')
    || element.textContent
    || element.getAttribute('name')
    || element.id;
}

function riskFor(name: string): Risk {
  if (/削除|失効|終了|変更|精算|停止/.test(name)) return 'high-impact';
  if (/保存|追加|作成|送信|延期|既読|戻す|再開/.test(name)) return 'reversible';
  return 'navigation';
}

export function registerControls(root: ParentNode = document) {
  const route = slug(window.location.pathname.replace(/^\//, '') || 'welcome');
  const controls = [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')];
  const duplicates = new Map<string, number>();
  for (const element of controls) {
    if (element.dataset.controlId) continue;
    const name = readableName(element).trim();
    if (!name) continue;
    const modal = element.closest<HTMLElement>('[role="dialog"]');
    const context = modal ? slug(modal.getAttribute('aria-label') || document.getElementById(modal.getAttribute('aria-labelledby') ?? '')?.textContent || 'dialog') : 'page';
    const base = `${route}.${context}.${slug(name)}`;
    const occurrence = (duplicates.get(base) ?? 0) + 1;
    duplicates.set(base, occurrence);
    element.dataset.controlId = occurrence === 1 ? base : `${base}.${occurrence}`;
    element.dataset.controlRisk = riskFor(name);
  }
}

export function useControlRegistry() {
  useEffect(() => {
    const update = () => registerControls();
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', update);
    return () => { observer.disconnect(); window.removeEventListener('popstate', update); };
  }, []);
}
