import type { BgmPreset } from '../../domain/types';

/** スライドショーの曲。音源は持たず、ここに書いた和音からその場で合成する。 */
interface PresetSound {
  bpm: number;
  /** 4拍で1つの和音を鳴らす。MIDI の音の番号。 */
  chords: readonly (readonly number[])[];
  /** 1小節の分解和音。和音の何番目の音か。 */
  pattern: readonly number[];
  pad: OscillatorType;
  pluck: OscillatorType;
  padLevel: number;
  pluckLevel: number;
  cutoffHz: number;
}

export const bgmSounds: Record<BgmPreset, PresetSound> = {
  calm: { bpm: 58, chords: [[48, 55, 64, 72], [43, 55, 62, 71], [45, 52, 60, 69], [41, 53, 60, 69]], pattern: [1, 2, 3, 2], pad: 'sine', pluck: 'sine', padLevel: 0.11, pluckLevel: 0.12, cutoffHz: 900 },
  bright: { bpm: 104, chords: [[50, 57, 66, 74], [45, 57, 64, 73], [47, 54, 62, 71], [43, 55, 62, 71]], pattern: [1, 3, 2, 3, 1, 3, 2, 3], pad: 'triangle', pluck: 'triangle', padLevel: 0.07, pluckLevel: 0.14, cutoffHz: 2600 },
  gentle: { bpm: 76, chords: [[41, 57, 65, 72], [38, 57, 62, 69], [46, 58, 65, 74], [48, 55, 64, 72]], pattern: [1, 2, 3, 2, 3, 2], pad: 'sine', pluck: 'triangle', padLevel: 0.09, pluckLevel: 0.11, cutoffHz: 1500 },
};

const BEATS_PER_BAR = 4;
const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export interface BgmNote { frequency: number; beat: number; beats: number; level: number; wave: OscillatorType }

/** 1小節に鳴らす音。 */
export function barNotes(preset: BgmPreset, bar: number): BgmNote[] {
  const sound = bgmSounds[preset];
  const chord = sound.chords[bar % sound.chords.length];
  const pad = chord.slice(0, 3).map((note): BgmNote => ({ frequency: midiToHz(note), beat: 0, beats: BEATS_PER_BAR, level: sound.padLevel, wave: sound.pad }));
  const step = BEATS_PER_BAR / sound.pattern.length;
  const plucks = sound.pattern.map((index, position): BgmNote => ({ frequency: midiToHz(chord[index]), beat: position * step, beats: step * 1.6, level: sound.pluckLevel, wave: sound.pluck }));
  return [...pad, ...plucks];
}

export const barSeconds = (preset: BgmPreset) => (BEATS_PER_BAR * 60) / bgmSounds[preset].bpm;

export interface BgmPlayer {
  /** 利用者の操作の中で呼ぶ。鳴らせなければ false。 */
  play(preset: BgmPreset): Promise<boolean>;
  stop(): void;
  /** 0 から 1。 */
  setVolume(volume: number): void;
}

const LOOKAHEAD_SECONDS = 1;
const TICK_MS = 250;
const ATTACK_SECONDS = 0.04;
const FADE_SECONDS = 0.2;

function createDefaultContext() {
  return typeof AudioContext === 'undefined' ? null : new AudioContext();
}

export function createBgmPlayer(createContext: () => AudioContext | null = createDefaultContext): BgmPlayer {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let volume = 0.5;

  const playNote = (audio: AudioContext, output: AudioNode, note: BgmNote, start: number, seconds: number) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = note.wave;
    oscillator.frequency.value = note.frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(note.level, start + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    oscillator.connect(gain).connect(output);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + seconds + 0.02);
  };

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    const closing = context;
    const fading = master;
    context = null;
    master = null;
    if (!closing || !fading) return;
    fading.gain.setTargetAtTime(0, closing.currentTime, FADE_SECONDS / 4);
    setTimeout(() => { void closing.close().catch(() => undefined); }, FADE_SECONDS * 1000);
  };

  return {
    async play(preset) {
      stop();
      let audio: AudioContext | null;
      try { audio = createContext(); } catch { return false; }
      if (!audio) return false;
      const output = audio.createGain();
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = bgmSounds[preset].cutoffHz;
      output.gain.value = volume;
      filter.connect(output).connect(audio.destination);
      context = audio;
      master = output;
      try { await audio.resume(); } catch { stop(); return false; }
      if (context !== audio) return false;
      const seconds = barSeconds(preset);
      const beatSeconds = seconds / BEATS_PER_BAR;
      let bar = 0;
      let nextBarAt = audio.currentTime + 0.05;
      const schedule = () => {
        while (nextBarAt < audio.currentTime + LOOKAHEAD_SECONDS) {
          for (const note of barNotes(preset, bar)) playNote(audio, filter, note, nextBarAt + note.beat * beatSeconds, note.beats * beatSeconds);
          bar += 1;
          nextBarAt += seconds;
        }
      };
      schedule();
      timer = setInterval(schedule, TICK_MS);
      return true;
    },
    stop,
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      if (context && master) master.gain.setTargetAtTime(volume, context.currentTime, 0.02);
    },
  };
}
