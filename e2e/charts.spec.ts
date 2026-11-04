import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from './fixtures';

/**
 * 段階11の図表。家計の費目（横棒）、6か月の推移、人ごとの差し引き（中央から左右の棒）、ヒントの日ごとの件数。
 * 円記号はブラウザの Intl 実装で全角（Chromium）と半角（WebKit）が異なるので、比べるときは半角にそろえる。
 */
const plain = (text: string | null) => (text ?? '').replace(/￥/g, '¥').trim();
const chart = (page: Page, name: string) => page.locator(`[data-chart="${name}"]`);
const labels = async (scope: Locator) => (await scope.locator('.chart-label').allTextContents()).map(plain);
/** 棒が伸び終わるのを待つ（伸びる途中の幅を測らない）。 */
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
const width = async (bar: Locator) => { await settled(bar.page()); return (await bar.boundingBox())!.width; };

/** 「表で見る」を開き、表の行を [行の見出し, ...セル] の配列で返す。 */
async function openTable(scope: Locator) {
  const toggle = scope.getByRole('button', { name: '表で見る' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const tableId = await toggle.getAttribute('aria-controls');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const table = scope.page().locator(`[id="${tableId}"]`).getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.locator('caption')).not.toBeEmpty();
  await expect(table.locator('thead th[scope="col"]').first()).toBeVisible();
  return table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.children].map((cell) => (cell.textContent ?? '').replace(/￥/g, '¥').trim())));
}

test.describe('charts', () => {
  test('CHART-1 spending by category: sorted bars with yen and share at the tips, the same numbers in the table, lengths in proportion', async ({ page }) => {
    await page.goto('/budget');
    const spending = chart(page, 'spending-categories');
    await expect(spending.locator('.chart-name')).toHaveText(['食費', '交通', '教育・保育']);
    expect(await labels(spending)).toEqual(['¥5,840（48%）', '¥3,360（28%）', '¥2,860（24%）']);
    // 行はその費目の一覧へのリンクのまま。
    await expect(spending.getByRole('link', { name: /^食費の記録を見る/ })).toHaveAttribute('data-control-id', 'budget.category.open.food');
    const bars = spending.locator('.chart-bar');
    const [food, transport] = [await width(bars.nth(0)), await width(bars.nth(1))];
    expect(Math.abs(transport / food - 3360 / 5840)).toBeLessThan(0.01);
    const rows = await openTable(spending);
    expect(rows).toEqual([['食費', '¥5,840', '48%'], ['交通', '¥3,360', '28%'], ['教育・保育', '¥2,860', '24%']]);
    expect(rows.map(([, amount, share]) => `${amount}（${share}）`)).toEqual(await labels(spending));
  });

  test('CHART-2 six-month trend: zero months as ¥0, the current month marked, table equal to the labels', async ({ page }) => {
    await page.goto('/budget');
    const trend = chart(page, 'trend');
    await expect(trend.getByRole('img')).toHaveAttribute('aria-label', /2026年4月から2026年9月までの、月ごとの支出と収入。9月の支出は[¥￥]12,060/);
    const spending = trend.locator('[data-panel="spending"]');
    const income = trend.locator('[data-panel="income"]');
    await expect(spending.locator('.chart-group-name')).toHaveText(['4月', '5月', '6月', '7月', '8月', '9月今月']);
    await expect(spending.locator('.chart-group[data-marked]')).toHaveCount(1);
    expect(await labels(spending)).toEqual(['¥0', '¥0', '¥0', '¥0', '¥9,800', '¥12,060']);
    expect(await labels(income)).toEqual(['¥0', '¥0', '¥0', '¥0', '¥0', '¥320,000']);
    // 記録のない月は棒を描かず 0 の文字だけ。描いた棒は値に比例する。
    await expect(spending.locator('.chart-bar')).toHaveCount(2);
    const [august, september] = [await width(spending.locator('.chart-bar').nth(0)), await width(spending.locator('.chart-bar').nth(1))];
    expect(Math.abs(august / september - 9800 / 12060)).toBeLessThan(0.01);
    const rows = await openTable(trend);
    expect(rows.map((row) => row[0])).toEqual(['2026年4月', '2026年5月', '2026年6月', '2026年7月', '2026年8月', '2026年9月（今月）']);
    expect(rows.map((row) => row[1])).toEqual(await labels(spending));
    expect(rows.map((row) => row[2])).toEqual(await labels(income));
  });

  test('CHART-2 a window with a single month of records says so instead of drawing an empty axis', async ({ page }) => {
    await page.goto('/budget?month=2026-08');
    const card = page.getByRole('region', { name: '6か月の推移' });
    await expect(card.locator('[data-chart-empty="trend"]')).toHaveText('記録のある月が2か月以上になると、3月から8月までの推移を表示します。');
    await expect(card.locator('svg')).toHaveCount(0);
  });

  test('CHART-3 member balance: diverging bars from zero, labelled 受け取る and 支払う, matching the transfers', async ({ page }) => {
    await page.goto('/budget?view=settlements');
    const balances = chart(page, 'balances');
    await expect(balances.getByRole('img')).toHaveAttribute('aria-label', /^人ごとの差し引き。蓮さんは受け取る [¥￥]250、碧さんは支払う [¥￥]250。$/);
    await expect(balances.locator('.chart-name')).toHaveText(['蓮', '碧']);
    expect(await labels(balances)).toEqual(['受け取る ¥250', '支払う ¥250']);
    // 受け渡しのまとめ（同じ netBalances から作る）と同じ額。
    await expect(page.getByRole('region', { name: '誰が誰に渡せば済むか' })).toContainText('碧さんから蓮さんへ');
    await settled(page);
    const axis = await balances.locator('.chart-axis').first().boundingBox();
    const [receive, pay] = [await balances.locator('.chart-bar').nth(0).boundingBox(), await balances.locator('.chart-bar').nth(1).boundingBox()];
    expect(Math.abs(receive!.x - axis!.x)).toBeLessThan(1.5);
    expect(Math.abs(pay!.x + pay!.width - axis!.x)).toBeLessThan(1.5);
    expect(Math.abs(receive!.width - pay!.width)).toBeLessThan(0.5);
    const rows = await openTable(balances);
    expect(rows).toEqual([['蓮', '受け取る', '¥250'], ['碧', '支払う', '¥250']]);
    expect(rows.map(([, direction, amount]) => `${direction} ${amount}`)).toEqual(await labels(balances));
  });

  test('CHART-4 weekly load in the hints: one group per day for seven days, counts equal to the table', async ({ page }) => {
    await page.goto('/insights');
    const week = chart(page, 'week-load');
    await expect(week.locator('.chart-group')).toHaveCount(7);
    await expect(week.locator('.chart-group-name').first()).toHaveText('9/30（水）今日');
    await expect(week.locator('.chart-series').first()).toHaveText('予定');
    const counts = await labels(week);
    expect(counts).toHaveLength(14);
    const rows = await openTable(week);
    expect(rows[0][0]).toBe('9月30日（水）（今日）');
    expect(rows.flatMap((row) => row.slice(1))).toEqual(counts);
    // 長さは件数に比例する（0件は棒なし）。
    const values = counts.map((text) => Number(text.replace('件', '')));
    const bars = week.locator('.chart-bar');
    await expect(bars).toHaveCount(values.filter((value) => value > 0).length);
    const max = Math.max(...values);
    await settled(page);
    const widths = await bars.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
    const longest = Math.max(...widths);
    expect(widths.map((value) => Math.round((value / longest) * max * 100) / 100)).toEqual(values.filter((value) => value > 0));
    // 振り返りの種類を外すと、その系列も外れる。
    const review = page.getByRole('region', { name: '記録を数えた結果' });
    await review.getByRole('checkbox', { name: 'タスク' }).uncheck();
    await expect(week.locator('.chart-series')).toHaveCount(0);
    await expect(week.locator('.chart-label')).toHaveCount(7);
  });

  test('CHART-5 no pie or donut: the charts draw only rectangles, lines and text', async ({ page }) => {
    for (const route of ['/budget', '/budget?view=settlements', '/insights']) {
      await page.goto(route);
      await expect(page.locator('.chart-svg').first()).toBeVisible();
      const shapes = await page.locator('.chart-svg *').evaluateAll((items) => [...new Set(items.map((item) => item.tagName.toLowerCase()))].sort());
      expect(shapes.filter((tag) => !['g', 'line', 'rect', 'text', 'tspan'].includes(tag)), route).toEqual([]);
      await expect(page.locator('.chart-svg circle, .chart-svg ellipse, .chart-svg path')).toHaveCount(0);
      const arcs = await page.locator('.chart-svg path').evaluateAll((items) => items.map((item) => item.getAttribute('d')).filter((d) => /[Aa]/.test(d ?? '')));
      expect(arcs).toEqual([]);
    }
  });

  test('CHART-6 every chart fits 320px: no horizontal scroll, labels inside the screen and clear of each other', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of ['/budget', '/budget?view=settlements', '/insights']) {
      await page.goto(route);
      await expect(page.locator('.chart svg').first()).toBeVisible();
      for (const toggle of await page.getByRole('button', { name: '表で見る' }).all()) await toggle.click();
      await settled(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(320);
      const problems = await page.locator('.chart').evaluateAll((charts) => charts.flatMap((root) => {
        const boxes = [...root.querySelectorAll('.chart-label, .chart-name, .chart-series, .chart-group-name')].map((item) => ({ text: item.textContent, box: item.getBoundingClientRect() })).filter(({ box }) => box.width > 0);
        const outside = boxes.filter(({ box }) => box.left < 0 || box.right > 320).map(({ text }) => `outside: ${text}`);
        const overlaps = boxes.flatMap((a, index) => boxes.slice(index + 1).filter((b) => a.box.left < b.box.right - 0.5 && b.box.left < a.box.right - 0.5 && a.box.top < b.box.bottom - 0.5 && b.box.top < a.box.bottom - 0.5 ).map((b) => `overlap: ${a.text} / ${b.text}`));
        // 棒の先の値は、棒に重ならない。
        const tips = [...root.querySelectorAll('.chart-track[data-room] svg')].flatMap((svg) => {
          const bar = svg.querySelector('.chart-bar')?.getBoundingClientRect();
          const label = svg.querySelector('.chart-label')?.getBoundingClientRect();
          return bar && label && svg.closest('[data-room]')?.getAttribute('data-room') !== 'none' && label.left < bar.right - 0.5 ? [`label on bar: ${svg.textContent}`] : [];
        });
        return [...outside, ...overlaps, ...tips];
      }));
      expect(problems, route).toEqual([]);
    }
  });

  test('CHART-7 axe finds nothing serious with the tables open', async ({ page }) => {
    for (const route of ['/budget', '/budget?view=settlements', '/insights', '/budget?month=2026-08']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      for (const toggle of await page.getByRole('button', { name: '表で見る' }).all()) await toggle.click();
      const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
      expect(blocking, `${route}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
    }
  });

  test('CHART-8 bars grow for at most 300ms, and not at all with reduced motion', async ({ page }) => {
    await page.goto('/budget');
    const motion = () => page.locator('.chart-mark').first().evaluate((item) => { const style = getComputedStyle(item); return { name: style.animationName, duration: parseFloat(style.animationDuration) * (style.animationDuration.endsWith('ms') ? 1 : 1000) }; });
    const normal = await motion();
    expect(normal.name).toBe('chart-grow');
    expect(normal.duration).toBeGreaterThan(0);
    expect(normal.duration).toBeLessThanOrEqual(300);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    expect((await motion()).name).toBe('none');
  });

  test('CHART-9 charts count only what the viewer may see and what the member filter shows', async ({ page }) => {
    // 碧さんには、蓮さんだけが見られる ¥3,000 の支出が入らない。差し引きもその分を含めない。
    await page.goto('/budget');
    expect((await labels(chart(page, 'trend').locator('[data-panel="spending"]'))).at(-1)).toBe('¥12,060');
    await page.goto('/budget?actor=member-ren');
    expect((await labels(chart(page, 'trend').locator('[data-panel="spending"]'))).at(-1)).toBe('¥15,060');
    await page.goto('/budget?view=settlements&actor=member-ren');
    expect(await labels(chart(page, 'balances'))).toEqual(['受け取る ¥1,250', '支払う ¥1,250']);
    await page.goto('/budget?view=settlements');
    expect(await labels(chart(page, 'balances'))).toEqual(['受け取る ¥250', '支払う ¥250']);

    // 表示する人で絞ると、絞った記録だけを数える。蓮さん本人に関わらない碧さんの給与は、収入の面ごと消える。
    await page.goto('/budget?actor=member-ren');
    const trend = chart(page, 'trend');
    await expect(trend.locator('[data-panel="income"]')).toHaveCount(1);
    await page.getByLabel('表示する人').selectOption({ label: '自分' });
    await expect(trend.locator('[data-panel="income"]')).toHaveCount(0);
    const tile = plain(await page.locator('.metric').first().textContent());
    expect((await labels(trend.locator('[data-panel="spending"]'))).at(-1)).toBe(tile);
    expect(await openTable(trend)).toEqual(expect.not.arrayContaining([expect.arrayContaining(['¥320,000'])]));
    await page.getByLabel('表示する人').selectOption({ label: 'すべて' });

    // 子どもとゲストは家計もヒントも開けず、図表も表も出ない。
    for (const actor of ['member-hana', 'member-yui']) {
      for (const route of ['/budget', '/budget?view=settlements', '/insights']) {
        await page.goto(`${route}${route.includes('?') ? '&' : '?'}actor=${actor}`);
        await expect(page.getByRole('heading', { name: 'このページは表示できません' })).toBeVisible();
        await expect(page.locator('.chart')).toHaveCount(0);
        await expect(page.getByText(/[¥￥]12,060|[¥￥]320,000/)).toHaveCount(0);
      }
    }
  });
});
