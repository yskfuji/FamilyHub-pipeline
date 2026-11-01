import type { AssistantJobKind, AssistantStatus } from '../assistant';
import { ok } from './context';
import type { CommandContext } from './context';
import type { Result } from '../types';

/** 読み取りの補助の権限。提案を受け取っても使えない人には、外へ送らせない。 */
export function createAssistantCommands({ requireCapability, viewer }: CommandContext) {
  const needed = { receipt: 'expense.create', event: 'event.create' } as const;
  return {
    status(available: boolean): Result<AssistantStatus> {
      const allowed = viewer().status === 'active' && viewer().capabilities.includes('assistant.use');
      return ok({ available: available && allowed });
    },
    authorize(kind: AssistantJobKind): Result<void> {
      return requireCapability<void>('assistant.use') ?? requireCapability<void>(needed[kind]) ?? ok(undefined);
    },
  };
}
