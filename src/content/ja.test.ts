import { describe, expect, it } from 'vitest';
import { externalLinkLabel, ja, recurrenceLabel } from './ja';

describe('日本語コンテンツカタログ', () => {
  it('内部の役割値と利用状態を日本語の表示名に変換する', () => {
    expect(ja.roles).toEqual({ owner: '管理者', adult: '大人のメンバー', child: '子どもメンバー', guest: 'ゲスト' });
    expect(ja.membershipStatus).toEqual({ active: '利用中', invited: '招待中', suspended: '利用停止' });
  });

  it('繰り返しの範囲を予定とタスクの文脈に合わせる', () => {
    expect(recurrenceLabel('event', 'this')).toBe('この予定だけ');
    expect(recurrenceLabel('event', 'future')).toBe('これ以降の予定');
    expect(recurrenceLabel('event', 'series')).toBe('すべての予定');
    expect(recurrenceLabel('task', 'this')).toBe('このタスクだけ');
    expect(recurrenceLabel('task', 'future')).toBe('これ以降のタスク');
    expect(recurrenceLabel('task', 'series')).toBe('すべてのタスク');
  });

  it('外部リンクの操作名に対象名と開き方を含める', () => {
    expect(externalLinkLabel('青葉小学校の保護者向けページ')).toBe('青葉小学校の保護者向けページを開く（新しいタブ）');
  });

  it('共通エラーに内部実装用語を含めない', () => {
    const copy = Object.values(ja.errors).join('\n');
    expect(copy).not.toMatch(/セッション|CSRF|WebAuthn|バックエンド|サーバー/);
  });
});
