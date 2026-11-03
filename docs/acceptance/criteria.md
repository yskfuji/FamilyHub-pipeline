# 合格基準

指摘17項目（A）と画面全体（B）の合格基準。根拠は [evidence.md](evidence.md)。各基準は自動の試験で判定する。

## 監査の記録

| 回 | 日付 | 方法 | 結論 |
|---|---|---|---|
| 1 | 2026-11-03 | 計画の段階で、別のエージェントがコードと資料に照らして反証を探した | 矛盾2件（鍵がないと起動しない基準が回復を妨げる、鍵つきの鎖が鍵の引退を妨げる）、誤り（繰り返しの曜日の回し方、まとめた精算の範囲、性能の今の値）、漏えいの抜け（監査の対象、アルバムの検索の場所、バックアップの塊）、必要以上の設計（鍵つきの鎖、OKLCH での保存、毎週の自動復元）を見つけた。すべてこの版で直し、**採用**とした |
| 2 | 実装の後 | 実装と試験を突き合わせ、試験が中身のないものになっていないかを確かめる | 下の「結果」の表に記入する |

## 結果

段階ごとに、基準・試験の ID・結果を記入する。

| 項目 | 試験の ID | 結果 |
|---|---|---|
| A1 | 段階1。`server/test/llm.test.ts`: 「allowed addresses (A1-2)」の allows／refuses の全件（2）、「configuration and startup」の refuses to start with the URL…／refuses to start with an address outside the home…（`http://8.8.8.8`・`http://169.254.169.254` ほか）／accepts…（`https://192.168.1.10` ほか）／allows plain http to another machine on the home network only when it is stated（4）／refuses to start when the name resolves outside the home（`https://api.example.com`）／starts with the helper unavailable when the name does not resolve（1）、「each request」の resolves again for every request and connects to the checked address／never connects to a name that changes to a public address after startup／never connects when any later answer is outside…／opens the socket only to the pinned address…（3・5）、「createLlmClient」の does not use the global fetch／refuses a redirect without following it, and a body over 1 MiB／reports a connection failure without the URL or the key。`scripts/security-check.mjs` の LLM の規則（6。lookup を外す・`fetch` を足す・`agent: false` を外す注入で失敗することを確かめて戻した）。`src/content/legal.test.ts` の「読み取りの補助は、既定で使わないことと、家庭内で読み取り外部へ送らないことを明記する」、`e2e/real/assistant.spec.ts` の案内文（7） | 合格（段階1）。実物の LLM と、家庭内の別の機械への https は未確認 |
| A2 | 段階1。新しく作ったのではなく、守られていることを示す試験を足した。`server/test/urlFetcher.test.ts` の「port 443 only, with the production settings (A2)」: refuses a redirect to port 8443 without connecting to it／refuses a redirect to plain http without connecting to it／refuses plain http and another port before any connection／still follows a redirect that stays on port 443。既存の「checks before any connection › refuses another port」 | 合格。443番の確認を外すと前の3つのうち2つが失敗することを確かめた。urlFetcher の動作は変えていない（宛先の判定を共有の部品 `server/adapters/destination.ts` へ移しただけ） |
| A3 | （未記入） | 未実施 |
| A4 | 段階1（1の「閲覧者に見えること」の部分だけ）: `src/data/gateway.suite.ts` の「answers NOT_FOUND for every change to an expense the viewer cannot see, even when the viewer pays or shares it」（モックと実サーバー）。精算・精算の取り消し・更新・削除・復元が、一覧と同じ規則（`canSeeExpense`／`projectExpense`）で確かめ、応答も同じ投影を通す。最近削除からも見えない支出を外した | 一部（段階1）。`settleAll` は段階5 |
| A5 | 段階3（1〜7、9。画面の8は段階9）。`src/authz/policy.test.ts` の gives the change record (audit.read) to owners only and never lets an override grant it to an adult (A5-1)（`capabilitiesFor`／`capabilityCeilingFor`。管理者への個別の拒否は効く）。`src/data/gateway.suite.ts` の「change record (A5)」4件（モックと実サーバーの両方。応答は OpenAPI の `AuditPage`／`AccountAuditPage`（`additionalProperties: false`）で照合）: records each successful change once by operation name, with field names but never the values（項目の鍵を全部照合、本文の語が出ない、`detail` は `{"fields":[…]}`）／lets only owners read the household record, and every member read their own account record／filters by person, kind and date, and pages with a cursor／hides the ID of a record the viewer can no longer see。`server/test/audit.test.ts` の「the record API (A5)」: hides the target of a record another member keeps private（同じファイルを2人の世界で共有し、蓮さんだけに見える支出を `hidden: true`・ID なしで返す）／lists sign-in and two-step changes in the account record…（鍵を全部照合、otpauth・アドレスが出ない）。`server/test/auditLabels.test.ts`（OpenAPI の全 operationId に日本語の名前、書く操作すべてに名前とまとまり）。`src/content/legal.test.ts` の 管理者が変更の記録を見られることと、その保持の期間（24か月）を明記する（A5-9）。`scripts/audit-contract.mjs` が `src/data/gatewayOperations.ts`（モックの対応表）と `operationFor` の一致を確かめる。`docs/verification/use-cases.json` に UC-A15・UC-H13 | 合格（段階3、API）。先に失敗を確かめた: 対応表の記録を外す・伏せる処理を外す・大人の上限に戻す・名前を1つ消す、の注入でそれぞれ失敗し、戻した。IP は記録にもともと持たず、応答にも入れない（管理者に家族の居場所や回線を見せないため）。個別の許可で大人に渡すことはできない（上限の外。基準の1に従い、指示の「上書きで渡せる」とは違う）。画面（8）は段階9 |
| A6 | 段階3。`server/test/audit.test.ts`: 「the audit file (A6-1)」lives in its own file next to the main database, created with mode 0600（`-wal` も 0600）／narrows the mode of a file that already exists、「outbox and mover (A6-2)」writes the outbox in the same transaction as the change…／neither duplicates nor loses a row when it stops between appending and clearing the outbox（追記だけ済ませて接続を閉じ、開き直して移す）／keeps the rows in the outbox when the audit file cannot be written…、「append-only triggers (A6-3)」、「hash chain (A6-4)」hashes SHA-256(prev_hash ‖ canonical row)…／never forks when the API and several operator processes append at the same time（別の処理3つ×120行、実際の `cli.ts grant`、API の120行を同時に。481行が連番で1本につながる）、「anchors (A6-5)」、「tampering is detected with its position (A6-6, A6-9)」trigger を外した生の接続で、改変（seq 4）・削除（6、番号を詰めても6）・並べ替え（3）・挿入（6）・基準点より前の切り捨て（7）・基準点と食い違う作り直し（8）を検出し、最後の基準点より後の切り捨ては検出できないことも確かめる／`audit verify` の終了コード2と位置、`--anchors` の運用ログの写し、「checking at startup (A6-6)」壊れた鎖でも起動し `/ready` は200、API の `chain.state` が problem、運用ログに出る、「retention and prune (A6-7)」既定24か月／checkpoint を残してから消し、verify が checkpoint から続ける／checkpoint だけを置いて頭を切る改ざんを検出／毎日の手入れ、「the previous audit_events table becomes the origin of the chain (A6-8)」。`dist-server/main.js` を一時的な DB で起動し `/health` 200、`audit.db`・`-wal`・`-shm` が 0600。`dist-server/cli.js` の `grant`・`audit verify|anchor|prune` を実行 | 合格（段階3）。先に失敗を確かめた: `INSERT OR IGNORE` を外す・`BEGIN IMMEDIATE` を外す・DELETE の trigger を開ける・checkpoint の裏づけの確認を外す・確定の前に移す・`/ready` を落とす、の注入でそれぞれ失敗し、戻した。基準点は運用ログと本体の DB の `audit_anchors`（計画の ER にない表を1つ足した）に残す。バックアップの目録への記入は段階4（`AuditLog.currentAnchor()` を用意した）。別のファイルにしても同じ OS の利用者や root からは守れないこと、最後の基準点より後の切り捨ては検出できないことを、脅威モデルと deploy/README.md に書いた |
| A7 | 段階1（7）: `server/test/media.test.ts` の「serves the type and name stored with the attachment, whatever the link query says」。段階2（1〜6）: `server/test/keyring.test.ts` の「configuration (A7-1)」keeps FAMILY_HUB_SECRET working as the active legacy key／reads FAMILY_HUB_KEYS with the active kid and keeps FAMILY_HUB_SECRET readable as legacy／refuses（6件）、「sealed secrets (A7-2)」reads the previous format as the legacy key, from a fixed value（HEAD 03f7897 の実装で作った固定の値）／writes v2.<kid>.<iv>.<tag>.<ct> bound to the person and the purpose／answers null, never throws…、「signatures across a rotation (A7-3)」signs with the active key and accepts every key that is not retired（CSRF と添付。引退後は拒否）／finds a reset link issued before the rotation, with every key、「rotating and removing a key (A7-4)」re-seals every secret under the active key, then still verifies the code without the old key（`keys status`・`rotate` の冪等・参照があるときと有効な鍵の `retire` の拒否・監査の記録）／refuses to start when the active key has been retired、「a lost key (A7-5, A7-6)」starts, marks the code unavailable, lets a recovery code sign in, and allows setting up again／never answers 500 when the secret of a kid has changed／reads a secret stored in the previous format and signs in with its code／lets the operator remove the code, with an audit record、「operator command exit codes」（`server/cli.ts` を別の処理で起動して終了コードを確かめる）。`server/test/account.test.ts` の確認コードの試験（`v2.legacy.` で保存）。`dist-server/cli.js` の `keys status`（0）・有効な鍵の `keys retire`（1）・`keys rotate`（0）を一時的な DB で実行 | 合格（段階2）。先に失敗を確かめた: HEAD では秘密を変えると確認コードの手順が 502 になる（使い捨ての作業木で再現）。パスキーでのサインインは鍵束に依存しない（CSRF だけ）ことをコードで確かめたが、鍵がないときのパスキーでのサインインそのものは試験していない（仮想認証器は実スタックの E2E だけで、鍵を替えて起動し直せない）。画面の「確認コードを確かめられなくなりました」の表示は E2E で確かめていない（API の `totpUnavailable` を試験）。`keys retire` が数えるのは確認コードの秘密だけで、再設定と添付のリンクは有効期限が過ぎるのを待つ手順を `deploy/README.md` に書いた |
| A8 | （未記入） | 未実施 |
| A9 | 段階2。`src/domain/passwordPolicy.test.ts`: rejects every entry, also when typed in capitals or full width（全5317件）、「context words (A9-2)」rejects（11件。サービス名・メールの @ より前・表示名・家族の名前、数字と記号を除いた一致、繰り返し）／keeps a passphrase that only contains a context word、「patterns (A9-3)」rejects（15件。同じ文字・短いまとまりの繰り返し、昇順・降順、キーボードの行・列・ジグザグ）、「ordinary long passphrases (A9-5)」accepts（6件）／checks only the length of the current password at sign-in。`server/test/passwordList.test.ts`: is the recorded file（sha256・5317件・NFKC と小文字・15〜64文字・重複なし）／is rejected in full by the check the API uses／is loaded on demand。`src/data/gateway.suite.ts` の「refuses common, personal and patterned new passwords everywhere and accepts a passphrase (A9)」（モックと実サーバー。変更・再設定・登録）。`server/test/passwordFields.test.ts`（`autocomplete` と貼り付け）。`e2e/shell.spec.ts` の「new passwords (A9) › fields name their purpose, allow paste, and load the common list only on submit」。`scripts/security-check.mjs` の「最初の表示のファイルに一覧が入っていない」規則（静的に読み込む変更を注入して失敗を確かめ、戻した） | 合格（段階2）。先に失敗を確かめた: 同等性の試験はモックと実サーバーの両方で失敗した。出典・ライセンス・sha256 は evidence.md §7。基準より広げた点: 8文字以下のまとまりの繰り返し（`passwordpassword` など）と、途中で1回だけ並びを替えたもの（`qwerty123456789` など）も拒否する。漏えいの照会は使わない理由を README・脅威モデル・evidence.md・`passwordPolicy.ts` に書いた |
| A10 | 段階2。`server/test/password.test.ts`: stores the PHC string with a 16-byte salt, m=46080, t=2, p=1 and a 32-byte hash（ライブラリの PHC の検証でも読める）／reads the previous format from fixed values and asks to store it again（`crypto.argon2` で一度だけ作って貼り付けた2つの固定の値）／asks to store again when the parameters differ from the current ones／never matches an unknown user, an unreadable value or out-of-range parameters, and still does the work（時間をそろえる処理）、「upgrading stored hashes at sign-in (A10-2)」signs in with the previous format and stores the PHC string…／leaves a current hash alone。`server/test/security.test.ts` の hashes passwords with a random salt。`scripts/security-check.mjs` の `crypto.argon2`／`argon2Sync` の禁止（`server/` と `src/` の全部、試験を含む。2か所に注入して失敗を確かめ、戻した）。`dist-server/main.js` を一時的な DB で起動し、`/health`、登録（一覧の語は 422）、サインイン（200）、保存した値が `$argon2id$v=19$m=46080,t=2,p=1$` で始まることを確かめた | 合格（段階2）。`@node-rs/argon2` 2.2.2 は `build:server` で外部のまま（`dist-server/main.js` が `import … from "@node-rs/argon2"`） |
| A11 | （未記入） | 未実施 |
| A12 | 段階1（2と3）: `src/data/gateway.suite.ts` の「lets an owner promote only a declared adult, and lets one of two owners leave」（モックと実サーバー）。成人の申告は `CommandEnv.isAdultDeclared` で、移譲と役割の変更の両方が同じ規則（`ownerCandidateProblem`）で確かめる。モックは利用者ごとの申告を持つ | 一部（段階1）。画面（1）は段階9 |
| A13 | （未記入） | 未実施 |
| A14 | （未記入） | 未実施 |
| A15 | （未記入） | 未実施 |
| A16 | （未記入） | 未実施 |
| A17 | （未記入） | 未実施 |
| B（コントラスト・操作の大きさ・フォーカス・認証・文字の間隔・動き・応答・取り消し・図表・性能） | （未記入） | 未実施 |

## A. 指摘17項目の合格基準

**共通の条件**
- 「同等性」とは、`src/data/gateway.suite.ts` がモックと実サーバーの両方で通ること。
- 新しい API は、OpenAPI・`audit-contract`・経路の宣言・`control-inventory`・`use-cases` のゲートを通す。
- 新しい文言は `audit:ui` を通す（サーバー・セッション・AI・検査済みなどの禁止語を使わない）。

### A1. LLM はローカルだけ
1. 起動時に URL が不正なら起動しない。IP を直接書いて許可範囲の外なら起動しない。名前を解決して許可範囲の外なら起動しない。名前の解決に失敗したときは起動し、LLM を「使えない」とする。
2. 許可するのは loopback、10/8・172.16/12・192.168/16、fc00::/7 だけ。
   - `::ffff:` で表した IPv4 は IPv4 として判定する。
   - 0.0.0.0/8・100.64/10・169.254/16・fe80::/10・グローバルは拒否する。
3. 要求のたびに名前を解決し直し、検査を通ったアドレスにだけ接続する。`urlFetcher` の宛先を固定する名前解決を、許可側の判定に反転させて共通の部品にする。`fetch` から `http(s).request` と `lookup` の組に替える。
4. loopback 以外へ平文の http で接続するのは、`FAMILY_HUB_LLM_ALLOW_LAN_HTTP=1` を明示したときだけ。文書に、平文で流れることを書く。
5. 試験:
   - `https://api.example.com`・`http://8.8.8.8`・`http://169.254.169.254` では起動しない。
   - `https://192.168.1.10` は通る。
   - 途中で公開アドレスへ解決が変わる名前には、一度も接続しない。
6. `security-check` に、`llm.ts` は検査を通った宛先にだけ接続する、という規則を足す。
7. 案内文、規約、脅威モデル、比較表から外部の LLM の記述を消し、家庭内で処理して外部へ送らない、と書き直す。

### A2. 443番以外へ接続しない
- すでに実装済み（`urlFetcher.test.ts:77` に `:8443` の試験がある）。
- `:8443` へリダイレクトされたときの試験と、`http:` を拒否する試験を足す。
- 報告では、新しく作ったのではなく、守られていることを示す試験を足したと書く。

### A3. 支出と収入を記録後に変えられる
1. `expenseUpdateSchema` に `kind` を足す。
2. 支出から収入に変えるとき:
   - 取り消していない精算があれば CONFLICT にして理由を返す。
   - 負担は空にする。
   - 収入の費目を、同じ要求の中で必須にする。
3. 収入から支出に変えるとき: 負担と支出の費目を、同じ要求の中で必須にする。
4. 同等性の試験を4つ置く: 成功2つ、精算があるときの拒否、費目の食い違いの拒否。
5. 画面: 編集画面に種類のラジオを置く。切り替えると、費目と負担の欄がその場で変わる。負担が消えるときは、保存の前に知らせる。
6. 監査の `detail` には、変えた項目の名前（`{"fields":["kind"]}`）だけを残し、値は残さない。
7. オフラインの待ち行列には入れない。

### A4. まとめた精算を一度で記録する
1. 新しい操作 `settleAll` を作る。
   - 要求には、画面に示した負担の一覧 `[(expenseId, membershipId, remainingJpy)]` と送金案を含める。
   - サーバーは、各負担が閲覧者に見えることと、残額が一致することを確かめる。
   - 確かめた負担の集合だけを、1つのトランザクションで精算済みにする。
   - 1つでも合わなければ CONFLICT にする。
2. 送金の当事者が関わる負担の中に、閲覧者には見えない有効な支出の残額があれば拒否する。理由は、記録の中身を明かさない一般的な文にする。
3. 人で絞って表示しているとき（「すべて」以外）は、まとめて精算するボタンを出さない。
4. まとめの記録（`batchId`）には、実際に渡した送金の一覧を残す。履歴では1件のまとめとして表示する。
5. 性質の試験: 残高の合計が0、送金の数が n−1 以下、適用したあとの残額がすべて0。
6. 取り消しはまとめの単位（`reverseBatch`）で行い、取り消したあとの残額は元と一致すること。一部をすでに個別に取り消していれば CONFLICT にする。
7. 一部だけの支払いは、これまでどおり記録ごとの精算で残す。
8. 本人の再確認を求める。冪等キーは画面ごとに1つにする。オフラインの待ち行列には入れない。

### A5. 変更の記録を一覧で見る（画面と API）
1. 権限 `audit.read` は、既定では管理者だけが持つ。大人の上限には入れない。`capabilitiesFor` の試験で確かめる。
2. `GET /v1/audit-events` は家族の単位で返す。カーソルでページを送り、人・種類・期間で絞り込める。
3. `GET /v1/account/audit-events` は、本人が行ったサインインやパスワードの変更などを返す。
4. 応答に、本文・秘密・トークンを入れない。試験で全部の項目を照合する。
5. 閲覧者が見られない記録を指す行は、ID を伏せて「見られない記録」と表示する。
6. すべての `operationId` に日本語の表示名を用意する。足りなければ試験を失敗させる。
7. モックにも記録を持たせ、ゲートウェイのメソッドから `operationId` への対応表を置く。同等性の試験を通す。
8. 画面: 設定の「変更の記録」。日付ごとのタイムライン、絞り込み、空の状態、続きの読み込み、鎖の確認の結果（正常か、最後に確かめた日時）を出す。
9. 規約に、管理者が操作の記録を見られることと、保持の期間を書く。

### A6. 監査記録の改ざんに気づける
1. 本人の指摘に沿って、記録は別のファイル `audit.db`（`FAMILY_HUB_AUDIT_DB`、権限 0600）に置く。別ファイルにすること自体は守りを強めない（同じ利用者や root なら両方を書き換えられる）。改ざんに気づく仕組みの中心は、外に残す基準点にある。このことを文書に書く。
2. 本体のトランザクションの中で `audit_outbox` に書き、移送器が `INSERT OR IGNORE`（outbox の id は UNIQUE）で `audit.db` に追記してから outbox を消す。WAL では、ATTACH した複数のファイルにまたがるトランザクションは全体として原子的にならないので、この形にする。途中で止まっても重複も欠けも出ないことを試験で確かめる。
3. `audit.db` では UPDATE と DELETE を trigger の `RAISE(ABORT)` で拒否する。
4. `hash = SHA-256(prev_hash ‖ 正規化した行)` とし、鍵は使わない（鍵の引退を妨げないため）。追記は `BEGIN IMMEDIATE` の中で末尾を読んでから行う。サーバーと CLI が同時に書いても、鎖が分かれないことを試験で確かめる。
5. 基準点（鎖の末尾の hash）を、毎日、運用ログとバックアップの目録に残す。最後の基準点より後の切り捨ては検出できない。このことを文書に書く。
6. CLI の `audit verify` は、改変・削除・並べ替え・挿入・基準点より前の切り捨てを、位置を示して検出する。起動時には直近の分を確かめ、失敗したら管理者の画面と運用ログに出す。`/ready` は落とさない。
7. 保持の期間は既定で24か月。`audit prune --before` は、切り取る区間の末尾の hash を checkpoint の行として残してから消す。verify は checkpoint から続きを確かめる。
8. 今ある `audit_events` の行を移して、鎖の起点にする。
9. 試験: trigger を外した生の接続で改ざんし、5つの種類をすべて検出できること。

### A7. 鍵の入れ替えと、鍵をなくしたとき
1. 鍵束は `FAMILY_HUB_KEYS`（`kid=秘密` の並び）と `FAMILY_HUB_ACTIVE_KID` で持つ。`FAMILY_HUB_KEYS` がなければ、`FAMILY_HUB_SECRET` を kid `legacy` の有効な鍵とし、今の設定のまま動く。
2. 暗号文の形式は `v2.<kid>.<iv>.<tag>.<ct>`（AES-256-GCM。AAD は利用者 ID と用途）。古い形式は `legacy` として読む。
3. CSRF・再設定・添付の署名は、有効な鍵で署名し、引退していないすべての鍵で検証する。再設定のトークンの照会も、すべての鍵で行う。
4. CLI:
   - `keys status`: kid ごとの件数を出す。
   - `keys rotate`: 1つのトランザクションで暗号化し直す。何度やり直しても安全にする。
   - `keys retire <kid>`: 参照が0件のときだけ引退させる。
5. 起動時に、kid ごとの指紋を DB の記録と照らし合わせる。対応する鍵がない暗号文があっても起動はし、その利用者の二段階認証を「使えない」として扱う。回復コードとパスキーでのサインイン、`totp reset --user`（監査記録つき）は動かす。運用ログに理由を出し、500 にはしない。
6. 鍵をなくしたときは、回復コード（鍵に依存しない hash）でサインインし、二段階認証を登録し直すよう案内する。
7. 添付で配信する種類と名前は DB の記録から取り、クエリの値は使わない。署名には id・期限・表示方法を含める。

### A8. バックアップと復元
1. 毎日（既定は 03:00）、`node:sqlite` の `backup()` で本体 DB と `audit.db` を一時ファイルに写す。
   - `Db` に `backup()` 用のメソッドを足す。
   - 写しで `integrity_check` が 'ok'、`foreign_key_check` が空であることを確かめてから、rename で確定する。
2. メディアは、世代の間で塊を共有する増分にする。
   - 塊の名前は `HMAC(バックアップ鍵, 平文)` にする。平文の sha256 は使わない。
   - 写した DB が参照するメディアが、すべて世代に入っていることを確かめる。期限切れの削除の処理とは同時に動かさない。
3. 暗号は AES-256-GCM の塊ごとに行い、鍵は `FAMILY_HUB_BACKUP_KEY` を使う。
   - 各塊の AAD に、ファイルの id・塊の番号・最後の塊かどうかを入れる。
   - 目録には、各ファイルの hash、監査の基準点、必要な kid の指紋、HMAC を入れる。
4. 世代は日7・週4・月6。参照されない塊は消す。
5. CLI: `backup now|list|verify <id>|restore <id> --to <dir>`。
   - 復元は動いているファイルを上書きしない。ロックを持つサーバーが動いていれば拒否する。
   - 鍵束に足りない kid があれば、理由を示して止める。
6. 毎日、新しい世代を検証する。毎週の自動復元は行わず、CLI での復元を試験で確かめる。
7. 試験:
   - 途中で止めても、半端な世代が見えない。
   - 1バイトの改ざん、塊の入れ替え・並べ替え・切り捨てのどれでも verify が失敗する。
   - 復元したデータでサーバーが起動し、読み取りの同等性の試験が通る。
   - 世代の数が正確。
   - 暗号文に `SQLite format 3` や JPEG の先頭のバイトが出ない。
8. 置き場所は systemd の `ReadWritePaths` に足し、deploy の文書を更新する。
9. 文書と規約に書くこと: 鍵は別の場所に保管する。削除したアカウントのデータも、最長6か月はバックアップに残る。

### A9. パスワードの禁止リスト
1. 公開されている頻出パスワードの一覧を、NFKC と小文字にそろえ、15文字以上の項目に絞って同梱する。NIST 800-63B-4 は、最小の長さに満たない項目は不要としている。出典・ライセンス・sha256 を記録する。
2. 文脈に関わる語を拒否する: サービス名、メールの @ より前、表示名、家族の名前。そのままの一致に加え、数字と記号を除いた一致も拒否する。
3. 同じ文字の繰り返し、昇順・降順の並び、キーボードの並びを拒否する。
4. 判定は `src/domain` に置き、クライアント・モック・サーバーで共有する。クライアントでは一覧を遅れて読み込む。
5. 試験: 一覧の全件と文脈の語がモックとサーバーで拒否され、普通の長い文は通る。`autocomplete` を指定し、貼り付けを妨げない。
6. 漏えいしたパスワードの照会（HIBP）は、外部への送信になるので入れない。理由を文書に書く。

### A10. `crypto.argon2` を使わない
1. `@node-rs/argon2` の `hashRaw` を、明示した salt・m=46080・t=2・p=1（OWASP の最低値以上）で呼び、`timingSafeEqual` で比べる。保存の形式は PHC 標準の `$argon2id$v=19$…`（標準の base64、詰め物なし）。
2. 古い形式（base64url）を変換して検証し、成功したら新しい形式で保存し直す。パラメータが変わったときも、次のサインインで保存し直す。
3. 古い形式の試験の値は、固定の文字列として保存する。`crypto.argon2` で作らない。
4. `security-check` で `crypto.argon2` と `argon2Sync` を禁止する。存在しない利用者でも時間をそろえる処理を保つ。

### A11. `--ink-faint` を 4.5:1 以上にする
1. 色は hex で持ち、試験もそのまま残す。OKLCH は、色を導いた過程の記録にとどめる。
2. 全10テーマで、宣言した文字色と背景の組の表が 4.5:1 以上であること。丸めない。例外は削除する。
3. Playwright で、10テーマ × 撮影一覧のすべての状態を開く。見えている文字ごとに、祖先の背景を透明度ごと合成した実際の背景と比べ、4.5:1（大きな文字は 3:1）以上であること。
   - 画像とグラデーションの背景は、名前を付けた例外にする。
   - axe の `incomplete` は失敗として扱う。
   - `::placeholder` は別に測る。
4. 1.4.11（3:1）は、部品を見分けるのに必要な境界とアイコンに当てる。

### A12. 管理者が複数いるときの退出
1. 画面: 有効な管理者が2人以上いれば、退出の操作を出す。自分1人だけなら、理由と「管理者を引き継ぐ」への道を出す。
2. 成人の申告の確認を、共有の規則（`CommandEnv.isAdultDeclared`）に移す。移譲と、役割を管理者に変える操作の両方で確かめる。
3. モックに利用者ごとの申告を持たせる。同等性の試験で次の2つを確かめる。
   - 申告のない大人を管理者にできない。
   - 管理者が2人いるとき、片方が退出できる。

### A13. 繰り返しの「すべて」編集で日付も変える
1. 共有の関数 `shiftSeries(event, deltaDays)` を作る。delta は、下書きの日付と開いた回の日付の差。
2. ずらせる規則:
   - DAILY。
   - WEEKLY のうち、INTERVAL=1 のもの、または回した後の BYDAY が週の境を越えないもの。
   - MONTHLY のうち、ずらした後の日がすべて1〜28日に収まるもの。
3. 上に当てはまらない規則は、理由を示して拒否し、「これ以降の予定」を案内する。月末・BYSETPOS・週の境を越えるものがこれに当たる。
4. 開始・終了・例外日・UNTIL・`occurrenceDeletions` を同じだけずらす。分けた後のシリーズは別の予定として扱い、ずらさない。
5. 性質の試験: 対応するすべての規則で、ずらした後の回の集合が、元の集合を delta だけずらしたものと、2年以上の範囲で一致する。
6. 画面: 保存の前に「すべての予定を1日後へ移します（毎週木曜）」のように示す。
7. 送るときは `expectedVersion` を付ける（オフラインの待ち行列にも入る）。

### A14. 添付の「開く」で画面に表示する
1. 画像と mp4 は、アプリの中の表示画面（アルバムと共通の部品）で表示する。
   - inline で配信するのは、許可した種類（画像・mp4・PDF）だけにする。
   - 再生できない形式（QuickTime など）には「保存して開く」を出す。
2. PDF は、アプリの中で pdf.js を使って描く。
   - pdf.js は後から読み込み、`isEvalSupported:false` にし、スクリプトを使わず、worker は同じオリジンから読む。
   - CMap と標準の書体は同じオリジンから配信し、CID の書体を使う日本語の PDF が描けることを確かめる。
   - CSP を変えずに、WebAssembly が使えないときの代わりの道で描けることを E2E で確かめる。
   - 注釈のリンクは `rel=noopener noreferrer` で開く。
3. 保存は別のボタンにし、`?download=1` のときだけ `attachment` にする。`window.open` は使わない。
4. モックも見本の画像と PDF を返す。
5. E2E: 3つの種類が表示されること、閉じたら焦点が戻ること、保存でファイルが落ちること、署名を改ざんしたら 404 になること。

### A15. 動画と写真の撮影日時
1. 動画: `com.apple.quicktime.creationdate`（時差つき）を優先し、なければ `mvhd` の作成日時（1904年起点、UTC とみなす）を使う。0、1990年より前、1日より先の未来は捨てる。
2. 写真: `DateTimeOriginal` と `OffsetTimeOriginal` を使う。時差がなければ家族の時間帯とみなし、`takenAtSource` に記録する。
3. 日時は、メタデータを消す処理の前に読む。
4. OpenAPI の `AlbumItem` に `takenAt` と `takenAtSource` を足す。
5. 画面: 表示画面に撮影日時を出す。アルバムに「撮影日順」の並べ替えを足す。
6. 試験: 合成した MP4（mvhd の v0 と v1、Apple のキー）と JPEG の固定値で、期待どおりの日時になること。壊れた値は採らないこと。

### A16. 「位置情報を残す」でも元ファイルをそのまま保存しない
1. 写真は、常に回転を当てて再エンコードする。
   - 残すのは GPS（緯度・経度・高度）・撮影日時・時差を書いた最小の EXIF だけ。
   - 別の読み取り器（`exifr` など）で GPS を読めることを試験で確かめる。`withExif` で書けなければ、自前で作った最小の APP1 を差し込む代わりの道を使う。
2. 動画は、許可した項目（位置と作成日時）以外のメタデータを、長さを変えずに空にする。
   - XMP の `uuid`、トラックごとの `udta` と `meta`、時刻つきメタデータのトラック（`gpmd`・`camm`）も対象にする。
   - 位置を消すときにこれらを処理できなければ、拒否する。
3. 試験: 機種・シリアルを含む合成のファイルで、残すときも消すときも、許可した項目以外が残らないこと。

### A17. アルバムを全体の検索に出す
1. 検索の対象は、アルバム（題名・説明・場所）と写真・動画（ファイル名・撮影日）。
2. 照合の前に `redactPlace` と `seen()` を当てる。準備中・拒否・ごみ箱の項目は出さない。
3. 試験で、`place.read` のない人が場所の名前でアルバムを見つけられないことを確かめる。
4. OpenAPI の `kind` に `album` と `albumItem` を足す。種類ごとの上限を契約に書く。行き先は `/albums/:id`。写真のときは表示画面を開く。
5. 画面: 結果を種類ごとにまとめる。
6. 性能: 1万件の家族で、決まった環境での中央値が 200ms 以内。CI では 3倍を上限にする。

## B. 根拠に基づく画面の合格基準

| 領域 | 合格基準 | 根拠（強さ） |
|---|---|---|
| コントラスト | A11 の 2〜4 を全画面に当てる | WCAG 2.2 1.4.3 と 1.4.11（N）。APCA は WCAG 3 でまだ決まっていないので参考だけ |
| 操作の大きさ | タッチの配置（1100px 以下）では、操作できる要素がすべて 44×44 以上で、主な操作は 48 以上。机の配置でも 24 以上。文の中のリンクは除く | WCAG 2.5.5 と 2.5.8（N）、Apple・Material（O）、Parhi 2006（R） |
| フォーカス | 2px 以上で 3:1 以上の輪郭を出す。全画面で Tab を送り、要素の中心が上や下の固定部分に覆われていないこと | WCAG 2.4.7・2.4.11・2.4.13（N） |
| 認証 | 貼り付けを妨げない。`autocomplete` を正しく付ける。TOTP は1つの欄で `one-time-code`。パスキーでもサインインできる | WCAG 3.3.8（N）、ASVS 6.2.7（N） |
| 文字の間隔 | WCAG 1.4.12 の上書き（行間 1.5、字間 0.12em、語間 0.16em、段落 2em）で、切れや重なりが出ないこと（全画面で試験する） | WCAG 1.4.12（N） |
| 文字組み（方針） | 本文 16px、行間 1.7〜1.8、説明文の幅 40em 以下、UI の文字は 12px 以上。文字の大きさは尺度のトークンだけを使い、ゲートで確かめる。月の表の祝日名は、320px で省略記号にする | JLREQ は印刷向けの Note（方針） |
| 動き | 時間のトークンは 100〜300ms。スライドショーのほかは 500ms を超えない。動きを減らす設定では、必要でない動きを止める | WCAG 2.3.3（N）。NN/g は方針 |
| 応答 | 押したら次のフレームで見た目が変わる。1秒を超える読み込みには骨組みを出し、10秒を超えるものには進み具合を出す | Card ほか 1991（R。丸めた目安であることを記す） |
| 取り消しと確認 | 元に戻せる削除は、確認を出さずに「元に戻す」を出す。戻せない操作だけ確認を出し、対象と結果を具体的に書く。家族の削除は名前の入力で確かめる | Vance ほか 2018（R、警告に慣れてしまうこと） |
| 段階的に見せる（方針） | 必須の項目を先に出し、任意の項目は「詳細」にまとめる | NN/g（B）、Cowan 2001（R。項目数の規則には使わない） |
| 図表 | 位置か長さで表す。円グラフは使わない。直接ラベルを付ける。同じ内容の表を必ず添える | Cleveland と McGill 1984（R）、Heer と Bostock 2010（R） |
| 性能 | `dist-http` にサインインした状態で、主要5画面（今日・予定・家計・アルバム・メモ）を測る。LCP より前に読む JS の合計が gzip -6 で 150KB 以下。読む woff2 の合計が 400KB 以下。Lighthouse はモバイルと机の両方で、Performance 90 以上・Accessibility 100・Best Practices 100、LCP 2.5秒未満、CLS 0.1未満。nginx は `gzip_static on` にし、前もって圧縮したファイルを用意する | Lighthouse（O） |
