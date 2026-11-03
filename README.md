# family-hub-reference

家族向けライフマネジメント製品「よりどころ」の参照実装です。画面（`src/`）に加えて、実際の API サーバー（`server/`）があります。東京の架空4人家族とゲスト、固定日時を用いるモックのデモと、SQLite に保存する実スタックの両方で動きます。

**これは本番で安全と宣言するものではありません。** 外部の侵入試験、実利用者の評価、実機の VoiceOver、法務の確認は行っていません。未確認の項目は [証拠台帳](docs/evidence-register.md) を参照してください。

## 必要なもの

Node.js 24.7.0 以上（`node:sqlite` を使います。安定版の API ではありません）。パスワードのハッシュは `@node-rs/argon2`（ネイティブのモジュール）で計算します。

```bash
npm install
```

## 起動

### モック（サーバーなし）

```bash
npm run dev
```

架空の家族「森さんち」で全画面を操作できます。データは画面の中だけにあります。

### 実スタック（API と SQLite）

端末を2つ開きます。

```bash
npm run dev:server   # API。http://127.0.0.1:8799 、データは data/dev.sqlite
npm run dev:stack    # 画面。http://localhost:4174 （/v1 を API へ転送）
```

`npm run dev:server` は見本の家族を入れ、サインインに使うメールアドレスとパスワードを表示します。パスキーの RP ID のため、画面は `localhost` で開いてください。

## 環境変数

API（`server/config.ts`、`server/main.ts`）の設定です。

| 変数 | 既定 | 内容 |
|---|---|---|
| `FAMILY_HUB_ORIGIN` | `http://localhost:4174` | 利用者が開くオリジン。Origin の検査、Cookie、パスキーの RP ID に使う |
| `FAMILY_HUB_SECRET` | 開発用の値 | 鍵束を使わないときの鍵（kid `legacy`）。CSRF、署名、確認コードの暗号化に使う。32文字以上。`NODE_ENV=production` では、これか `FAMILY_HUB_KEYS` が必須 |
| `FAMILY_HUB_KEYS` | 未設定 | 鍵束。`kid=秘密` をカンマで並べる（秘密は32文字以上）。設定すると `FAMILY_HUB_SECRET` は kid `legacy` として読むためだけに使う |
| `FAMILY_HUB_ACTIVE_KID` | `FAMILY_HUB_KEYS` が1つならその kid | 新しく署名・暗号化する鍵。`FAMILY_HUB_KEYS` に2つ以上あるときは必須 |
| `FAMILY_HUB_DATABASE` | `data/family-hub.sqlite`（`dev:server` は `data/dev.sqlite`） | SQLite のファイル |
| `FAMILY_HUB_AUDIT_DB` | `FAMILY_HUB_DATABASE` と同じディレクトリの `audit.db` | 監査の記録（変更の記録）のファイル。権限 0600 で作る。改ざんに気づく仕組みと限界は [配備の覚え書き](deploy/README.md#監査の記録) |
| `FAMILY_HUB_AUDIT_RETENTION_MONTHS` | `24` | 監査の記録を残す月数。過ぎた分は毎日 checkpoint を残してから消す。0 なら消さない |
| `FAMILY_HUB_MEDIA` | `data/media` | 写真、動画、添付の保存先 |
| `FAMILY_HUB_BACKUP_DIR` | 未設定 | 暗号化したバックアップの置き場所。`FAMILY_HUB_BACKUP_KEY` と両方あるときだけ毎日作る。なければ自動のバックアップは止まり、起動のときに運用ログへ出す（[配備の覚え書き](deploy/README.md#バックアップ)） |
| `FAMILY_HUB_BACKUP_KEY` | 未設定 | バックアップ専用の鍵。32文字以上。`FAMILY_HUB_SECRET`・`FAMILY_HUB_KEYS` と同じ値では起動しない。API の機械とも置き場所とも別に保管する |
| `FAMILY_HUB_BACKUP_AT`、`FAMILY_HUB_BACKUP_TZ` | `03:00`、`Asia/Tokyo` | 毎日のバックアップの時刻と、日・週・月（日7・週4・月6）を数える時間帯 |
| `FAMILY_HUB_RECENT_AUTH_MS` | `300000` | 金銭や権限の操作に必要な、直近の本人確認の有効時間 |
| `FAMILY_HUB_SMTP_HOST`、`_PORT`、`_USER`、`_PASSWORD`、`_FROM` | 未設定（ポートは587） | メール送信。未設定の間は、メールを使う機能を画面に出しません |
| `FAMILY_HUB_CLAMD_HOST`、`_PORT`、`_TIMEOUT_MS` | 未設定（3310、600000） | ウイルス検査。`NODE_ENV=production` では `FAMILY_HUB_CLAMD_HOST` が必須 |
| `FAMILY_HUB_LLM_URL` | 未設定 | 読み取りの補助の接続先（OpenAI 互換）。同じ機械か家庭内だけ（loopback、10/8・172.16/12・192.168/16、fc00::/7）。外への宛先なら起動しない。未設定なら機能は無効 |
| `FAMILY_HUB_LLM_MODEL` | なし | `FAMILY_HUB_LLM_URL` を設定するときは必須 |
| `FAMILY_HUB_LLM_KEY` | 未設定 | 接続先の鍵 |
| `FAMILY_HUB_LLM_TIMEOUT_MS` | `45000` | 読み取りの待ち時間 |
| `FAMILY_HUB_LLM_ALLOW_LAN_HTTP` | 未設定 | `1` のときだけ、loopback 以外の家庭内の機械へ平文の http で送る。画像と本文と鍵が平文で流れる |
| `PORT` | `8799` | API のポート |
| `HOST` | `127.0.0.1` | API の待ち受けアドレス（`server/main.ts` だけ。`dev:server` は常に `127.0.0.1`） |

`NODE_ENV=production` では、https のオリジン、`FAMILY_HUB_SECRET` か `FAMILY_HUB_KEYS`、`FAMILY_HUB_CLAMD_HOST` がないと起動しません。鍵の入れ替えの手順は [配備の覚え書き](deploy/README.md#鍵) にあります。開発の転送先を変えるときは、画面側の `FAMILY_HUB_API` を設定します。

版の印は環境変数ではなく、ビルドのときに git の値（`VITE_BUILD_ID` があればその値）を画面と API の両方へ埋めます。

## 運営者の命令

支払いの仕組みはありません。登録から14日で試用が終わるので、利用期間の延長と停止はデータベースのある機械で命令を実行します。HTTP の経路はなく、すべて監査の記録に残ります。API と同じ環境変数で実行してください。

```bash
npx tsx server/cli.ts list                      # 開発。ビルド後は node dist-server/cli.js
npx tsx server/cli.ts grant <household> [days]  # 利用期間を延ばす（days を省くと期限なし）
npx tsx server/cli.ts expire <household>        # 利用を止める
npx tsx server/cli.ts suspend <membership>      # メンバーの参加を止める
npx tsx server/cli.ts resume <membership>       # メンバーの参加を戻す
npx tsx server/cli.ts keys status               # 鍵ごとの状態と、確認コードの秘密の件数
npx tsx server/cli.ts keys rotate               # 確認コードの秘密を有効な鍵で暗号化し直す（何度実行してもよい）
npx tsx server/cli.ts keys retire <kid>         # 参照が0件の鍵を引退させる
npx tsx server/cli.ts totp reset --user <id>    # その人の確認コードと回復コードを消す
npx tsx server/cli.ts backup now                # 暗号化したバックアップを作って確かめる
npx tsx server/cli.ts backup list               # バックアップの世代の一覧
npx tsx server/cli.ts backup verify <id>        # 世代を確かめる（食い違いは終了コード2）
npx tsx server/cli.ts restore <id> --to <dir>   # 新しいか空のディレクトリへ復元する（API が動いている間は断る）
```

終了コードは、成功が0、使い方の誤りと断ったときが1です（理由は標準エラーに出ます）。`audit verify` と `backup verify` などの確認で食い違いを見つけたときは2です。

## ビルド

| 命令 | 出力 | 中身 |
|---|---|---|
| `npm run build` | `dist/` | モックの通常版。監査用の面と管理コンソールの見本を含まない |
| `npm run build:http` | `dist-http/` | 実スタックの画面。確認用データを含まない |
| `npm run build:server` | `dist-server/` | API（`main.js`）と運営者の命令（`cli.js`）。実行には `node_modules` が要る |
| `npm run build:audit` | `dist-audit/` | 役割の切り替え、異常状態、`/showcase`、source map を含む内部監査用 |

配備の注意は [deploy/README.md](deploy/README.md) にあります。

## 内部監査の画面

`npm run dev:audit` または `build:audit` のビルドでだけ `/showcase` が開きます。`/showcase/management` は管理コンソールの見本で、すべて架空のデータで動き、本物のサーバーへは何も送りません。サーバーの経路もありません。

## 検証

- `npm run verify`: lint、型、単体、3種のビルド、セキュリティ・日本語・操作台帳・OpenAPI・経路・ユースケースの検査、Lighthouse、3ブラウザのモック E2E、axe、実スタックの E2E
- `npm run test:real`: 実スタックの E2E（Chromium、CSP あり）
- `npm run audit:routes`: Fastify の経路と OpenAPI の双方向の照合
- `npm run audit:visual`: 主要画面の撮影とHTMLギャラリー生成
- `npm run render:er`: MermaidソースからER図SVGを生成
- `npm run package`: 全検証後、静的ZIP・ソースTGZ・SHA-256を生成（`bash scripts/package.sh --dry-run` でソースの一覧を確認できます）

`/v1` の要求は OpenAPI（102操作）に合わせ、同じ試験集合をモックと実サーバーの両方へ流します（`src/data/gateway.test.ts`、`server/test/gateway.parity.test.ts`）。外部の相手（SMTP、ClamAV、LLM、Open-Meteo）は `server/testing/` の代役で試し、実物には接続しません。

## 重要な境界

- 認証、セッション、CSRF、認可、再認証、監査の記録、添付の検査はサーバーで強制します。画面の非表示は認可の境界ではありません。
- 通常の `build` は `/showcase`、actor/scenario切替、監査用fixture、source mapを含みません。`build:http` のビルドは確認用データも含みません。どちらも `npm run audit:ui` と `npm run audit:security` が確かめます。
- 安定版でない Node の API（`node:sqlite`）は1ファイルに閉じています（`server/db/db.ts`）。パスワードのハッシュは `@node-rs/argon2` を `server/auth/password.ts` だけで使い、Node の `crypto.argon2` は `npm run audit:security` が禁じます。
- 新しいパスワードは、同梱した頻出の一覧（SecLists、MIT）、サービス名・メールアドレス・名前・家族グループの名前、繰り返しと並びで確かめます（`src/domain/passwordPolicy.ts`）。漏えいしたパスワードの照会（Have I Been Pwned など）は、入力の一部を外部へ送ることになるので使いません。
- 実物の SMTP、clamd、LLM、URL 取得の TLS の経路、H.264 の再生、ピクチャーインピクチャーは未確認です。実スタックの E2E は Chromium だけです。
- `npm run verify` は3ブラウザの E2E を含みます。最後の確認では Firefox がこの環境で起動できず、WebKit では環境由来の読み込みの時間切れが2件出たので、全体は終了コード0になっていません（[検証結果](docs/audits/verification-report.md)）。

詳細は [証拠台帳](docs/evidence-register.md)、[脅威モデル](docs/threat-model.md)、[アクセス表](docs/access-control-matrix.md)、[IA](docs/information-architecture.md)、[比較表](docs/parity-matrix.md) を参照してください。

## 主な画面と、どこから見るか

| 見たいもの | 場所 | 補足 |
|---|---|---|
| 記録した場所の一覧 | `/places`（左ナビ／モバイルは「その他」→「場所」） | 既定は「最近使った順」。支出・メモの詳細の場所表示からも開けます。管理者と大人だけ |
| 支出の詳細・編集・削除 | `/budget/{id}`（家計の一覧で行を選ぶ） | 取り消していない精算がある間は、金額・負担の変更と削除はできません。削除は7日以内なら元に戻せます |
| アルバム | `/albums`、`/albums/{id}` | 実スタックではファイルを検査して保存します。モックは画面の中だけの見本の動作です |
| 最近削除した項目 | `/settings/recently-deleted` | 7日以内なら元に戻せます。30日で完全に消します |
| 読み取りの補助 | 家計と予定の画面 | 運営者が有効にしたときだけ出ます。既定では無効です |
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
