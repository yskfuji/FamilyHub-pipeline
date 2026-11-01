import type { FamilyHubGateway } from './gateway';
import type { GatewayError, Result } from '../domain/types';

type RequestOptions = RequestInit & { csrf?: boolean; idempotencyKey?: string };

const networkError: GatewayError = { code: 'OFFLINE', message: 'ネットワークに接続できません。', retryable: true };
const responseFailure: GatewayError = { code: 'UPSTREAM_FAILURE', message: '応答を受け取れませんでした。少し待ってからお試しください。', retryable: true };
const mutationHeaders = (context?: { idempotencyKey: string; expectedPermissionRevision: number }) => ({
  idempotencyKey: context?.idempotencyKey,
  headers: context ? { 'If-Permission-Revision': String(context.expectedPermissionRevision) } : undefined,
});

const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (character) => character.charCodeAt(0));
const toBase64Url = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function browserPasskeyOptions(options: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
  const source = options as PublicKeyCredentialCreationOptions & { challenge: ArrayBuffer | string; user: PublicKeyCredentialUserEntity & { id: ArrayBuffer | string }; excludeCredentials?: Array<PublicKeyCredentialDescriptor & { id: ArrayBuffer | string }> };
  return {
    ...source,
    challenge: typeof source.challenge === 'string' ? fromBase64Url(source.challenge) : source.challenge,
    user: { ...source.user, id: typeof source.user.id === 'string' ? fromBase64Url(source.user.id) : source.user.id },
    excludeCredentials: source.excludeCredentials?.map((item) => ({ ...item, id: typeof item.id === 'string' ? fromBase64Url(item.id) : item.id })),
  };
}

function browserRequestOptions(options: PublicKeyCredentialRequestOptions): PublicKeyCredentialRequestOptions {
  const source = options as PublicKeyCredentialRequestOptions & { challenge: ArrayBuffer | string; allowCredentials?: Array<PublicKeyCredentialDescriptor & { id: ArrayBuffer | string }> };
  return {
    ...source,
    challenge: typeof source.challenge === 'string' ? fromBase64Url(source.challenge) : source.challenge,
    allowCredentials: source.allowCredentials?.map((item) => ({ ...item, id: typeof item.id === 'string' ? fromBase64Url(item.id) : item.id })),
  };
}

function serializeAssertion(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    type: credential.type,
    rawId: toBase64Url(credential.rawId),
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
  };
}

function serializeRegistration(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    type: credential.type,
    rawId: toBase64Url(credential.rawId),
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

const allowedBase = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
};

type FetchLike = typeof fetch;

/** token を取り直すときは true を受け取る。 */
export type CsrfProvider = (refresh?: boolean) => string | Promise<string>;

export function createHttpGateway(baseUrl: string, getCsrfToken: CsrfProvider, getPermissionRevision: () => number | undefined, fetchImplementation?: FetchLike): FamilyHubGateway {
  if (!allowedBase(baseUrl)) throw new Error('本番HTTPアダプタにはHTTPSのbaseUrlが必要です');
  if (typeof getCsrfToken !== 'function') throw new Error('本番HTTPアダプタには実行時CSRF token providerが必要です');
  if (typeof getPermissionRevision !== 'function') throw new Error('本番HTTPアダプタには実行時の権限リビジョンproviderが必要です');

  async function send<T>(path: string, options: RequestOptions, idempotencyKey: string | undefined, refreshCsrf: boolean): Promise<Result<T>> {
    const isMutation = Boolean(options.method && !['GET', 'HEAD'].includes(options.method));
    const permissionRevision = isMutation ? getPermissionRevision() : undefined;
    const csrfToken = options.csrf ? await getCsrfToken(refreshCsrf) : undefined;
    const response = await (fetchImplementation ?? fetch)(new URL(path, baseUrl), {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(isMutation && permissionRevision !== undefined ? { 'If-Permission-Revision': String(permissionRevision) } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204 || response.headers.get('content-length') === '0') return response.ok ? { ok: true, value: undefined as T } : { ok: false, error: responseFailure };
    let payload: T | GatewayError;
    try {
      payload = await response.json() as T | GatewayError;
    } catch {
      // 中継の機器が返す本文のない失敗などは、オフラインの待ち行列へ回さない。
      return { ok: false, error: responseFailure };
    }
    return response.ok ? { ok: true, value: payload as T } : { ok: false, error: payload as GatewayError };
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
    const isMutation = Boolean(options.method && !['GET', 'HEAD'].includes(options.method));
    const idempotencyKey = isMutation ? options.idempotencyKey ?? crypto.randomUUID() : undefined;
    try {
      const result = await send<T>(path, options, idempotencyKey, false);
      if (result.ok || result.error.reason !== 'CSRF') return result;
      // token が古いときは取り直し、同じ冪等キーで一度だけ送り直す。
      return await send<T>(path, options, idempotencyKey, true);
    } catch {
      return { ok: false, error: networkError };
    }
  }

  return {
    auth: {
      beginPasskey: () => request('/v1/auth/passkey/challenge', { method: 'POST', csrf: true }),
      finishPasskey: (challengeId, assertion) => request('/v1/auth/passkey/complete', { method: 'POST', body: JSON.stringify({ challengeId, assertion }), csrf: true }),
      signInWithPassword: (email, password) => request('/v1/auth/password', { method: 'POST', body: JSON.stringify({ email, password }), csrf: true }),
      signOut: () => request('/v1/auth/session', { method: 'DELETE', csrf: true }),
      getSession: () => request('/v1/auth/session'),
      verifyTotp: (challengeId, code) => request('/v1/auth/totp/verify', { method: 'POST', body: JSON.stringify({ challengeId, code }), csrf: true }),
      signUp: (input) => request('/v1/auth/sign-up', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      requestPasswordReset: (email) => request('/v1/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }), csrf: true }),
      confirmPasswordReset: (input) => request('/v1/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      reauthenticate: (password) => request('/v1/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password }), csrf: true }),
      getAccount: () => request('/v1/account'),
      updateAccount: (input) => request('/v1/account', { method: 'PATCH', body: JSON.stringify(input), csrf: true }),
      changeEmail: (email) => request('/v1/account/email', { method: 'POST', body: JSON.stringify({ email }), csrf: true }),
      deleteAccount: () => request('/v1/account', { method: 'DELETE', csrf: true }),
      beginTotpEnrollment: () => request('/v1/account/totp', { method: 'POST', csrf: true }),
      confirmTotpEnrollment: (code) => request('/v1/account/totp/confirm', { method: 'POST', body: JSON.stringify({ code }), csrf: true }),
      disableTotp: () => request('/v1/account/totp', { method: 'DELETE', csrf: true }),
      getSecurityOverview: () => request('/v1/auth/security'),
      beginPasskeyRegistration: () => request('/v1/auth/passkeys/registration', { method: 'POST', csrf: true }),
      finishPasskeyRegistration: (challengeId, credential) => request('/v1/auth/passkeys/registration/complete', { method: 'POST', body: JSON.stringify({ challengeId, credential }), csrf: true }),
      changePassword: (currentPassword, newPassword) => request('/v1/auth/password/change', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }), csrf: true }),
      revokeSession: (sessionId) => request(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', csrf: true }),
    },
    household: {
      createHousehold: (name) => request('/v1/households', { method: 'POST', body: JSON.stringify({ name }), csrf: true }),
      getSnapshot: () => request('/v1/households/current/snapshot'),
      acceptInvite: (code) => request('/v1/household-invites/accept', { method: 'POST', body: JSON.stringify({ code }), csrf: true }),
      updateProfile: (input) => request('/v1/households/current', { method: 'PATCH', body: JSON.stringify(input), csrf: true }),
      updateMembershipRole: (id, role, expectedVersion) => request(`/v1/household-memberships/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ role, expectedVersion }), csrf: true }),
      createInvite: (role) => request('/v1/household-invites', { method: 'POST', body: JSON.stringify({ role }), csrf: true }),
      listInvites: () => request('/v1/household-invites'),
      revokeInvite: (id) => request(`/v1/household-invites/${encodeURIComponent(id)}`, { method: 'DELETE', csrf: true }),
      getPermissionOverrides: (membershipId) => request(`/v1/household-memberships/${encodeURIComponent(membershipId)}/permission-overrides`),
      updatePermissionOverrides: (membershipId, overrides, expectedPermissionRevision) => request(`/v1/household-memberships/${encodeURIComponent(membershipId)}/permission-overrides`, { method: 'PUT', body: JSON.stringify({ overrides, expectedPermissionRevision }), csrf: true }),
      resetPermissionOverrides: (membershipId, expectedPermissionRevision) => request(`/v1/household-memberships/${encodeURIComponent(membershipId)}/permission-overrides?expectedPermissionRevision=${expectedPermissionRevision}`, { method: 'DELETE', csrf: true }),
      getPrivacySettings: () => request('/v1/households/current/privacy'),
      savePrivacySettings: (settings) => request('/v1/households/current/privacy', { method: 'PUT', body: JSON.stringify(settings), csrf: true }),
    },
    events: {
      createEvent: (input, context) => request('/v1/events', { method: 'POST', body: JSON.stringify(input), csrf: true, ...mutationHeaders(context) }),
      updateEvent: (id, scope, input, expectedVersion, context, occurrenceDate) => request(`/v1/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ scope, input, expectedVersion, ...(occurrenceDate ? { occurrenceDate } : {}) }), csrf: true, ...mutationHeaders(context) }),
      deleteEvent: (id, scope, expectedVersion, occurrenceDate) => request(`/v1/events/${encodeURIComponent(id)}?${new URLSearchParams({ scope, expectedVersion: String(expectedVersion), ...(occurrenceDate ? { occurrenceDate } : {}) })}`, { method: 'DELETE', csrf: true }),
      restoreEvent: (id) => request(`/v1/events/${encodeURIComponent(id)}/restore`, { method: 'POST', csrf: true }),
    },
    todos: {
      createTodo: (input, context) => request('/v1/todos', { method: 'POST', body: JSON.stringify(input), csrf: true, ...mutationHeaders(context) }),
      updateTodoStatus: (id, status, expectedVersion, note) => request(`/v1/todos/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, expectedVersion, ...(note ? { note } : {}) }), csrf: true }),
      updateTodo: (id, scope, input, expectedVersion, context) => request(`/v1/todos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ scope, input, expectedVersion }), csrf: true, ...mutationHeaders(context) }),
      deleteTodo: (id, expectedVersion, scope = 'series') => request(`/v1/todos/${encodeURIComponent(id)}?${new URLSearchParams({ scope, expectedVersion: String(expectedVersion) })}`, { method: 'DELETE', csrf: true }),
      restoreTodo: (id) => request(`/v1/todos/${encodeURIComponent(id)}/restore`, { method: 'POST', csrf: true }),
    },
    memos: {
      createMemo: (input, context) => request('/v1/memos', { method: 'POST', body: JSON.stringify(input), csrf: true, ...mutationHeaders(context) }),
      updateMemo: (id, input, expectedVersion, context) => request(`/v1/memos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ input, expectedVersion }), csrf: true, ...mutationHeaders(context) }),
      uploadAttachment: async (memoId, file) => {
        const form = new FormData(); form.set('file', file);
        return request(`/v1/memos/${encodeURIComponent(memoId)}/attachments`, { method: 'POST', body: form, csrf: true });
      },
      getAttachmentLink: (memoId, attachmentId) => request(`/v1/memos/${encodeURIComponent(memoId)}/attachments/${encodeURIComponent(attachmentId)}/link`),
      deleteMemo: (id) => request(`/v1/memos/${encodeURIComponent(id)}`, { method: 'DELETE', csrf: true }),
      restoreMemo: (id) => request(`/v1/memos/${encodeURIComponent(id)}/restore`, { method: 'POST', csrf: true }),
    },
    expenses: {
      createExpense: (input) => request('/v1/expenses', { method: 'POST', body: JSON.stringify(input), csrf: true }),
      updateExpense: (id, input, expectedVersion) => request(`/v1/expenses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ input, expectedVersion }), csrf: true }),
      deleteExpense: (id, expectedVersion) => request(`/v1/expenses/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`, { method: 'DELETE', csrf: true }),
      restoreExpense: (id) => request(`/v1/expenses/${encodeURIComponent(id)}/restore`, { method: 'POST', csrf: true }),
      recordSettlement: (expenseId, fromMembershipId, amountJpy) => request(`/v1/expenses/${encodeURIComponent(expenseId)}/settlements`, { method: 'POST', body: JSON.stringify({ fromMembershipId, amountJpy }), csrf: true }),
      reverseSettlement: (expenseId, settlementId) => request(`/v1/expenses/${encodeURIComponent(expenseId)}/settlements/${encodeURIComponent(settlementId)}/reverse`, { method: 'POST', csrf: true }),
    },
    resources: { search: (query) => request(`/v1/search?q=${encodeURIComponent(query)}`) },
    insights: { list: () => request('/v1/insights') },
    notifications: {
      list: () => request('/v1/notifications'),
      markRead: (id) => request(`/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', csrf: true }),
      snooze: (id, minutes) => request(`/v1/notifications/${encodeURIComponent(id)}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }), csrf: true }),
      stop: (id) => request(`/v1/notifications/${encodeURIComponent(id)}/stop`, { method: 'POST', csrf: true }),
      resume: (id) => request(`/v1/notifications/${encodeURIComponent(id)}/resume`, { method: 'POST', csrf: true }),
      getPreferences: () => request('/v1/notification-preferences'),
      updatePreferences: (input) => request('/v1/notification-preferences', { method: 'PATCH', body: JSON.stringify(input), csrf: true }),
    },
    credentials: {
      async create(options) {
        if (!window.isSecureContext || !navigator.credentials || !options) return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーには安全な接続と対応ブラウザが必要です。', retryable: false } };
        try {
          const credential = await navigator.credentials.create({ publicKey: browserPasskeyOptions(options) });
          if (!(credential instanceof PublicKeyCredential)) return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーの作成がキャンセルされました。', retryable: true } };
          return { ok: true, value: serializeRegistration(credential) };
        } catch {
          return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーの作成を完了できませんでした。', retryable: true } };
        }
      },
      async get(options) {
        if (!window.isSecureContext || !navigator.credentials || !options) return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーには安全な接続と対応ブラウザが必要です。', retryable: false } };
        try {
          const credential = await navigator.credentials.get({ publicKey: browserRequestOptions(options) });
          if (!(credential instanceof PublicKeyCredential)) return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーでの本人確認がキャンセルされました。', retryable: true } };
          return { ok: true, value: serializeAssertion(credential) };
        } catch {
          return { ok: false, error: { code: 'UPSTREAM_FAILURE', message: 'パスキーでの本人確認を完了できませんでした。', retryable: true } };
        }
      },
    },
  };
}
