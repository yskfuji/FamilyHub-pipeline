import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
export const rfc3339Schema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();
export const jpySchema = z.number().int().nonnegative().safe();

export const todoInputSchema = z.object({
  title: z.string().trim().min(1, '内容を入力してください').max(120),
  dueAt: rfc3339Schema.optional(),
  assigneeMembershipId: idSchema,
  reviewerMembershipId: idSchema.optional(),
});

export const eventInputSchema = z.object({
  title: z.string().trim().min(1, '予定名を入力してください').max(120),
  startsAt: rfc3339Schema,
  endsAt: rfc3339Schema,
  timezone: z.string().min(1),
  participantMembershipIds: z.array(idSchema).min(1),
  recurrence: z.object({
    rrule: z.string().startsWith('FREQ='),
    timezone: z.string(),
    exceptions: z.array(isoDateSchema),
  }).optional(),
}).refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  message: '終了は開始より後にしてください',
  path: ['endsAt'],
});

export const expenseInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  amountJpy: jpySchema.positive(),
  incurredOn: isoDateSchema,
  payerMembershipId: idSchema,
  shareMembershipIds: z.array(idSchema).min(1),
});

export const passwordSchema = z.string()
  .min(15, '15文字以上で入力してください')
  .max(64, '64文字以内で入力してください')
  .refine((value) => !['passwordpassword', '123456789012345', 'qwertyuiopasdfg'].includes(value.toLowerCase()), '既知の漏えいパスワードに近いため使用できません');

export type TodoInput = z.infer<typeof todoInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
