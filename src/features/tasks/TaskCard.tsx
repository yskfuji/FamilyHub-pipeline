import { memberName, useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { StatusBadge } from '../../design-system/components';
import { CheckIcon, ClockIcon } from '../../design-system/icons';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { describeRule } from '../../domain/recurrence';
import type { Todo } from '../../domain/types';
import { labelStyle } from '../calendar/calendarLabels';
import { dueText } from './taskLabels';
import { useInlineTodoAction } from './useTodoTransition';

export function TaskCard({ todo, search }: { todo: Todo; search: string }) {
  const { snapshot } = useApp();
  const inline = useInlineTodoAction(todo);
  const label = snapshot.colorLabels.find((item) => item.id === todo.colorLabelId);
  return <div className="task-card">
    {inline && <button data-control-id={`tasks.complete.${todo.id}`} className="task-check" type="button" aria-label={inline.label} onClick={() => void inline.run()}><CheckIcon width="18"/></button>}
    <a data-control-id={`tasks.open.${todo.id}`} className="task-card-link" href={`/tasks/${todo.id}${search}`} data-link>
      <strong>{todo.title}</strong>
      <span className="meta task-due"><ClockIcon width="14"/> {dueText(todo, snapshot.context.asOf)}</span>
      <span className="people">
        <span className="person-chip">担当：{memberName(snapshot, todo.assigneeMembershipId)}</span>
        {todo.reviewerMembershipId && <span className="person-chip">確認する人：{memberName(snapshot, todo.reviewerMembershipId)}</span>}
        {label && <span className="person-chip task-label"><span className="color-dot" style={labelStyle(snapshot.colorLabels, label.id)} aria-hidden="true"/>{label.name}</span>}
      </span>
      {todo.priority && todo.priority !== 'normal' && <StatusBadge tone={todo.priority === 'high' ? 'attention' : 'neutral'}>優先度：{ja.taskPriority[todo.priority]}</StatusBadge>}
      {todo.recurrence && todo.dueAt && <StatusBadge>{describeRule(dateKeyFromRfc3339(todo.dueAt), todo.recurrence)}</StatusBadge>}
    </a>
  </div>;
}
