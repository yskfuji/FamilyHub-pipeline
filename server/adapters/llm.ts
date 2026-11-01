import { z } from 'zod';
import { jsonOfOutput } from '../../src/domain/assistant';
import type { ServerConfig } from '../config';

export type LlmUserContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export type LlmFailure = 'timeout' | 'unavailable' | 'malformed';

export class LlmError extends Error {
  readonly code: LlmFailure;
  constructor(code: LlmFailure) { super(code); this.code = code; }
}

export interface LlmClient {
  readonly available: boolean;
  /** 応答の本文を JSON として返す。形の確認は呼ぶ側で行う（応答は信用しない）。 */
  complete(system: string, user: LlmUserContent): Promise<unknown>;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 1200;

const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(100_000) }) })).min(1) });

const disabled: LlmClient = { available: false, complete: () => Promise.reject(new LlmError('unavailable')) };

async function bodyOf(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new LlmError('malformed');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new LlmError('malformed'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** OpenAI 互換の /chat/completions。設定がなければ使えない状態を返す。内容は記録に残さない。 */
export function createLlmClient(config: ServerConfig['llm']): LlmClient {
  if (!config) return disabled;
  const endpoint = `${config.url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`;
  return {
    available: true,
    async complete(system, user) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
          headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
          body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        });
        if (!response.ok) throw new LlmError('unavailable');
        const parsed = envelope.safeParse(JSON.parse(await bodyOf(response)));
        const output = parsed.success ? jsonOfOutput(parsed.data.choices[0].message.content) : null;
        if (output === null) throw new LlmError('malformed');
        return output;
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (error instanceof SyntaxError) throw new LlmError('malformed');
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new LlmError('timeout');
        throw new LlmError('unavailable');
      }
    },
  };
}
