# 検証結果

実測日: 2026-11-02（段階16、ブランチ `feat/full-parity`）。固定ロケール `ja-JP`、`Asia/Tokyo`、固定fixtureで実行。未実行の項目を合格とは記載しない。合否は各命令の終了コードで判定した。自動試験の成功は本番での安全性を意味しない。

| 区分 | 状態 | 証拠 |
|---|---|---|
| TypeScript / ESLint | pass | `npx tsc -b --pretty false`、`npx eslint . --max-warnings 0` とも終了コード0。`server/` の読み込みの制限を `no-restricted-imports` で検査 |
| 単体・同等性 | pass | `npx vitest run`: 58ファイル、1056件。同じ試験集合をモック（`src/data/gateway.test.ts`）と実サーバー（`server/test/gateway.parity.test.ts`）へ流す。HTTP の応答は ajv で OpenAPI の形と照合 |
| 経路と契約 | pass | `npm run audit:routes`: 3件。Fastify の全経路と OpenAPI を双方向で照合。`scripts/audit-contract.mjs`: 102操作が Gateway のメソッドと1対1 |
| ビルド | pass | `npm run build`、`npm run build:http`、`npm run build:server`、`npm run build:audit` とも0 |
| ビルドの境界 | pass | `dist/` と `dist-http/` に `/showcase`、内部監査の文言、管理コンソールの見本の印、source map がない。`dist-http/` に確認用データ（森さんち）がない。`dist-server/` に代役がない。`dist-server/` と `dist-http/` の版の印が同じ（`npm run audit:ui`、`npm run audit:security`） |
| セキュリティの静的検査 | pass | ヘッダーの一致、`connect-src` と `media-src` の完全一致、nginx の `/v1` 転送、外部接続は `server/adapters` だけ、SQL の文字列の組み立ての禁止、`Set-Cookie` は1ファイルだけ、`server/` の読み込みの制限、`server/` の本体に日本語の文字列がないこと。各検査は、わざと違反を入れて失敗することを確かめた（23件の違反をすべて検出） |
| 日本語コンテンツ監査 | pass + evidence-pending | 122ファイルを走査。既知の未翻訳語・内部値・実装語0件。比較元の名前の検査は350ファイル。母語話者2名レビューは未実施 |
| 操作ID・ユースケース | pass | 明示的な操作468件・108系統。ユースケース96件、能力名はすべて実在 |
| Chromium モック E2E + axe | pass | `e2e/` の一覧と `e2e/accessibility.spec.ts` で305件 |
| WebKit モック E2E | 未達（4件） | `npm run test:e2e` の WebKit で4件が再現して失敗する（`e2e/albums.spec.ts:304`、`:378`、`e2e/shell.spec.ts:173`、`:392`）。この4件は段階15のコミットでも同じように失敗し、この段階で増えたものではない。ほかに2件（`e2e/navigation.spec.ts:103`、`e2e/places.spec.ts:106`）は全体の実行で失敗し、単独の再実行では通った。4件の内容は、WebKit で `Touch` を作れない（試験の問題）、Escape のあとでボタンへフォーカスが戻らない、密度「コンパクト」で操作の高さが30pxになる、月の表のキーボード操作で移動のリンクへフォーカスが移らない。修正していない |
| Firefox モック E2E | 未実施 | この環境では Firefox が起動の段階で止まり（macOS の sandbox の `Operation not permitted`）、試験へ進めない。245件が `browserType.launch` の時間切れで、アプリの結果ではない |
| `npm run verify` の全体 | 未達 | 上の2件のため、この環境では終了コード0にならない。全体の命令としては実行していない。構成する命令は個別に実行した |
| 実スタック E2E | pass（Chromium だけ） | `playwright.real.config.ts`: 40件。実際の API と SQLite、配信と同じ CSP の下で動かす。パスキーは仮想認証器、LLM は代役 |
| 管理コンソールの見本 | pass | 7項目すべてで見本の表示を確認。外への要求がないこと、通常のビルドでは見つからないページになることを `e2e/management.spec.ts` で確認。390px と 1440px の撮影を目視し、水平のはみ出しは0 |
| API の起動 | pass | `dist-server/main.js` を一時的なデータベースで起動し、`/health` は200、`/ready` は200、`/v1/version` は `dist-server/build-id.txt` と同じ値。`NODE_ENV=production` で clamd に届かないときは `/health` が200、`/ready` が503。clamd の設定がなければ起動しない。`dist-server/cli.js` は動作を確認 |
| ER 図 | pass | `npm run render:er` は既存の Chrome で実行できた。`docs/er.svg.sha256` は実際の生成の結果。図の表と文書の種類は `server/db/migrations.ts`（14表）と `server/db/aggregateStore.ts`（15種）から照合 |
| 配布の一覧 | pass | `bash scripts/package.sh --dry-run`: 497件。データベース、アップロード、メディア、`.env`、ビルド、試験の結果を含まない。`src/data/` と `server/media/` は含む |
| Lighthouse Today desktop | pass（ローカルの静的 preview） | Performance 99、Accessibility 100、Best Practices 100、LCP 767ms、CLS 0.00048、TBT 0ms |
| 場所検索の実データ測定 | 前回の結果 | 2026-10-03 の測定のまま（`docs/audits/place-lookup-probe.md`）。今回は再測定していない |
| npm runtime audit | residual risk | `npm audit --omit=dev`: high 1件（zod 4.1.11、GHSA-mrhx-c7xc-m3w5。大きな集まりの検証でメモリを使い切る）。修正版 4.6.7 があるが、この段階では更新していない。API の本文は2MiBに制限している |
| npm full audit | residual risk | 全依存で32件（critical 1、high 12、moderate 14、low 5）。大半は開発用の推移依存。強制修正は行っていない |
| 実機の VoiceOver + Safari | evidence-pending | 人手記録なし |
| iOS Safari / Android実機の位置情報 | evidence-pending | 実機記録なし |
| 外部の侵入試験 | evidence-pending | 未実施 |
| 実利用者の評価 | evidence-pending | 6世帯12名未実施 |
| 法務の確認 | evidence-pending | 規約とプライバシーポリシーは草案。運営者名と問い合わせ先は空欄 |
| 実物の clamd、SMTP、LLM | evidence-pending | 代役だけで確認 |
| URL の取得の TLS の経路 | evidence-pending | 試験は http の代役 |
| H.264 の再生、ピクチャーインピクチャー | evidence-pending | 自動試験で確かめていない |
| 実スタックの Firefox と WebKit | evidence-pending | 実スタックの E2E は Chromium だけ |
| nginx、systemd の例 | evidence-pending | この環境に nginx と docker がなく、動かしていない。TLS証明書の設定も含まない |
| INP | evidence-pending | labではTBT 0ms。INPは実ユーザーのfield interaction dataが必要 |

Lighthouseの生データは `lighthouse-today.report.json` / `.html`、要約は `lighthouse-summary.json`。測定はローカル静的previewであり、実配信CDNや実端末のCore Web Vitalsを保証しない。自動テストの成功は日本語の自然さや実利用者満足を証明しない。
