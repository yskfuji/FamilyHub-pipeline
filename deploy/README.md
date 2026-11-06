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

`FAMILY_HUB_DATABASE` と `FAMILY_HUB_MEDIA` は永続する領域を指定します。バックアップは `FAMILY_HUB_BACKUP_DIR` と `FAMILY_HUB_BACKUP_KEY` を設定すると毎日作ります（下の「バックアップ」）。監査の記録は別のファイル `FAMILY_HUB_AUDIT_DB`（既定は `FAMILY_HUB_DATABASE` と同じディレクトリの `audit.db`）に置きます。下の「監査の記録」を参照してください。メールを使うなら `FAMILY_HUB_SMTP_*`、読み取りの補助を使うなら `FAMILY_HUB_LLM_*` を設定します。

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

## 監査の記録

- ファイル: `FAMILY_HUB_AUDIT_DB`（既定は本体の DB と同じディレクトリの `audit.db`）。API と命令が権限 0600 で作り、すでにあるファイルも 0600 にそろえます（`-wal` と `-shm` も同じ権限になります）。置き場所は `family-hub-api.service` の `ReadWritePaths` の中にしてください。別のディレクトリに置くなら `ReadWritePaths` に足します。
- **別のファイルにしても、API と同じ OS の利用者や root からは守れません。** 両方のファイルを書き換えられ、trigger も外せます。改ざんに気づけるのは、別の場所に残した基準点の範囲だけです。
- 基準点: API は毎日1回、運用ログ（journald）に `audit anchor day=… seq=… hash=…` の行を出します。同じ値を本体の DB の `audit_anchors` にも残し、バックアップの目録にも入れます。本体の DB の控えは、両方のファイルを書き換えられる人には効かないので、運用ログを別の機械へ送るか、この行を別の場所に控えてください。**最後の基準点より後の切り捨ては検出できません。** 今の基準点は `node dist-server/cli.js audit anchor` でも表示できます。
- 確かめる: `journalctl -u family-hub-api | grep 'audit anchor' > anchors.txt` で控えを作り、`node dist-server/cli.js audit verify --anchors anchors.txt`。改変・削除・並べ替え・挿入・基準点より前の切り捨てを、行の番号とともに標準エラーに出し、終了コード2で終わります。食い違いがなければ0です。API も起動のときと毎日、直近の5000行を確かめ、食い違いを運用ログ（`audit: the chain check failed at seq …`）と管理者の「変更の記録」に出します。`/ready` は落としません。
- 保持: 既定で24か月（`FAMILY_HUB_AUDIT_RETENTION_MONTHS`、0 なら消さない）。API が毎日、過ぎた分を消します。手で消すなら `node dist-server/cli.js audit prune --before 2025-01-01`（省くと `FAMILY_HUB_AUDIT_RETENTION_MONTHS` の月数より前。0 にしているときは、省くと何も消さずに終了コード1で止まるので、`--before` を付けてください）。消す前に、消す区間の末尾の hash を checkpoint として残し、そのことを鎖に1行足します。verify はそこから続きを確かめます。
- 移行: 以前の版の本体の DB にあった `audit_events` の行は、最初の起動で送り出しの箱（`audit_outbox`）へ移し、`audit.db` の鎖の起点にします（表は消えます）。起動の前に本体の DB を別に写しておいてください。
- バックアップ: `audit.db` は毎日のバックアップに入ります（下の「バックアップ」）。目録には、写した `audit.db` の鎖の末尾（基準点）を入れ、確かめるときと復元のときに照らし合わせます。

## nginx

- `nginx.conf` には TLS 証明書の設定がありません。配備先で足してください。
- `location /v1/` の中で `add_header` を書くと、上の見出しがすべて消えます。書かないでください。
- API は同じ機械の nginx から届く `X-Forwarded-For` の末尾だけを信じます（`trustProxy: 'loopback'`）。別の機械を挟むなら設定を変える必要があります。
- 見出しは `public/_headers` と同じ値です。変えるときは両方を変えます。`npm run audit:security` が一致を確かめます。
- `public/_headers` は静的ホスティング用の設定で、配信物にも入ります。nginx では `location = /_headers` で 404 にしています（`npm run audit:security` が確かめます）。
- アクセスログには IP アドレスが残ります。プライバシーポリシーに書く日数（`src/content/legal.ts` の「本サービスの機械の記録」）で消すよう、logrotate などを設定してください。
- 圧縮: `npm run build:http` は、1KB 以上の文字のファイル（JS・CSS・HTML・SVG など）の隣に、gzip -9 で圧縮した `.gz` を置きます。`location /` の `gzip_static on;` がそれをそのまま配り、配るたびに圧縮しません。`gzip_static` には `ngx_http_gzip_static_module` が要ります（Debian・Ubuntu と nginx.org の包みには入っています。自分でビルドするときは `--with-http_gzip_static_module`）。`.gz` は元のファイルと同じ中身であることを `npm run audit:security` が確かめます。
- brotli（`.br`）は作っていません。`brotli_static` は別のモジュール `ngx_brotli` がないと設定の誤りになり、nginx が起動しないためです。使うときは、モジュールを入れたうえで、ビルドに `.br` の出力を足し、`brotli_static on;` を書いてください。

## バックアップ

本体の DB・`audit.db`・メディアを、毎日暗号化して `FAMILY_HUB_BACKUP_DIR` に保存します（`server/backup/`）。この環境で確かめたのは、一時的なディレクトリでの作成・確認・復元と、復元したファイルで API が起動して同じ記録を返すことです。systemd の下と、別の機械への持ち出しは確かめていません。

### 設定

- `FAMILY_HUB_BACKUP_DIR`: 置き場所。`family-hub-api.service` の `ReadWritePaths` に足します（例は `/var/backups/family-hub`）。DB と別のディスクにしてください。
- `FAMILY_HUB_BACKUP_KEY`: バックアップ専用の鍵。32文字以上の乱数（例: `openssl rand -base64 48`）。`FAMILY_HUB_SECRET` や `FAMILY_HUB_KEYS` の秘密と同じ値では起動しません。
- `FAMILY_HUB_BACKUP_AT`: 毎日の時刻（既定 `03:00`）。`FAMILY_HUB_BACKUP_TZ`: 日・週・月を数える時間帯（既定 `Asia/Tokyo`）。
- 置き場所か鍵のどちらかがないと、自動のバックアップは止まります。起動は止めず、起動のときに運用ログへ `backup: automatic backups are OFF …` と出します（`NODE_ENV=production` では警告として出します）。鍵が32文字未満・鍵束と同じ値・時刻や時間帯の形が違うときは、起動しません。

### 鍵の保管

- バックアップの鍵は、**API の機械とも、バックアップの置き場所とも別の場所**に保管してください（パスワード管理ツール、封をした紙など）。置き場所と一緒に置くと、暗号化の意味がなくなります。
- `FAMILY_HUB_KEYS`（鍵束）とも分けます。片方が漏れても、もう片方で守るためです。
- バックアップの鍵をなくすと、どの世代も復元できません。鍵を替えるときは、新しい鍵で `backup now` を実行した後も、古い世代が消えるまで（最長6か月）古い鍵を残してください。
- 復元には鍵束の鍵も要ります（確認コードの秘密を暗号化した kid）。鍵束の控えも、別に保管してください。

### 動き

- 決めた時刻を過ぎて、その時刻より後に作った今日の世代がなければ作ります。API が止まっていた日は、起動の後に作ります。失敗したら1時間ごとにやり直し、運用ログに `backup: the daily backup failed (…)` と出します。成功すると `backup: generation <ID> created and verified …` と出します。
- 本体の DB と `audit.db` は、SQLite のバックアップ API で一貫した写しを一時ファイルに作り、読むだけで開いて `integrity_check` が `ok`、`foreign_key_check` が空であることを確かめます。目録には `audit.db` の鎖の末尾（基準点）を入れます。
- メディアは、写した DB が参照するファイル（準備ができた写真と動画とその縮小画像、確認が終わった添付）を全部入れます。足りなければ（3回写し直しても）世代を作らずに失敗します。期限切れのファイルを消す処理とは、`FAMILY_HUB_MEDIA/.maintenance.lock` で同時に動かしません（消す処理は次の回に行います）。
- 形式: ファイルを 4MiB の塊に分け、塊ごとに AES-256-GCM で暗号化します。鍵は `FAMILY_HUB_BACKUP_KEY` から HKDF で用途ごとに導きます。塊の AAD には、ファイルの ID・塊の番号・最後の塊かどうかを入れるので、入れ替え・並べ替え・切り捨ては確認で見つかります。ファイルと塊の名前は鍵つきの HMAC で、平文の hash は置き場所に出ません。同じ内容の塊は世代の間で共有し、1回だけ保存します。
- 目録（ファイルの一覧と平文の sha256、監査の基準点、必要な鍵の指紋、作った日時）も暗号化し、HMAC を付けます。世代は、作ったその場で置き場所から読み戻して全部を確かめ（復号・hash・DB の検査・参照するメディア・基準点・鍵の指紋）、合ってから目録を rename で置いて確定します。**途中で止まっても、目録のない半端な世代は見えません。** 残った一時ファイルは次の実行が消します。毎週の自動の復元は行いません。
- 世代の数: 日7・週4・月6。日は今日を含む直近7日の各日のいちばん新しい世代、週は今週を含む直近4週（月曜始まり）の各週の最初に成功した世代（月曜が失敗した週は火曜以降）、月は今月を含む直近6か月の各月の最初に成功した世代です。暦で数えるので、6か月より前の世代は残りません。新しい世代を確定するたびに、外れた世代を消し、どの世代も参照しない塊を消します（バックアップが止まっている間は、古い世代も残ります）。
- 毎回、メディアを全部読みます（名前を計算するため）。変わっていない塊は書きません。

### 命令

```bash
node dist-server/cli.js backup now               # 世代を1つ作って確かめ、古い世代を片付ける
node dist-server/cli.js backup list              # 世代の一覧（作った日時・ファイルの数・大きさ・残る理由）
node dist-server/cli.js backup verify <ID>       # 世代を確かめる
node dist-server/cli.js restore <ID> --to <新しいディレクトリ> [--allow-missing-key <kid>]
```

API と同じ環境変数で実行します。終了コードは、成功が0、使い方の誤り・断ったとき（バックアップの実行中、ない世代、動いている API、足りない鍵、空でないディレクトリ）が1、確かめて食い違いを見つけたときが2です。

### 復元の手順

1. `backup list` で戻す世代を選び、`backup verify <ID>` が0で終わることを確かめます。
2. API を止めます（`systemctl stop family-hub-api`）。API は起動の間 `FAMILY_HUB_DATABASE` の名前に `.server.lock` を足したファイルを持ち、これがある間は `restore` が断ります。
3. `node dist-server/cli.js restore <ID> --to /var/lib/family-hub-restore` を実行します。行き先は、新しいか空のディレクトリだけです。今のファイルは上書きしません。書いた後にもう一度、hash と DB の検査を行います。
   - 世代が使う鍵（確認コードの秘密を暗号化した kid）が鍵束にないか、秘密が違うと、kid を示して止まります。鍵束を直して実行し直してください。鍵を本当になくしたときだけ `--allow-missing-key <kid>` を付けます（その人は回復コードかパスキーでサインインし、確認コードを設定し直します）。
4. 表示された `FAMILY_HUB_DATABASE=…`、`FAMILY_HUB_AUDIT_DB=…`、`FAMILY_HUB_MEDIA=…` を `/etc/family-hub/api.env` に設定します。元の場所に戻すなら、今のファイル（`-wal` と `-shm` を含む）とメディアを別の名前に移してから、復元したものを移します。所有者は API を動かす利用者、ファイルの権限は 0600 にします。
5. API を起動し、`/health`、`node dist-server/cli.js audit verify`、`keys status` を確かめます。
6. 復元した世代より後の変更（記録・写真・監査の記録）は戻りません。利用者に知らせてください。

### 別の場所へ持ち出す（3-2-1 の目安）

- 同じ機械の中だけでは、故障・盗難・火事・ランサムウェアに耐えません。目安は、写しを3つ、2種類の媒体に、1つは別の場所に置くことです（3-2-1）。
- 持ち出すのは `FAMILY_HUB_BACKUP_DIR` の `chunks/` と `generations/` です（`tmp/` は不要）。暗号化済みなので、外付けのディスクや別の機械へそのまま写せます（`rsync -a --delete` など）。鍵は一緒に置かないでください。
- 写す途中で新しい世代ができると揃わないので、決めた時刻を外して写し、写した先を `FAMILY_HUB_BACKUP_DIR` にして `backup verify` で確かめてください。運用ログの基準点の行（`audit anchor …`）も別に控えます。

### 削除したデータ

削除したアカウントや記録も、最長6か月はバックアップに残ります（規約とポリシーにも書いています）。置き場所の中は自動で片付きますが、別の場所へ持ち出した写しは、運営者が同じ期間で消してください。

## ファイルの権限

- API は、本体の DB を 0600、DB とメディアのフォルダーを 0700 で作ります。`family-hub-api.service` は `UMask=0077` で、写真・WAL・バックアップも持ち主だけが読み書きできるようにします（侵入試験 PT-PERMS、`docs/security/pentest-2026-11.md`）。
- 前の版から移すときは、既にあるファイルの権限を `chmod -R go-rwx` で直してください。

## 漏えいなどが起きたとき

個人情報保護法26条と施行規則7条により、次のものは個人情報保護委員会への報告と本人への通知が要ります。不正アクセスなど不正の目的によるものは、人数を問いません。

1. 気づいたら、影響を止める（鍵の入れ替え `keys rotate`、該当するセッションの無効化、外からの接続を止める）。記録（`audit verify`、nginx のログ）を保全する。
2. 範囲を確かめる（どの家族・どの人の、どの情報か）。
3. 委員会へ速報を「速やかに」（目安は3〜5日以内）送る。
4. 影響を受ける方へ知らせる（何が起きたか、何が漏れたおそれがあるか、何をしてほしいか）。
5. 確報を30日以内（不正の目的によるものは60日以内）に送る。

責任者と連絡の流れは、運営者が決めて別に書いておきます（`docs/legal/legal-review-2026-11.md` の「運営者が決めること」）。

## 運営

- 試用は14日で終わります。`node dist-server/cli.js list`、`grant`、`expire`、`suspend`、`resume` を API と同じ環境変数で実行します。鍵の命令（`keys status|rotate|retire`、`totp reset --user`）は上の「鍵」、監査の記録の命令（`audit verify|anchor|prune`）は上の「監査の記録」、バックアップの命令（`backup now|list|verify`、`restore`）は上の「バックアップ」を参照してください。
- `/health` は起動の確認、`/ready` はデータベースと clamd の確認です。nginx の設定では外へ出していません。
- `node:sqlite` は安定版の API ではありません。Node を更新するときは全試験を流してください。パスワードのハッシュは Node の `crypto.argon2` ではなく `@node-rs/argon2` で計算します。
