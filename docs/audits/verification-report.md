# 検証結果

実測日: 2026-09-30。固定ロケール `ja-JP`、`Asia/Tokyo`、固定fixtureで実行。未実行の項目を合格とは記載しない。

| 区分 | 状態 | 証拠 |
|---|---|---|
| lint / TypeScript / unit | pass | ESLint 0 warnings、TypeScript 0 errors、Vitest 10/10 |
| 静的ビルド | pass | Vite 8.0.4、109 modules、`dist/`生成 |
| Chromium / WebKit / Firefox E2E | pass | 主要フロー48/48＋新規操作24/24。無反応だった25操作、取消、失敗、対象限定更新、外部タブ境界を含む |
| axe serious/critical / keyboard | pass | 主要11ルート×3ブラウザ、フォーカストラップ・復帰、inert、Reduced Motion、44px監査を含む45/45。serious/critical 0 |
| 320〜1920px水平オーバーフロー | pass | 8ルート×6幅×3ブラウザ、document/body/main差分0 |
| 全主要画面スクリーン | pass + human reviewed | DPR 2 PNG 79枚、390/834/1440px、明暗・異常状態・通知/編集/権限/パスワード、`artifacts/screens/gallery.html` |
| Lighthouse Today desktop | target met | Performance 100、Accessibility 100、Best Practices 100、LCP 570ms、CLS 0.037、TBT 0ms |
| npm runtime audit | pass | `npm audit --omit=dev`: 0 vulnerabilities、production dependencies 7 |
| npm full audit | security exception | 指定固定Vite 8.0.4の開発サーバーにhigh。localhost限定、静的dist配布。8.3.1以降へ更新推奨 |
| VoiceOver + Safari実機 | evidence-pending | 人手記録なし |
| 家庭ユーザー試験 | evidence-pending | 6世帯12名未実施 |
| INP | evidence-pending | labではTBT 0ms。INPは実ユーザーのfield interaction dataが必要 |

Lighthouseの生データは `lighthouse-today.report.json` / `.html`、要約は `lighthouse-summary.json`。測定はローカル静的previewであり、実配信CDNや実端末のCore Web Vitalsを保証しない。
