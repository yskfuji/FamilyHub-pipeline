import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { externalLinkLabel, ja, placeCategoryLabel, placeDistanceLabel } from '../../content/ja';
import { StatusBadge } from '../../design-system/components';
import { ImageIcon, LinkIcon, LocateIcon, MapPinIcon, SearchIcon } from '../../design-system/icons';
import { placeRefSchema } from '../../domain/schemas';
import type { PlaceCaptureSource, PlaceRef, PrivacySettings, Result } from '../../domain/types';
import { getDevicePosition, isGeolocationAvailable } from './deviceLocation';
import { readPhotoGps } from './exif';
import { APPROXIMATE_ACCURACY_METERS, COARSE_ACCURACY_METERS, toPlaceRef, toRfc3339, type ExactPosition, type PlaceCandidate } from './geo';
import { OPENPOI_ATTRIBUTION_URL, PLACE_LOOKUP_NOTICE_VERSION, findNearbyPlaces, openPoiPlaceLookup, searchPlacesByName, type PlaceLookupPort } from './openPoi';

export type PlaceFailure = keyof typeof ja.place.failures;
type LookupOrigin = Exclude<PlaceCaptureSource, 'manual'>;
type PanelState =
  | { kind: 'idle' }
  | { kind: 'consent'; resume: LookupOrigin }
  | { kind: 'busy'; message: string }
  | { kind: 'results'; origin: LookupOrigin; candidates: PlaceCandidate[]; notice?: 'approximate' | 'nationwide'; takenAt?: string }
  | { kind: 'empty'; origin: LookupOrigin }
  | { kind: 'failed'; reason: PlaceFailure; retry?: LookupOrigin };

/* ---------- 同意 ---------- */

export type ConsentStatus = 'loading' | 'granted' | 'required' | 'unavailable';

/** 外部検索への同意。現在の説明（noticeVersion）に同意している場合だけ granted。設定は AppContext の1か所で持つ。 */
export function usePlaceLookupConsent() {
  const { privacy, updatePrivacy } = useApp();
  // 操作直後は結果を待たずに反映し（続けて操作しても再確認を出さない）、記録に失敗したら元に戻す。
  const [pending, setPending] = useState<ConsentStatus | null>(null);
  const recorded: ConsentStatus = privacy === null ? 'loading' : privacy.placeLookupConsent?.noticeVersion === PLACE_LOOKUP_NOTICE_VERSION ? 'granted' : 'required';
  const save = useCallback(async (granted: boolean): Promise<Result<PrivacySettings>> => {
    setPending(granted ? 'granted' : 'required');
    const result = await updatePrivacy({ placeLookupConsent: granted ? { noticeVersion: PLACE_LOOKUP_NOTICE_VERSION, grantedAt: toRfc3339(new Date()) } : null });
    setPending(null);
    return result;
  }, [updatePrivacy]);
  return { status: pending ?? recorded, grant: () => save(true), revoke: () => save(false) };
}

/* ---------- 表示部品 ---------- */

export function PlaceAttributionLink({ where }: { where: 'picker' | 'memo' | 'budget' | 'expense' | 'places' }) {
  return <p className="place-attribution small muted">{ja.place.attributionPrefix}: <a data-control-id={`place.attribution.${where}`} href={OPENPOI_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={externalLinkLabel(`${ja.place.attributionPrefix} ${ja.place.attributionLabel}`)}>{ja.place.attributionLabel}<LinkIcon width="13"/></a></p>;
}

export function PlaceSummary({ place }: { place: PlaceRef }) {
  const category = placeCategoryLabel(place.category);
  return <div className="place-summary">
    <MapPinIcon width="20"/>
    <div className="row-main">
      <strong className="wrap">{place.name}</strong>
      <span className="meta wrap">{[place.address, category, ja.place.recordedVia[place.capturedVia]].filter(Boolean).join(' · ')}</span>
    </div>
  </div>;
}

/* ---------- 入力部品 ---------- */

const errorFailure = (code: string): PlaceFailure => (code === 'OFFLINE' || code === 'RATE_LIMITED' ? code : 'UPSTREAM_FAILURE');
const deviceFailure = { unsupported: 'geo-unsupported', denied: 'geo-denied', unavailable: 'geo-unavailable', timeout: 'geo-timeout' } as const satisfies Record<string, PlaceFailure>;
const photoFailure = { 'no-gps': 'photo-no-gps', unsupported: 'photo-unsupported', malformed: 'photo-malformed', 'too-large': 'photo-too-large' } as const satisfies Record<string, PlaceFailure>;
const formatTakenAt = (iso: string) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(iso));
const defaultSource = (): PlaceCaptureSource => (isGeolocationAvailable() && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'device' : 'photo');

/**
 * 支出・メモに付ける場所を選ぶ。正確な位置は exactRef にだけ置き、閉じる・切り替えるときに破棄する。
 * 外部に送るのは丸めた位置と検索語だけ（openPoi.ts）。
 */
export function PlaceField({ value, onChange, disabled = false, port = openPoiPlaceLookup }: { value: PlaceRef | null; onChange: (next: PlaceRef | null) => void; disabled?: boolean; port?: PlaceLookupPort }) {
  const { announce } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState<PlaceCaptureSource>(defaultSource);
  const [panel, setPanel] = useState<PanelState>({ kind: 'idle' });
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState({ name: '', address: '' });
  const [manualError, setManualError] = useState('');
  const consent = usePlaceLookupConsent();
  const exactRef = useRef<ExactPosition | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const consentAccept = useRef<HTMLButtonElement>(null);
  const sourceAction = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const setSourceAction = (element: HTMLButtonElement | HTMLInputElement | null) => { sourceAction.current = element; };
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const pendingGrant = useRef<Promise<Result<PrivacySettings>> | null>(null);
  const consentStatus = useRef(consent.status);
  const headingId = useId();
  const geolocation = isGeolocationAvailable();
  const sources = (Object.keys(ja.place.sources) as PlaceCaptureSource[]).filter((item) => item !== 'device' || geolocation);

  const cancelPending = () => { abortRef.current?.abort(); abortRef.current = null; };
  const nextSignal = () => { cancelPending(); abortRef.current = new AbortController(); return abortRef.current.signal; };
  useEffect(() => () => { abortRef.current?.abort(); exactRef.current = null; }, []);
  useEffect(() => { consentStatus.current = consent.status; }, [consent.status]);
  // パネルが入れ替わると押したボタンが消えたり無効になったりするため、フォーカスが失われたら次の操作へ移す。
  useEffect(() => {
    if (!expanded) return;
    if (panel.kind === 'consent') {
      consentAccept.current?.focus();
      consentAccept.current?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const root = fieldsetRef.current;
    const active = document.activeElement;
    // body に落ちた場合と、待機中に fieldset へ預けた場合だけ移す。利用者が自分で選んだ位置は奪わない。
    if (active && active !== document.body && active !== root) return;
    const target = panel.kind === 'results' ? root?.querySelector<HTMLElement>('.place-candidate')
      : panel.kind === 'failed' || panel.kind === 'empty' ? root?.querySelector<HTMLElement>('.place-failure button')
        : panel.kind === 'busy' ? root
          : sourceAction.current;
    target?.focus();
  }, [expanded, panel, source]);

  const collapse = (focusTarget: 'change' | 'add') => {
    cancelPending();
    exactRef.current = null;
    setExpanded(false);
    setPanel({ kind: 'idle' });
    requestAnimationFrame(() => (focusTarget === 'change' ? changeButton.current : addButton.current)?.focus());
  };
  const switchSource = (next: PlaceCaptureSource) => {
    cancelPending();
    if (next !== 'search') exactRef.current = null;
    setSource(next);
    setPanel({ kind: 'idle' });
  };
  const select = (candidate: PlaceCandidate, origin: LookupOrigin) => {
    onChange(toPlaceRef(candidate, origin, new Date()));
    announce(ja.place.selected(candidate.name));
    collapse('change');
  };

  /** 外部へ送る直前に、同意が記録済みであることを確かめる（記録中なら結果を待つ）。 */
  const consentConfirmed = async () => {
    if (pendingGrant.current && !(await pendingGrant.current).ok) return false;
    return consentStatus.current === 'granted';
  };

  const showNearby = async (signal: AbortSignal, position: ExactPosition, accuracy: number | undefined, origin: LookupOrigin, takenAt?: string) => {
    if (accuracy !== undefined && accuracy > COARSE_ACCURACY_METERS) {
      // おおよその位置では近くの候補がずれるため、名前検索に切り替える（検索の優先地域としてだけ使う）。
      exactRef.current = position;
      setSource('search');
      setPanel({ kind: 'failed', reason: 'geo-coarse' });
      return;
    }
    exactRef.current = position;
    setPanel({ kind: 'busy', message: ja.place.search.busy });
    if (!(await consentConfirmed()) || signal.aborted) { if (!signal.aborted) setPanel({ kind: 'failed', reason: 'consent-failed' }); return; }
    const result = await findNearbyPlaces(port, position, signal);
    if (signal.aborted) return;
    if (!result.ok) { setPanel({ kind: 'failed', reason: errorFailure(result.error.code), retry: origin }); return; }
    if (result.value.length === 0) { setPanel({ kind: 'empty', origin }); return; }
    setPanel({ kind: 'results', origin, candidates: result.value, ...(accuracy !== undefined && accuracy > APPROXIMATE_ACCURACY_METERS ? { notice: 'approximate' as const } : {}), ...(takenAt ? { takenAt } : {}) });
  };

  const locate = async () => {
    const signal = nextSignal();
    setPanel({ kind: 'busy', message: ja.place.device.busy });
    const outcome = await getDevicePosition(signal);
    if (signal.aborted) return;
    if (!outcome.ok) { setPanel({ kind: 'failed', reason: deviceFailure[outcome.reason], retry: 'device' }); return; }
    await showNearby(signal, outcome.position, outcome.accuracyMeters, 'device');
  };

  const readPhoto = async (file?: File) => {
    if (photoInput.current) photoInput.current.value = '';
    if (!file) return;
    const signal = nextSignal();
    setPanel({ kind: 'busy', message: ja.place.photo.busy });
    const outcome = await readPhotoGps(file);
    if (signal.aborted) return;
    if (outcome.status !== 'found') { setPanel({ kind: 'failed', reason: photoFailure[outcome.status], retry: 'photo' }); return; }
    await showNearby(signal, { lat: outcome.gps.lat, lng: outcome.gps.lng }, outcome.gps.accuracyMeters, 'photo', outcome.gps.takenAt);
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    const signal = nextSignal();
    setPanel({ kind: 'busy', message: ja.place.search.busy });
    if (!(await consentConfirmed()) || signal.aborted) { if (!signal.aborted) setPanel({ kind: 'failed', reason: 'consent-failed' }); return; }
    const result = await searchPlacesByName(port, q, exactRef.current, signal);
    if (signal.aborted) return;
    if (!result.ok) { setPanel({ kind: 'failed', reason: errorFailure(result.error.code), retry: 'search' }); return; }
    if (result.value.candidates.length === 0) { setPanel({ kind: 'empty', origin: 'search' }); return; }
    setPanel({ kind: 'results', origin: 'search', candidates: result.value.candidates, ...(result.value.nationwide ? { notice: 'nationwide' as const } : {}) });
  };

  /** 外部へ送る前に同意を確かめる。写真の選択は利用者の操作の中で開く必要があるため、ここで直接呼ぶ。 */
  const start = (origin: LookupOrigin) => {
    if (consent.status !== 'granted') { setPanel({ kind: 'consent', resume: origin }); return; }
    if (origin === 'device') void locate();
    else if (origin === 'photo') photoInput.current?.click();
    else void search();
  };
  const acceptConsent = async (resume: LookupOrigin) => {
    const pending = consent.grant();
    pendingGrant.current = pending;
    // 写真の選択画面は利用者の操作の中でしか開けないため先に開く。外部への問い合わせは同意の記録を待ってから行う。
    if (resume === 'photo') { setPanel({ kind: 'idle' }); photoInput.current?.click(); }
    const result = await pending;
    if (pendingGrant.current === pending) pendingGrant.current = null;
    if (!result.ok) { setPanel({ kind: 'failed', reason: 'consent-failed' }); return; }
    if (resume === 'device') void locate();
    else if (resume === 'search') void search();
  };

  const applyManual = () => {
    const parsed = placeRefSchema.safeParse({ name: manual.name, ...(manual.address.trim() ? { address: manual.address } : {}), capturedVia: 'manual', selectedAt: toRfc3339(new Date()) });
    if (!parsed.success) { setManualError(parsed.error.issues[0]?.message ?? ja.errors.INVALID_INPUT); return; }
    setManualError('');
    onChange(parsed.data);
    announce(ja.place.selected(parsed.data.name));
    collapse('change');
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); collapse(value ? 'change' : 'add'); return; }
    // 支出・メモの入力フォームの中にあるため、Enter で外側のフォームが送信されないようにする。
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (source === 'manual') applyManual();
    }
  };

  if (!expanded) {
    return value
      ? <div className="place-field"><PlaceSummary place={value}/><div className="place-actions">
        <button ref={changeButton} data-control-id="place.change" className="button" type="button" disabled={disabled} onClick={() => setExpanded(true)}>{ja.place.change}</button>
        <button data-control-id="place.remove" className="button" type="button" disabled={disabled} onClick={() => { onChange(null); announce(ja.place.removed); requestAnimationFrame(() => addButton.current?.focus()); }}>{ja.place.remove}</button>
      </div></div>
      : <button ref={addButton} data-control-id="place.add" className="button place-add" type="button" disabled={disabled} onClick={() => setExpanded(true)}><MapPinIcon width="18"/>{ja.place.add}</button>;
  }

  const busy = panel.kind === 'busy';
  // 候補が出たら探し直しの操作は控えめにし、視線を候補へ向ける。
  const actionClass = panel.kind === 'results' ? 'button' : 'button primary';
  return <fieldset ref={fieldsetRef} tabIndex={-1} className="fieldset place-picker" aria-labelledby={headingId} aria-busy={busy} onKeyDown={onKeyDown}>
    <legend id={headingId}>{ja.place.legend}</legend>
    <div className="segmented place-sources" role="group" aria-label={ja.place.sourceSwitcher}>
      {sources.map((item) => <button key={item} data-control-id={`place.source.${item}`} type="button" aria-pressed={source === item} disabled={busy} onClick={() => switchSource(item)}>{ja.place.sources[item]}</button>)}
    </div>
    {source !== 'manual' && <p className="field-help place-transmission">{ja.place.transmission}</p>}

    {panel.kind === 'consent' ? <div className="callout info place-consent" role="group" aria-labelledby={`${headingId}-consent`}>
      <MapPinIcon/>
      <div>
        <strong id={`${headingId}-consent`}>{ja.place.consent.title}</strong>
        <ul className="place-consent-points small">{ja.place.consent.points.map((point) => <li key={point}>{point}</li>)}</ul>
        <p className="small muted mb-0">{ja.place.consent.revokeHint}</p>
        <div className="place-actions mt-1">
          <button ref={consentAccept} data-control-id="place.consent.accept" className="button primary" type="button" onClick={() => void acceptConsent(panel.resume)}>{ja.place.consent.accept}</button>
          <button data-control-id="place.consent.decline" className="button" type="button" onClick={() => switchSource('manual')}>{ja.place.consent.decline}</button>
        </div>
      </div>
    </div> : <>
      {source === 'device' && <div className="place-panel"><p className="small muted mb-0">{ja.place.device.help}</p><button ref={setSourceAction} data-control-id="place.device.locate" className={actionClass} type="button" disabled={busy || consent.status === 'loading'} onClick={() => start('device')}><LocateIcon width="18"/>{ja.place.device.action}</button></div>}
      {source === 'photo' && <div className="place-panel"><p className="small muted mb-0">{ja.place.photo.help}</p><button ref={setSourceAction} data-control-id="place.photo.choose" className={actionClass} type="button" disabled={busy || consent.status === 'loading'} onClick={() => start('photo')}><ImageIcon width="18"/>{ja.place.photo.action}</button></div>}
      {source === 'search' && <div className="place-search" role="search">
        <div className="field"><label htmlFor={`${headingId}-q`}>{ja.place.search.label}</label><input ref={setSourceAction} data-control-id="place.search.query" id={`${headingId}-q`} className="input" type="search" enterKeyHint="search" maxLength={60} autoComplete="off" value={query} aria-describedby={`${headingId}-q-help`} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (query.trim() && !busy && consent.status !== 'loading') start('search'); } }}/><span className="field-help" id={`${headingId}-q-help`}>{ja.place.search.help}</span></div>
        <button data-control-id="place.search.submit" className={actionClass} type="button" disabled={busy || !query.trim() || consent.status === 'loading'} onClick={() => start('search')}><SearchIcon width="18"/>{ja.place.search.submit}</button>
      </div>}
      {source === 'manual' && <div className="place-manual">
        <div className="field"><label htmlFor={`${headingId}-name`}>{ja.place.manual.name}</label><input ref={setSourceAction} data-control-id="place.manual.name" id={`${headingId}-name`} className="input" maxLength={120} value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })}/></div>
        <div className="field"><label htmlFor={`${headingId}-address`}>{ja.place.manual.address}</label><input data-control-id="place.manual.address" id={`${headingId}-address`} className="input" maxLength={200} autoComplete="street-address" value={manual.address} onChange={(event) => setManual({ ...manual, address: event.target.value })}/></div>
        {manualError && <p className="field-error" role="alert">{manualError}</p>}
        <button data-control-id="place.manual.apply" className="button primary" type="button" onClick={applyManual}>{ja.place.manual.apply}</button>
      </div>}
    </>}

    <input data-control-id="place.photo.file" ref={photoInput} className="sr-only" type="file" accept="image/*" tabIndex={-1} aria-label={ja.place.photo.input} onChange={(event) => void readPhoto(event.target.files?.[0])}/>

    <div role="status" aria-live="polite" className="place-status">
      {panel.kind === 'busy' && <><span className="sr-only">{panel.message}</span><div className="place-skeleton" aria-hidden="true"><span className="skeleton"/><span className="skeleton"/><span className="skeleton"/></div></>}
      {panel.kind === 'results' && <p className="small muted mb-0">{panel.origin === 'search' ? ja.place.searchResultCount(panel.candidates.length) : ja.place.resultCount(panel.candidates.length)}{panel.takenAt ? ` ${ja.place.photo.takenAt}: ${formatTakenAt(panel.takenAt)}` : ''}</p>}
      {panel.kind === 'empty' && <p className="small mb-0">{ja.place.empty[panel.origin]}</p>}
    </div>

    {panel.kind === 'results' && <>
      {panel.notice && <p className="callout info small place-notice">{ja.place[panel.notice]}</p>}
      <ul className="place-candidates">{panel.candidates.map((candidate) => {
        const category = placeCategoryLabel(candidate.category);
        return <li key={candidate.key}><button data-control-id={`place.candidate.${candidate.key}`} className="place-candidate" type="button" onClick={() => select(candidate, panel.origin)}>
          <span className="place-candidate-main"><strong className="wrap">{candidate.name}</strong>{candidate.address && <span className="meta wrap">{candidate.address}</span>}</span>
          <span className="place-candidate-side">{candidate.distanceMeters !== undefined && <span className="place-distance">{placeDistanceLabel(candidate.distanceMeters)}</span>}{category && <StatusBadge>{category}</StatusBadge>}</span>
        </button></li>;
      })}</ul>
      <PlaceAttributionLink where="picker"/>
    </>}

    {(panel.kind === 'failed' || panel.kind === 'empty') && <div className={panel.kind === 'failed' ? 'notice error place-failure' : 'place-failure'}>
      {panel.kind === 'failed' && <p className="mb-0" role="alert">{ja.place.failures[panel.reason]}</p>}
      <div className="place-actions">
        {panel.kind === 'failed' && panel.retry && <button data-control-id="place.retry" className="button" type="button" onClick={() => start(panel.retry!)}>{ja.place.retry}</button>}
        {source !== 'search' && <button data-control-id="place.switch.search" className="button" type="button" onClick={() => switchSource('search')}>{ja.place.switchToSearch}</button>}
        <button data-control-id="place.switch.manual" className="button" type="button" onClick={() => switchSource('manual')}>{ja.place.switchToManual}</button>
      </div>
    </div>}

    <div className="place-actions place-footer">
      <button data-control-id="place.collapse" className="button" type="button" onClick={() => collapse(value ? 'change' : 'add')}>{value ? ja.place.collapse.keep : ja.place.collapse.skip}</button>
    </div>
  </fieldset>;
}
