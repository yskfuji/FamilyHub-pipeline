import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { StatusBadge, formatYen } from '../../design-system/components';
import { CheckIcon } from '../../design-system/icons';
import { addDateKeyDays, dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { expensesOn, inlineTaskAction, occurrencesBetween, todosOn, type Occurrence } from '../../domain/calendarLayout';
import { holidaysBetween } from '../../domain/holidays';
import type { Todo } from '../../domain/types';
import { taskStatusLabels } from '../../content/ja';
import { dayLabel, labelStyle, timeOnDay } from './calendarLabels';

const HOLIDAY_SEARCH_DAYS = 400;

function TaskRow({ todo }: { todo: Todo }) {
  const { snapshot, gateway, refresh, announce, can } = useApp();
  const me = snapshot.viewer.membershipId;
  const related = [todo.creatorMembershipId, todo.assigneeMembershipId, todo.reviewerMembershipId].includes(me) || ['owner', 'adult'].includes(snapshot.viewer.role);
  const action = can('task.transition') && related ? inlineTaskAction(todo, me) : null;
  const finish = async () => {
    if (!action) return;
    const result = await gateway.todos.updateTodoStatus(todo.id, action, todo.version);
    if (!result.ok) return announce(result.error.message);
    await refresh();
    announce(action === 'review' ? `「${todo.title}」の確認を依頼しました` : `「${todo.title}」を完了にしました${todo.recurrence ? '。次の回を作成しました' : ''}`);
  };
  return <li className="list-row day-task" data-done={todo.status === 'done' || undefined}>
    {action
      ? <button data-control-id={`calendar.task.complete.${todo.id}`} className="task-check" type="button" aria-label={action === 'review' ? `「${todo.title}」の確認を依頼する` : `「${todo.title}」を完了にする`} onClick={() => void finish()}><CheckIcon width="18"/></button>
      : <span className="task-check-state" aria-hidden="true">{todo.status === 'done' && <CheckIcon width="18"/>}</span>}
    <div className="row-main"><a data-control-id={`calendar.task.open.${todo.id}`} href={`/tasks/${todo.id}`} data-link>{todo.title}</a><span className="meta">{taskStatusLabels[todo.status]}</span></div>
  </li>;
}

interface Props {
  selected: string | null;
  onOpen: (occurrence: Occurrence) => void;
  onCreate?: (date: string) => void;
  /** 見出しの id。画面に1つだけ置く。 */
  headingId: string;
}

/** 選んだ日の予定、タスク、支出。 */
export function DayEntries({ selected, onOpen, onCreate, headingId }: Props) {
  const { snapshot, can } = useApp();
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const events = useMemo(() => (selected ? occurrencesBetween(snapshot.events, selected, selected) : []), [snapshot.events, selected]);
  const nextHoliday = useMemo(() => {
    const from = selected ?? today;
    return holidaysBetween(from, addDateKeyDays(from, HOLIDAY_SEARCH_DAYS))[0] ?? null;
  }, [selected, today]);
  if (!selected) return <><p className="eyebrow">選択した日</p><h2 id={headingId}>日付を選んでください</h2><p className="muted">カレンダーの日付を選ぶと、その日の予定を確認できます。</p></>;
  const holiday = nextHoliday?.date === selected ? nextHoliday.name : undefined;
  const todos = can('task.read') ? todosOn(snapshot.todos, selected) : [];
  const expenses = can('expense.read') ? expensesOn(snapshot.expenses, selected) : [];
  return <>
    <p className="eyebrow">選択した日</p>
    <h2 id={headingId}>{dayLabel(selected)}</h2>
    {holiday && <p className="day-panel-holiday">{holiday}</p>}
    {events.length === 0 ? <p className="muted">この日の予定はありません。</p> : <ul className="list">
      {events.map((event) => <li className="list-row agenda-row" style={labelStyle(snapshot.colorLabels, event.colorLabelId)} key={`${event.id}-${event.occurrenceDate}`}>
        <time className="time">{timeOnDay(event, selected)}</time>
        <div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div>
        <button data-control-id={`calendar.selected-event.open.${event.id}.${event.occurrenceDate}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => onOpen(event)}>開く</button>
      </li>)}
    </ul>}
    {onCreate && <button data-control-id="calendar.event.create-on-day" className="button" type="button" onClick={() => onCreate(selected)}>この日に予定を追加</button>}
    {todos.length > 0 && <div className="day-section"><h3>タスク</h3><ul className="list">{todos.map((todo) => <TaskRow todo={todo} key={todo.id}/>)}</ul></div>}
    {expenses.length > 0 && <div className="day-section"><h3>支出</h3><ul className="list">{expenses.map((expense) => <li className="list-row day-expense" key={expense.id}>
      <div className="row-main"><a data-control-id={`calendar.expense.open.${expense.id}`} href={`/budget/${expense.id}`} data-link>{expense.title}</a></div>
      <span className="amount">{expense.kind === 'income' && <StatusBadge tone="success">収入</StatusBadge>} {formatYen(expense.amountJpy)}</span>
    </li>)}</ul></div>}
    <hr className="day-rule"/>
    <h3>次の祝日</h3>
    <p className="muted mb-0">{nextHoliday ? `${dayLabel(nextHoliday.date)} ${nextHoliday.name}` : '登録されている祝日はありません。'}</p>
  </>;
}
