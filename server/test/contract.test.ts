import { afterAll, describe, expect, it } from 'vitest';
import { routeTable } from '../http/app';
import { contractOperations } from '../testing/contract';
import { createWorld } from '../testing/world';

const world = createWorld();
afterAll(() => world.close());

describe('routes and contract', () => {
  it('declares exactly the operations in the OpenAPI contract, both ways', async () => {
    await world.ready;
    const served = routeTable.map((item) => `${item.method} ${item.url.replace(/:([A-Za-z]+)/g, '{$1}')} ${item.declaration.operationId}`).sort();
    const contracted = contractOperations().map((item) => `${item.method} ${item.path} ${item.operationId}`).sort();
    expect(served).toEqual(contracted);
  });

  it('protects every mutation with CSRF, except where sign-in has no session yet and is still checked', async () => {
    await world.ready;
    const unprotected = routeTable.filter((item) => !['GET', 'HEAD'].includes(item.method) && !item.declaration.csrf);
    expect(unprotected).toEqual([]);
  });

  it('declares idempotency for every household data mutation', async () => {
    await world.ready;
    const rule = routeTable.filter((item) => item.method !== 'GET' && item.declaration.capability === 'rule');
    expect(rule.filter((item) => !item.declaration.idempotent)).toEqual([]);
  });
});
