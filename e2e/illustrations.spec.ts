import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';
import { allThemes } from '../src/domain/theme';

/**
 * 段階10: 挿絵・空の状態・はじめに・今日の画面。
 * 挿絵は飾りなので、名前を持たず（aria-hidden）、焦点も受けず、テーマの色だけで描く。意味は見出しと文が伝える。
 */

/** 挿絵が読み上げにも Tab にも現れないこと。axe（WCAG 2.2 AA）の重大な違反がないこと。 */
async function expectDecorative(page: Page, scope = page.locator('body')) {
  const art = scope.locator('svg.illustration');
  await expect(art.first()).toBeVisible();
  for (const svg of await art.all()) {
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(svg).toHaveAttribute('focusable', 'false');
    expect(await svg.locator('title, desc').count()).toBe(0);
  }
  // 読み上げの木に、画像や名前のない図が出ない。
  const tree = await scope.first().ariaSnapshot();
  expect(tree).not.toMatch(/\b(img|image|graphics-document|graphics-symbol)\b/);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

const emptyStates: Array<[string, string, RegExp | string, string | null]> = [
  ['予定', '/calendar?view=list&scenario=empty', /からの予定はありません$/, 'この月に予定を追加'],
  ['タスク', '/tasks?scenario=empty', 'まだタスクはありません', '最初のタスクを追加'],
  ['全部済んだ（タスク）', '/tasks?scenario=all-done', 'タスクは全部済みました', '完了したタスクを見る'],
  ['メモ', '/notes?scenario=empty', 'まだメモはありません', '最初のメモを書く'],
  ['家計', '/budget?scenario=empty', 'まだ記録がありません', '最初の支出を記録'],
  ['アルバム', '/albums?scenario=empty', '見られるアルバムはまだありません', 'アルバムを作る'],
  ['場所', '/places?scenario=empty', 'まだ場所を記録していません', '支出を追加'],
  ['オフライン', '/today?stage=unreachable', '接続できません', 'もう一度試す'],
  ['全部済んだ（今日）', '/today?scenario=all-done', '今日することは全部済みました', null],
  ['今日（記録なし）', '/today?scenario=empty', '今日の予定やタスクはありません', '予定を追加'],
];

test.describe('ILLUS-1 each empty state has its illustration, its text and one next action', () => {
  for (const [label, route, heading, action] of emptyStates) {
    test(`${label}: ${route}`, async ({ page }) => {
      await page.goto(route);
      const empty = page.locator('.empty').filter({ has: page.getByRole('heading', { name: heading }) });
      await expect(empty).toBeVisible();
      await expect(empty.locator('svg.illustration')).toHaveCount(1);
      if (action) await expect(empty.getByRole('button', { name: action })).toBeVisible();
      else await expect(empty.getByRole('button')).toHaveCount(0);
      await expectDecorative(page, empty);
    });
  }

  test('検索で見つからない: the search palette and a notes search', async ({ page }) => {
    await page.goto('/today');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('Control+K');
    await page.getByRole('searchbox').fill('見つからない言葉');
    const palette = page.getByRole('dialog', { name: '家族の情報を検索' });
    const empty = palette.locator('.empty.compact');
    await expect(empty.getByRole('heading', { name: '一致する情報はありません', level: 3 })).toBeVisible();
    await expectDecorative(page, empty);
    await page.keyboard.press('Escape');
    await page.goto('/notes');
    await page.getByLabel('メモを検索').fill('見つからない言葉');
    await expectDecorative(page, page.locator('.empty').filter({ hasText: '条件に合うメモはありません' }));
  });

  test('エラー: the route error boundary', async ({ page }) => {
    await page.goto('/today');
    await page.route('**/assets/InsightsPage-*.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export function InsightsPage() { throw new Error("injected render failure"); }' }));
    await page.evaluate(() => { window.history.pushState({}, '', '/insights'); window.dispatchEvent(new PopStateEvent('popstate')); });
    const boundary = page.locator('.route-error');
    await expect(boundary.getByRole('heading', { name: 'この画面を表示できませんでした' })).toBeVisible();
    await expect(boundary.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
    await expectDecorative(page, boundary);
  });

  test('はじめに: one scene per step', async ({ page }) => {
    await page.goto('/onboarding');
    for (const [step, heading] of [['1', '家族グループの設定'], ['2', '共有範囲'], ['3', 'ようこそ、よりどころへ']] as const) {
      await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
      await expect(page.locator(`.onboarding-scene[data-step="${step}"] svg.illustration`)).toBeVisible();
      await expectDecorative(page, page.locator('.auth-card'));
      if (step !== '3') await page.getByRole('button', { name: '次へ' }).click();
    }
  });
});

test.describe('ILLUS-2 people who cannot add get no add button', () => {
  for (const [route, heading, action] of [
    ['/tasks?scenario=empty&actor=member-yui', 'まだタスクはありません', '最初のタスクを追加'],
    ['/today?scenario=empty&actor=member-yui', '今日の予定やタスクはありません', '予定を追加'],
    ['/notes?scenario=empty&actor=member-yui', 'まだメモはありません', '最初のメモを書く'],
    ['/albums?scenario=empty&actor=member-yui', '見られるアルバムはまだありません', 'アルバムを作る'],
    ['/calendar?view=list&scenario=empty&actor=member-yui', /からの予定はありません$/, 'この月に予定を追加'],
  ] as const) {
    test(`guest: ${route}`, async ({ page }) => {
      await page.goto(route);
      const empty = page.locator('.empty').filter({ has: page.getByRole('heading', { name: heading }) });
      await expect(empty.locator('svg.illustration')).toBeVisible();
      await expect(empty.getByRole('button', { name: action })).toHaveCount(0);
    });
  }
  test('a child can add a task from the empty state', async ({ page }) => {
    await page.goto('/tasks?scenario=empty&actor=member-hana');
    await expect(page.locator('.empty').getByRole('button', { name: '最初のタスクを追加' })).toBeVisible();
  });
});

test.describe('ILLUS-3 illustrations take every colour from the theme', () => {
  for (const theme of allThemes) {
    test(theme, async ({ page }) => {
      await page.addInitScript((value) => { localStorage.setItem('family-hub-theme', value); localStorage.setItem('family-hub-theme-follow-system', 'false'); }, theme);
      await page.goto('/tasks?scenario=empty');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.empty svg.illustration')).toBeVisible();
      const { used, palette } = await page.evaluate(() => {
        const names = ['--paper', '--paper-deep', '--sheet', '--ink', '--ink-soft', '--ink-faint', '--line', '--line-strong', '--accent', '--accent-strong', '--brand', '--brand-soft', '--moss', '--moss-soft', '--gold', '--info-soft', '--attention', '--attention-soft', '--art-ground'];
        const probe = document.createElement('div');
        document.body.append(probe);
        const palette = Object.fromEntries(names.map((name) => { probe.style.color = `var(${name})`; return [name, getComputedStyle(probe).color]; }));
        probe.remove();
        const used = [...document.querySelectorAll('.empty svg.illustration *')].flatMap((element) => {
          const style = getComputedStyle(element);
          return [style.fill, style.stroke].filter((value) => value !== 'none');
        });
        return { used: [...new Set(used)], palette };
      });
      const values = new Set(Object.values(palette));
      for (const colour of used) expect(values.has(colour), `${theme}: ${colour} is not a theme colour`).toBe(true);
      // 地の色は、昼は一段濃い地、夜は案内の地（暗い穴に見えない）。
      expect(palette['--art-ground']).toBe(theme === 'dusk' || theme.endsWith('-night') ? palette['--info-soft'] : palette['--paper-deep']);
    });
  }
});

/** 今日の画面の欄の並び。読む順（DOM の順）を返す。 */
const blockOrder = (page: Page) => page.locator('.today-block').evaluateAll((blocks) => blocks.map((block) => (block as HTMLElement).dataset.block));

test.describe('ILLUS-4 Today groups the day at each size class', () => {
  test('narrow: one column, the next action first and above the fold, and the season scene adds no height', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/today');
    await expect(page.locator('.today-layout')).toHaveAttribute('data-layout', 'narrow');
    expect(await blockOrder(page)).toEqual(['next', 'timeline', 'due', 'weather', 'budget']);
    const next = await page.locator('[data-block="next"]').boundingBox();
    expect(next!.y + 120).toBeLessThan(844);
    await expect(page.getByRole('link', { name: '次の予定「学校公開」を開く' })).toBeInViewport();
    for (const route of ['/today', '/today?scenario=all-done']) {
      await page.goto(route);
      const head = page.locator('.page-head-copy');
      const withScene = (await head.boundingBox())!.height;
      await page.locator('.season-scene').evaluate((element) => { (element as unknown as HTMLElement).style.display = 'none'; });
      expect(Math.abs((await head.boundingBox())!.height - withScene), route).toBeLessThanOrEqual(1);
    }
  });

  test('medium: the next action and the time strip span, then two columns', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.goto('/today');
    const layout = page.locator('.today-layout');
    await expect(layout).toHaveAttribute('data-layout', 'medium');
    expect((await layout.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(' ')).toHaveLength(2);
    expect(await blockOrder(page)).toEqual(['next', 'timeline', 'due', 'weather', 'budget']);
    await expect(page.locator('.today-span')).toHaveCount(1);
  });

  test('wide: three columns, and no line of text longer than 40em', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/today');
    const layout = page.locator('.today-layout');
    await expect(layout).toHaveAttribute('data-layout', 'wide');
    expect((await layout.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(' ')).toHaveLength(3);
    expect(await blockOrder(page)).toEqual(['next', 'weather', 'timeline', 'due', 'budget']);
    const tooLong = await layout.locator('p').evaluateAll((paragraphs) => paragraphs.filter((p) => p.getBoundingClientRect().width > 40 * parseFloat(getComputedStyle(p).fontSize) + 1).map((p) => p.textContent));
    expect(tooLong).toEqual([]);
  });

  test('every earlier control is still there, with the time strip next to the list', async ({ page }) => {
    await page.goto('/today');
    for (const id of ['today.review.open.todo-form', 'today.next.open.event-school', 'today.calendar.open', 'today.event.open.event-school', 'today.timeline-todo.open.todo-library', 'today.todo.open.todo-library', 'today.budget.open']) {
      await expect(page.locator(`[data-control-id="${id}"]`), id).toBeVisible();
    }
    // 帯は読み上げない（下の一覧が同じ内容を文で伝える）。目盛りは今の範囲の朝6時から。
    await expect(page.locator('.time-strip')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.time-strip-ticks span').first()).toHaveText('6時');
    await expect(page.locator('.time-strip-mark')).toHaveCount(4);
    await expect(page.locator('.time-strip-now')).toBeVisible();
    for (const heading of ['次にすること', '時刻順に確認', '碧さんのタスク', '雨と予定', '未精算の合計']) await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  });

  test('the quick add button never covers the end of the page on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/today');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const fab = (await page.getByRole('button', { name: 'すぐに追加' }).boundingBox())!;
    const last = (await page.locator('.today-block').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(fab.y);
  });
});

test.describe('ILLUS-5 child and guest views of Today hide what they cannot see', () => {
  for (const [actor, name] of [['member-hana', '花'], ['member-yui', '結衣']] as const) {
    test(actor, async ({ page }) => {
      await page.goto(`/today?actor=${actor}`);
      await expect(page.getByRole('heading', { name: `${name}さんのタスク` })).toBeVisible();
      await expect(page.locator('[data-block="budget"]')).toHaveCount(0);
      await expect(page.getByText('未精算の合計')).toHaveCount(0);
      await expect(page.locator('[data-control-id="today.budget.open"]')).toHaveCount(0);
      // 番号は見える欄だけで続けて振る。
      const numbers = await page.locator('.today-layout .section-head .eyebrow').evaluateAll((items) => items.map((item) => item.textContent!.slice(0, 2)));
      expect(numbers).toEqual(['01', '02', '03', '04']);
    });
  }
});

test.describe('ILLUS-6 the season scene follows the household date and keeps still when asked', () => {
  test('each season can be shown, and autumn is the sample date', async ({ page }) => {
    for (const [query, season] of [['', 'autumn'], ['?season=spring', 'spring'], ['?season=summer', 'summer'], ['?season=winter', 'winter']] as const) {
      await page.goto(`/today${query}`);
      const scene = page.locator('.page-head .season-scene');
      await expect(scene).toHaveAttribute('data-season', season);
      await expect(scene).toHaveAttribute('aria-hidden', 'true');
    }
  });
  test('the scene rises for at most 300ms on mount, and not at all with reduced motion', async ({ page }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.goto('/today');
      const [name, duration, iterations] = await page.locator('.season-scene').evaluate((element) => { const style = getComputedStyle(element); return [style.animationName, parseFloat(style.animationDuration), style.animationIterationCount]; });
      if (reducedMotion === 'reduce') expect(name).toBe('none');
      else { expect(name).toBe('scene-rise'); expect(duration).toBeLessThanOrEqual(0.3); expect(iterations).toBe('1'); }
    }
    // この端末の設定（動きを減らす）でも止まる。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => localStorage.setItem('family-hub-reduced-motion', 'true'));
    await page.reload();
    expect(await page.locator('.season-scene').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  });
});
