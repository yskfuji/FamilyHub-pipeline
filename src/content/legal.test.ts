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
  it('読み取りの補助は、既定で使わないことと、家庭内で読み取り外部へ送らないことを明記する', () => {
    const text = documentText('privacy');
    for (const phrase of ['読み取りの補助', '初期の設定では使いません', '運営者が有効にしたときだけ', '画像', '本文', '同じ機械か家庭内のネットワーク', '外部へは送りません']) expect(text).toContain(phrase);
    expect(text).not.toContain('運営者が設定したサービスへ送ります');
    const external = legalDocuments.find((item) => item.id === 'privacy')?.sections.find((section) => section.heading === '外部のサービス');
    expect(JSON.stringify(external)).not.toContain('読み取り');
    for (const phrase of ['初期の設定では使いません', '外部のサービスへは送りません']) expect(documentText('terms')).toContain(phrase);
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
