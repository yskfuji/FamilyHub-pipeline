import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

export type ClamdBehavior = 'clean' | 'infected' | 'garbage' | 'silent';

/** clamd の INSTREAM を話す代役。受け取った長さの区切りを読み、決めた答えを返す。 */
export async function startFakeClamd(behavior: ClamdBehavior) {
  const server = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on('error', () => undefined);
    socket.on('data', (data) => {
      buffered = Buffer.concat([buffered, data]);
      if (buffered.toString('latin1').startsWith('zPING\0')) { socket.end('PONG\0'); return; }
      const start = buffered.indexOf(0) + 1;
      let at = start;
      while (at + 4 <= buffered.length) {
        const size = buffered.readUInt32BE(at);
        if (size === 0) {
          if (behavior === 'silent') return;
          socket.end(behavior === 'clean' ? 'stream: OK\0' : behavior === 'infected' ? 'stream: Win.Test.EICAR_HDB-1 FOUND\0' : '???\0');
          return;
        }
        at += 4 + size;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise((resolve) => server.close(resolve)) };
}
