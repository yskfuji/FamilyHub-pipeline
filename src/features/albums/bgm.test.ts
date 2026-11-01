import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barNotes, barSeconds, bgmSounds, createBgmPlayer } from './bgm';
import type { BgmPreset } from '../../domain/types';

const presets = Object.keys(bgmSounds) as BgmPreset[];

function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const node = () => ({ gain: param(), frequency: param(), type: '', connect(target: unknown) { return target; }, disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null });
  const oscillators: ReturnType<typeof node>[] = [];
  const gains: ReturnType<typeof node>[] = [];
  const audio = {
    currentTime: 0, destination: {}, resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    createOscillator: () => { const created = node(); oscillators.push(created); return created; },
    createGain: () => { const created = node(); gains.push(created); return created; },
    createBiquadFilter: node,
  };
  return { audio, oscillators, gains, create: () => audio as unknown as AudioContext };
}

describe('the three presets', () => {
  it('sound different from one another', () => {
    const fingerprints = presets.map((preset) => JSON.stringify(barNotes(preset, 0)));
    expect(new Set(fingerprints).size).toBe(3);
  });
  it('produce audible, finite notes that stay inside the bar on every chord', () => {
    for (const preset of presets) {
      for (let bar = 0; bar < 8; bar += 1) {
        for (const note of barNotes(preset, bar)) {
          expect(note.frequency).toBeGreaterThan(30);
          expect(note.frequency).toBeLessThan(2000);
          expect(note.beat).toBeLessThan(4);
          expect(note.level).toBeLessThan(0.2);
        }
      }
      expect(barSeconds(preset)).toBeGreaterThan(1);
    }
  });
  it('move through the chords and repeat', () => {
    expect(barNotes('calm', 0)).not.toEqual(barNotes('calm', 1));
    expect(barNotes('calm', 0)).toEqual(barNotes('calm', 4));
  });
});

describe('createBgmPlayer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('makes no sound until play, then schedules notes', async () => {
    const fake = fakeContext();
    const player = createBgmPlayer(fake.create);
    expect(fake.oscillators).toHaveLength(0);
    expect(await player.play('calm')).toBe(true);
    expect(fake.audio.resume).toHaveBeenCalled();
    expect(fake.oscillators.length).toBeGreaterThan(0);
    player.stop();
  });

  it('keeps scheduling as time passes and stops scheduling after stop', async () => {
    const fake = fakeContext();
    const player = createBgmPlayer(fake.create);
    await player.play('bright');
    const first = fake.oscillators.length;
    fake.audio.currentTime = 30;
    vi.advanceTimersByTime(300);
    expect(fake.oscillators.length).toBeGreaterThan(first);
    player.stop();
    const stopped = fake.oscillators.length;
    fake.audio.currentTime = 60;
    vi.advanceTimersByTime(1000);
    expect(fake.oscillators).toHaveLength(stopped);
    expect(fake.audio.close).toHaveBeenCalledTimes(1);
  });

  it('clamps the volume and applies it while playing', async () => {
    const fake = fakeContext();
    const player = createBgmPlayer(fake.create);
    player.setVolume(4);
    await player.play('gentle');
    expect(fake.gains[0].gain.value).toBe(1);
    player.setVolume(-1);
    expect(fake.gains[0].gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, expect.any(Number));
    player.stop();
  });

  it('replaces the running preset instead of layering two', async () => {
    const first = fakeContext();
    const second = fakeContext();
    const contexts = [first, second];
    const player = createBgmPlayer(() => contexts.shift()!.create());
    await player.play('calm');
    await player.play('gentle');
    vi.advanceTimersByTime(300);
    expect(first.audio.close).toHaveBeenCalledTimes(1);
    expect(second.audio.close).not.toHaveBeenCalled();
    player.stop();
  });

  it('reports when the browser has no audio', async () => {
    expect(await createBgmPlayer(() => null).play('calm')).toBe(false);
    expect(await createBgmPlayer(() => { throw new Error('blocked'); }).play('calm')).toBe(false);
  });

  it('stop is safe when nothing is playing', () => {
    expect(() => createBgmPlayer(() => null).stop()).not.toThrow();
  });
});
