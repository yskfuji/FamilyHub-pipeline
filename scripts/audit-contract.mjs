import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const [contract, adapter, gateway, domain, audited, sessions] = await Promise.all([
  readFile('contracts/family-hub.openapi.yaml', 'utf8'),
  readFile('src/data/httpGateway.ts', 'utf8'),
  readFile('src/data/gateway.ts', 'utf8'),
  readFile('src/domain/types.ts', 'utf8'),
  readFile('src/data/gatewayOperations.ts', 'utf8'),
  readFile('server/auth/sessions.ts', 'utf8'),
]);

const failures = [];

// 経路の中の {名前} は、経路か操作のどちらかで path の引数として宣言する。宣言がないと、契約を読む道具（OpenAPI の検証器や侵入試験の走査）が経路を読めない（docs/security/pentest-2026-11.md）。
{
  const document = parse(contract);
  const resolveParameter = (parameter) => (parameter.$ref ? parameter.$ref.split('/').slice(1).reduce((node, key) => node[key], document) : parameter);
  const pathNames = (list) => (list ?? []).map(resolveParameter).filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name);
  for (const [path, item] of Object.entries(document.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const atPath = pathNames(item.parameters);
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'head', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const atOperation = pathNames(operation.parameters);
      for (const name of names) if (!atPath.includes(name) && !atOperation.includes(name)) failures.push(`${method.toUpperCase()} ${path}: path parameter ${name} is not declared`);
      for (const name of atOperation) if (!names.includes(name)) failures.push(`${method.toUpperCase()} ${path}: declares path parameter ${name} that is not in the path`);
    }
  }
}
// 契約の cookie の名前は、サーバーが https で付ける名前と同じにする（アプリと検証器が契約を読んで送る）。
{
  const issued = sessions.match(/session: '(__Host-[^']+)'/)?.[1];
  const declared = parse(contract).components?.securitySchemes?.sessionCookie?.name;
  if (!issued) failures.push('server/auth/sessions.ts: could not read the https session cookie name');
  else if (declared !== issued) failures.push(`OpenAPI sessionCookie is ${declared}, but the server issues ${issued}`);
}
const operationIds = [...contract.matchAll(/operationId:\s*([A-Za-z0-9]+)/g)].map((match) => match[1]);
const duplicates = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
if (duplicates.length) failures.push(`duplicate OpenAPI operationId: ${[...new Set(duplicates)].join(', ')}`);

const requiredOperations = [
  'updateMembershipRole', 'listHouseholdInvites', 'revokeHouseholdInvite',
  'getPermissionOverrides', 'updatePermissionOverrides', 'resetPermissionOverrides',
  'restoreEvent', 'restoreTodo', 'restoreMemo', 'reverseSettlement', 'settleAll', 'reverseBatch',
  'resumeNotification', 'updateNotificationPreferences', 'getPrivacySettings',
];
for (const operation of requiredOperations) {
  if (!operationIds.includes(operation)) failures.push(`missing OpenAPI operationId: ${operation}`);
}

const requiredContractMarkers = [
  'x-mutation-policy:', 'Idempotency-Key', 'If-Permission-Revision', 'X-CSRF-Token',
  'NOT_FOUND', 'REAUTH_REQUIRED', 'OWNER_REQUIRED', 'PERMISSION_REVISION', 'IDEMPOTENCY',
  'PlaceRef:', 'PlaceLookupConsent:', 'place.read',
];
for (const marker of requiredContractMarkers) {
  if (!contract.includes(marker)) failures.push(`missing OpenAPI contract marker: ${marker}`);
}

const adapterMarkers = [
  "credentials: 'include'", "'X-CSRF-Token'", "'Idempotency-Key'", "'If-Permission-Revision'",
  'response.status === 204', '/permission-overrides', '/restore', '/reverse', '/resume', '/settlement-batches',
];
for (const marker of adapterMarkers) {
  if (!adapter.includes(marker)) failures.push(`missing HTTP adapter boundary: ${marker}`);
}

const gatewayMethods = [
  'updatePermissionOverrides', 'resetPermissionOverrides', 'revokeInvite',
  'restoreEvent', 'restoreTodo', 'restoreMemo', 'reverseSettlement', 'settleAll', 'reverseBatch', 'resume', 'getPrivacySettings',
];
for (const method of gatewayMethods) {
  if (!gateway.includes(`${method}(`)) failures.push(`missing gateway method: ${method}`);
}

if (!domain.includes("'place.read'")) failures.push('missing capability: place.read');
for (const reason of ['CAPABILITY_MISSING', 'SCOPE_DENIED', 'OWNER_REQUIRED', 'VERSION', 'PERMISSION_REVISION', 'IDEMPOTENCY']) {
  if (!domain.includes(reason)) failures.push(`missing discriminated failure reason: ${reason}`);
}

// Gateway のメソッドと OpenAPI の操作を1対1で照合する（ブラウザ内で完結する credentials は対象外）。
const operationFor = {
  'auth.beginPasskey': 'beginPasskey', 'auth.finishPasskey': 'finishPasskey', 'auth.signInWithPassword': 'signInWithPassword', 'auth.signOut': 'signOut',
  'auth.getSecurityOverview': 'getSecurityOverview', 'auth.beginPasskeyRegistration': 'beginPasskeyRegistration', 'auth.finishPasskeyRegistration': 'finishPasskeyRegistration',
  'auth.getSession': 'getSession', 'auth.getVersion': 'getVersion', 'family.transferOwnership': 'transferOwnership', 'family.setMemberStatus': 'setMemberStatus', 'family.removeMember': 'removeMember', 'family.leaveHousehold': 'leaveHousehold', 'family.createColorLabel': 'createColorLabel', 'family.updateColorLabel': 'updateColorLabel', 'family.deleteColorLabel': 'deleteColorLabel', 'links.createLink': 'createItemLink', 'links.deleteLink': 'deleteItemLink', 'trash.list': 'listRecentlyDeleted', 'memos.deleteAttachment': 'deleteAttachment', 'albums.listAlbums': 'listAlbums', 'albums.getAlbum': 'getAlbum', 'albums.createAlbum': 'createAlbum', 'albums.updateAlbum': 'updateAlbum', 'albums.deleteAlbum': 'deleteAlbum', 'albums.restoreAlbum': 'restoreAlbum', 'albums.reorderItems': 'reorderAlbumItems', 'albums.deleteItem': 'deleteAlbumItem', 'albums.restoreItem': 'restoreAlbumItem', 'albums.uploadItem': null, 'albums.cancelUpload': 'cancelUpload', 'albums.mediaUrl': null, 'auth.verifyTotp': 'verifyTotp', 'auth.signUp': 'signUp', 'auth.requestPasswordReset': 'requestPasswordReset', 'auth.confirmPasswordReset': 'confirmPasswordReset', 'auth.reauthenticate': 'reauthenticate', 'auth.getAccount': 'getAccount', 'auth.updateAccount': 'updateAccount', 'auth.changeEmail': 'changeEmail', 'auth.deleteAccount': 'deleteAccount', 'auth.beginTotpEnrollment': 'beginTotpEnrollment', 'auth.confirmTotpEnrollment': 'confirmTotpEnrollment', 'auth.disableTotp': 'disableTotp', 'household.createHousehold': 'createHousehold', 'auth.changePassword': 'changePassword', 'auth.revokeSession': 'revokeSession',
  'household.getSnapshot': 'getHouseholdSnapshot', 'household.acceptInvite': 'acceptInvite', 'household.updateProfile': 'updateHouseholdProfile',
  'household.updateMembershipRole': 'updateMembershipRole', 'household.createInvite': 'createHouseholdInvite', 'household.listInvites': 'listHouseholdInvites',
  'household.revokeInvite': 'revokeHouseholdInvite', 'household.getPermissionOverrides': 'getPermissionOverrides', 'household.updatePermissionOverrides': 'updatePermissionOverrides',
  'household.resetPermissionOverrides': 'resetPermissionOverrides', 'household.getPrivacySettings': 'getPrivacySettings', 'household.savePrivacySettings': 'savePrivacySettings',
  'events.createEvent': 'createEvent', 'events.updateEvent': 'updateRecurringEvent', 'events.deleteEvent': 'deleteEvent', 'events.restoreEvent': 'restoreEvent',
  'todos.createTodo': 'createTodo', 'todos.updateTodoStatus': 'updateTodoStatus', 'todos.updateTodo': 'updateTodo', 'todos.deleteTodo': 'deleteTodo', 'todos.restoreTodo': 'restoreTodo',
  'memos.createMemo': 'createMemo', 'memos.updateMemo': 'updateMemo', 'memos.uploadAttachment': 'uploadAttachment', 'memos.getAttachmentLink': 'getAttachmentLink',
  'memos.deleteMemo': 'deleteMemo', 'memos.restoreMemo': 'restoreMemo',
  'expenses.createExpense': 'createExpense', 'expenses.updateExpense': 'updateExpense', 'expenses.deleteExpense': 'deleteExpense', 'expenses.restoreExpense': 'restoreExpense',
  'expenses.recordSettlement': 'recordSettlement', 'expenses.reverseSettlement': 'reverseSettlement', 'expenses.settleAll': 'settleAll', 'expenses.reverseBatch': 'reverseBatch',
  'resources.search': 'searchHousehold', 'insights.list': 'listInsights',
  'assistant.getStatus': 'getAssistantStatus', 'assistant.readReceipt': 'readReceipt', 'assistant.readEventImage': 'readEventImage', 'assistant.readEventUrl': 'readEventUrl', 'assistant.getJob': 'getAssistantJob',
  'notifications.list': 'listNotifications', 'notifications.markRead': 'markNotificationRead', 'notifications.snooze': 'snoozeNotification', 'notifications.stop': 'stopNotification',
  'notifications.resume': 'resumeNotification', 'notifications.getPreferences': 'getNotificationPreferences', 'notifications.updatePreferences': 'updateNotificationPreferences',
  'audit.list': 'listAuditEvents', 'audit.listMine': 'listAccountAuditEvents',
  'credentials.create': null, 'credentials.get': null,
};
const portOf = Object.fromEntries([...gateway.matchAll(/^\s+(\w+): (\w+Port|CredentialClient);$/gm)].map((match) => [match[2], match[1]]));
const declared = [...gateway.matchAll(/export interface (\w+(?:Port)|CredentialClient) \{([\s\S]*?)\n\}/g)].flatMap(([, port, body]) => [...body.matchAll(/^\s+(\w+)\(/gm)].map((match) => `${portOf[port]}.${match[1]}`));
for (const method of declared) {
  if (!(method in operationFor)) failures.push(`gateway method has no OpenAPI mapping: ${method}`);
  else if (operationFor[method] && !operationIds.includes(operationFor[method])) failures.push(`mapped OpenAPI operation is missing: ${method} -> ${operationFor[method]}`);
  const name = method.split('.')[1];
  if (!new RegExp(`\\b${name}(:|\\s*\\()`).test(adapter)) failures.push(`HTTP adapter does not implement: ${method}`);
}
for (const method of Object.keys(operationFor)) if (!declared.includes(method)) failures.push(`mapping refers to a gateway method that no longer exists: ${method}`);
// 確認用の実装が変更の記録に使う対応表（src/data/gatewayOperations.ts）は、ここの対応と同じ operationId を使う。
const auditedEntries = [...audited.matchAll(/^\s+'(\w+\.\w+)': (?:household|account)\('(\w+)'/gm)].map((match) => [match[1], match[2]]);
if (auditedEntries.length === 0) failures.push('src/data/gatewayOperations.ts: no audited operations found');
for (const [method, operationId] of auditedEntries) {
  if (!(method in operationFor)) failures.push(`gatewayOperations.ts maps an unknown gateway method: ${method}`);
  else if (operationFor[method] !== operationId) failures.push(`gatewayOperations.ts disagrees with operationFor: ${method} -> ${operationId} (expected ${operationFor[method]})`);
}
const mapped = new Set(Object.values(operationFor).filter(Boolean));
// 運用の確認や CSRF の取得など、画面の Gateway を通らない操作は契約に x-gateway: none と書く。
const exempt = new Set([...contract.matchAll(/operationId:\s*([A-Za-z0-9]+)\n\s+x-gateway: none/g)].map((match) => match[1]));
for (const id of operationIds) if (!mapped.has(id) && !exempt.has(id)) failures.push(`OpenAPI operation is not used by any gateway method: ${id}`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`OpenAPI/adapter contract audit passed: ${operationIds.length} unique operations mapped one-to-one to gateway methods, mutation and recovery boundaries present.`);
