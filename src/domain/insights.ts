import { addDateKeyDays, dateKeyFromRfc3339 } from './calendarDate';
import { unsettledSummary } from './ledger';
import type { HouseholdSnapshot, Insight } from './types';

const yen = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));
const day = (dateKey: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(`${dateKey}T12:00:00+09:00`));
const nameOf = (snapshot: HouseholdSnapshot, id?: string) => snapshot.memberships.find((member) => member.id === id)?.displayName;

/**
 * 閲覧者に見えている記録だけから、確認しておきたいことを導く。固定文は使わず、記録が変われば内容も変わる。
 * 予定や担当を自動で変えることはしない。
 */
export function deriveInsights(snapshot: HouseholdSnapshot): Insight[] {
  const { asOf, weather } = snapshot.context;
  const today = dateKeyFromRfc3339(asOf);
  const me = snapshot.viewer.membershipId;
  const insights: Insight[] = [];

  const toReview = snapshot.todos.filter((todo) => todo.status === 'review' && todo.reviewerMembershipId === me);
  if (toReview.length) {
    const first = toReview[0];
    insights.push({
      id: 'insight-review-requested', confidence: 'high',
      title: `確認を頼まれたタスクが${toReview.length}件`,
      summary: `「${first.title}」など、あなたの確認を待っています。内容を見てから完了にしてください。`,
      evidence: `タスクの状態（確認する人：${nameOf(snapshot, me) ?? 'あなた'}）`,
      actionLabel: 'タスクを開く', destination: `/tasks/${first.id}`,
    });
  }
  const waiting = snapshot.todos.filter((todo) => todo.status === 'review' && todo.assigneeMembershipId === me && todo.reviewerMembershipId && todo.reviewerMembershipId !== me);
  if (waiting.length) {
    const first = waiting[0];
    insights.push({
      id: 'insight-review-waiting', confidence: 'high',
      title: `確認待ちのタスクが${waiting.length}件`,
      summary: `「${first.title}」は${nameOf(snapshot, first.reviewerMembershipId) ?? '確認する人'}さんの確認待ちです。提出前に内容がそろっているか確認してください。`,
      evidence: `タスクの状態（担当：${nameOf(snapshot, me) ?? 'あなた'}、確認する人：${nameOf(snapshot, first.reviewerMembershipId) ?? '不明'}）`,
      actionLabel: 'タスクを開く', destination: `/tasks/${first.id}`,
    });
  }

  const dueToday = snapshot.todos.filter((todo) => todo.status !== 'done' && todo.assigneeMembershipId === me && todo.dueAt && dateKeyFromRfc3339(todo.dueAt) === today);
  if (dueToday.length) {
    const sorted = [...dueToday].sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
    insights.push({
      id: 'insight-due-today', confidence: 'high',
      title: `今日が期限のタスクが${dueToday.length}件`,
      summary: `いちばん早い期限は「${sorted[0].title}」の${time(sorted[0].dueAt!)}です。`,
      evidence: `担当がご自身で、期限が${day(today)}のタスク`,
      actionLabel: 'タスクを見る', destination: `/tasks/${sorted[0].id}`,
    });
  }

  // 天気は「今日」の予報なので、今日の天気の影響を受ける予定にだけ結び付ける。
  const affected = snapshot.events.filter((event) => event.weatherSensitive && dateKeyFromRfc3339(event.startsAt) === today);
  if (weather.condition !== 'sunny' && affected.length) {
    insights.push({
      id: 'insight-weather', confidence: 'medium',
      title: `今日の屋外の予定は${weather.condition === 'storm' ? '荒天' : '雨'}の可能性`,
      summary: `${weather.location}の降水確率は${weather.precipitationPercent}%です。「${affected[0].title}」の準備や変更を検討してください。`,
      evidence: `天気予報（${time(asOf)}時点）と、天気の影響を受ける予定${affected.length}件`,
      actionLabel: '予定を確認', destination: `/calendar/${affected[0].id}`,
    });
  }

  if (snapshot.viewer.capabilities.includes('expense.read')) {
    const unsettled = unsettledSummary(snapshot.expenses);
    if (unsettled.totalJpy > 0) {
      insights.push({
        id: 'insight-unsettled', confidence: 'high',
        title: `未精算は合計${yen(unsettled.totalJpy)}`,
        summary: '記録した支出の負担額から計算しています。誰が誰にいくら払うかを確認できます。',
        evidence: `未精算の支出${unsettled.count}件（1円単位で計算）`,
        actionLabel: '内訳を見る', destination: '/budget',
      });
    }
  }

  const holiday = snapshot.context.holidays.find((item) => item.date > today && item.date <= addDateKeyDays(today, 14));
  if (holiday) {
    insights.push({
      id: 'insight-holiday', confidence: 'high',
      title: `${day(holiday.date)}は${holiday.name}`,
      summary: '祝日の予定や、学校・習い事の休みを確認しておくと安心です。',
      evidence: '国民の祝日（内閣府の公表日）',
      actionLabel: '予定を確認', destination: `/calendar?month=${holiday.date.slice(0, 7)}`,
    });
  }
  return insights;
}
