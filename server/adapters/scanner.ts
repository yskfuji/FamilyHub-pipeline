import { createReadStream } from 'node:fs';
import { connect } from 'node:net';
import type { ServerConfig } from '../config';

export interface Scanner {
  /** clean のときだけ保存してよい。感染、接続できない、時間切れ、壊れた応答はすべて clean にしない。 */
  scan(path: string): Promise<'clean' | 'infected' | 'failed'>;
  ready(): Promise<boolean>;
}

const CHUNK = 64 * 1024;

/** clamd の INSTREAM。追加の部品を増やさず、標準の TCP だけで話す。 */
export function createClamdScanner(host: string, port: number, timeoutMs: number): Scanner {
  const talk = (write: (send: (value: Buffer) => boolean, finish: () => void, drained: () => Promise<void>) => Promise<void>) => new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, timeoutMs);
    const settle = (action: () => void) => { clearTimeout(timer); action(); };
    socket.on('error', (error) => settle(() => reject(error)));
    socket.on('data', (data) => chunks.push(data));
    socket.on('end', () => settle(() => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim())));
    socket.on('connect', () => {
      write((value) => socket.write(value), () => socket.end(), () => new Promise((done) => socket.once('drain', () => done()))).catch((error: unknown) => { socket.destroy(); settle(() => reject(error)); });
    });
  });
  return {
    async scan(path) {
      try {
        const answer = await talk(async (send, finish, drained) => {
          send(Buffer.from('zINSTREAM\0'));
          for await (const chunk of createReadStream(path, { highWaterMark: CHUNK })) {
            const size = Buffer.alloc(4);
            size.writeUInt32BE((chunk as Buffer).length);
            if (!send(Buffer.concat([size, chunk as Buffer]))) await drained();
          }
          send(Buffer.alloc(4));
          finish();
        });
        if (/: OK$/.test(answer)) return 'clean';
        return /FOUND$/.test(answer) ? 'infected' : 'failed';
      } catch {
        return 'failed';
      }
    },
    async ready() {
      try { return (await talk(async (send, finish) => { send(Buffer.from('zPING\0')); finish(); })) === 'PONG'; } catch { return false; }
    },
  };
}

/** 開発用。本番では起動を拒否する。 */
const developmentScanner: Scanner = { scan: async () => 'clean', ready: async () => true };

export function createScanner(config: ServerConfig): Scanner {
  if (config.clamd) return createClamdScanner(config.clamd.host, config.clamd.port, config.clamd.timeoutMs);
  if (config.production) throw new Error('production requires a virus scanner (FAMILY_HUB_CLAMD_HOST)');
  return developmentScanner;
}
