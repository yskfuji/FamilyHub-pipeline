import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../app/AppContext';
import { bgmLabels, ja } from '../../content/ja';
import { useModalBehavior } from '../../design-system/components';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, MusicIcon, PauseIcon, PlayIcon } from '../../design-system/icons';
import { slideshowItems, stepIndex } from '../../domain/albumView';
import type { Album, AlbumItem, BgmPreset } from '../../domain/types';
import { createBgmPlayer } from './bgm';
import { shouldIgnoreArrowKeys } from './MediaViewer';
import { useIdleControls } from './useIdleControls';
import { useReducedMotion } from './useReducedMotion';

/** 写真を見せる時間。動画はこの時間では送らず、最後まで再生してから次へ進む。 */
export const SLIDE_MS = 5000;
const presets = Object.keys(bgmLabels) as BgmPreset[];

interface Props {
  album: Album;
  items: readonly AlbumItem[];
  onClose: () => void;
}

export function Slideshow({ album, items, onClose }: Props) {
  const { gateway, announce } = useApp();
  const [includeVideos, setIncludeVideos] = useState(true);
  const { items: slides, keptVideos } = useMemo(() => slideshowItems(items, includeVideos), [items, includeVideos]);
  /** lap は表示のたびに増やす。同じ項目へ戻っても、時間を測り直して動きを始めからにする。 */
  const [position, setPosition] = useState({ id: slides[0]?.id, lap: 0 });
  const [paused, setPaused] = useState(false);
  const [stoppedByHiding, setStoppedByHiding] = useState(false);
  const [failedSlide, setFailedSlide] = useState<string | null>(null);
  const [player] = useState(() => createBgmPlayer());
  const [playing, setPlaying] = useState(false);
  const [preset, setPreset] = useState<BgmPreset>(album.bgmPreset ?? 'calm');
  const [volume, setVolume] = useState(0.5);
  const video = useRef<HTMLVideoElement>(null);
  const pauseButton = useRef<HTMLButtonElement>(null);
  const root = useModalBehavior(onClose);
  const reducedMotion = useReducedMotion();
  const controlsShown = useIdleControls(paused);
  const index = Math.max(0, slides.findIndex((item) => item.id === position.id));
  const slide = slides[index];
  const slideKey = `${slide?.id}-${position.lap}`;
  const isVideo = slide?.kind === 'video';
  const videoFailed = failedSlide === slideKey;

  const go = (step: number) => setPosition((current) => ({ id: slides[stepIndex(index, slides.length, step)]?.id, lap: current.lap + 1 }));
  const advance = useEffectEvent(() => go(1));

  useEffect(() => {
    if (paused || !slideKey || (isVideo && !videoFailed)) return;
    const timer = window.setTimeout(() => advance(), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [paused, slideKey, isVideo, videoFailed]);

  // 動画は音つきで始め、止められたら音を消して始め直す。それでも再生できなければ、写真と同じ時間で送る。
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) { element.pause(); return; }
    const failed = () => setFailedSlide(slideKey);
    element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      element.muted = true;
      element.play().catch(failed);
    });
  }, [paused, slideKey]);

  // 次の写真を先に読んでおく。
  const upcoming = slides[stepIndex(index, slides.length, 1)];
  useEffect(() => {
    if (upcoming?.kind === 'photo') new Image().src = gateway.albums.mediaUrl(upcoming, 'file');
  }, [gateway, upcoming]);

  // 最初のボタンは閉じるボタンなので、スペースキーで閉じてしまわないよう、一時停止へ移す。
  useEffect(() => { pauseButton.current?.focus(); }, []);

  const togglePause = () => { setPaused((value) => !value); setStoppedByHiding(false); };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (shouldIgnoreArrowKeys(event.target)) return;
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === ' ' && !(event.target instanceof HTMLElement && event.target.closest('button, a'))) { event.preventDefault(); togglePause(); }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  // 見ていないあいだは、写真も音も止める。戻ったら利用者が再開する。
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== 'hidden') return;
      setPaused(true);
      setStoppedByHiding(true);
      player.stop();
      setPlaying(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [player]);
  useEffect(() => () => player.stop(), [player]);

  const startMusic = async (next: BgmPreset) => {
    const started = await player.play(next);
    setPlaying(started);
    if (!started) announce('この環境では曲を再生できません。');
  };
  const toggleMusic = () => {
    if (playing) { player.stop(); setPlaying(false); } else void startMusic(preset);
  };
  const changePreset = (next: BgmPreset) => {
    setPreset(next);
    if (playing) void startMusic(next);
  };
  const changeVolume = (next: number) => { setVolume(next); player.setVolume(next); };

  if (!slide) return null;
  const fileUrl = gateway.albums.mediaUrl(slide, 'file');
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root data-theme="dusk" className="media-screen slideshow" data-controls={controlsShown ? 'shown' : 'hidden'} data-paused={paused} role="dialog" aria-modal="true" aria-label={`スライドショー：${album.title}`}>
    <div className="media-stage" key={slideKey}>
      {isVideo
        ? <video ref={video} className="media-full" src={fileUrl} poster={slide.hasThumbnail ? gateway.albums.mediaUrl(slide, 'thumbnail') : undefined} muted={playing} playsInline preload="auto" aria-label={slide.originalName} onEnded={() => go(1)} onError={() => setFailedSlide(slideKey)}/>
        : <img className={`media-full${reducedMotion ? '' : ` slide-zoom ${index % 2 ? 'slide-zoom-out' : 'slide-zoom-in'}`}`} src={fileUrl} alt={slide.originalName}/>}
    </div>
    <header className="media-bar">
      <button data-control-id="albums.slideshow.close" className="icon-button" type="button" aria-label={ja.actions.close} onClick={onClose}><CloseIcon/></button>
      <p className="media-count" aria-live="off">{index + 1} / {slides.length}</p>
      <p className="media-name">{album.title}</p>
    </header>
    <div className="slideshow-panel">
      {(stoppedByHiding || keptVideos) && <p className="slideshow-note" role="status">{stoppedByHiding ? 'タブを離れたので止めました。再生で続きから流します。' : '写真がないので、動画を流しています。'}</p>}
      <div className="slideshow-row">
        <button data-control-id="albums.slideshow.previous" className="icon-button" type="button" aria-label="前へ" onClick={() => go(-1)}><ChevronLeftIcon/></button>
        <button ref={pauseButton} data-control-id="albums.slideshow.pause" className="icon-button" type="button" aria-label={paused ? '再生' : '一時停止'} onClick={togglePause}>{paused ? <PlayIcon/> : <PauseIcon/>}</button>
        <button data-control-id="albums.slideshow.next" className="icon-button" type="button" aria-label="次へ" onClick={() => go(1)}><ChevronRightIcon/></button>
        <label className="check-row slideshow-check"><input data-control-id="albums.slideshow.include-videos" type="checkbox" checked={includeVideos} onChange={(event) => setIncludeVideos(event.target.checked)}/>動画も流す</label>
      </div>
      <div className="slideshow-row">
        <button data-control-id="albums.slideshow.bgm.toggle" className="button" type="button" aria-pressed={playing} onClick={toggleMusic}><MusicIcon width="17"/>{playing ? '曲を止める' : '曲を流す'}</button>
        <div className="slideshow-field"><label htmlFor="slideshow-preset">曲</label><select data-control-id="albums.slideshow.bgm.preset" id="slideshow-preset" className="select" value={preset} onChange={(event) => changePreset(event.target.value as BgmPreset)}>{presets.map((value) => <option key={value} value={value}>{bgmLabels[value]}</option>)}</select></div>
        <div className="slideshow-field"><label htmlFor="slideshow-volume">音量</label><input data-control-id="albums.slideshow.bgm.volume" id="slideshow-volume" className="slideshow-volume" type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => changeVolume(Number(event.target.value))}/></div>
      </div>
    </div>
  </div>, document.body);
}
