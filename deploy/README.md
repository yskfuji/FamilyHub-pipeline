# 配備の覚え書き

これは本番で安全と判定した手順ではありません。外部の侵入試験、実物の clamd・SMTP・LLM との接続、nginx そのものの動作は確かめていません。`nginx.conf` と `family-hub-api.service` は例で、この環境では動かしていません（nginx、systemd、docker がないため）。動作を確かめたのは、`dist-server/main.js` を一時的なデータベースで起動して `/health` に応答することだけです。

## 構成

- 画面: `npm run build:http` の `dist-http/` を nginx で配る。`deploy/nginx.conf` の `root` に置く。
- API: `npm run build:server` の `dist-server/` を Node.js 24.7.0 以上で動かす。`sharp` と `@node-rs/argon2` などの依存は `dist-server/` に入っていないので、`npm ci --omit=dev` の `node_modules` と同じ場所に置く。どちらもネイティブのモジュールで、`npm ci` がその機械に合う組み立て済みの部品を入れる（別の OS や CPU で作った `node_modules` を写さない）。
- 同じコミットから両方を作る。`dist-server/build-id.txt` と画面の版の印が一致しないと `npm run audit:security` が失敗する。API の方が新しいと、開いている画面に新しい版の知らせが出る。

## 必須の設定

`NODE_ENV=production` では、次がないと起動しません。

- `FAMILY_HUB_ORIGIN`: https のオリジン
- `FAMILY_HUB_SECRET`（32文字以上の乱数）か、鍵束の `FAMILY_HUB_KEYS` と `FAMILY_HUB_ACTIVE_KID`。下の「鍵」を参照
- `FAMILY_HUB_CLAMD_HOST`: clamd の接続先

`FAMILY_HUB_DATABASE` と `FAMILY_HUB_MEDIA` は永続する領域を指定します。メールを使うなら `FAMILY_HUB_SMTP_*`、読み取りの補助を使うなら `FAMILY_HUB_LLM_*` を設定します。

読み取りの補助の接続先は、同じ機械か家庭内の LLM だけです（loopback、10/8・172.16/12・192.168/16、fc00::/7）。外部の LLM のサービスは設定できません。

- IP をそのまま書いて範囲の外なら起動しません。名前を書いたときは起動のときに引き、範囲の外に解決すれば起動しません。名前を引けなければ起動し、読み取りの補助は「使えない」になります（運営の記録に理由が出ます）。
- 要求のたびに名前を引き直し、確かめた宛先にだけ接続します。
- 同じ機械なら `http://127.0.0.1:…` で構いません。家庭内の別の機械へは https を使ってください。平文の http で送るには `FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1` が必要で、**このとき利用者が選んだ画像とページの本文と鍵が、家庭内のネットワークを平文で流れます。**

全体の一覧は [README](../README.md) の「環境変数」にあります。

## 鍵

鍵は、CSRF のトークン、パスワードの再設定のリンク、添付のリンクの署名と、確認コード（二段階認証）の秘密の暗号化に使います（`server/auth/keyring.ts`）。

- 今までの設定（`FAMILY_HUB_SECRET` だけ）は、そのまま kid `legacy` の有効な鍵として動きます。
- 鍵束: `FAMILY_HUB_KEYS=k2026=<32文字以上の乱数>,k2027=<…>` と `FAMILY_HUB_ACTIVE_KID=k2027`。`FAMILY_HUB_SECRET` も残っていれば、`legacy` として読むためだけに使います。
- **1つの kid の秘密は変えません。** 秘密を替えるときは新しい kid を足します。同じ kid の秘密を変えると、起動のたびに運用ログへ「指紋が違う」と出て、前の秘密で暗号化した確認コードは使えなくなります。
- 起動のたびに、kid ごとの指紋（秘密は分からない値）を `key_fingerprints` 表と照らし合わせます。

入れ替えの手順:

1. 新しい kid を `FAMILY_HUB_KEYS` に足し、`FAMILY_HUB_ACTIVE_KID` をその kid にして API を起動し直す。古い kid は残す（開いている画面のトークンと、発行済みのリンクを確かめるため）。
2. `node dist-server/cli.js keys rotate` で、確認コードの秘密を新しい鍵で暗号化し直す（1つのトランザクション。何度実行してもよい）。
3. パスワードの再設定のリンクの有効期限（30分）と、添付のリンクの有効期限が過ぎるのを待つ。
4. `node dist-server/cli.js keys retire <古い kid>`。古い鍵で暗号化した秘密が残っていれば、件数を示して断ります（終了コード1）。
5. API を起動し直し、古い kid を `FAMILY_HUB_KEYS` から消す。`keys status` で状態を確かめる。

鍵をなくしたとき:

- API はそのまま起動します。運用ログに、どの kid の何件が読めないかが出ます。要求が 500 になることはありません。
- その人は、回復コード（鍵に依存しないハッシュで保存）かパスキーでサインインできます。設定の「アカウント」に「確認コードを確かめられなくなりました」と出るので、解除してから設定し直してもらいます。
- 回復コードもパスキーもないときは、本人であることを確かめたうえで `node dist-server/cli.js totp reset --user <利用者の ID>` を実行します（監査の記録に残ります）。
- 鍵は API の機械とは別の場所にも保管してください。

## nginx

- `nginx.conf` には TLS 証明書の設定がありません。配備先で足してください。
- `location /v1/` の中で `add_header` を書くと、上の見出しがすべて消えます。書かないでください。
- API は同じ機械の nginx から届く `X-Forwarded-For` の末尾だけを信じます（`trustProxy: 'loopback'`）。別の機械を挟むなら設定を変える必要があります。
- 見出しは `public/_headers` と同じ値です。変えるときは両方を変えます。`npm run audit:security` が一致を確かめます。

## バックアップ

バックアップの仕組みはありません。SQLite のファイル（`-wal` を含む）と `FAMILY_HUB_MEDIA` の両方を、運営者が別に保存してください。復元の手順は確かめていません。

## 運営

- 試用は14日で終わります。`node dist-server/cli.js list`、`grant`、`expire`、`suspend`、`resume` を API と同じ環境変数で実行します。鍵の命令（`keys status|rotate|retire`、`totp reset --user`）は上の「鍵」を参照してください。
- `/health` は起動の確認、`/ready` はデータベースと clamd の確認です。nginx の設定では外へ出していません。
- `node:sqlite` は安定版の API ではありません。Node を更新するときは全試験を流してください。パスワードのハッシュは Node の `crypto.argon2` ではなく `@node-rs/argon2` で計算します。
