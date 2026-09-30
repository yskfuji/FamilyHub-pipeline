# family-hub-reference

家族向けライフマネジメント製品のための、独立した参照フロントエンドです。東京の架空4人家族とゲスト、固定日時を用い、バックエンドなしでも主要フローを操作できます。

## 起動

```bash
npm install
npm run dev
```

- `npm run dev:audit`: 役割・異常状態・ショーケースを含む内部監査用画面
- `npm run verify`: lint、型、単体、consumer build、セキュリティ・日本語・OpenAPI契約、Lighthouse、3ブラウザE2E、axe
- `npm run audit:visual`: 主要画面の撮影とHTMLギャラリー生成
- `npm run render:er`: MermaidソースからER図SVGを生成
- `npm run package`: 全検証後、静的ZIP・ソースTGZ・SHA-256を生成

## 重要な境界

これはフロントエンド参照実装です。画面上の認証、セッション、CSRF、添付検疫は契約を可視化したもので、サーバー側の実装なしに安全性を保証しません。実利用者評価も未実施であり、認知・使いやすさの外的妥当性は `evidence-pending` です。

通常の `build` はconsumer向けで、`/showcase`、actor/scenario切替、監査用fixture、source mapを含みません。`build:audit`だけが内部監査面を生成します。HTTP adapterはHTTPSの接続先、実行時CSRF token provider、権限リビジョンproviderの注入を必須とします。

詳細は [証拠台帳](docs/evidence-register.md)、[脅威モデル](docs/threat-model.md)、[IA](docs/information-architecture.md) を参照してください。
