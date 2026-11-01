import { isDateKey } from './calendarDate';
import { splitShares } from './ledger';
import type { ExpenseInput, ExpenseUpdateInput } from './schemas';
import type { Expense, HouseholdMembership, Id, PlaceRef, VisibilityAudience } from './types';
import { peopleOutsideAudience, visibilityChange, visibilityInput, visibilityProblem } from './visibilityForm';

export type SplitMode = 'equal' | 'payer' | 'custom';
export const splitModes: readonly SplitMode[] = ['equal', 'payer', 'custom'];

export interface ExpenseDraft {
  kind: Expense['kind'];
  title: string;
  /** 入力のままの文字。送るときに円の整数へ直す。 */
  amount: string;
  date: string;
  category: Expense['category'];
  payerId: Id;
  splitMode: SplitMode;
  customAmounts: Record<Id, string>;
  note: string;
  audience: VisibilityAudience;
  selectedIds: Id[];
  place: PlaceRef | null;
}

type ShareAmount = { membershipId: Id; amountJpy: number };

/** 入力された文字を円の整数として読む。全角の数字や桁区切りも受け付ける。読めなければ null。 */
export function parseYen(text: string): number | null {
  const digits = text.normalize('NFKC').replace(/[,\s¥円]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export const activeAdults = (memberships: readonly HouseholdMembership[]) => memberships.filter((member) => member.status === 'active' && (member.role === 'owner' || member.role === 'adult'));

/** 支払った人に選べる人。今の支払った人は、変えずに保存できるように残す。 */
export function payerChoices(memberships: readonly HouseholdMembership[], keepId?: Id) {
  return memberships.filter((member) => activeAdults(memberships).includes(member) || member.id === keepId);
}

export const defaultCategory = (kind: Expense['kind']): Expense['category'] => (kind === 'income' ? 'income_other' : 'other');

export function newExpenseDraft(date: string, viewerMembershipId: Id, adultIds: readonly Id[], audience: VisibilityAudience, kind: Expense['kind'] = 'expense'): ExpenseDraft {
  return {
    kind, title: '', amount: '', date, category: defaultCategory(kind), payerId: adultIds.includes(viewerMembershipId) ? viewerMembershipId : adultIds[0] ?? viewerMembershipId,
    splitMode: 'equal', customAmounts: {}, note: '', audience, selectedIds: [], place: null,
  };
}

function splitModeOf(expense: Expense, adultIds: readonly Id[]): SplitMode {
  const ids = expense.shares.map((share) => share.membershipId);
  if (ids.length === 1 && ids[0] === expense.payerMembershipId) return 'payer';
  const amounts = expense.shares.map((share) => share.amountJpy);
  const even = Math.max(...amounts) - Math.min(...amounts) <= 1;
  return even && ids.length === adultIds.length && ids.every((id) => adultIds.includes(id)) ? 'equal' : 'custom';
}

export function expenseToDraft(expense: Expense, adultIds: readonly Id[]): ExpenseDraft {
  const income = expense.kind === 'income';
  return {
    kind: expense.kind, title: expense.title, amount: String(expense.amountJpy), date: expense.incurredOn, category: expense.category,
    payerId: expense.payerMembershipId, splitMode: income ? 'equal' : splitModeOf(expense, adultIds),
    customAmounts: Object.fromEntries(expense.shares.map((share) => [share.membershipId, String(share.amountJpy)])),
    note: expense.note ?? '', audience: expense.visibility.audience, selectedIds: [...expense.visibility.selectedMembershipIds], place: expense.place ?? null,
  };
}

/** 入力の内容から決まる負担。0円の人は負担のない人として外す。 */
export function plannedShares(draft: ExpenseDraft, adultIds: readonly Id[]): ShareAmount[] {
  const amountJpy = parseYen(draft.amount) ?? 0;
  if (draft.splitMode === 'custom') {
    return Object.entries(draft.customAmounts)
      .map(([membershipId, text]) => ({ membershipId, amountJpy: parseYen(text) ?? 0 }))
      .filter((share) => share.amountJpy > 0);
  }
  if (draft.splitMode === 'payer' || adultIds.length === 0) return [{ membershipId: draft.payerId, amountJpy }];
  return splitShares(amountJpy, draft.payerId, [...adultIds]).map(({ membershipId, amountJpy: share }) => ({ membershipId, amountJpy: share }));
}

/** 「金額を指定」に切り替えたときの最初の値。入力がなければ、等分の額を入れておく。 */
export function seedCustomAmounts(draft: ExpenseDraft, adultIds: readonly Id[]): Record<Id, string> {
  if (Object.values(draft.customAmounts).some((text) => text.trim())) return draft.customAmounts;
  if (!parseYen(draft.amount)) return draft.customAmounts;
  return Object.fromEntries(plannedShares({ ...draft, splitMode: 'equal' }, adultIds).map((share) => [share.membershipId, String(share.amountJpy)]));
}

/** 金額から負担の合計を引いた額。正なら足りず、負なら多い。金額が読めなければ null。 */
export function customSplitGap(draft: ExpenseDraft): number | null {
  const amountJpy = parseYen(draft.amount);
  if (amountJpy === null) return null;
  return amountJpy - plannedShares({ ...draft, splitMode: 'custom' }, []).reduce((sum, share) => sum + share.amountJpy, 0);
}

export const expenseTitleLabel = (kind: Expense['kind']) => (kind === 'income' ? '収入名' : '支出名');

/** 入力の確認。問題があれば文言を返す。splitLocked のときは、変えられない金額と負担を見ない。 */
export function expenseDraftProblem(draft: ExpenseDraft, splitLocked: boolean): string | null {
  if (!draft.title.trim()) return `${expenseTitleLabel(draft.kind)}を入力してください。`;
  if (!isDateKey(draft.date)) return '日付を確認してください。';
  const shared = visibilityProblem(draft.audience, draft.selectedIds);
  if (shared) return shared;
  if (splitLocked) return null;
  if (!parseYen(draft.amount)) return '金額は1円以上の整数で入力してください。';
  if (draft.kind === 'income' || draft.splitMode !== 'custom') return null;
  if (Object.values(draft.customAmounts).some((text) => text.trim() && parseYen(text) === null)) return '負担の額は0円以上の整数で入力してください。';
  return customSplitGap(draft) === 0 ? null : '負担の合計を金額と合わせてください。';
}

/** 負担の指定。等分と支払った人だけは人の指定で送り、金額の指定だけ額を送る。 */
function shareInput(draft: ExpenseDraft, adultIds: readonly Id[]) {
  if (draft.splitMode === 'custom') return { shareAmounts: plannedShares(draft, adultIds) };
  return { shareMembershipIds: draft.splitMode === 'payer' || adultIds.length === 0 ? [draft.payerId] : [...adultIds] };
}

export function expenseDraftToCreateInput(draft: ExpenseDraft, adultIds: readonly Id[]): ExpenseInput {
  const income = draft.kind === 'income';
  return {
    kind: draft.kind, title: draft.title.trim(), amountJpy: parseYen(draft.amount) ?? 0, incurredOn: draft.date, payerMembershipId: draft.payerId,
    category: draft.category, visibility: visibilityInput(draft.audience, draft.selectedIds),
    ...(income ? {} : shareInput(draft, adultIds)),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    ...(!income && draft.place ? { place: draft.place } : {}),
  };
}

const sameShares = (planned: readonly ShareAmount[], original: Expense) => planned.length === original.shares.length
  && planned.every((share) => original.shares.some((item) => item.membershipId === share.membershipId && item.amountJpy === share.amountJpy));

/** 金額と負担の変更。何も変えていなければ送らない（送ると負担が作り直される）。 */
function splitChange(draft: ExpenseDraft, original: Expense, adultIds: readonly Id[]): ExpenseUpdateInput {
  const amountJpy = parseYen(draft.amount) ?? original.amountJpy;
  const samePayment = amountJpy === original.amountJpy && draft.payerId === original.payerMembershipId;
  if (draft.kind === 'income') return samePayment ? {} : { amountJpy, payerMembershipId: draft.payerId };
  if (samePayment && sameShares(plannedShares(draft, adultIds), original)) return {};
  return { amountJpy, payerMembershipId: draft.payerId, ...shareInput(draft, adultIds) };
}

/** 変更の入力。空にした項目は null で外す。公開範囲と場所は、変えたときだけ送る。 */
export function expenseDraftToUpdateInput(draft: ExpenseDraft, original: Expense, adultIds: readonly Id[], splitLocked: boolean): ExpenseUpdateInput {
  return {
    title: draft.title.trim(), incurredOn: draft.date, category: draft.category, note: draft.note.trim() || null,
    ...visibilityChange(draft.audience, draft.selectedIds, original.visibility),
    ...(draft.place !== (original.place ?? null) ? { place: draft.place } : {}),
    ...(splitLocked ? {} : splitChange(draft, original, adultIds)),
  };
}

/** 関わる人のうち、公開範囲の外になる人。 */
export function peopleOutsideExpense(draft: ExpenseDraft, adultIds: readonly Id[], memberships: readonly HouseholdMembership[], creatorId: Id) {
  const related = draft.kind === 'income' ? [draft.payerId] : [draft.payerId, ...plannedShares(draft, adultIds).map((share) => share.membershipId)];
  return peopleOutsideAudience(related, draft.audience, draft.selectedIds, memberships, creatorId);
}
