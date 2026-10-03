# 検証結果

実測日: 2026-10-03。固定ロケール `ja-JP`、`Asia/Tokyo`、固定fixtureで実行。未実行の項目を合格とは記載しない。

| 区分 | 状態 | 証拠 |
|---|---|---|
| lint / TypeScript / unit | pass | ESLint 0 warnings、TypeScript 0 errors、Vitest 79/79。年月の年越し、閏年、無効URL、東京日付、週範囲、選択日の正規化に加え、場所の丸め・並べ直し・外部応答の検証・位置情報の失敗・EXIF（JPEG/HEIF、不正構造、変異ファズ500回）・項目単位の秘匿を含む |
| 静的ビルド | pass | Vite 8.3.1、119 modules、consumer `dist/`生成。showcase、監査切替、source mapなし。JS gzip 123.4KB（main比 +12.1KB）、CSS gzip 38.9KB（+0.5KB） |
| OpenAPI / HTTP adapter | pass | 45 operationId一意（`getPrivacySettings` 追加、`PlaceRef`／`PrivacySettings` スキーマ）、CSRF・冪等キー・権限revision・204応答・復元操作の静的契約監査 |
| Chromium / WebKit / Firefox E2E | pass | 41件×3ブラウザ=123/123。主要フロー、旧無反応25操作、前月・次月・今月・年月選択・ブラウザ戻る、4ロール、権限拒否、取消、失敗、オフライン再送、操作IDに加え、場所の外部送信内容（丸めた中心・Cookie/リファラーなし）、位置情報の拒否・時間切れ・精度不足、写真の位置あり・なし、全国検索、外部停止時の手入力、子ども非表示、同意撤回を含む。外部APIは架空データで差し替え、Service Workerを無効にして実APIへ接続しない |
| 日本語コンテンツ監査 | pass + evidence-pending | 通常・内部監査画面、fixture、成功・失敗文、入力検証文を走査。既知の未翻訳語・内部値・実装語0件。母語話者2名レビューは未実施 |
| axe serious/critical / keyboard | pass | 17件×3ブラウザ=51/51。フォーカストラップ・復帰、inert、Reduced Motion、44px監査、`/settings/location`、結果表示中の場所選択（390px）を含みserious/critical 0。ダイアログの閉じるボタンが長い説明文で30.7px幅に縮む既存の不具合を修正 |
| 320〜1920px水平オーバーフロー | pass | 主要ルート×6幅×3ブラウザ、document/body/main差分0 |
| 全主要画面スクリーン | pass + human reviewed | DPR 2 PNG 100枚、390/834/1440px、明暗・異常状態・4ロール・通知/編集/権限/パスワード。モバイル予定表は初期・途中・末尾の実表示領域も収録。`artifacts/screens/gallery.html` |
| Lighthouse Today desktop | target met | Performance 100、Accessibility 100、Best Practices 100、LCP 647ms、CLS 0.00045、TBT 0ms |
| 場所検索の実データ測定 | pass（1日・28地点） | `docs/audits/place-lookup-probe.md`。小数第3位の丸め＋端末内の並べ直しで上位10件の再現率 平均0.961、完全一致25/28。再測定は `npm run probe:openpoi` |
| 配信ヘッダー | static pass + evidence-pending | `_headers`と`nginx.conf`の一致、`connect-src`、`geolocation=(self)`を静的検査。`vite preview`はヘッダーを適用しないため配備先で要確認 |
| npm runtime audit | pass | `npm audit --omit=dev` は0 vulnerabilities。Vite 8.3.1 |
| npm full audit | residual risk | 開発時だけ使うMermaid CLI→Puppeteerの推移依存にhigh 8件。Node 20で利用できる固定版24.34.0には上流修正版がなく、`npm install --ignore-scripts`と既存Chrome指定でダウンロード／展開経路を使わない。consumer buildには含まれない。強制修正による旧版化は採用しない |
| VoiceOver + Safari実機 | evidence-pending | 人手記録なし |
| iOS Safari / Android実機の位置情報 | evidence-pending | 現在地の許可プロンプト、正確な位置情報オフ時の誤差、写真選択の「オプション」の既定値、Androidでの写真の位置情報除去は実機記録なし |
| 家庭ユーザー試験 | evidence-pending | 6世帯12名未実施 |
| INP | evidence-pending | labではTBT 0ms。INPは実ユーザーのfield interaction dataが必要 |

Lighthouseの生データは `lighthouse-today.report.json` / `.html`、要約は `lighthouse-summary.json`。測定はローカル静的previewであり、実配信CDNや実端末のCore Web Vitalsを保証しない。自動テストの成功は日本語の自然さや実利用者満足を証明しない。
