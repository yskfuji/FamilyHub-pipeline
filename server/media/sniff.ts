/** ファイルの先頭から種類を判定する。送られてきた名前や種類の申告は信じない。 */
export type SniffedType = { mimeType: 'image/jpeg' | 'image/png' | 'application/pdf' | 'video/mp4' | 'video/quicktime'; kind: 'photo' | 'video' | 'document' };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

const heifBrands = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif']);

export type SniffResult = SniffedType | { rejected: 'heic' | 'unknown' };

export function sniff(bytes: Uint8Array): SniffResult {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', kind: 'photo' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: 'image/png', kind: 'photo' };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mimeType: 'application/pdf', kind: 'document' };
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (heifBrands.has(brand)) return { rejected: 'heic' };
    return brand === 'qt  ' ? { mimeType: 'video/quicktime', kind: 'video' } : { mimeType: 'video/mp4', kind: 'video' };
  }
  return { rejected: 'unknown' };
}
