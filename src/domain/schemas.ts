import { z } from 'zod';
import { passwordMessages } from '../content/passwordMessages';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hasWeakPattern } from './passwordPolicy';
import { parseRRule } from './recurrence';

export const idSchema = z.string().min(1).max(100);
export const rfc3339Schema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();
export const jpySchema = z.number().int().nonnegative().safe();

const audienceSchema = z.enum(['household', 'adults', 'participants', 'creator', 'selected']);
export const visibilityInputSchema = z.strictObject({
  audience: audienceSchema,
  selectedMembershipIds: z.array(idSchema).max(8, '選べるのは8人までです。').default([]),
});
/** メモとアルバムには「参加者」がないため、選べる範囲が狭い。 */
export const contentVisibilityInputSchema = z.strictObject({
  audience: audienceSchema.exclude(['participants']),
  selectedMembershipIds: z.array(idSchema).max(8, '選べるのは8人までです。').default([]),
});

export const recurrenceSchema = z.object({
  rrule: z.string().refine((value) => parseRRule(value) !== null, '繰り返しの指定を確認してください。'),
  timezone: z.string(),
  exceptions: z.array(isoDateSchema),
});

export const todoInputSchema = z.object({
  title: z.string().trim().min(1, 'タスク名を入力してください。').max(120),
  dueAt: rfc3339Schema.optional(),
  dueStartAt: rfc3339Schema.optional(),
  assigneeMembershipId: idSchema,
  reviewerMembershipId: idSchema.optional(),
  note: z.string().max(2000).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  colorLabelId: idSchema.optional(),
  recurrence: recurrenceSchema.optional(),
  visibility: visibilityInputSchema.optional(),
});

/** タスクの変更。null は項目を外すことを表す。 */
export const todoUpdateSchema = todoInputSchema.partial().extend({
  dueAt: rfc3339Schema.nullable().optional(),
  dueStartAt: rfc3339Schema.nullable().optional(),
  reviewerMembershipId: idSchema.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).nullable().optional(),
  colorLabelId: idSchema.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});

/** 予定の項目。部分更新の検証にも使うため、終了と開始の前後関係の検査とは分けて定義する。 */
export const eventFieldsSchema = z.object({
  title: z.string().trim().min(1, '予定名を入力してください。').max(120),
  startsAt: rfc3339Schema,
  endsAt: rfc3339Schema,
  timezone: z.string().min(1),
  participantMembershipIds: z.array(idSchema).min(1),
  recurrence: recurrenceSchema.optional(),
  location: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  weatherSensitive: z.boolean().optional(),
  allDay: z.boolean().optional(),
  colorLabelId: idSchema.optional(),
  reminderMinutesBefore: z.number().int().min(0).max(40320).optional(),
  visibility: visibilityInputSchema.optional(),
});
/** 予定の変更。null は項目を外すことを表す。 */
export const eventUpdateSchema = eventFieldsSchema.partial().extend({
  recurrence: recurrenceSchema.nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  colorLabelId: idSchema.nullable().optional(),
  reminderMinutesBefore: z.number().int().min(0).max(40320).nullable().optional(),
});
const endsAfterStart = { message: '終了日時は開始日時より後にしてください。', path: ['endsAt'] };
export const eventInputSchema = eventFieldsSchema.refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), endsAfterStart);
export const isEventTimeRangeValid = (startsAt: string, endsAt: string) => Date.parse(endsAt) > Date.parse(startsAt);

const atMostFiveDecimals = (value: number) => Math.abs(value * 1e5 - Math.round(value * 1e5)) < 1e-6;

export const placeRefSchema = z.strictObject({
  name: z.string().trim().min(1, '場所の名前を入力してください。').max(120, '場所の名前は120文字以内にしてください。'),
  address: z.string().trim().min(1).max(200, '住所は200文字以内にしてください。').optional(),
  coordinates: z.strictObject({
    lat: z.number().min(-90).max(90).refine(atMostFiveDecimals),
    lng: z.number().min(-180).max(180).refine(atMostFiveDecimals),
  }).optional(),
  category: z.string().min(1).max(40).optional(),
  provenance: z.strictObject({
    provider: z.literal('openpoi'),
    source: z.string().min(1).max(40),
    licenses: z.array(z.string().min(1).max(200)).max(10),
    attributions: z.array(z.string().min(1).max(300)).max(20),
  }).optional(),
  capturedVia: z.enum(['device', 'photo', 'search', 'manual']),
  selectedAt: rfc3339Schema,
}).refine(
  (value) => value.capturedVia === 'manual'
    ? value.coordinates === undefined && value.provenance === undefined
    : value.coordinates !== undefined && value.provenance !== undefined,
  { message: '場所の記録の形式を確認してください。', path: ['capturedVia'] },
);

export const spendingCategorySchema = z.enum(['food', 'dining', 'transport', 'utilities', 'home', 'education', 'health', 'entertainment', 'shopping', 'savings', 'other']);
export const incomeCategorySchema = z.enum(['income_salary', 'income_bonus', 'income_side', 'income_investment', 'income_gift', 'income_other']);
export const expenseCategorySchema = z.union([spendingCategorySchema, incomeCategorySchema]);
const shareAmountsSchema = z.array(z.strictObject({ membershipId: idSchema, amountJpy: jpySchema })).min(1);

export const expenseInputSchema = z.object({
  title: z.string().trim().min(1, '支出名を入力してください。').max(120),
  amountJpy: jpySchema.positive('金額は1円以上にしてください。'),
  incurredOn: isoDateSchema,
  payerMembershipId: idSchema,
  shareMembershipIds: z.array(idSchema).min(1, '負担する人を1人以上選んでください。').optional(),
  /** 金額を指定して分けるとき。合計は金額と一致させる。 */
  shareAmounts: shareAmountsSchema.optional(),
  kind: z.enum(['expense', 'income']).default('expense'),
  category: expenseCategorySchema.optional(),
  note: z.string().trim().max(500).optional(),
  place: placeRefSchema.optional(),
  visibility: visibilityInputSchema.optional(),
}).superRefine((value, context) => {
  const income = value.kind === 'income';
  if (income && (value.shareMembershipIds || value.shareAmounts)) context.addIssue({ code: 'custom', message: '収入には負担を指定できません。', path: ['shareMembershipIds'] });
  if (!income && !value.shareMembershipIds && !value.shareAmounts) context.addIssue({ code: 'custom', message: '負担する人を1人以上選んでください。', path: ['shareMembershipIds'] });
  if (value.category && incomeCategorySchema.safeParse(value.category).success !== income) context.addIssue({ code: 'custom', message: '費目を確認してください。', path: ['category'] });
  if (value.shareAmounts && value.shareAmounts.reduce((sum, item) => sum + item.amountJpy, 0) !== value.amountJpy) context.addIssue({ code: 'custom', message: '負担の合計を金額と合わせてください。', path: ['shareAmounts'] });
});

/**
 * 支出の変更。金額・支払った人・負担は、取り消していない精算がない間だけ変えられる（mock と API で検査する）。
 * kind を変えるときは、同じ要求の中で費目（と支出にするときは負担）を指定する（A3。規則は commands/expenses.ts）。
 */
export const expenseUpdateSchema = z.strictObject({
  kind: z.enum(['expense', 'income']),
  title: z.string().trim().min(1, '支出名を入力してください。').max(120),
  amountJpy: jpySchema.positive('金額は1円以上にしてください。'),
  incurredOn: isoDateSchema,
  payerMembershipId: idSchema,
  shareMembershipIds: z.array(idSchema).min(1, '負担する人を1人以上選んでください。'),
  shareAmounts: shareAmountsSchema,
  category: expenseCategorySchema,
  note: z.string().trim().max(500).nullable(),
  place: placeRefSchema.nullable(),
  visibility: visibilityInputSchema,
}).partial();

/** まとめた精算（A4）。画面に示した負担と残りの額、送金の案。同じ負担を2回含めない。 */
export const settleAllInputSchema = z.strictObject({
  shares: z.array(z.strictObject({ expenseId: idSchema, membershipId: idSchema, remainingJpy: jpySchema.positive() })).min(1).max(1000),
  transfers: z.array(z.strictObject({ from: idSchema, to: idSchema, amountJpy: jpySchema.positive() })).max(100),
}).superRefine((value, context) => {
  const keys = value.shares.map((item) => `${item.expenseId}\u0000${item.membershipId}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: '同じ負担が2回含まれています。', path: ['shares'] });
  if (value.transfers.some((item) => item.from === item.to)) context.addIssue({ code: 'custom', message: '送金の案を確認してください。', path: ['transfers'] });
});

export const householdProfileSchema = z.strictObject({
  name: z.string().trim().min(1, '家族グループの名前を入力してください。').max(40, '40文字以内で入力してください。'),
});

/** サインインで入力する今のパスワード。長さだけを確かめる（前の規則で作ったものも受け付ける）。 */
export const currentPasswordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH, passwordMessages.tooShort)
  .max(PASSWORD_MAX_LENGTH, passwordMessages.tooLong);

/**
 * 新しいパスワードの同期の検査（長さと並び）。頻出の一覧と文脈の語は checkNewPassword（passwordPolicy.ts）で確かめる。
 * API と確認用データは、保存の前に必ず checkNewPassword も通す。
 */
export const passwordSchema = currentPasswordSchema
  .refine((value) => !hasWeakPattern(value), passwordMessages.pattern);

export const memoInputSchema = z.object({
  title: z.string().trim().min(1, 'タイトルを入力してください。').max(120),
  body: z.string().trim().min(1, '本文を入力してください。').max(5000),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  place: placeRefSchema.nullable().optional(),
  memoDate: isoDateSchema.nullable().optional(),
  ocrText: z.string().max(8000).nullable().optional(),
  visibility: contentVisibilityInputSchema.optional(),
});

export const privacySettingsSchema = z.strictObject({
  defaultAudience: z.enum(['household', 'creator']),
  hideNotificationContent: z.boolean(),
  placeLookupConsent: z.strictObject({
    noticeVersion: z.string().min(1).max(40),
    grantedAt: rfc3339Schema,
  }).nullable(),
});

export const albumInputSchema = z.object({
  title: z.string().trim().min(1, 'アルバム名を入力してください。').max(120),
  description: z.string().trim().max(2000).optional(),
  place: placeRefSchema.nullable().optional(),
  bgmPreset: z.enum(['calm', 'bright', 'gentle']).nullable().optional(),
  visibility: contentVisibilityInputSchema.optional(),
});
export const albumUpdateSchema = albumInputSchema.partial().extend({
  description: z.string().trim().max(2000).nullable().optional(),
  coverItemId: idSchema.nullable().optional(),
});

export const colorLabelInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'リストの名前を入力してください。').max(40, '40文字以内で入力してください。'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, '色を確認してください。'),
});

export const safeHttpsUrlSchema = z.string().url('リンク先の形式を確認してください。').refine((value) => new URL(value).protocol === 'https:', 'このリンクは開けません。https://で始まるリンクを入力してください。');

export type TodoInput = z.input<typeof todoInputSchema>;
export type TodoUpdateInput = z.input<typeof todoUpdateSchema>;
export type EventInput = z.input<typeof eventFieldsSchema>;
export type EventUpdateInput = z.input<typeof eventUpdateSchema>;
export type ExpenseInput = z.input<typeof expenseInputSchema>;
export type ExpenseUpdateInput = z.input<typeof expenseUpdateSchema>;
export type SettleAllRequest = z.input<typeof settleAllInputSchema>;
export type HouseholdProfileInput = z.infer<typeof householdProfileSchema>;
export type MemoInput = z.input<typeof memoInputSchema>;
export type ColorLabelInput = z.infer<typeof colorLabelInputSchema>;
export type AlbumInput = z.input<typeof albumInputSchema>;
export type AlbumUpdateInput = z.input<typeof albumUpdateSchema>;
export type VisibilityInput = z.input<typeof visibilityInputSchema>;
