import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
export const rfc3339Schema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();
export const jpySchema = z.number().int().nonnegative().safe();

export const todoInputSchema = z.object({
  title: z.string().trim().min(1, 'タスク名を入力してください。').max(120),
  dueAt: rfc3339Schema.optional(),
  assigneeMembershipId: idSchema,
  reviewerMembershipId: idSchema.optional(),
  note: z.string().max(2000).optional(),
});

/** 予定の項目。部分更新の検証にも使うため、終了と開始の前後関係の検査とは分けて定義する。 */
export const eventFieldsSchema = z.object({
  title: z.string().trim().min(1, '予定名を入力してください。').max(120),
  startsAt: rfc3339Schema,
  endsAt: rfc3339Schema,
  timezone: z.string().min(1),
  participantMembershipIds: z.array(idSchema).min(1),
  recurrence: z.object({
    rrule: z.string().startsWith('FREQ='),
    timezone: z.string(),
    exceptions: z.array(isoDateSchema),
  }).optional(),
  location: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  weatherSensitive: z.boolean().optional(),
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

export const expenseCategorySchema = z.enum(['food', 'transport', 'education', 'home', 'other']);

export const expenseInputSchema = z.object({
  title: z.string().trim().min(1, '支出名を入力してください。').max(120),
  amountJpy: jpySchema.positive('金額は1円以上にしてください。'),
  incurredOn: isoDateSchema,
  payerMembershipId: idSchema,
  shareMembershipIds: z.array(idSchema).min(1, '負担する人を1人以上選んでください。'),
  category: expenseCategorySchema.default('other'),
  note: z.string().trim().max(500).optional(),
  place: placeRefSchema.optional(),
});

/** 支出の変更。金額・支払った人・負担は、取り消していない精算がない間だけ変えられる（mock と API で検査する）。 */
export const expenseUpdateSchema = z.strictObject({
  title: z.string().trim().min(1, '支出名を入力してください。').max(120),
  amountJpy: jpySchema.positive('金額は1円以上にしてください。'),
  incurredOn: isoDateSchema,
  payerMembershipId: idSchema,
  shareMembershipIds: z.array(idSchema).min(1, '負担する人を1人以上選んでください。'),
  category: expenseCategorySchema,
  note: z.string().trim().max(500).nullable(),
  place: placeRefSchema.nullable(),
}).partial();

export const householdProfileSchema = z.strictObject({
  name: z.string().trim().min(1, '家族グループの名前を入力してください。').max(40, '40文字以内で入力してください。'),
});

export const passwordSchema = z.string()
  .min(15, '15文字以上で入力してください。')
  .max(64, '64文字以内で入力してください。')
  .refine((value) => !['passwordpassword', '123456789012345', 'qwertyuiopasdfg'].includes(value.toLowerCase()), 'このパスワードは安全性が低いため使用できません。別のパスワードを入力してください。');

export const memoInputSchema = z.object({
  title: z.string().trim().min(1, 'タイトルを入力してください。').max(120),
  body: z.string().trim().min(1, '本文を入力してください。').max(5000),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  place: placeRefSchema.nullable().optional(),
});

export const privacySettingsSchema = z.strictObject({
  defaultAudience: z.enum(['household', 'creator']),
  hideNotificationContent: z.boolean(),
  placeLookupConsent: z.strictObject({
    noticeVersion: z.string().min(1).max(40),
    grantedAt: rfc3339Schema,
  }).nullable(),
});

export const safeHttpsUrlSchema = z.string().url('リンク先の形式を確認してください。').refine((value) => new URL(value).protocol === 'https:', 'このリンクは開けません。https://で始まるリンクを入力してください。');

export type TodoInput = z.infer<typeof todoInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type ExpenseInput = z.input<typeof expenseInputSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type HouseholdProfileInput = z.infer<typeof householdProfileSchema>;
export type MemoInput = z.infer<typeof memoInputSchema>;
