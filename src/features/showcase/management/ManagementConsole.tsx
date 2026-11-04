import { useReducer, useState } from 'react';
import { Dialog, EmptyState, PageHeader, StatusBadge } from '../../../design-system/components';
import { initialConsoleState, sections } from './fixtures';
import { consoleReducer } from './model';
import type { ConsoleAction, SectionId } from './model';
import { AuditLogSection, BackupsSection, HouseholdsSection, JobsSection, OverviewSection, RecordsSection, ServicesSection } from './sections';
import './management.css';

export interface PendingConfirmation { title: string; description: string; confirmLabel: string; action: ConsoleAction; done: string }
export type ConsoleDispatch = (action: ConsoleAction, done: string) => void;

const sectionFor = (path: string) => sections.find((item) => item.href === path.replace(/\/$/, ''))?.id ?? null;

/** どの項目でも最初に見えるように、見出しより前に置く。 */
function SampleBanner() {
  return <aside className="mgmt-banner" role="note" aria-label="見本の画面です">
    <span className="mgmt-banner-mark">見本</span>
    <p><strong>ここに表示しているのは、すべて架空のデータです。</strong>ボタンはこの画面の中の表示を変えるだけで、本物のサーバーや家族の記録には何も届きません。読み込み直すと元に戻ります。</p>
  </aside>;
}

function SectionBody({ section, ...props }: { section: SectionId } & Parameters<typeof JobsSection>[0]) {
  if (section === 'overview') return <OverviewSection state={props.state}/>;
  if (section === 'services') return <ServicesSection {...props}/>;
  if (section === 'jobs') return <JobsSection {...props}/>;
  if (section === 'backups') return <BackupsSection {...props}/>;
  if (section === 'audit-log') return <AuditLogSection state={props.state}/>;
  if (section === 'households') return <HouseholdsSection {...props}/>;
  return <RecordsSection state={props.state}/>;
}

export function ManagementConsole({ path }: { path: string }) {
  const [state, send] = useReducer(consoleReducer, initialConsoleState);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [message, setMessage] = useState('');
  const section = sectionFor(path);
  const dispatch: ConsoleDispatch = (action, done) => { send(action); setMessage(done); };
  const shared = { state, dispatch, confirm: setConfirmation };
  return <div className="page management-console">
    <SampleBanner/>
    <PageHeader eyebrow="内部監査 · 見本" title="管理コンソールの見本" description="運営者が使う画面の形を確かめるためのものです。項目ごとに架空のデータで操作できます。" action={<StatusBadge tone="attention">架空のデータ</StatusBadge>}/>
    <nav className="mgmt-nav" aria-label="管理コンソールの項目">
      {sections.map((item) => <a data-control-id={`showcase.management.nav.${item.id}`} key={item.id} className="button" href={item.href} data-link aria-current={item.id === section ? 'page' : undefined}>{item.label}</a>)}
    </nav>
    {message && <p className="small" role="status">{message}</p>}
    {section
      ? <SectionBody section={section} {...shared}/>
      : <EmptyState title="この項目の見本はありません" action={<a data-control-id="showcase.management.nav.fallback" className="button primary" href="/showcase/management" data-link>概要に戻る</a>}>上の項目から選んでください。</EmptyState>}
    {confirmation && <Dialog title={confirmation.title} description={confirmation.description} onClose={() => setConfirmation(null)} actions={<>
      <button data-control-id="showcase.management.confirm.cancel" className="button" type="button" onClick={() => setConfirmation(null)}>やめる</button>
      <button data-control-id="showcase.management.confirm.accept" className="button primary" type="button" onClick={() => { dispatch(confirmation.action, confirmation.done); setConfirmation(null); }}>{confirmation.confirmLabel}</button>
    </>}/>}
  </div>;
}
