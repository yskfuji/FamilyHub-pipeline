# 主な17の使い方の手数

画面を作り直す前（3698822）と今（HEAD）で、主な17の使い方の最短の手数を数えた。計画の「確かめ方」の「認知」の項目に当たる。結論: 増えた使い方はない。2つは減った（記録の種類を変える、残りをまとめて精算する）。

## 数え方

- 手数は、画面を押す回数と、入力する欄の数と、送る操作の和。
  - ボタン・リンク・ラジオ・チェックを押すと1手。選択の欄は、開いて選ぶまでで1手。
  - 欄に入力すると、長さによらず1手。
  - 入れなければ送れない欄だけを数える。初めから値が入っていて、そのままで送れる欄は数えない。
  - 送る操作（「追加する」「変更を保存」など）は1手。
- 数えないもの: スクロール、読むこと、待つこと、OS の画面（パスキー、ファイルの選択）。
- 本人の再確認（パスワードを尋ねる画面）は、条件によって出る。どちらの版でも数えない。
- 「入力中の内容を破棄しますか」は、入力をやめるときだけ出る。最後まで進める道には出ないので数えない。
- 画面の幅は 390px（下のナビがある幅）。机の幅（1440px）の違いは下の注に書く。
- 始める画面は、サインインしたあとに開く `/today`。サインインだけは `/auth` から。
- 見本の家族の碧さん（管理者）で数える。まとめて精算だけは蓮さん（`?actor=member-ren`）で数える。碧さんには、見えない蓮さんの支出に残りがあるので、まとめては記録できないため（S9-SETTLE-3）。
- 同じ結果になる道が複数あるときは、いちばん短い道を数える（すぐに追加、検索の画面のコマンド、ナビ）。
- 数はコードの道筋（`src/app/App.tsx`・`Shell.tsx`・`QuickCreate*.tsx`・`src/features/**`・`src/domain/schemas.ts` と各フォームの確かめ）から数え、e2e の試験の操作と照らした。前の版は `git show 3698822:<path>` で読んだ。時間を測った実行ではない。この作業では試験を流していない。

## 選んだ17の使い方

`docs/verification/use-cases.json` と `docs/audits/cognitive-walkthrough.md` から、毎日の家事で使い、両方の版にあるものを選んだ。新しい流れ（記録の種類を変える、まとめて精算、添付を開く）は、前の版にも同じ結果に届く道があるので入れた。通知の延期（ベル → 「30分後に通知」、どちらも2手）は、通知の部分が変わっていないので外した。

| # | 使い方 | 始める画面 | 前（3698822） | 後（HEAD） | 差 | 手順（後） | 根拠の試験 |
|---|---|---|---|---|---|---|---|
| 1 | 今日の次の予定を開く（UC-D01） | /today | 1 | 1 | 0 | 「次にすること」の「開く」。前は「時刻順に確認」の行の「開く」 | 後: `e2e/illustrations.spec.ts` の「ILLUS-4 … narrow: one column, the next action first and above the fold…」と「every earlier control is still there…」。前: 押す試験はない（コードの `today.event.open` から数えた） |
| 2 | 予定を追加する（UC-D02、UC-C02） | /today | 4 | 4 | 0 | すぐに追加 → 予定 → 予定名 → 追加する | `e2e/authorization.spec.ts` の「offline collaborative creation is queued, reviewed, and explicitly replayed」（両方の版） |
| 3 | タスクをすぐに追加する（UC-D02） | /today | 3 | 3 | 0 | すぐに追加 → タスク名 → 追加する（初めはタスクが選ばれている） | `e2e/shell.spec.ts` の「unsaved changes › a saved form leaves no warning behind」（両方の版） |
| 4 | タスクを完了にする（UC-T03、UC-T05） | /today | 2 | 2 | 0 | タスク → 「…を完了にする」 | `e2e/tasks-notes.spec.ts` の「the list completes a task in place and keeps to the same flow」（両方の版） |
| 5 | メモを書く（UC-M01） | /today | 5 | 5 | 0 | すぐに追加 → メモ → タイトル → 本文 → 追加する。メモ → メモを追加 → タイトル → 本文 → 作成する も5 | `e2e/interactions.spec.ts` の「task edit and memo creation update state and URLs」（両方の版） |
| 6 | 支出を記録する（UC-B02） | /today | 5 | 5 | 0 | すぐに追加 → 家計 → 支出名 → 金額 → 追加する（負担は等分が初めから選ばれている） | `e2e/budget.spec.ts` の「a custom split must add up to the amount and is saved exactly」と「payer only leaves nothing to settle…」（両方の版。`/budget` の「支出を追加」から同じフォームを開く） |
| 7 | 1件の精算を記録する（UC-B03） | /today | 3 | 3 | 0 | 内訳と精算を確認 → 学校教材 → 「蓮さんの残り¥1,430を精算」 | `e2e/core.spec.ts` の「expense settlement changes the row and the undo stays visible after refresh」、`e2e/budget.spec.ts` の「expense detail shows place, shares and history…」（両方の版） |
| 8 | アルバムの写真を開く（UC-G04） | /today | 4 | 4 | 0 | その他 → アルバム → 運動会 → 写真 | `e2e/albums.spec.ts` の「the navigation lists albums, and on a phone it sits under その他…」「shows albums with cover, title and count…」「viewer › arrows move, Escape closes…」（両方の版） |
| 9 | 検索して記録を開く（UC-S01） | /today | 3 | 3 | 0 | 検索 → 語を入力 → 結果 | `e2e/navigation.spec.ts` の「search finds expenses, places and memo text, and opens the detail」（両方の版）、後は S9-SEARCH-1 も |
| 10 | 繰り返しの予定の1回だけを変える（UC-C03、UC-C06） | /today | 6 | 6 | 0 | 予定 → 日 → 「…を開く」 → 編集する → 1つの欄 → 変更を保存。対象は初めから「この予定だけ」 | `e2e/calendar.spec.ts` の「narrow width › months continue down the page with a sticky header and a day sheet」と「every N days checks its range…」（初めの対象で編集を開く）、`e2e/recurrence.spec.ts` の「"this and following" edits split the series…」（両方の版） |
| 11 | 招待コードを作る（UC-H02） | /today | 3 | 3 | 0 | その他 → 設定 → 招待コードを作成。役割を変えるなら +1（両方の版） | `e2e/interactions.spec.ts` の「all household permission controls, sole-owner guard, and invite creation work」（両方の版） |
| 12 | メンバーの役割を変える（UC-H05） | /today | 5 | 5 | 0 | その他 → 設定 → 権限 → メンバーの役割 → 役割を保存 | 同じ試験（両方の版） |
| 13 | テーマを変える（UC-P01、UC-Y02） | /today | 2 | 2 | 0 | 検索 → 「テーマ：抹茶」。設定の「表示・操作」からなら、その他 → 設定 → 表示・操作 → テーマ で4 | `e2e/shell.spec.ts` の「command palette › keeps search, and finds commands by name」と「theme and density › persists across reloads…」（両方の版） |
| 14 | サインインする（UC-A02） | /auth | 4 | 4 | 0 | パスワードでサインイン → メールアドレス → パスワード → サインイン。パスキーなら1 | `e2e/real/support.ts` の `signIn`（`e2e/real/session.spec.ts` などが使う）、パスキーは `e2e/core.spec.ts` の「registration and onboarding reach the Today page」（両方の版） |
| 15 | 記録した支出を収入に変える（UC-B10） | /today | 8 | 5 | −3 | 内訳と精算を確認 → 学校教材 → 内容を編集 → 収入 → 変更を保存 | 後: `e2e/features.spec.ts` の S9-KIND-1。前（消して作り直す）: `e2e/budget.spec.ts` の「an expense without settlements can be deleted and restored」と「income is recorded with its own categories and no split」 |
| 16 | 残りをまとめて精算する（UC-B11） | /today（蓮さん） | 9 | 4 | −5 | 内訳と精算を確認 → 精算 → まとめて精算する → 精算を記録する | 後: `e2e/features.spec.ts` の S9-SETTLE-1。前（1件ずつ）: 7 と同じ試験 |
| 17 | メモの添付を開く（UC-M06） | /today | 3 | 3 | 0 | メモ → 教材費レシート → 「教材の写真.jpgを開く」。後はアプリの中の表示、前は新しいタブ | 後: `e2e/features.spec.ts` の S9-VIEW-1。前: `e2e/tasks-notes.spec.ts` の「uploading shows limits, moves through checking, and the demo opens a sample file of the same type」 |

合計は、前が70手、後が62手。

## 差の注

- 15（−3）: 前は、記録したあとに種類を変えられなかった（「記録したあとは変えられません」）。同じ結果にするには、消して作り直す。内訳と精算を確認 → 学校教材 → 支出を削除 → 削除する → 収入を追加 → 収入名 → 金額 → 追加する で8手。元の日付（9月29日）に合わせるなら、さらに +1。後は編集の画面の種類のラジオで変えられる（A3-5）。
- 16（−5）: 前は「まとめて精算」の欄に受け渡しの額を出すだけで、記録は1件ずつだった。蓮さんの残りは3件（学校教材・家族のおでかけ交通費・贈り物の下見）。内訳と精算を確認のあと、「最近の記録」から 記録を開く → 精算 → 閉じる を3回（最後の閉じるは不要）で9手。後は確かめのダイアログで一度に記録する（A4-3）。確かめの1手は、まとめて記録する内容を示すためのもので、前の道より短い。

## 増えた使い方

ない。

前より手数が増える変更は、どれも入力をやめる道か、断られる道にだけある。最短の道には出ない。

- 権限の画面で役割を変えたまま「キャンセル」すると、「入力中の内容を破棄しますか」が出る（段階12。`e2e/interactions.spec.ts`）。役割を保存する道には出ない。
- 「すべての予定」で日付を動かせない規則のときは、保存を止めて「これ以降の予定」へ切り替える操作を出す（A13-6、S9-SERIES-2）。前は「変更を保存」を押してから理由を出していた。手数は増えていない。1回だけを変える道（10）には出ない。

## 机の幅（1440px）

- 主な機能が左のレールに並ぶので、アルバム・設定へは「その他」がいらない（8・11・12・13 の設定の道が両方の版で1手ずつ減る）。前と後の差は変わらない。
- すぐに追加は、後では上の帯に置く（下のナビがある幅では右下）。押す回数は同じ。
- 一覧の横に詳細を並べる幅が、本文の 832px 以上から 1100px 以上に変わった。窓が 1024px 前後だと、前は横に並び、後は右から開く。17の使い方はどれも詳細を1つだけ開くので、手数は変わらない。前の版で16を1件ずつ進める道は、横に並ぶ幅なら「閉じる」がいらず7手になる。それでも後の4手より長い。

## 確かめていないこと

- 前の版の今日の画面の「開く」を押す e2e はない。1 の前の数はコードから数えた。
- 16 の前の道を通しで動かす試験はない。1件の精算の試験（7）を3回つないだものとして数えた。
- 本人の再確認とパスキーの OS の画面は数えていない。実際のサーバーでは出ることがある。
- スクロールの量は数えていない。後の今日の画面は「次にすること」を最初の画面に出す（ILLUS-4）ので、目で探す量は減ったと考えるが、測っていない。
- 実際の利用者での試験は evidence-pending のまま残す。
