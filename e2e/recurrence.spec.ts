import { expect, test } from '@playwright/test';

const listRows = (page: import('@playwright/test').Page, title: string) => page.locator('.list-row').filter({ hasText: title });

test('weekly events are expanded across the month', async ({ page }) => {
  await page.goto('/calendar?month=2026-10');
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(listRows(page, '資源回収')).toHaveCount(5);
});

test('deleting only one occurrence keeps the rest and can be undone', async ({ page }) => {
  await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-08');
  const drawer = page.getByRole('dialog', { name: '資源回収' });
  await expect(drawer.getByText('毎週木曜')).toBeVisible();
  await expect(drawer.getByText(/この回：10月8日/)).toBeVisible();
  await drawer.getByLabel('対象とする予定').selectOption('this');
  await drawer.getByRole('button', { name: '予定を削除' }).click();
  await page.getByRole('dialog', { name: '予定を削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText('「資源回収」を削除しました')).toBeVisible();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(listRows(page, '資源回収')).toHaveCount(4);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(listRows(page, '資源回収')).toHaveCount(5);
});

test('"this and following" edits split the series without touching earlier occurrences', async ({ page }) => {
  await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-15');
  const drawer = page.getByRole('dialog', { name: '資源回収' });
  await drawer.getByLabel('対象とする予定').selectOption('future');
  await drawer.getByRole('button', { name: '編集する' }).click();
  await page.getByLabel('予定名').fill('資源回収（新しい集積所）');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(listRows(page, '資源回収（新しい集積所）')).toHaveCount(3);
  await expect(listRows(page, '資源回収').filter({ hasNotText: '新しい集積所' })).toHaveCount(2);
});

test('recurring tasks show their rule and move to the next occurrence when completed', async ({ page }) => {
  await page.goto('/tasks/todo-garbage?actor=member-ren');
  const drawer = page.getByRole('dialog', { name: '資源ごみをまとめる' });
  await expect(drawer.getByText('毎週木曜')).toBeVisible();
  await expect(drawer.getByLabel('対象とするタスク').locator('option')).toHaveText(['このタスクだけ', 'すべてのタスク']);
  await drawer.getByRole('button', { name: '着手する' }).click();
  await page.getByRole('link', { name: /資源ごみをまとめる/ }).click();
  await page.getByRole('dialog', { name: '資源ごみをまとめる' }).getByRole('button', { name: '完了にする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('次の回を作成しました');
  await page.getByRole('link', { name: /資源ごみをまとめる/ }).filter({ hasText: '10月8日' }).click();
  await expect(page.getByRole('dialog', { name: '資源ごみをまとめる' }).getByText(/10月8日/)).toBeVisible();
});
