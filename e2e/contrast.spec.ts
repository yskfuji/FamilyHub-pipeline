import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { allThemes } from '../src/domain/theme';
import { openedStates, screens, viewports } from './screens';

/**
 * 実際の画面の濃さ（A11-3）。10のテーマ × 撮影一覧のすべての画面と状態で、見えている文字ごとに、
 * 祖先の背景を透明度ごと重ねた実際の背景と比べる。4.5:1、大きな文字（24px 以上、または 18.67px 以上の太字）は 3:1。
 * 比は丸めない。入力欄の値と ::before/::after の文字も測り、::placeholder は別に測る。
 * あわせて axe の color-contrast を走らせ、違反と「確かめられなかった（incomplete）」を失敗にする。
 * 例外は下の名前を付けたものだけ。
 */

/** 背景の画像・グラデーションの例外。[名前, セレクタ, 理由]。 */
const backgroundExceptions = [
  ['select-arrow', '.select', '矢印だけを描く小さなグラデーション（background-size で矢印の大きさに限る）。文字の下には来ない'],
] as const;
/** 写真や動画の上に置く文字。[名前, セレクタ, 理由]。下の写真の代わりに、黒と白の両方の上で測る。 */
const photoExceptions = [
  ['album-tile-badge', '.album-tile-mark, .album-tile-cover, .album-tile-status', 'アルバムの写真の上の印。暗い幕の上にのせ、写真が黒でも白でも比を満たすことを測る'],
  ['media-viewer', '.media-screen', '写真・動画の表示画面の操作。上下の暗い幕の上にのせ、写真が黒でも白でも比を満たすことを測る'],
] as const;
/** axe の incomplete のうち、この確かめで同じ要素を測って合格したときに限って受け入れる理由。 */
const axeIncompleteMeasuredHere: Record<string, string> = {
  shortTextContent: '1文字の印（頭文字・矢印）は axe が測らない。ここで測る',
  nonBmp: '記号の文字は axe が測らない。ここで測る',
  pseudoContent: '::before/::after の飾りがあると axe は背景を決めない。ここで疑似要素ごと測る',
  bgOverlap: '固定の上部・下部などが重なる位置では axe は背景を決めない。ここで祖先の背景を重ねて測る',
  elmPartiallyObscured: '一部が隠れている要素。ここで祖先の背景を重ねて測る',
  elmPartiallyObscuring: '一部を隠している要素。ここで祖先の背景を重ねて測る',
  outsideViewport: '表示領域の外の要素。ここでは位置に関係なく測る',
  fgAlpha: '半透明の文字色。ここで透明度ごと重ねて測る',
  bgGradient: 'グラデーションの上の文字。ここでは色の止まりごとに測る（select の矢印は上の例外）',
};

interface Problem { kind: string; text: string; where: string; ratio: number; required: number; fg: string; bg: string }
interface Measured { problems: Problem[]; checked: number; placeholders: number; disabled: number; photo: string[] }

/** ページの中で測る。祖先の背景を、透明度とグループの不透明度ごと重ねる。 */
async function measure(page: Page): Promise<Measured> {
  return page.evaluate(({ backgroundSelectors, photoSelectors }) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const cache = new Map<string, RGBA>();
    /** どの書き方の色でも [r, g, b, a] にする。 */
    const parse = (value: string): RGBA => {
      const known = cache.get(value);
      if (known) return known;
      let result: RGBA;
      const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+%?))?\)$/.exec(value);
      const rgb = /^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)$/.exec(value);
      const alpha = (text: string | undefined) => text === undefined ? 1 : text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text);
      if (value === 'transparent') result = [0, 0, 0, 0];
      else if (srgb) result = [parseFloat(srgb[1]) * 255, parseFloat(srgb[2]) * 255, parseFloat(srgb[3]) * 255, alpha(srgb[4])];
      else if (rgb) result = [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3]), alpha(rgb[4])];
      else {
        // ほかの書き方（oklab など）は、白と黒の上に塗って読み、透明度も求める。
        const paint = (base: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = base; context.fillRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data; };
        const onBlack = paint('#000'); const onWhite = paint('#fff');
        const a = 1 - (onWhite[0] - onBlack[0]) / 255;
        result = a <= 0 ? [0, 0, 0, 0] : [onBlack[0] / a, onBlack[1] / a, onBlack[2] / a, a];
      }
      cache.set(value, result);
      return result;
    };
    const over = (top: RGBA, below: RGBA): RGBA => {
      const a = top[3] + below[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / a).concat(a) as RGBA;
    };
    const lerp = (from: RGBA, to: RGBA, t: number): RGBA => [0, 1, 2, 3].map((i) => from[i] + (to[i] - from[i]) * t) as RGBA;
    const luminance = (color: RGBA) => {
      const [r, g, b] = color.slice(0, 3).map((value) => { const unit = Math.min(255, Math.max(0, value)) / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const hex = (color: RGBA) => `#${color.slice(0, 3).map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;
    const white: RGBA = [255, 255, 255, 1];
    const black: RGBA = [0, 0, 0, 1];
    const describe = (element: Element) => {
      const parts: string[] = [];
      for (let node: Element | null = element; node && parts.length < 3; node = node.parentElement) parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`);
      return parts.join(' > ');
    };
    const photoMatch = (element: Element) => photoSelectors.find((selector) => element.closest(selector));
    const images = [...document.querySelectorAll('img, video, canvas, picture')].filter((media) => media.getBoundingClientRect().width > 0);

    /** 要素の背景の候補（グラデーションは色の止まりごと）。 */
    function layersOf(element: Element): { colors: RGBA[]; opacity: number; image: boolean } {
      const style = getComputedStyle(element);
      const base = parse(style.backgroundColor);
      const image = style.backgroundImage;
      if (image === 'none' || backgroundSelectors.some((selector) => element.matches(selector))) return { colors: [base], opacity: parseFloat(style.opacity), image: false };
      if (image.includes('url(')) return { colors: [base], opacity: parseFloat(style.opacity), image: true };
      const stops = [...image.matchAll(/(rgba?\([^)]*\)|color\([^)]*\)|transparent)/g)].map(([value]) => over(parse(value), base));
      return { colors: stops.length ? [base, ...stops] : [base], opacity: parseFloat(style.opacity), image: false };
    }

    /**
     * 祖先の背景を根から重ね、文字の色と実際の背景の組を候補ごとに返す。
     * media は文字の下にある写真・動画。それを含まない最初の祖先の下に写真があるとして、写真の色を黒と白の両方で測る。
     */
    function composite(element: Element, text: RGBA, media: Element | undefined): Array<{ fg: RGBA; bg: RGBA }> {
      const chain: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
      const layers = chain.map(layersOf);
      const photoIndex = media ? chain.findIndex((node) => !node.contains(media)) : -1;
      const photo = Boolean(media) || layers.some((layer) => layer.image);
      const results: Array<{ fg: RGBA; bg: RGBA }> = [];
      for (const start of photo ? [white, black] : [white]) {
        // グラデーションのある層だけ候補が増える。
        let paths: RGBA[][] = [[]];
        for (const layer of layers) paths = paths.flatMap((path) => layer.colors.map((color) => [...path, color])).slice(0, 64);
        for (const path of paths) {
          const render = (index: number, beneath: RGBA): [RGBA, RGBA] => {
            const layer = layers[index];
            const base = index === photoIndex ? start : beneath;
            let below = over(path[index], base);
            if (layer.image) below = over(start, below);
            const [bg, fg] = index === layers.length - 1 ? [below, over(text, below)] : render(index + 1, below);
            return [lerp(base, bg, layer.opacity), lerp(base, fg, layer.opacity)];
          };
          const [bg, fg] = render(0, white);
          results.push({ fg, bg });
        }
      }
      return results;
    }

    const problems: Problem[] = [];
    const photoUsed = new Set<string>();
    let checked = 0; let disabled = 0; let placeholders = 0;
    const marks = new WeakMap<Element, boolean>();
    (window as unknown as { __contrastMarks: WeakMap<Element, boolean> }).__contrastMarks = marks;

    const hiddenByClip = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if ((style.overflow !== 'visible' || style.clip !== 'auto' || style.clipPath !== 'none') && box.width <= 1.5 && box.height <= 1.5) return true;
        if (style.clipPath === 'inset(50%)') return true;
      }
      return false;
    };
    const visible = (element: Element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) && !hiddenByClip(element);

    function check(kind: string, element: Element, colorText: string, sample: string, style: CSSStyleDeclaration, rects: DOMRect[]) {
      if (element.closest('[inert]')) return;
      if (element.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]')) { disabled += 1; return; }
      const size = parseFloat(style.fontSize);
      const weight = parseInt(style.fontWeight, 10);
      const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      const media = images.find((item) => !element.contains(item) && !item.contains(element) && rects.some((rect) => { const box = item.getBoundingClientRect(); return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top; }));
      let imageBehind = false;
      for (let node: Element | null = element; node; node = node.parentElement) if (getComputedStyle(node).backgroundImage.includes('url(')) imageBehind = true;
      const pairs = composite(element, parse(colorText), media);
      // 写真が透けて見えるときだけ「写真の上の文字」とする（不透明な面の上なら写真の色は関係ない）。
      const textOverPhoto = (Boolean(media) || imageBehind) && pairs.some((pair) => pair.bg.some((value, index) => Math.abs(value - pairs[0].bg[index]) > 0.5));
      const photo = textOverPhoto ? photoMatch(element) : undefined;
      if (photo) photoUsed.add(photo);
      let worst = Infinity; let worstPair = pairs[0];
      for (const pair of pairs) { const value = ratio(pair.fg, pair.bg); if (value < worst) { worst = value; worstPair = pair; } }
      checked += 1;
      const ok = worst >= required && (!textOverPhoto || Boolean(photo));
      marks.set(element, (marks.get(element) ?? true) && ok);
      if (!ok) problems.push({ kind: textOverPhoto && !photo ? `${kind} over a photo without a named exception` : kind, text: sample.trim().slice(0, 40), where: describe(element), ratio: Math.round(worst * 1000) / 1000, required, fg: hex(worstPair.fg), bg: hex(worstPair.bg) });
    }

    // 文字のノード。
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!text.trim()) continue;
      const element = node.parentElement;
      if (!element || element.closest('script, style, noscript, template, option, title')) continue;
      if (!visible(element)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) continue;
      const style = getComputedStyle(element);
      check('text', element, style.color, text, style, rects);
    }
    // 入力欄の値と、選んでいる項目。
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
      if (!visible(element)) continue;
      const type = element instanceof HTMLInputElement ? element.type : '';
      if (['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      const style = getComputedStyle(element);
      const rects = [element.getBoundingClientRect()];
      const value = element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent ?? '' : element.value;
      if (value.trim()) check('field value', element, style.color, value, style, rects);
      const placeholder = element.getAttribute('placeholder');
      if (!value && placeholder) {
        placeholders += 1;
        check('placeholder', element, getComputedStyle(element, '::placeholder').color, placeholder, style, rects);
      }
    }
    // ::before / ::after の文字。
    for (const element of document.body.querySelectorAll('*')) {
      for (const pseudo of ['::before', '::after'] as const) {
        const style = getComputedStyle(element, pseudo);
        const content = style.content;
        if (!content || content === 'none' || content === 'normal' || !/^["'].*\S.*["']$/.test(content)) continue;
        if (!visible(element)) continue;
        check(`text ${pseudo}`, element, style.color, content.slice(1, -1), style, [element.getBoundingClientRect()]);
      }
    }
    return { problems, checked, placeholders, disabled, photo: [...photoUsed] };
  }, { backgroundSelectors: backgroundExceptions.map(([, selector]) => selector), photoSelectors: photoExceptions.map(([, selector]) => selector) });
}

/** axe の color-contrast。違反は失敗、incomplete は名前を付けた理由で、ここで測って合格した要素だけ受け入れる。 */
async function axeProblems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const problems = results.violations.flatMap((violation) => violation.nodes.map((node) => `axe violation ${node.target.join(' ')}: ${node.failureSummary ?? ''}`));
  for (const result of results.incomplete) {
    for (const node of result.nodes) {
      const reason = String((node.any[0]?.data as { messageKey?: string } | undefined)?.messageKey ?? 'unknown');
      const target = node.target.map(String);
      const measured = await page.evaluate(({ selector, photoSelectors }) => {
        const element = document.querySelector(selector);
        const marks = (window as unknown as { __contrastMarks?: WeakMap<Element, boolean> }).__contrastMarks;
        if (!element || !marks) return { found: Boolean(element), ok: false, photo: false };
        const values = [element, ...element.querySelectorAll('*')].map((item) => marks.get(item)).filter((value) => value !== undefined);
        return { found: true, ok: values.length > 0 && values.every(Boolean), photo: photoSelectors.some((item) => element.closest(item)) };
      }, { selector: target[0], photoSelectors: photoExceptions.map(([, selector]) => selector) });
      const explained = ((reason === 'bgImage' || reason === 'imgNode') && measured.photo && measured.ok)
        || (reason in axeIncompleteMeasuredHere && measured.ok)
        || (!measured.found && reason === 'outsideViewport');
      if (!explained) problems.push(`axe incomplete (${reason}) ${target.join(' ')}: ${measured.found ? 'not measured as passing here' : 'element not found'}`);
    }
  }
  return problems;
}

test.describe.configure({ mode: 'parallel' });
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const pages: Array<{ name: string; route: string; viewport: 'mobile' | 'desktop'; open?: (page: Page) => Promise<void> }> = [
  ...(['mobile', 'desktop'] as const).flatMap((viewport) => screens.map(([name, route]) => ({ name, route, viewport }))),
  ...openedStates.flatMap((state) => state.viewports.filter((viewport) => viewport !== 'tablet').map((viewport) => ({ name: state.name, route: state.route, viewport: viewport as 'mobile' | 'desktop', open: state.open }))),
];
const size = Object.fromEntries(viewports.map(([name, width, height]) => [name, { width, height }]));

for (const theme of allThemes) {
  for (const viewport of ['mobile', 'desktop'] as const) {
    test(`contrast ${theme} ${viewport}`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the render check reads computed colours in Chromium');
      test.setTimeout(600_000);
      await page.setViewportSize(size[viewport]);
      await page.addInitScript((value) => { localStorage.setItem('family-hub-theme', value); localStorage.setItem('family-hub-theme-follow-system', 'false'); }, theme);
      const failures: string[] = [];
      let checked = 0; let placeholders = 0;
      for (const target of pages.filter((item) => item.viewport === viewport)) {
        await page.goto(target.route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        if (target.open) await target.open(page);
        const result = await measure(page);
        checked += result.checked; placeholders += result.placeholders;
        for (const problem of result.problems) failures.push(`${target.name}: ${problem.kind} "${problem.text}" ${problem.where} ${problem.fg} on ${problem.bg} = ${problem.ratio} < ${problem.required}`);
        for (const problem of await axeProblems(page)) failures.push(`${target.name}: ${problem}`);
      }
      test.info().annotations.push({ type: 'measured', description: `${checked} texts, ${placeholders} placeholders` });
      expect(checked).toBeGreaterThan(1000);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
}
