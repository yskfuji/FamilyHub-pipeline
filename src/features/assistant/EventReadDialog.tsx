import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { Dialog } from '../../design-system/components';
import { READING_IMAGE_ACCEPT, candidateToDraft, readingImageProblem, readingUrlProblem } from '../../domain/assistant';
import type { AssistantJob, EventCandidate } from '../../domain/assistant';
import type { Result } from '../../domain/types';
import { dayLabel } from '../calendar/calendarLabels';
import { ReadingNotice, reviewNote } from './ReadingNotice';
import { useReadingJob } from './useReading';

type Source = 'url' | 'image';
const sources: ReadonlyArray<readonly [Source, string]> = [['url', 'ページのURL'], ['image', 'チラシの画像']];

const timeText = (candidate: EventCandidate) => (candidate.startTime ? `${candidate.startTime}${candidate.endTime ? `〜${candidate.endTime}` : ''}` : '終日');

export function EventDialog({ sample, onClose }: { sample: boolean; onClose: () => void }) {
  const { gateway, requestQuickCreate } = useApp();
  const [source, setSource] = useState<Source>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [job, setJob] = useState<AssistantJob | null>(null);
  const { busy, run } = useReadingJob();
  const ready = source === 'url' ? Boolean(url.trim()) : Boolean(file);

  const read = async () => {
    if (!ready || busy) return;
    const problem = source === 'url' ? readingUrlProblem(url) : file && readingImageProblem(file);
    if (problem) { setError(problem); return; }
    setError(''); setJob(null);
    const start = (): Promise<Result<AssistantJob>> => (source === 'url' ? gateway.assistant.readEventUrl(url.trim()) : gateway.assistant.readEventImage(file as File));
    const result = await run(start);
    if (!result) return;
    if (!result.ok) { setError(result.error.message); return; }
    setJob(result.value);
  };
  const openForm = (candidate: EventCandidate) => {
    onClose();
    requestQuickCreate('event', undefined, undefined, { event: candidateToDraft(candidate), note: reviewNote(Boolean(job?.sample)) });
  };

  return <Dialog title="URL・チラシから読み取る" description="案内のページやチラシから、予定の候補を探します。" onClose={onClose}>
    <div className="stack" aria-busy={busy}>
      <ReadingNotice sample={sample}/>
      <div className="segmented" role="group" aria-label="読み取るもの">{sources.map(([value, label]) => <button data-control-id={`assistant.event.source.${value}`} key={value} type="button" aria-pressed={source === value} disabled={busy} onClick={() => { setSource(value); setError(''); }}>{label}</button>)}</div>
      {source === 'url'
        ? <label className="field"><span>ページのURL</span><input data-control-id="assistant.event.url" className="input" type="url" inputMode="url" maxLength={2048} autoComplete="off" disabled={busy} placeholder="https://" value={url} aria-describedby="event-url-help" onChange={(event) => setUrl(event.target.value)}/><span className="field-help" id="event-url-help">公開されている https のページを読み取れます。</span></label>
        : <label className="field"><span>チラシの画像</span><input data-control-id="assistant.event.file" className="input" type="file" accept={READING_IMAGE_ACCEPT} disabled={busy} aria-describedby="event-file-help" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/><span className="field-help" id="event-file-help">JPEG と PNG を読み取れます（10MBまで）。</span></label>}
      {busy && <p className="small muted mb-0" role="status">読み取っています。しばらくお待ちください。</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {job?.events && <section aria-labelledby="event-candidates-title">
        <h3 id="event-candidates-title">予定の候補（{job.events.length}件）</h3>
        <ul className="reading-candidates">{job.events.map((candidate, index) => <li key={`${candidate.title}-${candidate.date}-${index}`}>
          <div className="reading-candidate-text"><strong>{candidate.title}</strong><span className="small muted">{dayLabel(candidate.date)} {timeText(candidate)}{candidate.location ? ` ${candidate.location}` : ''}</span></div>
          <button data-control-id={`assistant.event.candidate.${index}`} className="button" type="button" aria-label={`「${candidate.title}」を入力して開く`} onClick={() => openForm(candidate)}>入力して開く</button>
        </li>)}</ul>
      </section>}
      <div className="dialog-actions">
        <button data-control-id="assistant.event.cancel" className="button" type="button" onClick={onClose}>{job ? ja.actions.close : ja.actions.cancel}</button>
        <button data-control-id="assistant.event.submit" className="button primary" type="button" disabled={!ready || busy} onClick={() => void read()}>{busy ? '読み取り中…' : job ? 'もう一度読み取る' : '読み取る'}</button>
      </div>
    </div>
  </Dialog>;
}
