import type { FamilyHubGateway } from './gateway';
import type { GatewayError, Result } from '../domain/types';

type RequestOptions = RequestInit & { csrf?: boolean };

const networkError: GatewayError = { code: 'OFFLINE', message: 'ネットワークに接続できません。', retryable: true };

export function createHttpGateway(baseUrl: string, getCsrfToken: () => string): FamilyHubGateway {
  if (!baseUrl || !baseUrl.startsWith('https://')) throw new Error('本番HTTPアダプタにはHTTPSのbaseUrlが必要です');
  if (typeof getCsrfToken !== 'function') throw new Error('本番HTTPアダプタには実行時CSRF token providerが必要です');

  async function request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        ...options,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...(options.csrf ? { 'X-CSRF-Token': getCsrfToken() } : {}),
          ...options.headers,
        },
      });
      const payload = await response.json() as T | GatewayError;
      if (!response.ok) return { ok: false, error: payload as GatewayError };
      return { ok: true, value: payload as T };
    } catch {
      return { ok: false, error: networkError };
    }
  }

  return {
    auth: {
      beginPasskey: () => request('/v1/auth/passkey/challenge', { method: 'POST', csrf: true }),
      signInWithPassword: (email, password) => request('/v1/auth/password', { method: 'POST', body: JSON.stringify({ email, password }), csrf: true }),
      signOut: () => request('/v1/auth/session', { method: 'DELETE', csrf: true }),
    },
    household: {
      getSnapshot: () => request('/v1/households/current/snapshot'),
      acceptInvite: (code) => request('/v1/household-invites/accept', { method: 'POST', body: JSON.stringify({ code }), csrf: true }),
    },
    events: {
      createEvent: (input) => request('/v1/events', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      updateRecurrence: (id, scope, input) => request(`/v1/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ scope, input }), csrf: true }),
    },
    todos: {
      createTodo: (input) => request('/v1/todos', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      updateTodoStatus: (id, status, expectedVersion) => request(`/v1/todos/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, expectedVersion }), csrf: true }),
    },
    memos: {
      uploadAttachment: async (memoId, file) => {
        const form = new FormData(); form.set('file', file);
        return request(`/v1/memos/${encodeURIComponent(memoId)}/attachments`, { method: 'POST', body: form, csrf: true });
      },
    },
    expenses: {
      createExpense: (input) => request('/v1/expenses', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      recordSettlement: (expenseId, amountJpy) => request(`/v1/expenses/${encodeURIComponent(expenseId)}/settlements`, { method: 'POST', body: JSON.stringify({ amountJpy }), csrf: true }),
    },
    resources: { search: (query) => request(`/v1/search?q=${encodeURIComponent(query)}`) },
    context: { getContext: () => request('/v1/context') },
  };
}
