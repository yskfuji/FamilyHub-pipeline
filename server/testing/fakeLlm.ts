import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeLlmMode = 'valid' | 'malformed' | 'invalid' | 'timeout' | 'error' | 'redirect' | 'huge';

export interface FakeLlmRequest { authorization?: string; body: { model: string; messages: Array<{ role: string; content: unknown }> } }

export interface FakeLlm {
  url: string;
  requests: FakeLlmRequest[];
  /** 受け付けた TCP の接続の数。 */
  connections(): number;
  setMode(mode: FakeLlmMode): void;
  /** timeout の応答を待たせている接続を返させる。 */
  release(): void;
  close(): Promise<void>;
}

export const fakeReceipt = { total: 2480, date_text: '2026年9月29日', merchant: '試験スーパー', category: 'food' };
export const fakeEvents = { candidates: [
  { title: '試験の区民まつり', date_text: '10月27日', start_time: '10:00', end_time: '15:30', all_day: false, location: '中央公園' },
  { title: '試験の区民まつり（予備日）', date_text: '11月3日', start_time: null, end_time: null, all_day: true, location: null },
] };

const reply = (response: ServerResponse, status: number, body: string, type = 'application/json') => { response.writeHead(status, { 'Content-Type': type }); response.end(body); };
const completion = (content: string) => JSON.stringify({ id: 'fake', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content } }] });

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/** 本物の LLM の代わりに loopback で応える代役。試験のほかでは使わない。 */
export async function startFakeLlm(port = 0): Promise<FakeLlm> {
  let mode: FakeLlmMode = 'valid';
  const requests: FakeLlmRequest[] = [];
  let waiting: ServerResponse[] = [];
  const server: Server = createServer((request, response) => {
    void (async () => {
      const text = await readBody(request);
      if (request.url === '/health') return reply(response, 200, '{"status":"ok"}');
      if (request.url === '/__mode') { mode = (JSON.parse(text) as { mode: FakeLlmMode }).mode; return reply(response, 200, '{}'); }
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) return reply(response, 404, '{}');
      const body = JSON.parse(text) as FakeLlmRequest['body'];
      requests.push({ authorization: request.headers.authorization, body });
      const system = String(body.messages[0]?.content);
      const valid = system.includes('領収書') ? fakeReceipt : fakeEvents;
      if (mode === 'error') return reply(response, 500, '{"error":"failed"}');
      if (mode === 'malformed') return reply(response, 200, completion('これは JSON ではありません'));
      if (mode === 'invalid') return reply(response, 200, completion(JSON.stringify({ total: -5, date_text: 7, merchant: { a: 1 }, category: 'nothing', candidates: 'none' })));
      if (mode === 'timeout') { waiting.push(response); return undefined; }
      if (mode === 'redirect') { response.writeHead(307, { Location: 'http://127.0.0.1:9/v1/chat/completions' }); response.end(); return undefined; }
      if (mode === 'huge') return reply(response, 200, completion('x'.repeat(1024 * 1024 + 16)));
      return reply(response, 200, completion(JSON.stringify(valid)));
    })();
  });
  let connections = 0;
  server.on('connection', () => { connections += 1; });
  await new Promise<void>((resolve) => { server.listen(port, '127.0.0.1', resolve); });
  server.unref();
  const release = () => { for (const response of waiting) response.destroy(); waiting = []; };
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    connections: () => connections,
    setMode: (next) => { mode = next; },
    release,
    close: () => new Promise((resolve) => { release(); server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
