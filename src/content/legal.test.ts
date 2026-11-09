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
    for (const phrase of ['バックアップ', '暗号化', '最長6か月', '削除してから最長で30日と6か月ほど', '退会したアカウントの情報も、退会から最長6か月ほど', '古いバックアップを消さずに残します']) expect(text).toContain(phrase);
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
  it('運営者の責任は、軽過失のときだけ上限を置き、責任を全部は免れない（消費者契約法8条1項1号・3項、docs/legal/legal-review-2026-11.md）', () => {
    const text = documentText('terms');
    expect(text).not.toContain('故意または重大な過失がある場合を除き、本サービスの利用によって生じた損害の責任を負いません');
    for (const phrase of ['運営者の責めに帰すべき事由によって利用者に損害を与えたときは、その損害を賠償します', '運営者に軽過失（重大な過失を除く過失）がある場合に限り', 'のいずれか高い額を上限とします', '故意または重大な過失がある場合と、利用者の生命または身体に損害が生じた場合は、前の項の上限は適用しません']) expect(text).toContain(phrase);
  });
  it('規約の変更は、変更できる場合・効力が生じる日・知らせ方を定める（民法548条の4）', () => {
    const text = documentText('terms');
    for (const phrase of ['変更が利用者の一般の利益に合うとき', '契約の目的に反せず', '効力が生じる日', '本サービス上に掲示し、登録したメールアドレスへ送ります', '変更の前の版は']) expect(text).toContain(phrase);
    expect(text).toContain('この規約が運営者と利用者との契約の内容になります');
  });
  it('個人情報保護法32条と施行令10条の公表事項を書く', () => {
    const text = documentText('privacy');
    for (const phrase of ['住所：', '代表者：', '安全管理のためにとった措置', '問い合わせと苦情の窓口', '代理人（未成年の方の法定代理人を含む）', '手数料は', '第三者への提供の記録の開示', '利用の停止、消去、第三者への提供の停止']) expect(text).toContain(phrase);
    for (const phrase of ['利用契約の管理、料金の請求と入金の確認', '大事なお知らせをメールで送ること', 'IPアドレス、ブラウザの種類', '個人情報保護委員会へ報告し', '取扱いを任せる事業者']) expect(text).toContain(phrase);
  });
  it('16歳未満の改正を、公布の日と施行の扱いと中身で正しく書く', () => {
    const text = documentText('privacy');
    for (const phrase of ['令和8年法律第56号', '令和8年7月17日公布', '公布から2年以内の政令で定める日に施行されます', '利用の停止や消去を求められます']) expect(text).toContain(phrase);
    expect(text).not.toContain('と個人情報保護委員会は説明しています');
  });
  it('運営者は保存された内容を見ないこと、配慮の申出の窓口があること、外部のタグを使わないことを書く', () => {
    for (const id of ['terms', 'privacy']) expect(documentText(id)).toContain('運営者は、利用者が保存した内容を見ません');
    expect(documentText('terms')).toContain('配慮が必要な方は、問い合わせ先へメールなど文字でお知らせください');
    expect(documentText('privacy')).toContain('広告や利用状況の分析のための外部のタグは使いません');
    expect(documentText('privacy')).toContain('運営者の名称と所在国は公表されていません');
  });
  it('特定商取引法に基づく表記に、11条と施行規則23条〜25条の項目をそろえ、試用は自動で有料にならないと書く', () => {
    const text = documentText('commerce');
    for (const phrase of ['名称：', '代表者または業務の責任者：', '住所：', '電話番号：', '料金', '料金のほかに必要な費用', '支払いの時期', '支払いの方法', '提供の時期', '契約の期間と更新', '申込みの撤回、解約、返金', 'クーリング・オフはありません', '動作環境']) expect(text).toContain(phrase);
    for (const id of ['terms', 'commerce']) expect(documentText(id)).toContain('自動で有料に切り替わることや、料金を請求することはありません');
  });
  it('本文は構造化した文字列だけで、HTML を含まない', () => {
    expect(JSON.stringify(legalDocuments)).not.toMatch(/<[a-z/]/i);
  });
});
