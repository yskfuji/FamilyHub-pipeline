import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LlmError, createLlmClient } from '../adapters/llm';
import { loadConfig } from '../config';
import { startFakeLlm } from '../testing/fakeLlm';
import type { FakeLlm } from '../testing/fakeLlm';

let double: FakeLlm;
beforeAll(async () => { double = await startFakeLlm(); });
afterEach(() => { double.setMode('valid'); double.release(); double.requests.length = 0; });
afterAll(() => double.close());

const client = (timeoutMs = 2000) => createLlmClient({ url: double.url, key: 'secret-key', model: 'test-model', timeoutMs });
const code = async (work: Promise<unknown>) => { try { await work; return 'none'; } catch (error) { return (error as LlmError).code; } };

describe('createLlmClient', () => {
  it('is unavailable without configuration and refuses to run', async () => {
    const disabled = createLlmClient(null);
    expect(disabled.available).toBe(false);
    expect(await code(disabled.complete('s', 'u'))).toBe('unavailable');
  });

  it('calls /chat/completions and returns the parsed content', async () => {
    const output = await client().complete('領収書を読みます', 'data');
    expect(output).toMatchObject({ total: 2480 });
    expect(double.requests[0].authorization).toBe('Bearer secret-key');
    expect(double.requests[0].body).toMatchObject({ model: 'test-model', messages: [{ role: 'system', content: '領収書を読みます' }, { role: 'user', content: 'data' }] });
  });

  it('accepts a URL that already ends in the path', async () => {
    expect(await createLlmClient({ url: `${double.url}/chat/completions/`, model: 'm', timeoutMs: 2000 }).complete('領収書', 'x')).toMatchObject({ total: 2480 });
    expect(double.requests[0].authorization).toBeUndefined();
  });

  it('reports malformed output, an error status and a timeout', async () => {
    double.setMode('malformed');
    expect(await code(client().complete('s', 'u'))).toBe('malformed');
    double.setMode('error');
    expect(await code(client().complete('s', 'u'))).toBe('unavailable');
    double.setMode('timeout');
    expect(await code(client(100).complete('s', 'u'))).toBe('timeout');
  });

  it('reports a connection failure without the URL or the key', async () => {
    const error = await createLlmClient({ url: 'http://127.0.0.1:9/v1', key: 'secret-key', model: 'm', timeoutMs: 500 }).complete('s', 'u').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toBe('unavailable');
  });
});

describe('configuration', () => {
  it('is off by default', () => expect(loadConfig({}).llm).toBeNull());

  it('reads the settings', () => {
    expect(loadConfig({ FAMILY_HUB_LLM_URL: 'https://llm.example/v1', FAMILY_HUB_LLM_KEY: 'k', FAMILY_HUB_LLM_MODEL: 'm' }).llm).toEqual({ url: 'https://llm.example/v1', key: 'k', model: 'm', timeoutMs: 45_000 });
  });

  it('requires a model and refuses plain http away from loopback', () => {
    expect(() => loadConfig({ FAMILY_HUB_LLM_URL: 'https://llm.example/v1' })).toThrow('MODEL');
    expect(() => loadConfig({ FAMILY_HUB_LLM_URL: 'http://llm.example/v1', FAMILY_HUB_LLM_MODEL: 'm' })).toThrow('https');
    expect(loadConfig({ FAMILY_HUB_LLM_URL: 'http://127.0.0.1:8080/v1', FAMILY_HUB_LLM_MODEL: 'm' }).llm?.url).toContain('127.0.0.1');
  });
});
