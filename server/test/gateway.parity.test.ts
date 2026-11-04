import { afterAll, expect, it } from 'vitest';
import { runGatewaySuite } from '../../src/data/gateway.suite';
import { responseViolation } from '../testing/contract';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const worlds: World[] = [];
const violations: string[] = [];
afterAll(async () => { await Promise.all(worlds.map((world) => world.close())); });

runGatewaySuite((actor) => {
  const world = createWorld(actor, (body, request) => {
    const violation = responseViolation(request.method, request.url, request.status, body);
    if (violation) violations.push(violation);
  });
  worlds.push(world);
  return world.gateway;
});

it('answers every call in the shape the contract declares', () => {
  expect([...new Set(violations)]).toEqual([]);
});
