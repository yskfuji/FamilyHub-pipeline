import type { EventInput, ExpenseInput, TodoInput } from '../domain/schemas';
import type { CalendarEvent, ContextSnapshot, Expense, HouseholdSnapshot, Id, Memo, Result, Scenario, Todo } from '../domain/types';

export interface AuthPort {
  beginPasskey(): Promise<Result<{ challengeId: Id }>>;
  signInWithPassword(email: string, password: string): Promise<Result<{ userId: Id }>>;
  signOut(): Promise<Result<void>>;
}

export interface HouseholdPort {
  getSnapshot(scenario?: Scenario): Promise<Result<HouseholdSnapshot>>;
  acceptInvite(code: string): Promise<Result<{ householdId: Id }>>;
}

export interface EventPort {
  createEvent(input: EventInput): Promise<Result<CalendarEvent>>;
  updateRecurrence(id: Id, scope: 'this' | 'future' | 'series', input: Partial<EventInput>): Promise<Result<CalendarEvent>>;
}

export interface TodoPort {
  createTodo(input: TodoInput): Promise<Result<Todo>>;
  updateTodoStatus(id: Id, status: Todo['status'], expectedVersion: number): Promise<Result<Todo>>;
}

export interface MemoPort {
  uploadAttachment(memoId: Id, file: File): Promise<Result<Memo>>;
}

export interface ExpensePort {
  createExpense(input: ExpenseInput): Promise<Result<Expense>>;
  recordSettlement(expenseId: Id, amountJpy: number): Promise<Result<Expense>>;
}

export interface ResourcePort {
  search(query: string): Promise<Result<Array<{ kind: string; id: Id; label: string; destination: string }>>>;
}

export interface ContextPort {
  getContext(): Promise<Result<ContextSnapshot>>;
}

export interface FamilyHubGateway {
  auth: AuthPort;
  household: HouseholdPort;
  events: EventPort;
  todos: TodoPort;
  memos: MemoPort;
  expenses: ExpensePort;
  resources: ResourcePort;
  context: ContextPort;
}
