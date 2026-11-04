import { formatDue } from '../../design-system/components';
import type { Todo } from '../../domain/types';

/** 期限の表示。期間のタスクは開始も示す。 */
export const dueText = (todo: Pick<Todo, 'dueAt' | 'dueStartAt'>, asOf: string) => (todo.dueStartAt ? `${formatDue(todo.dueStartAt, asOf)}〜${formatDue(todo.dueAt, asOf)}` : formatDue(todo.dueAt, asOf));
