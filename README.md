# family-hub-reference

家族向けライフマネジメント製品のための、独立した参照フロントエンドです。東京の架空4人世帯と固定日時を用い、バックエンドなしでも主要フローを操作できます。

## 起動

```bash
npm install
npm run dev
```

- `npm run verify`: lint、型、単体、ビルド、セキュリティ静的検査、E2E、axe
- `npm run audit:visual`: 主要画面の撮影とHTMLギャラリー生成
- `npm run render:er`: MermaidソースからER図SVGを生成
- `npm run package`: 全検証後、静的ZIP・ソースTGZ・SHA-256を生成

## 重要な境界

これはフロントエンド参照実装です。画面上の認証、セッション、CSRF、添付検疫は契約を可視化したもので、サーバー側の実装なしに安全性を保証しません。実利用者評価も未実施であり、認知・使いやすさの外的妥当性は `evidence-pending` です。

詳細は [証拠台帳](docs/evidence-register.md)、[脅威モデル](docs/threat-model.md)、[IA](docs/information-architecture.md) を参照してください。
