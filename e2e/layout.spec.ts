import AxeBuilder from '@axe-core/playwright';
import { settingsRoutes } from '../src/content/settingsRoutes';
import { allThemes } from '../src/domain/theme';
import { expect, test, type Page } from './fixtures';

/**
 * 段階12: 全画面を同じ体系にそろえる（docs/acceptance/criteria.md の B「操作の大きさ・フォーカス・文字の間隔・文字組み・応答」）。
 * 試験の ID は describe の名前（LAYOUT-*）。
 */

const sizes = {
  narrow: { width: 390, height: 844 },
  // 834px の窓はレールがあり、本文は 600〜1100px（medium）。700px は前の「下のナビと medium」の隙間だった窓。
  medium: { width: 834, height: 1112 },
  'medium-700': { width: 700, height: 900 },
  wide: { width: 1440, height: 1000 },
} as const;
type SizeName = keyof typeof sizes;

/** 主な画面と、設定のすべてのタブ。 */
const routes = [
  '/welcome', '/auth', '/onboarding', '/today', '/calendar', '/calendar?view=week', '/calendar?view=day', '/calendar?view=list', '/calendar?view=list&scenario=empty',
  '/tasks', '/tasks?filter=done', '/notes', '/budget', '/budget?view=list', '/budget?view=members', '/budget?view=settlements',
  '/albums', '/albums/album-sports', '/places', '/insights', ...settingsRoutes, '/showcase', '/showcase/management', '/todayx',
];

/** 重ね表示。open は開いたことを確かめてから戻る。 */
const overlays: Array<{ name: string; route: string; open: (page: Page) => Promise<void> }> = [
  { name: 'task detail', route: '/tasks/todo-form', open: async (page) => { await expect(page.locator('[data-detail-title]')).toBeVisible(); } },
  { name: 'memo detail', route: '/notes/memo-clinic', open: async (page) => { await expect(page.locator('[data-detail-title]')).toBeVisible(); } },
  { name: 'event drawer', route: '/calendar/event-clean', open: async (page) => { await expect(page.locator('.drawer [data-detail-title]')).toBeVisible(); } },
  { name: 'quick add', route: '/today', open: async (page) => {
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('button', { name: '予定', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toBeVisible();
  } },
  { name: 'expense form', route: '/budget', open: async (page) => {
    await page.getByRole('button', { name: '支出を追加' }).click();
    await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toBeVisible();
  } },
  { name: 'search', route: '/today', open: async (page) => {
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('Control+K');
    await page.getByRole('searchbox').fill('学校');
    await expect(page.getByRole('heading', { name: /^アルバム/ })).toBeVisible();
  } },
  { name: 'notifications', route: '/today', open: async (page) => {
    await page.getByRole('button', { name: /通知を確認/ }).click();
    await expect(page.getByRole('heading', { name: '通知', exact: true })).toBeVisible();
  } },
  { name: 'permissions', route: '/settings/household', open: async (page) => {
    await page.getByRole('button', { name: '権限' }).nth(1).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } },
  { name: 'password', route: '/settings/security', open: async (page) => {
    await page.getByRole('button', { name: 'パスワードを変更' }).click();
    await expect(page.getByRole('dialog', { name: 'パスワードを変更' })).toBeVisible();
  } },
  { name: 'settle all', route: '/budget?view=settlements&actor=member-ren', open: async (page) => {
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    await expect(page.getByRole('dialog', { name: 'まとめて精算しますか' })).toBeVisible();
  } },
  { name: 'album edit', route: '/albums/album-sports', open: async (page) => {
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'アルバムを編集' })).toBeVisible();
  } },
];
/** 下のナビの「その他」は narrow だけ。 */
const moreMenu = { name: 'more menu', route: '/budget', open: async (page: Page) => {
  await page.getByRole('button', { name: /^その他/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
} };

const settle = async (page: Page, route: string, size: SizeName) => {
  await page.setViewportSize(sizes[size]);
  await page.goto(route);
  // 開いてすぐの動き（ドロワー・季節の場面・図表）が終わってから測る。
  await page.waitForTimeout(350);
};

/** 操作できる要素のうち、小さすぎるもの。文の中のリンク（WCAG 2.5.8 の例外）と、押せない要素は除く。 */
function undersized(page: Page, scope: string | null) {
  return page.evaluate(({ scope }) => {
    const sizeClass = document.documentElement.dataset.sizeClass ?? 'narrow';
    const touch = sizeClass !== 'wide';
    const min = touch ? 44 : 24;
    const primaryMin = touch ? 48 : 24;
    // 'overlay': いちばん上の重ね表示（ドロワー・シート・ダイアログ・検索）、なければ一覧の横の詳細（wide）。
    const root = scope === 'overlay' ? ([...document.querySelectorAll('[data-modal-root]')].at(-1) ?? document.querySelector('.detail-pane')) : scope ? document.querySelector(scope) : document.body;
    if (!root) return [`scope ${scope} not found`];
    const shown = (element: Element) => {
      if (element.closest('[inert], .sr-only')) return false;
      if (!element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    };
    const problems: string[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex="-1"])')) {
      if (!shown(element) || (element as HTMLButtonElement).disabled) continue;
      if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') {
        const block = element.parentElement;
        // 文の中のリンク: まわりに、リンクのほかの文字がある。
        if (block && (block.textContent ?? '').trim().length > (element.textContent ?? '').trim().length + 1) continue;
      }
      let box = element.getBoundingClientRect();
      if (element.matches('input[type=checkbox], input[type=radio]')) {
        const label = element.closest('label') ?? (element as HTMLInputElement).labels?.[0];
        if (label) box = label.getBoundingClientRect();
      }
      const name = `${element.tagName.toLowerCase()}${element.getAttribute('data-control-id') ? `[${element.getAttribute('data-control-id')}]` : ''} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 24)}"`;
      const need = element.matches('.button.primary, .quick-create') ? primaryMin : min;
      if (box.width < min - 0.5 || box.height < need - 0.5) problems.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)} < ${min}x${need}`);
    }
    return problems;
  }, { scope });
}

/** WCAG 1.4.12 の上書きを当てる（行間 1.5、字間 0.12em、語間 0.16em、段落の後 2em）。 */
const textSpacing = '*, *::before, *::after { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-block-end: 2em !important; }';

/** 文字の切れと重なり。省略記号で切った文字は、同じ文字が title か読み上げの名前にあるときだけ許す。 */
function clippedOrOverlapping(page: Page) {
  return page.evaluate(() => {
    const shown = (element: Element) => !element.closest('[inert], [aria-hidden="true"], .sr-only') && element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    const visuallyHidden = (element: Element) => { const box = element.getBoundingClientRect(); return box.width <= 1 || box.height <= 1 || getComputedStyle(element).clipPath === 'inset(50%)'; };
    const fullTextElsewhere = (element: Element, text: string) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        if ((node.getAttribute('title') ?? '').includes(text) || (node.getAttribute('aria-label') ?? '').includes(text)) return true;
      }
      return false;
    };
    const problems: string[] = [];
    // 切れ: 文字の箱が、はみ出しを隠す祖先（スクロールしない向き）の外へ 2px を超えて出ている。飾り（円や写真）のはみ出しは数えない。
    const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      const owner = node.parentElement;
      const text = node.textContent?.trim() ?? '';
      if (!owner || !text || owner.closest('svg, option') || !shown(owner) || visuallyHidden(owner)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      for (let clip: Element | null = owner; clip && clip !== document.body; clip = clip.parentElement) {
        const style = getComputedStyle(clip);
        const clipX = /hidden|clip/.test(style.overflowX);
        const clipY = /hidden|clip/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        if (visuallyHidden(clip)) break;
        const box = clip.getBoundingClientRect();
        const across = clipX && (rect.left < box.left - 2 || rect.right > box.right + 2);
        const down = clipY && (rect.top < box.top - 2 || rect.bottom > box.bottom + 2);
        if (!across && !down) continue;
        // 省略記号で切った1行（全文は title か名前にある）。外側の箱も同じ文字の長さで比べることになるので、ここで終える。
        if (across && !down && style.textOverflow === 'ellipsis' && fullTextElsewhere(owner, text)) break;
        problems.push(`clipped ${across ? 'across' : 'down'}: "${text.slice(0, 20)}" by ${clip.tagName.toLowerCase()}.${[...clip.classList].join('.')}`);
        break;
      }
    }
    // 文字の箱の重なり。固定・追従する部品（上部・下のナビ・すぐに追加・留まる見出し）の文字は、スクロールで重なるので除く。
    // 回した箱（ようこその見本のカード）の文字は、外接する長方形どうしが重なっても字は重ならないので、重なりの比較から除く（切れは上で測る）。
    const rotated = (element: Element) => { for (let node: Element | null = element; node; node = node.parentElement) { const matrix = getComputedStyle(node).transform; if (matrix.startsWith('matrix(') && Math.abs(Number(matrix.slice(7).split(',')[1])) > 0.001) return true; } return false; };
    const fixedOrSticky = (element: Element) => { for (let node: Element | null = element; node; node = node.parentElement) { const position = getComputedStyle(node).position; if (position === 'fixed' || position === 'sticky') return true; } return false; };
    const clipBox = (element: Element) => {
      let box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const rect = node.getBoundingClientRect();
        box = { left: Math.max(box.left, rect.left), top: Math.max(box.top, rect.top), right: Math.min(box.right, rect.right), bottom: Math.min(box.bottom, rect.bottom) };
      }
      return box;
    };
    const boxes: Array<{ left: number; top: number; right: number; bottom: number; owner: Element; text: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !node.textContent?.trim() || !shown(owner) || owner.closest('svg') || visuallyHidden(owner) || fixedOrSticky(owner) || rotated(owner)) continue;
      const clip = clipBox(owner);
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const box = { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top), right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) };
        if (box.right - box.left > 1 && box.bottom - box.top > 1) boxes.push({ ...box, owner, text: node.textContent.trim().slice(0, 16) });
      }
    }
    boxes.sort((a, b) => a.top - b.top);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length && boxes[j].top < boxes[i].bottom; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        if (a.owner === b.owner) continue;
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // 字の箱（行の高さではなく字面の高さ）が 3px 以下触れるだけのものは、重なりとして数えない。
        if (across > 2 && down > 3) problems.push(`overlap: "${a.text}" and "${b.text}" ${Math.round(across)}x${Math.round(down)}`);
      }
    }
    return [...new Set(problems)];
  });
}

/** 文字組み: 本文 16px、16px の説明文の行間 1.7〜1.8、説明文の幅 40em 以下、UI の文字 12px 以上。 */
function typography(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const body = getComputedStyle(document.body);
    if (body.fontSize !== '16px') problems.push(`body is ${body.fontSize}`);
    const shown = (element: Element) => !element.closest('[inert], .sr-only') && element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) && element.getBoundingClientRect().width > 1;
    for (const paragraph of document.querySelectorAll('p')) {
      if (!shown(paragraph)) continue;
      const style = getComputedStyle(paragraph);
      const size = parseFloat(style.fontSize);
      const leading = parseFloat(style.lineHeight) / size;
      const text = (paragraph.textContent ?? '').trim().slice(0, 20);
      if (size === 16 && (leading < 1.7 || leading > 1.8)) problems.push(`line height ${leading.toFixed(2)}: "${text}"`);
      if (paragraph.getBoundingClientRect().width > 40 * size + 1) problems.push(`measure ${(paragraph.getBoundingClientRect().width / size).toFixed(1)}em: "${text}"`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !node.textContent?.trim() || owner.closest('svg') || !shown(owner)) continue;
      const size = parseFloat(getComputedStyle(owner).fontSize);
      if (size < 12) problems.push(`text ${size}px: "${node.textContent.trim().slice(0, 20)}"`);
    }
    return [...new Set(problems)];
  });
}

test.describe('LAYOUT-1 every operable element is 44px (48px for the main action) on touch layouts and 24px on the desk', () => {
  for (const size of ['narrow', 'medium', 'medium-700', 'wide'] as const) {
    for (const route of routes) {
      test(`${size} ${route}`, async ({ page }) => {
        await settle(page, route, size);
        expect(await undersized(page, null)).toEqual([]);
      });
    }
  }
});

test.describe('LAYOUT-2 targets inside drawers, sheets, dialogs, the search and the more menu', () => {
  for (const size of ['narrow', 'medium', 'wide'] as const) {
    for (const overlay of [...overlays, ...(size === 'narrow' ? [moreMenu] : [])]) {
      test(`${size} ${overlay.name}`, async ({ page }) => {
        await settle(page, overlay.route, size);
        await overlay.open(page);
        await page.waitForTimeout(250);
        expect(await undersized(page, 'overlay')).toEqual([]);
      });
    }
  }
});

test.describe('LAYOUT-3 text spacing (WCAG 1.4.12) neither clips nor overlaps text', () => {
  for (const size of ['narrow', 'medium', 'wide'] as const) {
    for (const route of routes) {
      test(`${size} ${route}`, async ({ page }) => {
        await settle(page, route, size);
        await page.addStyleTag({ content: textSpacing });
        await page.waitForTimeout(100);
        expect(await clippedOrOverlapping(page)).toEqual([]);
      });
    }
  }
});

test.describe('LAYOUT-4 typography on every screen', () => {
  for (const size of ['narrow', 'wide'] as const) {
    for (const route of routes) {
      test(`${size} ${route}`, async ({ page }) => {
        await settle(page, route, size);
        expect(await typography(page)).toEqual([]);
      });
    }
  }

  test('holiday names in the month grid end with an ellipsis at 320px and keep the full name', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/calendar?month=2026-09');
    const names = page.locator('.month-week .day-holiday');
    expect(await names.count()).toBeGreaterThan(0);
    const result = await names.evaluateAll((items) => items.map((item) => {
      const style = getComputedStyle(item);
      const cell = item.closest('.day')!.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      return { text: item.textContent, ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap', inside: box.right <= cell.right + 0.5, title: item.getAttribute('title') };
    }));
    for (const item of result) {
      expect(item.ellipsis, item.text!).toBe(true);
      expect(item.inside, item.text!).toBe(true);
      expect(item.title).toBe(item.text);
    }
  });
});

test.describe('LAYOUT-5 focus is visible and never hidden: overlays, horizontal scrollers and every settings tab', () => {
  /** 今の焦点の問題。輪郭は 2px 以上で、地との比が 3:1 以上。中心が画面と、はみ出しを切る祖先の中にあり、上に別の要素がない。 */
  const focusProblem = (page: Page) => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return null;
    const label = `${active.tagName.toLowerCase()} ${active.getAttribute('data-control-id') ?? (active.textContent ?? '').trim().slice(0, 20)}`;
    if (active.closest('.skip-link')) return { label, problem: null as string | null };
    const box = active.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { label, problem: null };
    const style = getComputedStyle(active);
    const width = parseFloat(style.outlineWidth);
    if (style.outlineStyle === 'none' || width < 2) return { label, problem: `focus ring ${style.outlineStyle} ${style.outlineWidth}` };
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => { const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    let background = 'rgb(255, 255, 255)';
    for (let node = active.parentElement; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor;
      const parts = rgb(value);
      if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0.95)) { background = value; break; }
    }
    const [a, b] = [luminance(rgb(style.outlineColor)), luminance(rgb(background))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    if (ratio < 3) return { label, problem: `focus ring ${style.outlineColor} on ${background} is ${ratio.toFixed(2)}:1` };
    // 見えている部分: 窓（本文の要素では、上部と下のナビ・すぐに追加の分の scroll-padding を除く）と、はみ出しを隠す祖先の重なり。
    // 窓より大きい要素（週の表の日の列など）もあるので、中心ではなく、押せる大きさ（44px か要素の大きさ）が見えていることを求める。
    const padding = active.closest('[data-modal-root], .topbar, .mobile-nav, .rail, .quick-create') ? null : getComputedStyle(document.documentElement);
    let visible = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    const clipTo = (rect: { left: number; top: number; right: number; bottom: number }) => { visible = { left: Math.max(visible.left, rect.left), top: Math.max(visible.top, rect.top), right: Math.min(visible.right, rect.right), bottom: Math.min(visible.bottom, rect.bottom) }; };
    clipTo({ left: 0, top: padding ? parseFloat(padding.scrollPaddingTop) || 0 : 0, right: innerWidth, bottom: innerHeight - (padding ? parseFloat(padding.scrollPaddingBottom) || 0 : 0) });
    for (let node = active.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const parent = getComputedStyle(node);
      if (parent.overflowX === 'visible' && parent.overflowY === 'visible') continue;
      clipTo(node.getBoundingClientRect());
    }
    const shownWidth = visible.right - visible.left;
    const shownHeight = visible.bottom - visible.top;
    if (shownWidth < Math.min(box.width, 44) - 1 || shownHeight < Math.min(box.height, 44) - 1) return { label, problem: `only ${Math.max(0, Math.round(shownWidth))}x${Math.max(0, Math.round(shownHeight))} of ${Math.round(box.width)}x${Math.round(box.height)} is in view` };
    const x = visible.left + shownWidth / 2;
    const y = visible.top + shownHeight / 2;
    // 覆われていない: 見えている部分の中心と、内側に寄せた四隅の5点のどれかで、焦点の要素（かそのラベル）に当たる（WCAG 2.4.11 は「全部が隠れない」）。
    // 小さな要素では5点はほぼ中心に集まる。週の表の日の列のように、上に別の操作（予定）が重なる大きな要素は、空いている所で当たればよい。
    const labels = [...((active as HTMLInputElement).labels ?? [])];
    const inset = Math.min(8, shownWidth / 4, shownHeight / 4);
    const points = [[x, y], [visible.left + inset, visible.top + inset], [visible.right - inset, visible.top + inset], [visible.left + inset, visible.bottom - inset], [visible.right - inset, visible.bottom - inset]];
    const hits = points.map(([px, py]) => document.elementFromPoint(px, py));
    const ours = (hit: Element | null) => !hit || active.contains(hit) || hit.contains(active) || labels.some((item) => item.contains(hit));
    const hit = hits[0];
    if (!hits.some(ours) && hit) return { label, problem: `covered by ${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` };
    return { label, problem: null };
  });

  const walk = async (page: Page, key: string, steps = 60) => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < steps; step += 1) {
      await page.keyboard.press(key);
      const result = await focusProblem(page);
      if (!result) continue;
      if (result.problem) problems.push(`${result.label}: ${result.problem}`);
      if (seen.has(result.label) && step > 8) break;
      seen.add(result.label);
    }
    return { problems, seen: seen.size };
  };

  for (const size of ['narrow', 'wide'] as const) {
    for (const route of settingsRoutes) {
      test(`${size} ${route}`, async ({ page, browserName }) => {
        test.setTimeout(90_000);
        await settle(page, route, size);
        const result = await walk(page, browserName === 'webkit' ? 'Alt+Tab' : 'Tab', 70);
        expect(result.seen).toBeGreaterThan(3);
        expect(result.problems).toEqual([]);
      });
    }
    for (const overlay of [...overlays, ...(size === 'narrow' ? [moreMenu] : [])]) {
      test(`${size} overlay ${overlay.name}`, async ({ page, browserName }) => {
        test.setTimeout(60_000);
        await settle(page, overlay.route, size);
        await overlay.open(page);
        await page.waitForTimeout(250);
        const result = await walk(page, browserName === 'webkit' ? 'Alt+Tab' : 'Tab', 40);
        expect(result.seen).toBeGreaterThan(1);
        expect(result.problems).toEqual([]);
      });
    }
  }

  // 横にスクロールする並び: 設定のタブ（narrow）、予定の週の日の行、表示する人の札。
  for (const [name, route, selector] of [
    ['settings tabs', '/settings/help', '.settings-tabs'],
    ['calendar week days', '/calendar?view=week', 'main'],
    ['albums filter chips', '/albums/album-sports', 'main'],
  ] as const) {
    test(`narrow scroller: ${name}`, async ({ page, browserName }) => {
      test.setTimeout(60_000);
      await settle(page, route, 'narrow');
      await page.locator(selector).first().waitFor();
      const result = await walk(page, browserName === 'webkit' ? 'Alt+Tab' : 'Tab', 60);
      expect(result.seen).toBeGreaterThan(3);
      expect(result.problems).toEqual([]);
    });
  }
});

test.describe('LAYOUT-6 defects found in the screenshots of earlier stages', () => {
  test('each settings tab has its own lede, and the change record explains itself', async ({ page }) => {
    const ledes = new Set<string>();
    for (const route of settingsRoutes) {
      await page.goto(route);
      const lede = (await page.locator('main .page-head .lede').textContent()) ?? '';
      expect(lede.length, route).toBeGreaterThan(10);
      ledes.add(lede);
    }
    expect(ledes.size).toBe(settingsRoutes.length);
    await page.goto('/settings/audit');
    await expect(page.locator('main .page-head .lede')).toContainText('誰がいつ変えたか');
    await expect(page.locator('main .page-head .lede')).toContainText('か月残し');
  });

  test('the persimmon mark stays persimmon in every theme', async ({ page }) => {
    await page.setViewportSize(sizes.wide);
    for (const theme of allThemes) {
      await page.addInitScript((value) => { localStorage.setItem('family-hub-theme', value); localStorage.setItem('family-hub-theme-follow-system', 'false'); }, theme);
      await page.goto('/today');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const [fruit, fill] = await page.locator('.rail .brand-mark path').first().evaluate((path) => [getComputedStyle(path).stroke, getComputedStyle(path).fill]);
      const night = theme === 'dusk' || theme.endsWith('-night');
      expect(fruit, theme).toBe(night ? 'rgb(237, 158, 123)' : 'rgb(168, 70, 47)');
      expect(fill, theme).toBe(night ? 'rgb(84, 51, 41)' : 'rgb(241, 213, 197)');
    }
  });

  test('the marks on the time strip never overlap', async ({ page }) => {
    for (const size of ['narrow', 'medium', 'wide'] as const) {
      await settle(page, '/today', size);
      const boxes = await page.locator('.time-strip-mark').evaluateAll((marks) => marks.map((mark) => { const box = mark.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
      expect(boxes.length).toBe(4);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]; const b = boxes[j];
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
          expect(overlap, `${size}: marks ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  test('an empty calendar list shows the day rows first and the empty state below them', async ({ page }) => {
    await settle(page, '/calendar?view=list&scenario=empty', 'narrow');
    const today = page.locator('.agenda-day').first();
    const empty = page.locator('.calendar-agenda .empty');
    await expect(today).toBeVisible();
    await expect(empty).toBeVisible();
    expect((await empty.boundingBox())!.y).toBeGreaterThan((await today.boundingBox())!.y + (await today.boundingBox())!.height - 1);
  });

  test('a long display name wraps under the season scene, not beside it, and adds no height for the scene', async ({ page }) => {
    await settle(page, '/settings/account', 'narrow');
    await page.getByLabel('名前', { exact: true }).fill('とても長い名前のテスト用の家族の人');
    await page.getByRole('button', { name: '名前を保存' }).click();
    await expect(page.locator('.toast-visible')).toContainText('名前を変更しました');
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: '今日' }).click();
    const heading = page.locator('main .page-head h1');
    await expect(heading).toContainText('とても長い名前');
    const scene = (await page.locator('.season-scene').boundingBox())!;
    const lines = await heading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })); });
    for (const line of lines) {
      const besideScene = line.right > scene.x && line.bottom > scene.y && line.top < scene.y + scene.height;
      expect(besideScene, JSON.stringify(line)).toBe(false);
    }
    // 見出しは全幅で折り返す（場面の幅を空けない）。
    const width = await heading.evaluate((element) => element.getBoundingClientRect().width);
    const head = await page.locator('main .page-head-copy').evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(head - 2);
  });

  test('the bottom nav is shown exactly when the size class is narrow', async ({ page }) => {
    for (const width of [560, 600, 640, 683, 684, 700, 760, 800, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/tasks');
      const sizeClass = await page.evaluate(() => document.documentElement.dataset.sizeClass);
      const bottomNav = await page.locator('.mobile-nav').isVisible();
      const rail = await page.locator('.rail').isVisible();
      expect(bottomNav, `${width}px`).toBe(sizeClass === 'narrow');
      expect(rail, `${width}px`).toBe(sizeClass !== 'narrow');
      const main = await page.locator('#main').evaluate((element) => element.clientWidth);
      if (rail) expect(main, `${width}px`).toBeGreaterThanOrEqual(599);
    }
  });

  test('the unsettled card on the budget overview keeps its own height at the wide size', async ({ page }) => {
    await settle(page, '/budget', 'wide');
    const split = page.locator('.budget-split');
    const [left, right] = await split.evaluate((element) => [...element.children].map((child) => child.getBoundingClientRect().height));
    expect(left).toBeGreaterThan(right + 40);
    expect(await split.evaluate((element) => getComputedStyle(element).alignItems)).toBe('start');
  });

  test('no katakana word breaks across lines on the main screens', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'phrase breaking (word-break: auto-phrase) is a Chromium feature; other engines keep short labels whole with keep-all');
    const problems: string[] = [];
    for (const route of ['/today', '/calendar?view=list', '/tasks', '/notes', '/notes/memo-school', '/budget', '/budget?view=settlements', '/albums', '/albums/album-sports', '/places', '/insights', '/settings/household', '/settings/privacy', '/settings/security']) {
      await settle(page, route, 'narrow');
      problems.push(...await page.evaluate((route) => {
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          const owner = node.parentElement;
          if (!owner || owner.closest('svg, [aria-hidden="true"], .sr-only') || !owner.checkVisibility()) continue;
          for (const match of text.matchAll(/[ァ-ヺー]{3,}/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const tops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
            // 単語が欄の幅より長いときは折り返すしかないので数えない。
            const column = owner.getBoundingClientRect().width;
            if (tops.size > 1 && range.getBoundingClientRect().width < column) found.push(`${route}: "${match[0]}" in "${text.trim().slice(0, 30)}"`);
          }
        }
        return found;
      }, route));
    }
    expect(problems).toEqual([]);
  });
});

test.describe('LAYOUT-7 fail-safe input and response', () => {
  test('amount fields show thousands separators while typing and keep the value', async ({ page }) => {
    await page.goto('/budget');
    await page.getByRole('button', { name: '支出を追加' }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    const amount = dialog.getByLabel('金額（円）');
    await amount.pressSequentially('1234567');
    await expect(amount).toHaveValue('1,234,567');
    await amount.press('Backspace');
    await expect(amount).toHaveValue('123,456');
    await amount.fill('１２，０００円');
    await expect(amount).toHaveValue('12,000');
  });

  test('dates and times are picked, never typed as free text', async ({ page }) => {
    const problems: string[] = [];
    const open = [
      ['/today', async () => { await page.getByRole('button', { name: 'すぐに追加' }).click(); await page.getByRole('button', { name: '予定', exact: true }).click(); }],
      ['/today', async () => { await page.getByRole('button', { name: 'すぐに追加' }).click(); await page.getByRole('button', { name: 'タスク', exact: true }).click(); }],
      ['/budget', async () => { await page.getByRole('button', { name: '支出を追加' }).click(); }],
      ['/budget?view=list&period=custom', async () => undefined],
      ['/notes', async () => { await page.getByRole('button', { name: 'すぐに追加' }).click(); await page.getByRole('button', { name: 'メモ', exact: true }).click(); }],
    ] as const;
    for (const [route, action] of open) {
      await page.goto(route);
      await action();
      problems.push(...await page.evaluate((route) => [...document.querySelectorAll<HTMLInputElement>('input')].filter((input) => {
        const label = [...(input.labels ?? [])].map((item) => item.textContent ?? '').join(' ');
        return !['checkbox', 'radio'].includes(input.type) && /日付|開始|終了|期限|日$|誕生日/.test(label) && !['date', 'datetime-local', 'time', 'month'].includes(input.type);
      }).map((input) => `${route}: ${input.type} ${input.labels?.[0]?.textContent}`), route));
    }
    expect(problems).toEqual([]);
  });

  test('a submitted form disables its submit button until the answer comes, and creates one record from a double press', async ({ page }) => {
    await page.goto('/tasks');
    const before = await page.locator('.task-card').count();
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('button', { name: 'タスク', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    await dialog.getByLabel('タスク名').fill('二度押しの確かめ');
    const submit = dialog.getByRole('button', { name: '追加する' });
    // 同じフレームで2回押す（二度押し）。次のフレームではもう押せない。
    const disabledNextFrame = await submit.evaluate((button) => new Promise<boolean>((resolve) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      requestAnimationFrame(() => resolve((button as HTMLButtonElement).disabled));
    }));
    expect(disabledNextFrame).toBe(true);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.task-card', { hasText: '二度押しの確かめ' })).toHaveCount(1);
    expect(await page.locator('.task-card').count()).toBe(before + 1);
  });
});

test.describe('LAYOUT-9 the unsaved-changes guard also covers the permission dialog in the settings', () => {
  test('a changed role or permission asks before closing, and an untouched dialog closes at once', async ({ page }) => {
    await page.goto('/settings/household');
    const open = async () => {
      await page.getByRole('button', { name: '権限' }).nth(1).click();
      const dialog = page.getByRole('dialog', { name: /さんの権限$/ });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const prompt = page.getByRole('dialog', { name: '入力中の内容を破棄しますか' });
    let dialog = await open();
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    const role = dialog.getByLabel('メンバーの役割');
    const before = await role.inputValue();
    await role.selectOption({ index: before === 'child' ? 1 : 2 });
    await page.keyboard.press('Escape');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: '編集に戻る' }).click();
    await expect(role).not.toHaveValue(before);
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await prompt.getByRole('button', { name: '破棄する' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('LAYOUT-8 axe finds no serious or critical problem on the main screens in every theme', () => {
  for (const theme of allThemes) {
    test(theme, async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((value) => { localStorage.setItem('family-hub-theme', value); localStorage.setItem('family-hub-theme-follow-system', 'false'); }, theme);
      const failures: string[] = [];
      for (const route of ['/today', '/calendar', '/tasks', '/notes', '/budget', '/albums', '/places', '/insights', '/settings/household', '/settings/audit']) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        for (const violation of results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))) failures.push(`${route}: ${violation.id} ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
      }
      expect(failures).toEqual([]);
    });
  }
});
