import { readFile } from 'node:fs/promises';

const [contract, adapter, gateway, domain] = await Promise.all([
  readFile('contracts/family-hub.openapi.yaml', 'utf8'),
  readFile('src/data/httpGateway.ts', 'utf8'),
  readFile('src/data/gateway.ts', 'utf8'),
  readFile('src/domain/types.ts', 'utf8'),
]);

const failures = [];
const operationIds = [...contract.matchAll(/operationId:\s*([A-Za-z0-9]+)/g)].map((match) => match[1]);
const duplicates = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
if (duplicates.length) failures.push(`duplicate OpenAPI operationId: ${[...new Set(duplicates)].join(', ')}`);

const requiredOperations = [
  'updateMembershipRole', 'listHouseholdInvites', 'revokeHouseholdInvite',
  'getPermissionOverrides', 'updatePermissionOverrides', 'resetPermissionOverrides',
  'restoreEvent', 'restoreTodo', 'restoreMemo', 'reverseSettlement',
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
  'response.status === 204', '/permission-overrides', '/restore', '/reverse', '/resume',
];
for (const marker of adapterMarkers) {
  if (!adapter.includes(marker)) failures.push(`missing HTTP adapter boundary: ${marker}`);
}

const gatewayMethods = [
  'updatePermissionOverrides', 'resetPermissionOverrides', 'revokeInvite',
  'restoreEvent', 'restoreTodo', 'restoreMemo', 'reverseSettlement', 'resume', 'getPrivacySettings',
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
  'auth.changePassword': 'changePassword', 'auth.revokeSession': 'revokeSession',
  'household.getSnapshot': 'getHouseholdSnapshot', 'household.acceptInvite': 'acceptInvite', 'household.updateProfile': 'updateHouseholdProfile',
  'household.updateMembershipRole': 'updateMembershipRole', 'household.createInvite': 'createHouseholdInvite', 'household.listInvites': 'listHouseholdInvites',
  'household.revokeInvite': 'revokeHouseholdInvite', 'household.getPermissionOverrides': 'getPermissionOverrides', 'household.updatePermissionOverrides': 'updatePermissionOverrides',
  'household.resetPermissionOverrides': 'resetPermissionOverrides', 'household.getPrivacySettings': 'getPrivacySettings', 'household.savePrivacySettings': 'savePrivacySettings',
  'events.createEvent': 'createEvent', 'events.updateEvent': 'updateRecurringEvent', 'events.deleteEvent': 'deleteEvent', 'events.restoreEvent': 'restoreEvent',
  'todos.createTodo': 'createTodo', 'todos.updateTodoStatus': 'updateTodoStatus', 'todos.updateTodo': 'updateTodo', 'todos.deleteTodo': 'deleteTodo', 'todos.restoreTodo': 'restoreTodo',
  'memos.createMemo': 'createMemo', 'memos.updateMemo': 'updateMemo', 'memos.uploadAttachment': 'uploadAttachment', 'memos.getAttachmentLink': 'getAttachmentLink',
  'memos.deleteMemo': 'deleteMemo', 'memos.restoreMemo': 'restoreMemo',
  'expenses.createExpense': 'createExpense', 'expenses.updateExpense': 'updateExpense', 'expenses.deleteExpense': 'deleteExpense', 'expenses.restoreExpense': 'restoreExpense',
  'expenses.recordSettlement': 'recordSettlement', 'expenses.reverseSettlement': 'reverseSettlement',
  'resources.search': 'searchHousehold', 'insights.list': 'listInsights',
  'notifications.list': 'listNotifications', 'notifications.markRead': 'markNotificationRead', 'notifications.snooze': 'snoozeNotification', 'notifications.stop': 'stopNotification',
  'notifications.resume': 'resumeNotification', 'notifications.getPreferences': 'getNotificationPreferences', 'notifications.updatePreferences': 'updateNotificationPreferences',
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
const mapped = new Set(Object.values(operationFor).filter(Boolean));
for (const id of operationIds) if (!mapped.has(id)) failures.push(`OpenAPI operation is not used by any gateway method: ${id}`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`OpenAPI/adapter contract audit passed: ${operationIds.length} unique operations mapped one-to-one to gateway methods, mutation and recovery boundaries present.`);
