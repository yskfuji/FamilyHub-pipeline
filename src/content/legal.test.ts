import { describe, expect, it } from 'vitest';
import { CONTACT_PLACEHOLDER, OPERATOR_PLACEHOLDER, legalDocuments, legalNotice } from './legal';

const documentText = (id: string) => JSON.stringify(legalDocuments.find((item) => item.id === id));

describe('規約とポリシーの草案', () => {
  it('どちらも草案と分かり、運営者は空欄の印のまま', () => {
    expect(legalNotice).toContain('草案');
    for (const item of legalDocuments) {
      expect(item.title).toContain('草案');
      expect(item.intro).toContain(OPERATOR_PLACEHOLDER);
      expect(JSON.stringify(item)).toContain(CONTACT_PLACEHOLDER);
    }
  });
  it('外部のサービスを2つとも明記する', () => {
    expect(documentText('privacy')).toContain('OpenPOI');
    expect(documentText('privacy')).toContain('Open-Meteo');
  });
  it('保存の期間（7日の復元、30日の削除）を明記する', () => {
    for (const id of ['terms', 'privacy']) {
      expect(documentText(id)).toContain('7日間');
      expect(documentText(id)).toContain('30日');
    }
  });
  it('本文は構造化した文字列だけで、HTML を含まない', () => {
    expect(JSON.stringify(legalDocuments)).not.toMatch(/<[a-z/]/i);
  });
});
