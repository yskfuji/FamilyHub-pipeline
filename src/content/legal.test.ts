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
  it('管理者が変更の記録を見られることと、その保持の期間（24か月）を明記する（A5-9）', () => {
    for (const id of ['terms', 'privacy']) {
      expect(documentText(id)).toContain('管理者は');
      expect(documentText(id)).toContain('24か月残し');
    }
    expect(documentText('privacy')).toContain('見られない記録');
    expect(documentText('privacy')).toContain('IPアドレスは含みません');
  });
  it('削除した記録とアカウントも、最長6か月はバックアップに残ることを明記する（A8-9）', () => {
    const text = documentText('privacy');
    for (const phrase of ['バックアップ', '暗号化', '最長6か月', '削除した記録や退会したアカウントの情報も']) expect(text).toContain(phrase);
  });
  it('バックアップの鍵を別の場所に保管することと、漏えいの照会を外部へ送らないことを明記する（A8-9、A9-6）', () => {
    const text = documentText('privacy');
    expect(text).toContain('バックアップの鍵は、バックアップの置き場所とも本サービスの機械とも別の場所に保管します');
    expect(text).toContain('外部のサービスに問い合わせることはしません');
  });
  it('家庭内の別の機械へ暗号化しない通信で送る設定では、平文で流れることを明記する（A1-4）', () => {
    expect(documentText('privacy')).toContain('家庭内のネットワークを暗号化されないまま流れます');
  });
  it('未成年の登録は保護者の同意を示す必要があり、役割は管理者が選び、管理者になれるのは18歳以上だけと明記する', () => {
    const text = documentText('terms');
    for (const phrase of ['18歳未満と分かる方は', '保護者の同意を得ていることを示さないと登録できません', '示したことも記録しません', '招待する管理者が選びます', '誕生日からは決めません', '管理者になれるのは、申告した誕生日から18歳以上と分かる方だけです']) expect(text).toContain(phrase);
    for (const phrase of ['家計', '記録した場所', 'ヒント', '読み取りの補助', '家族グループの管理は使えません']) expect(text).toContain(phrase);
    expect(text).not.toContain('保護者の同意を得てから登録してください');
  });
  it('16歳未満の情報は、法定代理人の同意が求められることと、仕組みがまだないことを、適合を主張せずに書く', () => {
    const text = documentText('privacy');
    for (const phrase of ['16歳未満', '法定代理人', '保護者へ知らせる仕組みも、保護者の同意を記録する仕組みも持っていません', '確かめておらず', '法律の専門家']) expect(text).toContain(phrase);
    expect(text).not.toMatch(/準拠しています|適合しています|対応しています/);
  });
  it('本文は構造化した文字列だけで、HTML を含まない', () => {
    expect(JSON.stringify(legalDocuments)).not.toMatch(/<[a-z/]/i);
  });
});
