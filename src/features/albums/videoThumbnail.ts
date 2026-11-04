const MAX_EDGE = 640;
const TIMEOUT_MS = 8000;
const JPEG_QUALITY = 0.8;

const once = (video: HTMLVideoElement, event: string) => new Promise<void>((resolve, reject) => {
  video.addEventListener(event, () => resolve(), { once: true });
  video.addEventListener('error', () => reject(new Error('video')), { once: true });
});

/** 動画の1コマを端末の中で縮小画像にする。作れないときは null を返し、送信は止めない。 */
export async function makeVideoThumbnail(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const loaded = once(video, 'loadeddata');
    video.src = url;
    await loaded;
    const seeked = once(video, 'seeked');
    video.currentTime = Math.min(1, (video.duration || 0) / 10);
    await seeked;
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY); });
  })();
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); });
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
