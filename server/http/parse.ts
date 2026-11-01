import type { z } from 'zod';
import { invalidInput } from './context';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidInput(parsed.error.issues[0]?.message);
  return parsed.data;
}
