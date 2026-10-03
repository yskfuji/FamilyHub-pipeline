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

## 主な画面と、どこから見るか

| 見たいもの | 場所 | 補足 |
|---|---|---|
| 記録した場所の一覧 | `/places`（左ナビ／モバイルは「その他」→「場所」） | 既定は「最近使った順」。支出・メモの詳細の場所表示からも開けます。管理者と大人だけ |
| 支出の詳細・編集・削除 | `/budget/{id}`（家計の一覧で行を選ぶ） | 取り消していない精算がある間は、金額・負担の変更と削除はできません。削除は7日以内なら元に戻せます |
| 精算の履歴 | 支出の詳細の「精算の履歴」と、家計ページの「精算の履歴」欄 | 取り消しは元の記録を消さず、取り消しの記録を追加します |
| 繰り返し予定の範囲 | 予定の詳細の「対象とする予定」 | この予定だけ／これ以降／すべて。タスクは「このタスクだけ／すべて」 |
| 共有範囲・通知の内容 | `/settings/privacy` | 新しく作るものの共有範囲と、通知の題名と内容を隠す設定 |

金額・費目の割合・誰から誰へ・未精算などの数字は、すべて記録から `src/domain/ledger.ts` で計算しています（固定値ではありません）。

## 場所の記録と外部送信

支出とメモに、任意で「場所」を付けられます（管理者と大人のメンバーだけ。子どもメンバーとゲストには表示しません）。

- 探し方: 現在地、写真に記録された位置情報、名前で探す、手入力。端末の種類では分けず、使える機能をすべて表示します。
- 外部送信: 近くのお店の候補は [OpenPOI API](https://docs.openpoiapi.com/) から取得します。送るのは小数第3位（約100m）に丸めた位置と固定の半径、または確定した検索語だけで、正確な現在地と写真は送りません。Cookieとリファラーは送らず、応答はキャッシュしません。外部への出口は `src/features/place/openPoi.ts` の1ファイルだけです。
- 同意: 初めて外部に問い合わせる前に送信先と内容を示して同意を求め、`/settings/location` でいつでも撤回できます。説明を変えたら `PLACE_LOOKUP_NOTICE_VERSION` を更新して同意を取り直します。
- 保存: 選んだ場所の名前・住所・場所の座標・出典だけを保存し、現在地は保存しません。
- 検証: E2Eは架空データで OpenPOI を差し替え、実APIへは接続しません。実データでの性質は `npm run probe:openpoi` で再測定でき、結果は `docs/audits/place-lookup-probe.md` にまとめています。

## ライセンス

Copyright (c) 2026 Yusuke Fujinami. All rights reserved.

本リポジトリはソース公開（source-available）ですが、オープンソースではありません。閲覧・参照のみ許可しており、書面による事前許諾なく複製・改変・再配布・商用利用することはできません。商用利用の権利は Yusuke Fujinami のみが保有します。詳細は [LICENSE](LICENSE) を参照してください。
