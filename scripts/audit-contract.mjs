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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`OpenAPI/adapter contract audit passed: ${operationIds.length} unique operations, mutation and recovery boundaries present.`);
