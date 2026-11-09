import { expect, test, waitForRoute, type Page } from './fixtures';

/**
 * 段階8の枠組み（docs/acceptance/criteria.md の B「フォーカス・動き・応答」と計画 C「画面分割」）。
 * 試験の ID は describe の名前（FRAME-*）。
 */

const sizes = { narrow: { width: 390, height: 844 }, medium: { width: 1280, height: 800 }, wide: { width: 1440, height: 900 } } as const;
type SizeName = keyof typeof sizes;
const sizeClass = (page: Page) => page.evaluate(() => document.documentElement.dataset.sizeClass);

/** 一覧と詳細を持つ画面。[一覧, 詳細の URL, 詳細の見出し, 一覧の項目] */
const details = [
  ['/tasks', '/tasks/todo-form', '就学援助の確認票', /図書館の本を返す/],
  ['/notes', '/notes/memo-clinic', '小児科の控え', /学校公開のお知らせ/],
  ['/budget?view=list', '/budget/expense-books?view=list', '学校教材', /週末の食材/],
  ['/places', '/places/550c29b2', null, null],
] as const;

test.describe('FRAME-1 size classes on #main', () => {
  for (const [name, size] of Object.entries(sizes) as Array<[SizeName, typeof sizes[SizeName]]>) {
    test(`${name}: the class follows the content area and details open the right way`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const [, detail, title] of details) {
        await page.goto(detail);
        expect(await sizeClass(page)).toBe(name);
        const heading = title ? page.locator('[data-detail-title]', { hasText: title }) : page.locator('[data-detail-title]');
        await expect(heading).toBeVisible();
        if (name === 'wide') {
          await expect(page.locator('.detail-pane')).toBeVisible();
          await expect(page.locator('.drawer')).toHaveCount(0);
          await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
        } else {
          const drawer = page.locator('.drawer');
          await expect(drawer).toHaveAttribute('data-presentation', name === 'narrow' ? 'sheet' : 'drawer');
          await expect(page.locator('.detail-pane')).toHaveCount(0);
          const box = await drawer.boundingBox();
          if (name === 'narrow') expect(box!.width).toBeGreaterThanOrEqual(size.width - 1);
          else expect(box!.width).toBeLessThan(size.width * 0.6);
        }
      }
    });

    test(`${name}: a deep link opens the detail and the back button closes it`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const [list, detail] of details.slice(0, 3)) {
        await page.goto(list);
        await page.goto(detail);
        await expect(page.locator('[data-detail-title]')).toBeVisible();
        await page.goBack();
        await waitForRoute(page);
        await expect(page.locator('[data-detail-title]')).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`${list.split('?')[0]}(\\?|$)`));
      }
    });
  }

  test('the class is measured on #main, not the window', async ({ page }) => {
    // 1280px の窓でも、レール（約248px）を除いた本文は 1100px に届かないので medium。
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tasks');
    const main = await page.locator('#main').evaluate((element) => element.clientWidth);
    expect(main).toBeLessThan(1100);
    expect(await sizeClass(page)).toBe('medium');
    await page.setViewportSize({ width: 1400, height: 800 });
    await expect.poll(() => sizeClass(page)).toBe('wide');
    await page.setViewportSize({ width: 560, height: 800 });
    await expect.poll(() => sizeClass(page)).toBe('narrow');
  });

  test('calendar keeps its own day panel and opens events in a drawer at every size', async ({ page }) => {
    for (const size of Object.values(sizes)) {
      await page.setViewportSize(size);
      await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-08');
      await expect(page.locator('.drawer [data-detail-title]')).toBeVisible();
    }
  });
});

test.describe('FRAME-2 view transitions', () => {
  /** startViewTransition を数え、呼ばれたときに名前を持っていた要素を記録する。 */
  const record = async (page: Page) => {
    await page.addInitScript(() => {
      const calls: Array<{ named: string[] }> = [];
      (window as unknown as { __transitions: typeof calls }).__transitions = calls;
      const original = document.startViewTransition?.bind(document);
      if (!original) return;
      document.startViewTransition = ((update: () => void) => {
        calls.push({ named: [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')].map((element) => `${element.style.viewTransitionName}:${element.textContent}`) });
        return original(update);
      }) as typeof document.startViewTransition;
    });
  };
  const calls = (page: Page) => page.evaluate(() => (window as unknown as { __transitions: Array<{ named: string[] }> }).__transitions);
  const supported = (page: Page) => page.evaluate(() => typeof document.startViewTransition === 'function');

  test('a list item shares its title with the detail, and the name is removed afterwards', async ({ page }) => {
    await record(page);
    await page.setViewportSize(sizes.wide);
    await page.goto('/tasks');
    test.skip(!(await supported(page)), 'View Transitions are not available in this browser');
    await page.getByRole('link', { name: /資源ごみをまとめる/ }).click();
    await expect(page.locator('.detail-pane').getByRole('heading', { name: '資源ごみをまとめる' })).toBeVisible();
    expect(await calls(page)).toEqual([{ named: ['detail-title:資源ごみをまとめる'] }]);
    await expect.poll(() => page.locator('[style*="view-transition-name"]').count()).toBe(0);
    // 主なナビでの画面の切り替えも動かす。題名は渡さない。
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'メモ' }).click();
    await expect(page).toHaveURL(/\/notes$/);
    expect((await calls(page)).at(-1)).toEqual({ named: [] });
  });

  test('filters change only the query and switch at once', async ({ page }) => {
    await record(page);
    await page.goto('/tasks');
    await page.getByRole('button', { name: /^完了/ }).click();
    await expect(page).toHaveURL(/filter=done/);
    expect(await calls(page)).toEqual([]);
  });

  test('reduced motion switches at once, from the system and from the app setting', async ({ page }) => {
    await record(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/tasks');
    await page.getByRole('link', { name: /資源ごみをまとめる/ }).click();
    await expect(page.locator('[data-detail-title]')).toHaveText('資源ごみをまとめる');
    expect(await calls(page)).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => localStorage.setItem('family-hub-reduced-motion', 'true'));
    await page.goto('/tasks');
    await page.getByRole('link', { name: /資源ごみをまとめる/ }).click();
    await expect(page.locator('[data-detail-title]')).toHaveText('資源ごみをまとめる');
    expect(await calls(page)).toEqual([]);
  });

  test('drawers and dialogs open with the motion tokens', async ({ page }) => {
    await page.setViewportSize(sizes.medium);
    await page.goto('/tasks/todo-form');
    const drawer = await page.locator('.drawer').evaluate((element) => { const style = getComputedStyle(element); return [style.animationName, style.animationDuration]; });
    expect(drawer).toEqual(['drawer-in', '0.2s']);
    await page.getByRole('button', { name: '内容を編集' }).click();
    const dialog = await page.locator('.dialog').evaluate((element) => { const style = getComputedStyle(element); return [style.animationName, style.animationDuration]; });
    expect(dialog).toEqual(['dialog-in', '0.15s']);
  });
});

test.describe('FRAME-3 error boundaries per route', () => {
  // service worker が部品を取ると page.route を通らないので止める。
  test.use({ serviceWorkers: 'block' });
  /** 端末に残る下書き（未送信の変更）を1件作る。境界の「もう一度読み込む」の後も残ることを確かめるため。 */
  const queueDraft = async (page: Page) => {
    await page.goto('/today?scenario=offline');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('button', { name: '予定', exact: true }).click();
    await page.getByLabel('予定名').fill('境界の後も残る予定');
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByRole('button', { name: /未送信の変更/ })).toContainText('1');
    // ページ全体を読み込み直したら消える印。
    await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true; });
  };
  const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);
  const openInsights = (page: Page) => page.evaluate(() => { window.history.pushState({}, '', '/insights'); window.dispatchEvent(new PopStateEvent('popstate')); });

  test('a screen that fails to render offers to load again or go to Today, and keeps the frame and the drafts', async ({ page }) => {
    await page.route('**/assets/InsightsPage-*.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export function InsightsPage() { throw new Error("injected render failure"); }' }));
    await queueDraft(page);
    await openInsights(page);
    const alert = page.locator('.route-error');
    await expect(alert.getByRole('heading', { name: 'この画面を表示できませんでした' })).toBeVisible();
    await expect(alert).toHaveAttribute('data-route-error', 'render');
    await expect(alert.getByRole('link', { name: '今日へ戻る' })).toHaveAttribute('href', '/today');
    // 枠（上部・ナビ）は残る。
    await expect(page.getByRole('navigation', { name: '主な機能' })).toBeVisible();
    await alert.getByRole('button', { name: 'もう一度読み込む' }).click();
    // 同じ部品のまま描き直すので、また失敗する。ページは読み込み直さず、下書きは残る。
    await expect(alert).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
    await expect(page.getByRole('button', { name: /未送信の変更/ })).toContainText('1');
    await alert.getByRole('link', { name: '今日へ戻る' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
  });

  test('a screen whose files fail to load (for example after a new version) loads again without reloading the page', async ({ page }) => {
    let failing = true;
    await page.route('**/assets/InsightsPage-*.js', (route) => (failing ? route.abort('failed') : route.fallback()));
    await queueDraft(page);
    await openInsights(page);
    const alert = page.locator('.route-error');
    await expect(alert.getByRole('heading', { name: 'この画面を読み込めませんでした' })).toBeVisible();
    await expect(alert).toHaveAttribute('data-route-error', 'load');
    failing = false;
    await alert.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.getByRole('heading', { name: '確認しておきたいこと', level: 1 })).toBeVisible();
    expect(await sameDocument(page)).toBe(true);
    await expect(page.getByRole('button', { name: /未送信の変更/ })).toContainText('1');
  });

  test('a slow screen shows a skeleton of the same height, and after 10 seconds says how long it has taken', async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.clock.install();
    await page.route('**/assets/InsightsPage-*.js', async (route) => { await held; await route.fallback(); });
    await page.goto('/today');
    await page.evaluate(() => { window.history.pushState({}, '', '/insights'); window.dispatchEvent(new PopStateEvent('popstate')); });
    const loading = page.locator('.page-loading');
    await expect(loading).toBeVisible();
    await expect(loading.getByRole('status')).toHaveCount(0);
    await page.clock.runFor(11_000);
    await expect(loading.getByRole('status')).toContainText('読み込みに時間がかかっています');
    release();
    await expect(page.getByRole('heading', { name: '確認しておきたいこと', level: 1 })).toBeVisible();
    await expect(loading).toHaveCount(0);
  });
});

test.describe('FRAME-4 unsaved changes on every close path', () => {
  const prompt = (page: Page) => page.getByRole('dialog', { name: '入力中の内容を破棄しますか' });
  type Opened = { form: ReturnType<Page['getByRole']>; field: ReturnType<Page['getByRole']> };
  const forms: Array<[string, string, (page: Page) => Promise<Opened>]> = [
    ['album edit', '/albums', async (page) => {
      await page.getByRole('link', { name: /運動会/ }).click();
      await page.getByRole('button', { name: '編集', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'アルバムを編集' });
      return { form, field: form.getByLabel('アルバム名') };
    }],
    ['colour list', '/settings/household', async (page) => {
      await page.getByRole('button', { name: 'リストを追加' }).click();
      const form = page.getByRole('dialog', { name: 'リストを追加' });
      return { form, field: form.getByLabel('名前') };
    }],
    ['password', '/settings/security', async (page) => {
      await page.getByRole('button', { name: 'パスワードを変更' }).click();
      const form = page.getByRole('dialog', { name: 'パスワードを変更' });
      return { form, field: form.getByLabel('現在のパスワード') };
    }],
  ];
  const paths: Array<[string, (page: Page, opened: Opened) => Promise<void>]> = [
    ['Escape', async (page) => { await page.keyboard.press('Escape'); }],
    ['backdrop', async (page) => { await page.mouse.click(4, 4); }],
    ['close button', async (_page, opened) => { await opened.form.getByRole('button', { name: '閉じる' }).click(); }],
    ['cancel button', async (_page, opened) => { await opened.form.getByRole('button', { name: 'キャンセル' }).click(); }],
    ['browser back', async (page) => { await page.goBack(); }],
  ];
  for (const [formName, start, open] of forms) {
    for (const [pathName, close] of paths) {
      test(`${formName}: ${pathName} asks, staying keeps the text, discarding closes`, async ({ page }) => {
        // 戻るがアプリの中の移動になるよう、今日の画面からアプリの中で移る。
        await page.goto('/today');
        await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, start);
        await waitForRoute(page);
        const opened = await open(page);
        await opened.field.fill('まだ保存していない入力の値');
        await close(page, opened);
        await expect(prompt(page)).toBeVisible();
        await prompt(page).getByRole('button', { name: '編集に戻る' }).click();
        await expect(prompt(page)).toHaveCount(0);
        await expect(opened.field).toHaveValue('まだ保存していない入力の値');
        await close(page, opened);
        await prompt(page).getByRole('button', { name: '破棄する' }).click();
        await expect(opened.form).toHaveCount(0);
      });
    }
  }

  test('a changed household name asks before moving to another screen', async ({ page }) => {
    await page.goto('/settings/household');
    await page.getByLabel('名前', { exact: true }).first().fill('新しい名前の候補');
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'メモ' }).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole('button', { name: '編集に戻る' }).click();
    await expect(page).toHaveURL(/\/settings\/household/);
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'メモ' }).click();
    await prompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page).toHaveURL(/\/notes$/);
  });

  test('an untouched form closes from the detail pane without asking', async ({ page }) => {
    await page.setViewportSize(sizes.wide);
    await page.goto('/tasks/todo-form');
    await page.locator('.detail-pane').getByRole('button', { name: '閉じる' }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks$/);
  });
});

test.describe('FRAME-5 idle warning in night themes', () => {
  for (const theme of ['dusk', 'matcha-night', 'sakura-night', 'warm-night', 'modern-night', 'light']) {
    test(`the idle card uses the raised sheet in ${theme}`, async ({ page }) => {
      await page.clock.install();
      await page.goto('/today');
      await page.evaluate((value) => localStorage.setItem('family-hub-theme', value), theme);
      await page.reload();
      await page.clock.runFor('29:30');
      const card = page.locator('.idle-card');
      await expect(card).toBeVisible();
      const [background, raised] = await card.evaluate((element) => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--sheet-raised)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [getComputedStyle(element).backgroundColor, expected];
      });
      expect(background).toBe(raised);
      const channels = background.match(/\d+/g)!.slice(0, 3).map(Number);
      const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
      if (theme === 'light') expect(luminance).toBeGreaterThan(0.9);
      else expect(luminance, `${theme} idle card ${background}`).toBeLessThan(0.35);
    });
  }
});

test.describe('FRAME-6 focus is never hidden behind the fixed bars', () => {
  const routes = ['/today', '/calendar', '/tasks', '/notes', '/budget', '/albums', '/places', '/insights', '/settings/household'];
  for (const [name, size] of [['narrow', sizes.narrow], ['wide', sizes.wide]] as const) {
    for (const route of routes) {
      test(`${name} ${route}: every focused control is outside the top bar, bottom nav and quick add, with a 2px focus ring`, async ({ page, browserName }) => {
        test.setTimeout(90_000);
        await page.setViewportSize(size);
        await page.goto(route);
        const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
        const problems: string[] = [];
        const seen = new Set<string>();
        for (let step = 0; step < 70; step += 1) {
          await page.keyboard.press(key);
          const result = await page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active || active === document.body) return null;
            const label = `${active.tagName.toLowerCase()} ${active.getAttribute('data-control-id') ?? active.textContent?.trim().slice(0, 20) ?? ''}`;
            if (active.closest('.topbar, .mobile-nav, .rail, .quick-create, [data-modal-root], .skip-link')) return { label, problem: null as string | null };
            const box = active.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return { label, problem: null };
            const style = getComputedStyle(active);
            const ring = parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none';
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            const covering = [...document.querySelectorAll<HTMLElement>('.topbar, .mobile-nav, .quick-create[data-placement="floating"]')].filter((bar) => {
              const rect = bar.getBoundingClientRect();
              return getComputedStyle(bar).display !== 'none' && rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            }).map((bar) => bar.className.split(' ').at(-1));
            return { label, problem: covering.length ? `covered by ${covering.join(', ')}` : ring ? null : `focus ring ${style.outlineStyle} ${style.outlineWidth}` };
          });
          if (!result) continue;
          if (result.problem) problems.push(`${result.label}: ${result.problem}`);
          if (seen.has(result.label) && step > 10) break;
          seen.add(result.label);
        }
        expect(seen.size).toBeGreaterThan(3);
        expect(problems).toEqual([]);
      });
    }
  }
});

test.describe('FRAME-7 a press shows on the next frame', () => {
  test('buttons, links in the nav and list items change as soon as they are pressed', async ({ page }) => {
    await page.setViewportSize(sizes.wide);
    await page.goto('/tasks');
    for (const selector of ['.page-head .button.primary', '.segmented button[aria-pressed="false"]', '.rail .nav-link:not([aria-current])', '.task-card-link']) {
      const target = page.locator(selector).first();
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // 指を乗せたときの動きが終わってから比べる（押したことによる変化だけを見る）。
      await page.waitForTimeout(400);
      const before = await target.evaluate((element) => { const style = getComputedStyle(element); return `${style.transform}|${style.backgroundColor}`; });
      // 押した直後の最初の requestAnimationFrame（次に描くフレームの直前）で、見た目がもう変わっていること。
      await target.evaluate((element) => {
        (window as unknown as { __pressed: Promise<string> }).__pressed = new Promise((resolve) => element.addEventListener('pointerdown', () => requestAnimationFrame(() => { const style = getComputedStyle(element); resolve(`${style.transform}|${style.backgroundColor}`); }), { once: true }));
      });
      await page.mouse.down();
      const after = await page.evaluate(() => (window as unknown as { __pressed: Promise<string> }).__pressed);
      await page.mouse.up();
      expect(after, selector).not.toBe(before);
      await page.goto('/tasks');
    }
  });
});
