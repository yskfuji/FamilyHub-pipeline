import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { activeAdults, caretAfterDigits, customSplitGap, expenseDraftProblem, expenseDraftToCreateInput, expenseDraftToUpdateInput, expenseToDraft, formatAmountInput, kindChangeEffects, newExpenseDraft, parseYen, payerChoices, peopleOutsideExpense, plannedShares, seedCustomAmounts, withKind, type ExpenseDraft } from './expenseForm';
import { expenseInputSchema, expenseUpdateSchema } from './schemas';
import type { Expense } from './types';

const adults = ['member-aoi', 'member-ren'];
const books = baseSnapshot.expenses.find((item) => item.id === 'expense-books') as Expense;
const salary = baseSnapshot.expenses.find((item) => item.id === 'income-salary') as Expense;
const draftOf = (changes: Partial<ExpenseDraft> = {}): ExpenseDraft => ({ ...newExpenseDraft('2026-09-30', 'member-aoi', adults, 'household'), title: '夕食', amount: '1001', ...changes });

describe('parseYen', () => {
  it('reads plain, formatted and full-width amounts', () => {
    expect(['1200', '1,200', '１２００', '¥1,200', '￥1,200', ' 1200円 ', '0'].map(parseYen)).toEqual([1200, 1200, 1200, 1200, 1200, 1200, 0]);
  });

  it('refuses anything that is not a whole yen amount', () => {
    expect(['', '12.5', '-1', 'abc', '1e3', '99999999999999999999'].map(parseYen)).toEqual([null, null, null, null, null, null]);
  });
});

describe('people', () => {
  const members = baseSnapshot.memberships;

  it('treats only active owners and adults as adults', () => {
    expect(activeAdults(members).map((item) => item.id)).toEqual(adults);
    expect(activeAdults(members.map((item) => (item.id === 'member-ren' ? { ...item, status: 'suspended' as const } : item))).map((item) => item.id)).toEqual(['member-aoi']);
  });

  it('keeps the current payer selectable even after they stop being active', () => {
    const suspended = members.map((item) => (item.id === 'member-ren' ? { ...item, status: 'suspended' as const } : item));
    expect(payerChoices(suspended, 'member-ren').map((item) => item.id)).toEqual(adults);
    expect(payerChoices(suspended).map((item) => item.id)).toEqual(['member-aoi']);
  });

  it('starts with the viewer as payer, or the first adult when the viewer cannot pay', () => {
    expect(newExpenseDraft('2026-09-30', 'member-ren', adults, 'household').payerId).toBe('member-ren');
    expect(newExpenseDraft('2026-09-30', 'member-hana', adults, 'household').payerId).toBe('member-aoi');
    expect(newExpenseDraft('2026-09-30', 'member-aoi', adults, 'household', 'income').category).toBe('income_other');
  });
});

describe('expense split', () => {
  it('splits equally among adults and gives the odd yen to the first', () => {
    expect(plannedShares(draftOf(), adults)).toEqual([{ membershipId: 'member-aoi', amountJpy: 501 }, { membershipId: 'member-ren', amountJpy: 500 }]);
  });

  it('leaves the whole amount with the payer', () => {
    expect(plannedShares(draftOf({ splitMode: 'payer', payerId: 'member-ren' }), adults)).toEqual([{ membershipId: 'member-ren', amountJpy: 1001 }]);
  });

  it('drops people with no share from a custom split', () => {
    expect(plannedShares(draftOf({ splitMode: 'custom', customAmounts: { 'member-aoi': '1001', 'member-ren': '0', 'member-sora': '' } }), adults)).toEqual([{ membershipId: 'member-aoi', amountJpy: 1001 }]);
  });

  it('seeds a custom split from the equal one, and keeps what was typed', () => {
    expect(seedCustomAmounts(draftOf(), adults)).toEqual({ 'member-aoi': '501', 'member-ren': '500' });
    expect(seedCustomAmounts(draftOf({ customAmounts: { 'member-aoi': '7' } }), adults)).toEqual({ 'member-aoi': '7' });
    expect(seedCustomAmounts(draftOf({ amount: '' }), adults)).toEqual({});
  });

  it('reports how far a custom split is from the amount', () => {
    expect(customSplitGap(draftOf({ customAmounts: { 'member-aoi': '1000' } }))).toBe(1);
    expect(customSplitGap(draftOf({ customAmounts: { 'member-aoi': '1001' } }))).toBe(0);
    expect(customSplitGap(draftOf({ customAmounts: { 'member-aoi': '2000' } }))).toBe(-999);
    expect(customSplitGap(draftOf({ amount: '' }))).toBeNull();
  });
});

describe('expenseDraftProblem', () => {
  it('names the record by its kind', () => {
    expect(expenseDraftProblem(draftOf({ title: ' ' }), false)).toBe('支出名を入力してください。');
    expect(expenseDraftProblem(draftOf({ title: '', kind: 'income' }), false)).toBe('収入名を入力してください。');
  });

  it('checks the amount, the date and the visibility', () => {
    expect(expenseDraftProblem(draftOf({ amount: '0' }), false)).toContain('金額は1円以上');
    expect(expenseDraftProblem(draftOf({ amount: '12.5' }), false)).toContain('金額は1円以上');
    expect(expenseDraftProblem(draftOf({ date: '2026-02-31' }), false)).toBe('日付を確認してください。');
    expect(expenseDraftProblem(draftOf({ audience: 'selected' }), false)).toContain('公開する人');
    expect(expenseDraftProblem(draftOf(), false)).toBeNull();
  });

  it('requires a custom split to add up to the amount', () => {
    const custom = { splitMode: 'custom' as const };
    expect(expenseDraftProblem(draftOf({ ...custom, customAmounts: { 'member-aoi': '1000' } }), false)).toBe('負担の合計を金額と合わせてください。');
    expect(expenseDraftProblem(draftOf({ ...custom, customAmounts: { 'member-aoi': 'abc' } }), false)).toContain('0円以上の整数');
    expect(expenseDraftProblem(draftOf({ ...custom, customAmounts: { 'member-aoi': '1000', 'member-ren': '1' } }), false)).toBeNull();
  });

  it('ignores the split for income and for a locked record', () => {
    const custom = { splitMode: 'custom' as const, customAmounts: { 'member-aoi': '1' } };
    expect(expenseDraftProblem(draftOf({ ...custom, kind: 'income' }), false)).toBeNull();
    expect(expenseDraftProblem(draftOf({ ...custom, amount: '' }), true)).toBeNull();
  });
});

describe('expenseDraftToCreateInput', () => {
  it('sends people for an equal split and passes the schema', () => {
    const input = expenseDraftToCreateInput(draftOf({ title: ' 夕食 ', note: ' ' }), adults);
    expect(input).toEqual({ kind: 'expense', title: '夕食', amountJpy: 1001, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', category: 'other', visibility: { audience: 'household', selectedMembershipIds: [] }, shareMembershipIds: adults });
    expect(expenseInputSchema.safeParse(input).success).toBe(true);
  });

  it('sends amounts for a custom split and passes the schema', () => {
    const input = expenseDraftToCreateInput(draftOf({ splitMode: 'custom', customAmounts: { 'member-aoi': '1', 'member-ren': '1000' } }), adults);
    expect(input.shareAmounts).toEqual([{ membershipId: 'member-aoi', amountJpy: 1 }, { membershipId: 'member-ren', amountJpy: 1000 }]);
    expect(input.shareMembershipIds).toBeUndefined();
    expect(expenseInputSchema.safeParse(input).success).toBe(true);
  });

  it('sends no split and no place for income, and passes the schema', () => {
    const place = { name: '店', capturedVia: 'manual' as const, selectedAt: '2026-09-30T00:00:00+09:00' };
    const input = expenseDraftToCreateInput(draftOf({ kind: 'income', category: 'income_salary', splitMode: 'custom', customAmounts: { 'member-aoi': '5' }, place }), adults);
    expect(input.shareMembershipIds).toBeUndefined();
    expect(input.shareAmounts).toBeUndefined();
    expect(input.place).toBeUndefined();
    expect(expenseInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('editing', () => {
  it('recognizes how a record was split', () => {
    expect(expenseToDraft(books, adults).splitMode).toBe('equal');
    expect(expenseToDraft({ ...books, shares: [{ membershipId: 'member-aoi', amountJpy: 2860, settledJpy: 2860 }] }, adults).splitMode).toBe('payer');
    const uneven = expenseToDraft({ ...books, shares: [{ membershipId: 'member-aoi', amountJpy: 860, settledJpy: 860 }, { membershipId: 'member-ren', amountJpy: 2000, settledJpy: 0 }] }, adults);
    expect(uneven.splitMode).toBe('custom');
    expect(uneven.customAmounts).toEqual({ 'member-aoi': '860', 'member-ren': '2000' });
  });

  it('treats a split among only some of the adults as custom', () => {
    expect(expenseToDraft({ ...books, payerMembershipId: 'member-ren', shares: [{ membershipId: 'member-aoi', amountJpy: 2860, settledJpy: 0 }] }, adults).splitMode).toBe('custom');
  });

  it('leaves the split out when only the name changed', () => {
    const input = expenseDraftToUpdateInput({ ...expenseToDraft(books, adults), title: '教材' }, books, adults, false);
    expect(input).toEqual({ title: '教材', incurredOn: '2026-09-29', category: 'education', note: '花の図工・理科教材' });
    expect(expenseUpdateSchema.safeParse(input).success).toBe(true);
  });

  it('sends the whole split when the amount or the payer changes', () => {
    expect(expenseDraftToUpdateInput({ ...expenseToDraft(books, adults), amount: '3000' }, books, adults, false)).toMatchObject({ amountJpy: 3000, payerMembershipId: 'member-aoi', shareMembershipIds: adults });
    expect(expenseDraftToUpdateInput({ ...expenseToDraft(books, adults), payerId: 'member-ren' }, books, adults, false)).toMatchObject({ payerMembershipId: 'member-ren', shareMembershipIds: adults });
  });

  it('sends amounts when a custom split changes', () => {
    const draft = { ...expenseToDraft(books, adults), splitMode: 'custom' as const, customAmounts: { 'member-aoi': '860', 'member-ren': '2000' } };
    expect(expenseDraftToUpdateInput(draft, books, adults, false)).toMatchObject({ amountJpy: 2860, shareAmounts: [{ membershipId: 'member-aoi', amountJpy: 860 }, { membershipId: 'member-ren', amountJpy: 2000 }] });
  });

  it('never sends the amount, the payer or the split of a locked record', () => {
    const input = expenseDraftToUpdateInput({ ...expenseToDraft(books, adults), amount: '9', payerId: 'member-ren' }, books, adults, true);
    expect(input).not.toHaveProperty('amountJpy');
    expect(input).not.toHaveProperty('payerMembershipId');
    expect(input).not.toHaveProperty('shareMembershipIds');
  });

  it('sends only the amount and the payer of income', () => {
    expect(expenseDraftToUpdateInput({ ...expenseToDraft(salary, adults), amount: '330000' }, salary, adults, false)).toMatchObject({ amountJpy: 330000, payerMembershipId: 'member-aoi' });
    const input = expenseDraftToUpdateInput({ ...expenseToDraft(salary, adults), amount: '330000' }, salary, adults, false);
    expect(input).not.toHaveProperty('shareMembershipIds');
    expect(expenseDraftToUpdateInput(expenseToDraft(salary, adults), salary, adults, false)).not.toHaveProperty('amountJpy');
  });

  it('sends the visibility and the place only when they change', () => {
    const draft = expenseToDraft(books, adults);
    expect(expenseDraftToUpdateInput(draft, books, adults, false)).not.toHaveProperty('place');
    expect(expenseDraftToUpdateInput({ ...draft, place: null }, books, adults, false)).toMatchObject({ place: null });
    expect(expenseDraftToUpdateInput({ ...draft, audience: 'adults' }, books, adults, false)).toMatchObject({ visibility: { audience: 'adults', selectedMembershipIds: [] } });
  });
});

describe('changing the kind of a record (A3)', () => {
  it('switches the category and the split with the kind, and sends the kind only when it changes', () => {
    const toIncome = withKind(expenseToDraft(books, adults), 'income');
    expect(toIncome).toMatchObject({ kind: 'income', category: 'income_other' });
    const input = expenseDraftToUpdateInput(toIncome, books, adults, false);
    expect(input).toMatchObject({ kind: 'income', category: 'income_other' });
    expect(input).not.toHaveProperty('shareMembershipIds');
    expect(expenseUpdateSchema.safeParse(input).success).toBe(true);
    const toExpense = withKind(expenseToDraft(salary, adults), 'expense');
    expect(toExpense).toMatchObject({ kind: 'expense', category: 'other', splitMode: 'equal' });
    expect(expenseDraftToUpdateInput(toExpense, salary, adults, false)).toMatchObject({ kind: 'expense', category: 'other', amountJpy: 320000, payerMembershipId: 'member-aoi', shareMembershipIds: adults });
    expect(expenseDraftToUpdateInput(expenseToDraft(books, adults), books, adults, false)).not.toHaveProperty('kind');
    expect(withKind(toIncome, 'income')).toBe(toIncome);
  });

  it('tells what the change clears and needs before saving', () => {
    expect(kindChangeEffects(books, 'income')).toEqual({ changes: true, clearsShares: true, requiresShares: false, category: 'income', blockedBySettlement: false });
    const settled = { ...books, settlements: [{ id: 's', amountJpy: 1430, fromMembershipId: 'member-ren', toMembershipId: 'member-aoi', recordedAt: '2026-09-30T00:00:00+09:00' }] };
    expect(kindChangeEffects(settled, 'income').blockedBySettlement).toBe(true);
    expect(kindChangeEffects({ ...settled, settlements: [{ ...settled.settlements[0], reversedAt: '2026-09-30T01:00:00+09:00' }] }, 'income').blockedBySettlement).toBe(false);
    expect(kindChangeEffects(salary, 'expense')).toEqual({ changes: true, clearsShares: false, requiresShares: true, category: 'expense', blockedBySettlement: false });
    expect(kindChangeEffects(salary, 'income').changes).toBe(false);
  });
});

describe('peopleOutsideExpense', () => {
  const members = baseSnapshot.memberships;

  it('warns about a person who shares the cost but could not see the record', () => {
    expect(peopleOutsideExpense(draftOf({ audience: 'creator' }), adults, members, 'member-aoi').map((item) => item.id)).toEqual(['member-ren']);
    expect(peopleOutsideExpense(draftOf({ audience: 'selected', selectedIds: ['member-ren'] }), adults, members, 'member-aoi')).toEqual([]);
  });

  it('does not warn when everyone involved can see it', () => {
    expect(peopleOutsideExpense(draftOf({ audience: 'participants' }), adults, members, 'member-aoi')).toEqual([]);
    expect(peopleOutsideExpense(draftOf({ audience: 'creator', splitMode: 'payer' }), adults, members, 'member-aoi')).toEqual([]);
  });

  it('looks only at who received income', () => {
    expect(peopleOutsideExpense(draftOf({ kind: 'income', audience: 'creator', payerId: 'member-ren' }), adults, members, 'member-aoi').map((item) => item.id)).toEqual(['member-ren']);
  });
});

describe('amount field display (stage 12)', () => {
  it('groups digits by three, from full width and with yen marks, and keeps unreadable text as typed', () => {
    expect(formatAmountInput('1234567')).toBe('1,234,567');
    expect(formatAmountInput('１２，０００円')).toBe('12,000');
    expect(formatAmountInput('¥ 980')).toBe('980');
    expect(formatAmountInput('0012')).toBe('12');
    expect(formatAmountInput('')).toBe('');
    expect(formatAmountInput('12a')).toBe('12a');
  });
  it('puts the caret after the same digit', () => {
    expect(caretAfterDigits('1,234', 2)).toBe(3);
    expect(caretAfterDigits('1,234', 0)).toBe(0);
    expect(caretAfterDigits('1,234', 9)).toBe(5);
  });
});
