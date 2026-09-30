import { useApp, memberName } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { EmptyState, PageHeader, StatusBadge, formatTime, formatYen } from '../../design-system/components';
import { AlertIcon, ArrowIcon, CheckIcon, RainIcon } from '../../design-system/icons';

export function TodayPage() {
  const { snapshot, loading } = useApp();
  const mine = snapshot.todos.filter((todo) => todo.assigneeMembershipId === 'member-aoi' && todo.status !== 'done');
  const unsettled = snapshot.expenses.reduce((total, expense) => total + expense.shares.reduce((sum, share) => sum + Math.max(0, share.amountJpy - share.settledJpy), 0), 0);
  if (loading) return <div className="page"><PageHeader eyebrow="Today" title="おはよう、碧さん" description="家族の今日を静かに整えています。"/><div className="grid two"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div></div>;
  if (snapshot.events.length + snapshot.todos.length + snapshot.expenses.length === 0) return <div className="page"><PageHeader eyebrow="Today" title="おはよう、碧さん" description="今日の見通しを、必要な順番で。"/><EmptyState title="今日はまだ静かです" action={<button className="button primary" onClick={() => document.querySelector<HTMLButtonElement>('.quick-create')?.click()}>最初の予定を作る</button>}>予定やTodoを追加すると、ここに時間順でまとまります。</EmptyState></div>;

  return <div className="page"><PageHeader eyebrow="Today · 9月30日" title="おはよう、碧さん" description="迷わず動けるように、確認が必要なことから並べています。" action={<span className="badge success"><span className="status-dot"/>7:29 同期済み</span>} />
    <div className="stack">
      <section className="card accent" aria-labelledby="attention-title"><div className="section-head"><div><p className="eyebrow">01 · 要確認</p><h2 id="attention-title">先に見ておくこと</h2></div><StatusBadge tone="attention">2件</StatusBadge></div><div className="grid two"><div className="callout"><AlertIcon/><div><strong>確認待ちの書類があります</strong><p className="muted small">就学援助の確認票 · 碧 → 蓮</p></div><a className="button" href="/tasks/todo-form" data-link>確認 <ArrowIcon width="16"/></a></div><div className="callout info"><RainIcon/><div><strong>{snapshot.context.weather.alert}</strong><p className="muted small">ピアノへの移動時間に影響する可能性</p></div><a className="button" href="/calendar/event-piano" data-link>予定 <ArrowIcon width="16"/></a></div></div></section>

      <section className="card" aria-labelledby="timeline-title"><div className="section-head"><div><p className="eyebrow">02 · 本日の時間軸</p><h2 id="timeline-title">今日の流れ</h2></div><a href="/calendar" data-link>カレンダーへ</a></div><ul className="list timeline">{snapshot.events.filter((event) => event.startsAt.startsWith('2026-09-30')).map((event) => <li className="list-row" key={event.id}><time className="time">{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? memberName(snapshot, event.ownerMembershipId)}</span></div><button className="button" type="button" onClick={() => navigate(`/calendar/${event.id}`)}>詳細</button></li>)}<li className="list-row"><time className="time">18:00</time><div className="row-main"><strong>図書館の本を返す</strong><span className="meta">担当 · 碧</span></div><StatusBadge>Todo</StatusBadge></li></ul></section>

      <div className="grid two"><section className="card" aria-labelledby="mine-title"><div className="section-head"><div><p className="eyebrow">03 · 自分の担当</p><h2 id="mine-title">碧さんのTodo</h2></div><span className="metric">{mine.length}</span></div><ul className="list">{mine.map((todo) => <li className="list-row" key={todo.id}><CheckIcon width="20"/><div className="row-main"><strong>{todo.title}</strong><span className="meta">{formatTime(todo.dueAt)}{todo.reviewerMembershipId ? ` · 確認 ${memberName(snapshot, todo.reviewerMembershipId)}` : ''}</span></div><a className="button" href={`/tasks/${todo.id}`} data-link>開く</a></li>)}</ul></section>
        <section className="card" aria-labelledby="settle-title"><div className="section-head"><div><p className="eyebrow">04 · 未精算</p><h2 id="settle-title">立替の残り</h2></div><StatusBadge tone="attention">2件</StatusBadge></div><p className="metric">{formatYen(unsettled)}</p><p className="muted">学校教材と交通費の記録から算出。誰が・誰に・いくらを常に確認できます。</p><a className="button full" href="/budget" data-link>内訳と精算を確認</a></section>
      </div>

      <section className="card" aria-labelledby="weather-title"><div className="section-head"><div><p className="eyebrow">05 · 天気による影響</p><h2 id="weather-title">雨と予定</h2></div><RainIcon width="30"/></div><div className="grid three"><div><p className="metric">{snapshot.context.weather.precipitationPercent}%</p><p className="meta">降水確率</p></div><div><p className="metric">{snapshot.context.weather.temperatureC}℃</p><p className="meta">東京の予想</p></div><div><strong>判断は家族に残します</strong><p className="muted small">予定の自動変更はせず、根拠と影響候補だけを表示します。</p></div></div></section>
    </div>
  </div>;
}
