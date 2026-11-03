/**
 * 確認用の実装が変更の記録を残すための対応表。ゲートウェイのメソッド → OpenAPI の operationId。
 * API は経路の宣言（operationId）で記録を残すので、同じ操作は両方で同じ記録になる（同等性の試験で確かめる）。
 * scripts/audit-contract.mjs が、ここの operationId と operationFor の対応が一致することを確かめる。
 *
 * - params: 経路にある ID の数。メソッドの先頭の引数がその ID で、記録の対象は「/」でつなげたもの。
 * - created: 経路に ID がない作成の操作。作った記録の ID を対象にする。
 * - fieldsArg: 変更の入力の引数の位置。記録には項目の名前だけを残す（値は残さない）。
 * - household: 家族の記録か（false はアカウントの記録）。
 * 確認用の実装に、サインインや家族の作成・招待の参加などの流れはないので、ここには載せない。
 */
export interface AuditedOperation { operationId: string; params: number; created?: boolean; fieldsArg?: number; household: boolean }

const household = (operationId: string, params: number, extra: Partial<AuditedOperation> = {}): AuditedOperation => ({ operationId, params, household: true, ...extra });
const account = (operationId: string, extra: Partial<AuditedOperation> = {}): AuditedOperation => ({ operationId, params: 0, household: false, ...extra });

export const auditedGatewayOperations: Readonly<Record<string, AuditedOperation>> = {
  'auth.updateAccount': account('updateAccount', { fieldsArg: 0 }),
  'auth.changeEmail': account('changeEmail'),
  'auth.deleteAccount': account('deleteAccount'),
  'auth.confirmTotpEnrollment': account('confirmTotpEnrollment'),
  'auth.disableTotp': account('disableTotp'),
  'auth.finishPasskeyRegistration': account('finishPasskeyRegistration'),
  'auth.changePassword': account('changePassword'),
  'auth.revokeSession': account('revokeSession'),
  'household.updateProfile': household('updateHouseholdProfile', 0),
  'household.updateMembershipRole': household('updateMembershipRole', 1),
  'household.createInvite': household('createHouseholdInvite', 0, { created: true }),
  'household.revokeInvite': household('revokeHouseholdInvite', 1),
  'household.updatePermissionOverrides': household('updatePermissionOverrides', 1),
  'household.resetPermissionOverrides': household('resetPermissionOverrides', 1),
  'household.savePrivacySettings': household('savePrivacySettings', 0),
  'events.createEvent': household('createEvent', 0, { created: true }),
  'events.updateEvent': household('updateRecurringEvent', 1, { fieldsArg: 2 }),
  'events.deleteEvent': household('deleteEvent', 1),
  'events.restoreEvent': household('restoreEvent', 1),
  'todos.createTodo': household('createTodo', 0, { created: true }),
  'todos.updateTodoStatus': household('updateTodoStatus', 1),
  'todos.updateTodo': household('updateTodo', 1, { fieldsArg: 2 }),
  'todos.deleteTodo': household('deleteTodo', 1),
  'todos.restoreTodo': household('restoreTodo', 1),
  'memos.createMemo': household('createMemo', 0, { created: true }),
  'memos.updateMemo': household('updateMemo', 1, { fieldsArg: 1 }),
  'memos.uploadAttachment': household('uploadAttachment', 1),
  'memos.deleteAttachment': household('deleteAttachment', 2),
  'memos.deleteMemo': household('deleteMemo', 1),
  'memos.restoreMemo': household('restoreMemo', 1),
  'expenses.createExpense': household('createExpense', 0, { created: true }),
  'expenses.updateExpense': household('updateExpense', 1, { fieldsArg: 1 }),
  'expenses.deleteExpense': household('deleteExpense', 1),
  'expenses.restoreExpense': household('restoreExpense', 1),
  'expenses.recordSettlement': household('recordSettlement', 1),
  'expenses.reverseSettlement': household('reverseSettlement', 2),
  'albums.createAlbum': household('createAlbum', 0, { created: true }),
  'albums.updateAlbum': household('updateAlbum', 1, { fieldsArg: 1 }),
  'albums.deleteAlbum': household('deleteAlbum', 1),
  'albums.restoreAlbum': household('restoreAlbum', 1),
  'albums.reorderItems': household('reorderAlbumItems', 1),
  'albums.deleteItem': household('deleteAlbumItem', 2),
  'albums.restoreItem': household('restoreAlbumItem', 2),
  'family.transferOwnership': household('transferOwnership', 0),
  'family.setMemberStatus': household('setMemberStatus', 1),
  'family.removeMember': household('removeMember', 1),
  'family.leaveHousehold': household('leaveHousehold', 0),
  'family.createColorLabel': household('createColorLabel', 0, { created: true }),
  'family.updateColorLabel': household('updateColorLabel', 1),
  'family.deleteColorLabel': household('deleteColorLabel', 1),
  'links.createLink': household('createItemLink', 0, { created: true }),
  'links.deleteLink': household('deleteItemLink', 1),
  'notifications.markRead': household('markNotificationRead', 1),
  'notifications.snooze': household('snoozeNotification', 1),
  'notifications.stop': household('stopNotification', 1),
  'notifications.resume': household('resumeNotification', 1),
  'notifications.updatePreferences': household('updateNotificationPreferences', 0),
  'assistant.readReceipt': household('readReceipt', 0),
  'assistant.readEventImage': household('readEventImage', 0),
  'assistant.readEventUrl': household('readEventUrl', 0),
};
