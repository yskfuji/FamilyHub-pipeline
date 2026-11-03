import { expect, test, type Page } from '@playwright/test';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'すぐに追加' });
const openCreate = async (page: Page) => {
  await page.getByRole('button', { name: '予定を追加', exact: true }).click();
  await expect(dialog(page).getByLabel('予定名')).toBeVisible();
  return dialog(page);
};
const addEvent = async (page: Page) => {
  await dialog(page).getByRole('button', { name: '追加する' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.toast-visible')).toContainText('予定を追加しました');
};
const addAllDay = async (page: Page, title: string, from: string, to: string) => {
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill(title);
  await form.getByLabel('終日').check();
  await form.getByLabel('開始日').fill(from);
  await form.getByLabel('終了日').fill(to);
  await addEvent(page);
};
const dayCell = (page: Page, date: string) => page.locator(`[data-control-id="calendar.day.${date}"]`);
const agendaRows = (page: Page, month: string, title: string) => page.locator(`.agenda-day[data-date^="${month}"] .list-row`).filter({ hasText: title });

test('day view shows the selected date, moves by day and is remembered on the device', async ({ page }) => {
  await page.goto('/calendar');
  await dayCell(page, '2026-09-15').click();
  await expect(page.getByRole('heading', { name: '9月15日(火)' })).toBeVisible();
  await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page).toHaveURL(/on=2026-09-15/);
  await expect(page.getByLabel('9月15日(火)の予定', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '翌日' }).click();
  await expect(page.getByLabel('9月16日(水)の予定', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '今日', exact: true }).click();
  const timeline = page.getByLabel('9月30日(水)の予定', { exact: true });
  await expect(timeline.getByRole('button', { name: /学校公開を開く/ })).toBeVisible();
  await expect(timeline.locator('.timeline-now')).toBeVisible();
  await page.goto('/calendar');
  await expect(page.getByRole('button', { name: '日', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/calendar?view=week');
  await expect(page.getByRole('button', { name: '週', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('clicking empty space on the timeline opens create at that 30-minute slot', async ({ page }) => {
  await page.goto('/calendar?view=day&on=2026-10-05');
  const column = page.locator('.timeline-day[data-date="2026-10-05"]');
  await expect(column).toBeVisible();
  const hour = (await column.boundingBox())!.height / 24;
  await column.locator('.timeline-add').click({ position: { x: 40, y: hour * 14.6 } });
  const form = dialog(page);
  await expect(form.getByLabel('開始', { exact: true })).toHaveValue('2026-10-05T14:30');
  await expect(form.getByLabel('終了', { exact: true })).toHaveValue('2026-10-05T15:30');
  await form.getByLabel('予定名').fill('面談');
  await addEvent(page);
  await expect(column.getByRole('button', { name: /14:30〜15:30 面談を開く/ })).toBeVisible();
});

test('the keyboard reaches the timeline and opens a morning slot', async ({ page }) => {
  await page.goto('/calendar?view=day&on=2026-10-05');
  await page.getByRole('button', { name: '10月5日(月)に予定を追加' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByLabel('開始', { exact: true })).toHaveValue('2026-10-05T09:00');
});

test('week view places overlapping events side by side and keeps all-day events above the hours', async ({ page }) => {
  await page.goto('/calendar?view=week&on=2026-10-06');
  for (const [title, start, end] of [['保護者会', '2026-10-06T13:00', '2026-10-06T14:00'], ['通院', '2026-10-06T13:30', '2026-10-06T14:30']]) {
    const form = await openCreate(page);
    await form.getByLabel('予定名').fill(title);
    await form.getByLabel('開始', { exact: true }).fill(start);
    await form.getByLabel('終了', { exact: true }).fill(end);
    await addEvent(page);
  }
  const first = await page.locator('.timeline-block').filter({ hasText: '保護者会' }).boundingBox();
  const second = await page.locator('.timeline-block').filter({ hasText: '通院' }).boundingBox();
  expect(second!.x).toBeGreaterThan(first!.x);
  expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x + 1);
  await addAllDay(page, '運動会', '2026-10-07', '2026-10-07');
  await expect(page.locator('.timeline-ribbon').getByText('運動会')).toBeVisible();
});

test('month ribbons share lanes, mark continuation and report overflow', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  await addAllDay(page, '修学旅行', '2026-10-06', '2026-10-13');
  const ribbon = page.locator('.calendar-ribbon').filter({ hasText: '修学旅行' });
  await expect(ribbon).toHaveCount(2);
  await expect(ribbon.first()).toHaveAttribute('data-after', 'true');
  await expect(ribbon.last()).toHaveAttribute('data-before', 'true');
  await expect(dayCell(page, '2026-10-09')).toHaveAccessibleName(/予定1件/);
  for (const title of ['遠足', '参観', '面談', '受診']) await addAllDay(page, title, '2026-10-07', '2026-10-07');
  await expect(page.locator('.calendar-more')).toContainText('+2');
  await dayCell(page, '2026-10-07').click();
  const panel = page.locator('.calendar-day-panel');
  await expect(panel.getByRole('button', { name: /を開く/ })).toHaveCount(5);
  await expect(panel.getByText('終日').first()).toBeVisible();
});

test('holiday names and day colors appear on the grid', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  await expect(dayCell(page, '2026-10-12').locator('.day-holiday')).toHaveText('スポーツの日');
  await expect(dayCell(page, '2026-10-12')).toHaveAttribute('data-tone', 'holiday');
  await expect(dayCell(page, '2026-10-04')).toHaveAttribute('data-tone', 'holiday');
  await expect(dayCell(page, '2026-10-10')).toHaveAttribute('data-tone', 'saturday');
  await expect(dayCell(page, '2026-10-12')).toHaveAccessibleName(/スポーツの日/);
  await page.goto('/calendar?month=2026-01');
  await expect(dayCell(page, '2026-01-01').locator('.day-holiday')).toHaveText('元日');
});

test('expense marks and the expense list only reach viewers who can read expenses', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.locator('.day-yen').first()).toBeVisible();
  await page.locator('.day:has(.day-yen)').first().click();
  await expect(page.locator('.calendar-day-panel').getByRole('heading', { name: '家計' })).toBeVisible();
  await page.goto('/calendar?actor=member-hana');
  await expect(dayCell(page, '2026-09-30')).toBeVisible();
  await expect(page.locator('.day-yen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '家計' })).toHaveCount(0);
});

test('a task is completed from the day panel and a reviewed task asks for review instead', async ({ page }) => {
  await page.goto('/calendar');
  const panel = page.locator('.calendar-day-panel');
  await panel.getByRole('button', { name: '「図書館の本を返す」を完了にする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('完了にしました');
  await expect(panel.getByRole('button', { name: '「図書館の本を返す」を完了にする' })).toHaveCount(0);
  await expect(panel.locator('.day-task[data-done]').getByRole('link', { name: '図書館の本を返す' })).toBeVisible();
  await page.goto('/calendar?actor=member-hana');
  await page.locator('.calendar-day-panel').getByRole('button', { name: '「音読の記録」の確認を依頼する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('確認を依頼しました');
});

test('a recurring event is created from the form and repeats until its end date', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill('英会話');
  await form.getByLabel('開始', { exact: true }).fill('2026-10-05T17:00');
  await form.getByLabel('繰り返し', { exact: true }).selectOption('weekly');
  await form.getByLabel('繰り返しの終了日（任意）').fill('2026-10-19');
  await addEvent(page);
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(agendaRows(page, '2026-10', '英会話')).toHaveCount(3);
  await page.getByRole('button', { name: '英会話を開く' }).first().click();
  await expect(page.getByRole('dialog', { name: '英会話' }).getByText('毎週月曜・10月19日まで')).toBeVisible();
});

test('every N days checks its range, and the rule can be changed for the whole series only', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill('水やり');
  await form.getByLabel('開始', { exact: true }).fill('2026-10-01T07:00');
  await form.getByLabel('繰り返し', { exact: true }).selectOption('every-n-days');
  await form.getByLabel('何日ごと').fill('400');
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(form.getByRole('alert')).toContainText('366日');
  await form.getByLabel('何日ごと').fill('10');
  await addEvent(page);
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(agendaRows(page, '2026-10', '水やり')).toHaveCount(4);
  await page.getByRole('button', { name: '水やりを開く' }).first().click();
  const drawer = page.getByRole('dialog', { name: '水やり' });
  await expect(drawer.getByText('10日ごと')).toBeVisible();
  await drawer.getByRole('button', { name: '編集する' }).click();
  await expect(page.getByText('繰り返しの変更は、対象を「すべての予定」にすると行えます。')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await drawer.getByLabel('対象とする予定').selectOption('series');
  await drawer.getByRole('button', { name: '編集する' }).click();
  await page.getByRole('dialog', { name: '予定を編集' }).getByLabel('繰り返し', { exact: true }).selectOption('daily');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(agendaRows(page, '2026-10', '水やり')).toHaveCount(31);
});

test('the month-end rule lands on the last day of every month', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill('家賃の振込');
  await form.getByLabel('開始', { exact: true }).fill('2026-10-31T10:00');
  await form.getByLabel('繰り返し', { exact: true }).selectOption('month-end');
  await addEvent(page);
  await expect(dayCell(page, '2026-10-31')).toHaveAccessibleName(/予定1件/);
  await page.getByRole('button', { name: '次月' }).click();
  await expect(dayCell(page, '2026-11-30')).toHaveAccessibleName(/予定1件/);
  await expect(dayCell(page, '2026-11-29')).toHaveAccessibleName(/予定0件/);
  await page.goto('/calendar?month=2026-10');
  await expect(page.getByRole('button', { name: '次月' })).toBeVisible();
});

test('the audience is chosen in the form, picked members are limited, and "household" is not called everyone', async ({ page }) => {
  await page.goto('/calendar');
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill('サプライズの相談');
  const audience = form.getByLabel('公開範囲');
  await expect(audience.locator('option')).toHaveText(['大人のメンバーと関わる人', '大人のメンバー', '参加者', '作成した本人', '選択したメンバー']);
  await audience.selectOption('household');
  await expect(form.getByText('管理者と大人のメンバー、この予定に関わる人に表示します。')).toBeVisible();
  await expect(form.getByText('家族全員')).toHaveCount(0);
  await audience.selectOption('selected');
  const picker = form.getByRole('group', { name: /公開するメンバー/ });
  await expect(picker).toContainText('8人まで');
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(form.getByRole('alert')).toContainText('公開する人を1人以上');
  await picker.getByLabel('蓮').check();
  await addEvent(page);
  await page.locator('.calendar-day-panel').getByRole('button', { name: 'サプライズの相談を開く' }).click();
  await expect(page.getByRole('dialog', { name: 'サプライズの相談' }).getByRole('heading', { name: '公開範囲' }).locator('xpath=following-sibling::p[1]')).toHaveText('蓮');
});

test('a child sees fewer audiences and can still fix a title without changing the audience', async ({ page }) => {
  await page.goto('/calendar?actor=member-hana');
  const form = await openCreate(page);
  await expect(form.getByLabel('公開範囲').locator('option')).toHaveText(['参加者', '作成した本人', '選択したメンバー']);
  await form.getByLabel('予定名').fill('友だちと公園');
  await addEvent(page);
  await page.locator('.calendar-day-panel').getByRole('button', { name: '友だちと公園を開く' }).click();
  await page.getByRole('dialog', { name: '友だちと公園' }).getByRole('button', { name: '編集する' }).click();
  await page.getByRole('dialog', { name: '予定を編集' }).getByLabel('予定名').fill('友だちと図書館');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('友だちと図書館');
});

test('all-day, list and reminder round-trip through the form and can be cleared', async ({ page }) => {
  await page.goto('/calendar');
  const form = await openCreate(page);
  await form.getByLabel('予定名').fill('遠足');
  await form.getByLabel('場所（任意）').fill('動物園');
  await form.getByLabel('終日').check();
  await form.getByLabel('学校', { exact: true }).check();
  await form.getByLabel('通知').selectOption('1440');
  await addEvent(page);
  await page.locator('.calendar-day-panel').getByRole('button', { name: '遠足を開く' }).click();
  const drawer = page.getByRole('dialog', { name: '遠足' });
  await expect(drawer.getByText('9月30日(水)（終日）')).toBeVisible();
  await expect(drawer.getByText('1日前')).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'リスト' })).toBeVisible();
  await drawer.getByRole('button', { name: '編集する' }).click();
  const edit = page.getByRole('dialog', { name: '予定を編集' });
  await expect(edit.getByLabel('終日')).toBeChecked();
  await edit.getByLabel('場所（任意）').fill('');
  await edit.getByLabel('なし', { exact: true }).check();
  await edit.getByLabel('通知').selectOption('');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await expect(drawer.getByText('1日前')).toHaveCount(0);
  await expect(drawer.getByRole('heading', { name: 'リスト' })).toHaveCount(0);
  await expect(drawer.getByRole('heading', { name: '場所' }).locator('xpath=following-sibling::p[1]')).toHaveText('未設定');
});

test('a past event fills the form in one click and keeps the chosen date', async ({ page }) => {
  await page.goto('/calendar');
  let form = await openCreate(page);
  await expect(form.getByRole('group', { name: '過去の予定から入力' })).toHaveCount(0);
  await form.getByLabel('予定名').fill('耳鼻科');
  await form.getByLabel('開始', { exact: true }).fill('2026-09-01T15:30');
  await form.getByLabel('終了', { exact: true }).fill('2026-09-01T16:15');
  await form.getByLabel('場所（任意）').fill('こもれび医院');
  await addEvent(page);
  form = await openCreate(page);
  await form.getByRole('button', { name: '「耳鼻科」の内容を入れる' }).click();
  await expect(form.getByLabel('予定名')).toHaveValue('耳鼻科');
  await expect(form.getByLabel('場所（任意）')).toHaveValue('こもれび医院');
  await expect(form.getByLabel('開始', { exact: true })).toHaveValue('2026-09-30T15:30');
  await expect(form.getByLabel('終了', { exact: true })).toHaveValue('2026-09-30T16:15');
});

test('the delete action is hidden from a viewer who is not part of the event', async ({ page }) => {
  await page.goto('/calendar/event-park');
  const drawer = page.getByRole('dialog', { name: '週末の公園' });
  await expect(drawer.getByRole('button', { name: '予定を削除' })).toBeVisible();
  await drawer.getByRole('button', { name: '編集する' }).click();
  await page.getByRole('dialog', { name: '予定を編集' }).getByRole('group', { name: '参加者' }).getByLabel('碧').uncheck();
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await expect(drawer.getByRole('button', { name: '編集する' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '予定を削除' })).toHaveCount(0);
});

test('this-and-following delete can be undone', async ({ page }) => {
  await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-15');
  const drawer = page.getByRole('dialog', { name: '資源回収' });
  await drawer.getByLabel('対象とする予定').selectOption('future');
  await drawer.getByRole('button', { name: '予定を削除' }).click();
  await page.getByRole('dialog', { name: '予定を削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(agendaRows(page, '2026-10', '資源回収')).toHaveCount(2);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(agendaRows(page, '2026-10', '資源回収')).toHaveCount(5);
});

test('the list keeps sticky date headings and loads more days as it scrolls', async ({ page }) => {
  await page.goto('/calendar?view=list');
  const headings = page.locator('.agenda-heading');
  await expect(headings.first()).toBeVisible();
  await expect(page.locator('.agenda-day[data-date^="2026-11"]').first()).toBeVisible();
  const before = await headings.count();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(() => headings.count()).toBeGreaterThan(before);
  await expect(headings.first()).toHaveCSS('position', 'sticky');
});

test.describe('narrow width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('months continue down the page with a sticky header and a day sheet', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: '2026年9月', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '2026年10月', exact: true })).toBeVisible();
    await expect(page.locator('.month-sticky').first()).toHaveCSS('position', 'sticky');
    const toBottom = () => page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await toBottom();
    await expect(page.getByRole('heading', { name: '2026年12月', exact: true })).toBeVisible();
    await toBottom();
    await expect(page.getByRole('heading', { name: '2027年1月', exact: true })).toBeVisible();
    await page.getByRole('heading', { name: '2026年12月', exact: true }).scrollIntoViewIfNeeded();
    const top = await page.evaluate(() => window.scrollY);
    await dayCell(page, '2026-12-02').click();
    const sheet = page.locator('.calendar-day-sheet');
    await expect(sheet.getByRole('heading', { name: '12月2日(水)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'すぐに追加' })).toBeHidden();
    await page.waitForTimeout(100);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - top)).toBeLessThan(400);
    await sheet.getByRole('button', { name: '日の一覧を閉じる' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'すぐに追加' })).toBeVisible();
  });

  test('the month buttons jump within the continuous months', async ({ page }) => {
    await page.goto('/calendar');
    // 続く月の一覧が出てから押す（画面の本文は分けて読む）。
    await expect(page.getByRole('heading', { name: '2026年9月', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '前月' }).click();
    await expect(page.getByRole('heading', { name: '2026年8月', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: '今月' }).click();
    await expect(page.getByRole('heading', { name: '2026年9月', exact: true })).toBeInViewport();
  });

  test('week and day controls keep their size on a phone', async ({ page }) => {
    for (const view of ['week', 'day']) {
      await page.goto(`/calendar?view=${view}&on=2026-10-01`);
      await expect(page.locator('.timeline-day').first()).toBeVisible();
      const small = await page.locator('.calendar-timeline button:visible').evaluateAll((buttons) => buttons.filter((button) => { const box = button.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).map((button) => button.getAttribute('data-control-id')));
      expect(small).toEqual([]);
    }
  });
});
