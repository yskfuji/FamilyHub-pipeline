# 検証結果

実測日: 2026-10-03。固定ロケール `ja-JP`、`Asia/Tokyo`、固定fixtureで実行。未実行の項目を合格とは記載しない。

| 区分 | 状態 | 証拠 |
|---|---|---|
| lint / TypeScript / unit | pass | ESLint 0 warnings、TypeScript 0 errors、Vitest 107/107（14ファイル）。従来の日付・URL・場所・EXIF・秘匿に加え、家計の計算（月の合計、費目の割合の最大剰余法、誰から誰へ、支払った人の負担を精算済みとして1円が残らないこと、精算の取り消しの対応付け）、場所の集計と並べ替え、ヒントの導出、繰り返し（毎日・毎週曜日・毎月・間隔・UNTIL・COUNT・除外・月末・範囲の分割）、mockの支出編集・削除・復元の規則、招待の検証、権限、パスキーの完了を含む |
| 静的ビルド | pass | Vite 8.3.1、126 modules、consumer `dist/`生成。showcase、監査切替、source mapなし。JS gzip 139.4KB、CSS gzip 42.2KB（場所一覧・支出の詳細・繰り返し・プライバシー設定の追加分を含む） |
| OpenAPI / HTTP adapter | pass | 51 operationIdが一意で、Gatewayのメソッドと1対1に対応することを機械照合（`scripts/audit-contract.mjs`）。追加：`finishPasskey`、`updateHouseholdProfile`、`getAttachmentLink`、`updateExpense`／`deleteExpense`／`restoreExpense`、`listInsights`。削除：`getContext`。すべての2xx応答に本文スキーマ、IDは形式を固定しない文字列。CSRF・冪等キー・権限revision・204応答・復元操作も静的に確認 |
| Chromium / WebKit / Firefox E2E | pass | 62件×3ブラウザ=186/186。従来の主要フロー・4ロール・権限拒否・オフライン再送・場所の外部送信に加え、家計（計算値、支出の詳細→精算→履歴→取り消し、精算後の編集の制限と削除の禁止、削除と復元、不明なID）、繰り返し（毎週の展開、この回だけの削除と元に戻す、これ以降の分割、タスクの次の回）、ナビ（「その他」のダイアログ・Escape・フォーカス復帰・表示中の表示、404、`/settings`の振り分け、子どもの迂回禁止、検索結果から詳細とアンカー）、メモ削除後の復元案内、プライバシー設定と通知内容の秘匿、サインアウト、場所一覧と子どもの禁止を含む。円記号はChromium「￥」とWebKit「¥」の両方を許容 |
| 日本語コンテンツ監査 | pass + evidence-pending | 通常・内部監査画面、fixture、成功・失敗文、入力検証文を走査。既知の未翻訳語・内部値・実装語0件。母語話者2名レビューは未実施 |
| axe serious/critical / keyboard | pass | 30件×3ブラウザ=90/90。全設定タブ、ドロワー、ダイアログ、404、権限なしの案内、場所一覧と詳細、支出の詳細を含みserious/critical 0。44px監査はボタンに加えてボタン状のリンクも対象。画面左上のロゴだけのリンクに名前がなかった問題を修正 |
| 320〜1920px水平オーバーフロー | pass | 主要ルート×6幅×3ブラウザ、document/body/main差分0 |
| 全主要画面スクリーン | pass + human reviewed | DPR 2 PNG 126枚、390/834/1440px、明暗・異常状態・4ロール・通知/編集/権限/パスワードに、場所一覧と詳細、支出の詳細、繰り返しの回、プライバシー設定、モバイルの「その他」とすぐに追加を追加。目視で見つけて直したもの：「その他」のリンクが左レール用の縮小規則で1文字ずつ縦に潰れる、設定タブの語の途中での改行（パソコンはタブ単位で折り返し、モバイルは横スクロールし表示中のタブを中央へ）、子どもの今日の画面で見出し番号が04を飛ばす、影響する予定がないのに「先に確認すること」に天気を出す。`artifacts/screens/gallery.html` |
| Lighthouse Today desktop | target met | Performance 100、Accessibility 100、Best Practices 100、LCP 646ms、CLS 0.00047、TBT 0ms（機能追加後に再測定） |
| 操作ID・ユースケース | pass | 明示的な操作237件・26系統（存在しない能力名と、どの操作にも当たらない系統を検出）。ユースケース65件、重複・欠落なし |
| 場所検索の実データ測定 | pass（1日・28地点） | `docs/audits/place-lookup-probe.md`。小数第3位の丸め＋端末内の並べ直しで上位10件の再現率 平均0.961、完全一致25/28。再測定は `npm run probe:openpoi` |
| 配信ヘッダー | static pass + evidence-pending | `_headers`と`nginx.conf`の一致、`connect-src`、`geolocation=(self)`を静的検査。`vite preview`はヘッダーを適用しないため配備先で要確認 |
| npm runtime audit | pass | `npm audit --omit=dev` は0 vulnerabilities。Vite 8.3.1 |
| npm full audit | residual risk | 開発時だけ使うMermaid CLI→Puppeteerの推移依存にhigh 8件。Node 20で利用できる固定版24.34.0には上流修正版がなく、`npm install --ignore-scripts`と既存Chrome指定でダウンロード／展開経路を使わない。consumer buildには含まれない。強制修正による旧版化は採用しない |
| VoiceOver + Safari実機 | evidence-pending | 人手記録なし |
| iOS Safari / Android実機の位置情報 | evidence-pending | 現在地の許可プロンプト、正確な位置情報オフ時の誤差、写真選択の「オプション」の既定値、Androidでの写真の位置情報除去は実機記録なし |
| 家庭ユーザー試験 | evidence-pending | 6世帯12名未実施 |
| INP | evidence-pending | labではTBT 0ms。INPは実ユーザーのfield interaction dataが必要 |

Lighthouseの生データは `lighthouse-today.report.json` / `.html`、要約は `lighthouse-summary.json`。測定はローカル静的previewであり、実配信CDNや実端末のCore Web Vitalsを保証しない。自動テストの成功は日本語の自然さや実利用者満足を証明しない。
