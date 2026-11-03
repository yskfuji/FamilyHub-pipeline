# 配備の覚え書き

これは本番で安全と判定した手順ではありません。外部の侵入試験、実物の clamd・SMTP・LLM との接続、nginx そのものの動作は確かめていません。`nginx.conf` と `family-hub-api.service` は例で、この環境では動かしていません（nginx、systemd、docker がないため）。動作を確かめたのは、`dist-server/main.js` を一時的なデータベースで起動して `/health` に応答することだけです。

## 構成

- 画面: `npm run build:http` の `dist-http/` を nginx で配る。`deploy/nginx.conf` の `root` に置く。
- API: `npm run build:server` の `dist-server/` を Node.js 24.7.0 以上で動かす。`sharp` などの依存は `dist-server/` に入っていないので、`npm ci --omit=dev` の `node_modules` と同じ場所に置く。
- 同じコミットから両方を作る。`dist-server/build-id.txt` と画面の版の印が一致しないと `npm run audit:security` が失敗する。API の方が新しいと、開いている画面に新しい版の知らせが出る。

## 必須の設定

`NODE_ENV=production` では、次がないと起動しません。

- `FAMILY_HUB_ORIGIN`: https のオリジン
- `FAMILY_HUB_SECRET`: 32文字以上の乱数。失うと確認コードが使えなくなる
- `FAMILY_HUB_CLAMD_HOST`: clamd の接続先

`FAMILY_HUB_DATABASE` と `FAMILY_HUB_MEDIA` は永続する領域を指定します。メールを使うなら `FAMILY_HUB_SMTP_*`、読み取りの補助を使うなら `FAMILY_HUB_LLM_*` を設定します。

読み取りの補助の接続先は、同じ機械か家庭内の LLM だけです（loopback、10/8・172.16/12・192.168/16、fc00::/7）。外部の LLM のサービスは設定できません。

- IP をそのまま書いて範囲の外なら起動しません。名前を書いたときは起動のときに引き、範囲の外に解決すれば起動しません。名前を引けなければ起動し、読み取りの補助は「使えない」になります（運営の記録に理由が出ます）。
- 要求のたびに名前を引き直し、確かめた宛先にだけ接続します。
- 同じ機械なら `http://127.0.0.1:…` で構いません。家庭内の別の機械へは https を使ってください。平文の http で送るには `FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1` が必要で、**このとき利用者が選んだ画像とページの本文と鍵が、家庭内のネットワークを平文で流れます。**

全体の一覧は [README](../README.md) の「環境変数」にあります。

## nginx

- `nginx.conf` には TLS 証明書の設定がありません。配備先で足してください。
- `location /v1/` の中で `add_header` を書くと、上の見出しがすべて消えます。書かないでください。
- API は同じ機械の nginx から届く `X-Forwarded-For` の末尾だけを信じます（`trustProxy: 'loopback'`）。別の機械を挟むなら設定を変える必要があります。
- 見出しは `public/_headers` と同じ値です。変えるときは両方を変えます。`npm run audit:security` が一致を確かめます。

## バックアップ

バックアップの仕組みはありません。SQLite のファイル（`-wal` を含む）と `FAMILY_HUB_MEDIA` の両方を、運営者が別に保存してください。復元の手順は確かめていません。

## 運営

- 試用は14日で終わります。`node dist-server/cli.js list`、`grant`、`expire`、`suspend`、`resume` を API と同じ環境変数で実行します。
- `/health` は起動の確認、`/ready` はデータベースと clamd の確認です。nginx の設定では外へ出していません。
- `crypto.argon2` と `node:sqlite` は安定版の API ではありません。Node を更新するときは全試験を流してください。
