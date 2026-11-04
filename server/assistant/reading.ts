import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { parseEventOutput, parseReceiptOutput } from '../../src/domain/assistant';
import type { EventCandidate, ReceiptProposal } from '../../src/domain/assistant';
import { dateKeyFromRfc3339 } from '../../src/domain/calendarDate';
import type { IsoDate } from '../../src/domain/types';
import type { LlmUserContent } from '../adapters/llm';
import type { AppDeps } from '../http/context';
import { readingPrompts } from '../../src/content/serverMessages';

export type ReadingFailure = 'unreadable' | 'not-safe';

export class ReadingError extends Error {
  readonly code: ReadingFailure;
  constructor(code: ReadingFailure) { super(code); this.code = code; }
}

const IMAGE_SIDE_MAX = 1600;
const IMAGE_PIXELS_MAX = 40_000_000;

/** 画像を読み直して小さくする。読み直すことで、位置情報などの付加情報を外へ送らない。 */
async function imageContent(deps: AppDeps, path: string, instruction: string): Promise<LlmUserContent> {
  if (await deps.scanner.scan(path) !== 'clean') throw new ReadingError('not-safe');
  try {
    const bytes = await sharp(path, { failOn: 'error', limitInputPixels: IMAGE_PIXELS_MAX }).rotate().resize({ width: IMAGE_SIDE_MAX, height: IMAGE_SIDE_MAX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` } }];
  } catch {
    throw new ReadingError('unreadable');
  }
}

const todayOf = (deps: AppDeps) => dateKeyFromRfc3339(deps.clock.now()) as IsoDate;

export async function readReceiptImage(deps: AppDeps, path: string): Promise<{ receipt: ReceiptProposal }> {
  const output = await deps.llm.complete(readingPrompts.receiptSystem, await imageContent(deps, path, readingPrompts.receiptImage));
  const receipt = parseReceiptOutput(output, todayOf(deps));
  if (!receipt) throw new ReadingError('unreadable');
  return { receipt };
}

function candidates(deps: AppDeps, output: unknown): { events: EventCandidate[] } {
  const events = parseEventOutput(output, todayOf(deps));
  if (!events) throw new ReadingError('unreadable');
  return { events };
}

export async function readEventImage(deps: AppDeps, path: string) {
  return candidates(deps, await deps.llm.complete(readingPrompts.eventSystem, await imageContent(deps, path, readingPrompts.eventImage)));
}

/** ページの本文は JSON の値として渡す。区切りを偽装して指示の形にすることはできない。 */
export async function readEventPage(deps: AppDeps, address: string) {
  const page = await deps.pages.read(address);
  if (!page.text) throw new ReadingError('unreadable');
  return candidates(deps, await deps.llm.complete(readingPrompts.eventSystem, readingPrompts.eventPage(JSON.stringify({ page_url: page.url, page_text: page.text }))));
}

export const removeFile = (path: string) => rm(path, { force: true });
