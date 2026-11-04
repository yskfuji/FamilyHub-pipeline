import { z } from 'zod';
import { isoDateSchema, passwordSchema } from './schemas';

export const ADULT_AGE = 18;
export const IDLE_TIMEOUT_CHOICES = [1, 5, 15, 30, 60] as const;

/** 誕生日から満年齢を求める。日付は日本時間の YYYY-MM-DD。 */
export function ageOn(birthdate: string, today: string) {
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export const signUpSchema = z.strictObject({
  displayName: z.string().trim().min(1, '名前を入力してください。').max(40, '40文字以内で入力してください。'),
  email: z.email('メールアドレスを確認してください。').max(254),
  password: passwordSchema,
  birthdate: isoDateSchema,
  /** 18歳未満は保護者の同意が必要。 */
  guardianConsent: z.boolean().default(false),
});

export const avatarSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('initial') }),
  z.strictObject({ kind: z.literal('preset'), preset: z.enum(['leaf', 'sun', 'wave', 'mountain', 'star', 'flower']) }),
  // 192px の画像を端末側で縮めて送る。data URL の形式と大きさを確かめる。
  z.strictObject({ kind: z.literal('image'), dataUrl: z.string().max(200_000).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/, '画像の形式を確認してください。') }),
]);

export const accountUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1, '名前を入力してください。').max(40, '40文字以内で入力してください。').optional(),
  avatar: avatarSchema.optional(),
  idleTimeoutMinutes: z.union(IDLE_TIMEOUT_CHOICES.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<5>]).optional(),
  /** 一度だけ申告できる誕生日。 */
  birthdate: isoDateSchema.optional(),
});

export type SignUpInput = z.input<typeof signUpSchema>;
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;
export type Avatar = z.infer<typeof avatarSchema>;
