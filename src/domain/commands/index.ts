import { createAlbumCommands } from './albums';
import { createFamilyCommands } from './family';
import { createLinkCommands } from './links';
import { createTrashCommands } from './trash';
import { createCommandContext } from './context';
import type { CommandEnv, HouseholdAggregate } from './context';
import { createEventCommands } from './events';
import { createExpenseCommands } from './expenses';
import { createHouseholdCommands } from './household';
import { createMemoCommands } from './memos';
import { createNotificationCommands } from './notifications';
import { createAssistantCommands } from './assistant';
import { createInsightCommands, createSearchCommands } from './search';
import { createTodoCommands } from './todos';

export type { CommandEnv, HouseholdAggregate, HouseholdArchives, SyncPort } from './context';

/** 家族の記録に対する操作の規則。確認用の実装と API の実装が同じものを使う。 */
export function createHouseholdRules(aggregate: HouseholdAggregate, env: CommandEnv) {
  const context = createCommandContext(aggregate, env);
  return {
    context,
    household: createHouseholdCommands(context),
    events: createEventCommands(context),
    todos: createTodoCommands(context),
    memos: createMemoCommands(context),
    expenses: createExpenseCommands(context),
    albums: createAlbumCommands(context),
    family: createFamilyCommands(context),
    links: createLinkCommands(context),
    trash: createTrashCommands(context),
    resources: createSearchCommands(context),
    insights: createInsightCommands(context),
    assistant: createAssistantCommands(context),
    notifications: createNotificationCommands(context),
  };
}
