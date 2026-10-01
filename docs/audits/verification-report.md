# 検証結果

実測日: 2026-10-02。固定ロケール `ja-JP`、`Asia/Tokyo`、固定fixtureで実行。未実行の項目を合格とは記載しない。

| 区分 | 状態 | 証拠 |
|---|---|---|
| lint / TypeScript / unit | pass | ESLint 0 warnings、TypeScript 0 errors、Vitest 27/27 |
| 静的ビルド | pass | Vite 8.3.1、113 modules、consumer `dist/`生成。showcase、監査切替、source mapなし |
| OpenAPI / HTTP adapter | pass | 44 operationId一意、CSRF・冪等キー・権限revision・204応答・復元操作の静的契約監査 |
| Chromium / WebKit / Firefox E2E | pass | 30件×3ブラウザ=90/90。主要フロー、旧無反応25操作、4ロール、権限拒否、取消、失敗、オフライン再送、操作IDを含む |
| 日本語コンテンツ監査 | pass + evidence-pending | 通常・内部監査画面、fixture、成功・失敗文、入力検証文を走査。既知の未翻訳語・内部値・実装語0件。母語話者2名レビューは未実施 |
| axe serious/critical / keyboard | pass | 15件×3ブラウザ=45/45。フォーカストラップ・復帰、inert、Reduced Motion、44px監査を含みserious/critical 0 |
| 320〜1920px水平オーバーフロー | pass | 主要ルート×6幅×3ブラウザ、document/body/main差分0 |
| 全主要画面スクリーン | pass + human reviewed | DPR 2 PNG 97枚、390/834/1440px、明暗・異常状態・4ロール・通知/編集/権限/パスワード、`artifacts/screens/gallery.html` |
| Lighthouse Today desktop | target met | Performance 100、Accessibility 100、Best Practices 100、LCP 646ms、CLS 0.00045、TBT 0ms |
| npm runtime/full audit | pass | `npm audit --omit=dev`、全依存 `npm audit` ともに0 vulnerabilities。Vite 8.3.1 |
| VoiceOver + Safari実機 | evidence-pending | 人手記録なし |
| 家庭ユーザー試験 | evidence-pending | 6世帯12名未実施 |
| INP | evidence-pending | labではTBT 0ms。INPは実ユーザーのfield interaction dataが必要 |

Lighthouseの生データは `lighthouse-today.report.json` / `.html`、要約は `lighthouse-summary.json`。測定はローカル静的previewであり、実配信CDNや実端末のCore Web Vitalsを保証しない。自動テストの成功は日本語の自然さや実利用者満足を証明しない。
