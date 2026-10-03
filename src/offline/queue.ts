import type { EventInput, MemoInput, TodoInput } from '../domain/schemas';
import type { Id, IsoDate, RecurrenceScope } from '../domain/types';

export type QueueableCommand =
  | { operation: 'event.create'; summary: string; payload: { input: EventInput } }
  | { operation: 'event.update'; summary: string; payload: { id: Id; scope: RecurrenceScope; input: Partial<EventInput>; expectedVersion: number; occurrenceDate?: IsoDate } }
  | { operation: 'task.create'; summary: string; payload: { input: TodoInput } }
  | { operation: 'task.update'; summary: string; payload: { id: Id; scope: RecurrenceScope; input: Partial<TodoInput>; expectedVersion: number } }
  | { operation: 'memo.create'; summary: string; payload: { input: MemoInput } }
  | { operation: 'memo.update'; summary: string; payload: { id: Id; input: Partial<MemoInput>; expectedVersion: number } };

export type QueueState = 'pending' | 'conflicted' | 'blocked';

interface StoredRecord {
  id: string;
  clientOperationId: string;
  actorUserId: Id;
  householdId: Id;
  permissionRevision: number;
  operation: QueueableCommand['operation'];
  schemaVersion: 1;
  createdAt: number;
  expiresAt: number;
  state: QueueState;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export type QueuedCommand = Omit<StoredRecord, 'iv' | 'ciphertext'> & QueueableCommand;

export interface QueuePersistence {
  getKey(): Promise<CryptoKey | undefined>;
  setKey(key: CryptoKey): Promise<void>;
  load(): Promise<StoredRecord[]>;
  save(records: StoredRecord[]): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryQueuePersistence implements QueuePersistence {
  private key?: CryptoKey;
  private records: StoredRecord[] = [];
  async getKey() { return this.key; }
  async setKey(key: CryptoKey) { this.key = key; }
  async load() { return structuredClone(this.records); }
  async save(records: StoredRecord[]) { this.records = structuredClone(records); }
  async clear() { this.records = []; this.key = undefined; }
}

const DB_NAME = 'family-hub-offline-v1';
const STORE = 'queue';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
  });
}

export class IndexedDbQueuePersistence implements QueuePersistence {
  async getKey() { return transact('readonly', (store) => store.get('key')) as Promise<CryptoKey | undefined>; }
  async setKey(key: CryptoKey) { await transact('readwrite', (store) => store.put(key, 'key')); }
  async load() { return (await transact('readonly', (store) => store.get('records')) as StoredRecord[] | undefined) ?? []; }
  async save(records: StoredRecord[]) { await transact('readwrite', (store) => store.put(records, 'records')); }
  async clear() {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).clear();
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
    });
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_ITEMS = 50;
const TTL_MS = 24 * 60 * 60 * 1000;

function additionalData(record: Pick<StoredRecord, 'id' | 'clientOperationId' | 'actorUserId' | 'householdId' | 'permissionRevision' | 'operation' | 'schemaVersion' | 'createdAt' | 'expiresAt'>) {
  return encoder.encode(JSON.stringify({
    id: record.id, clientOperationId: record.clientOperationId, actorUserId: record.actorUserId,
    householdId: record.householdId, permissionRevision: record.permissionRevision,
    operation: record.operation, schemaVersion: record.schemaVersion, createdAt: record.createdAt, expiresAt: record.expiresAt,
  }));
}

export class EncryptedOfflineQueue {
  constructor(private readonly persistence: QueuePersistence, private readonly now = () => Date.now()) {}

  private async key() {
    const existing = await this.persistence.getKey();
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await this.persistence.setKey(key);
    return key;
  }

  private async currentRecords() {
    const now = this.now();
    const records = (await this.persistence.load()).filter((item) => item.expiresAt > now);
    await this.persistence.save(records);
    return records;
  }

  async enqueue(command: QueueableCommand, context: { actorUserId: Id; householdId: Id; permissionRevision: number }) {
    const records = await this.currentRecords();
    if (records.length >= MAX_ITEMS) throw new Error('未送信の変更は50件まで保存できます。不要な項目を削除してください。');
    const createdAt = this.now();
    const recordBase = {
      id: crypto.randomUUID(), clientOperationId: crypto.randomUUID(), ...context,
      operation: command.operation, schemaVersion: 1 as const, createdAt, expiresAt: createdAt + TTL_MS,
    };
    const iv = crypto.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer;
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(recordBase) },
      await this.key(),
      encoder.encode(JSON.stringify({ summary: command.summary, payload: command.payload })),
    );
    const record: StoredRecord = { ...recordBase, state: 'pending', iv, ciphertext };
    await this.persistence.save([...records, record]);
    return record.id;
  }

  async list(): Promise<QueuedCommand[]> {
    const key = await this.key();
    const records = await this.currentRecords();
    return Promise.all(records.map(async (record) => {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: additionalData(record) }, key, record.ciphertext);
      const command = JSON.parse(decoder.decode(plain)) as Pick<QueueableCommand, 'summary' | 'payload'>;
      return { ...record, summary: command.summary, payload: command.payload } as QueuedCommand;
    }));
  }

  async remove(id: string) { await this.persistence.save((await this.currentRecords()).filter((item) => item.id !== id)); }
  async mark(id: string, state: QueueState) { await this.persistence.save((await this.currentRecords()).map((item) => item.id === id ? { ...item, state } : item)); }
  async clear() { await this.persistence.clear(); }
}

export const queueableOperations = new Set<QueueableCommand['operation']>(['event.create', 'event.update', 'task.create', 'task.update', 'memo.create', 'memo.update']);
