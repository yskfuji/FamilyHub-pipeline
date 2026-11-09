# iOS アプリ（iPhone と iPad）

iPhone と iPad では、Web アプリの代わりに SwiftUI で作ったアプリを使う。Web アプリは机と Android のために残す。
作り方の段階（S0〜S8）と決めたことは、この文書の終わりの「段階」にまとめる。

## 置き場所

| 場所 | 中身 |
|---|---|
| `ios/project.yml` | xcodegen の定義。`FamilyHub.xcodeproj` はここから作り、リポジトリに入れない |
| `ios/Config/Base.xcconfig` | 全体の設定（iOS 26、Swift 6、iPhone と iPad） |
| `ios/Config/Local.xcconfig` | この Mac だけの設定（チーム ID、バンドルの接頭辞、端末の ID）。リポジトリに入れない。`Local.xcconfig.example` を写して作る |
| `ios/App/` | アプリの入口とアイコン |
| `ios/Packages/FamilyHubKit/` | アプリの中身（Swift Package） |

`FamilyHubKit` の target:

| target | 中身 | 元にした Web のファイル |
|---|---|---|
| `FHModel` | 型（Codable） | `src/domain/types.ts` ほか |
| `FHCopy` | 文言（生成） | `src/content/*.ts` |
| `FHDomain` | 計算（日付・祝日・書式など） | `src/domain/*` |
| `FHGateway` | サーバーと見本の窓口 | `src/data/gateway.ts`、`src/data/mockGateway.ts` |
| `FHDesign` | テーマ・ブランドの印・部品 | `src/design-system/*` |
| `FHFeatures` | 画面 | `src/features/*`、`src/app/*` |

外部の Swift のライブラリは使わない。

## Web と同じであることを保つ仕組み

手で写すと、いつかずれる。そこで Web の側から書き出し、試験で照らす。書き出しは `npm run ios:export`、確かめは `npm run verify:ios` に入っている。

| 書き出し | 何を | どう照らすか |
|---|---|---|
| `scripts/ios/build-sample-engine.mjs` | 見本の家族と規則（`src/native/sampleEngine.ts` が `src/data/mockGateway.ts` を包む）を、JavaScriptCore で動く1つのファイルにする | 見本のモードは、サーバーと同じ規則（`src/domain/commands`）で動く。`SampleGatewayTests` |
| `scripts/ios/export-fixtures.mjs` | 見本の仕組みに人ごとに問い合わせた応答の JSON | Swift の型で読んで書き戻し、同じ JSON になること（欄の落ちを見つける）。`FixtureRoundTripTests` |
| `scripts/ios/export-vectors.ts` | 本物の TS の関数の入力と答え（祝日、月の表、日付の鍵、金額と日付の書式、パスワードの規則、登録の入力、年齢、繰り返し、季節、時刻の帯、表示する人、今日の画面の中身）。パスワードの頻出の一覧もアプリに入れる | Swift の移植が同じ答えを出すこと。`VectorTests`・`S1VectorTests` |
| `scripts/ios/export-copy.ts` | 文言（`Copy.swift` と、ヘルプ・規約の JSON） | 文言を組み立てる関数は書き出せないので、`Copy.swift` の先頭に一覧を残し、Swift で同じ規則を書く |
| `scripts/ios/export-tokens.mjs` | 10のテーマの色と、大きさ・余白・角の丸み | `ThemeTests` で、主な文字と面の組が 4.5:1 以上 |
| `scripts/ios/export-brand.mjs`、`export-icon.mjs` | 柿の印と「よりどころ」の字形、アイコン | 形は SVG の path をそのまま変換する |
| `scripts/ios/export-illustrations.ts` | 挿絵（空の状態・季節・はじめに）。React で SVG にして、要素ごとの path と色の役割にする（`scripts/ios/svg.mjs`） | 色はテーマの変数の名前のまま。夜のテーマでも変わる |

生成物はリポジトリに入れる。`--check` は作り直して差分が出たら止める。

### 円の記号
Apple の ICU（JavaScriptCore と Foundation）は円の記号を半角の `¥` で書く。サーバー（node）と Web（Chrome）は全角の `￥` で書く。アプリでは全角にそろえる。

- Swift の `Format.yen` は自分で組み立てる。
- 見本の仕組みは `src/native/nativePolyfills.ts` で置き換える。

## 見本のモード

アプリには見本の家族（森さんち、碧さん＝管理者）が入っていて、サーバーなしで全部の画面を動かせる。

- 変更は記憶の中だけに残る。アプリを閉じると元に戻る。
- 見本の時計は Web と同じく、2026年9月30日 7:45 から始まる。

## サーバーにつなぐ

サーバーは cookie で認証する（`__Host-fh_session`）。通信は `FHGateway` の `APIClient` と `HTTPGateway`（Web の `src/data/httpGateway.ts` の写し）。

- cookie は URLSession の入れ物に任せる。Bearer のトークンはない。
- 変更の要求には、CSRF の token（`GET /v1/auth/csrf`）・`Idempotency-Key`・分かっていれば `If-Permission-Revision` を付ける。403 CSRF なら token を取り直し、同じ冪等キーで1回だけ送り直す。
- サインインのたびにサーバーは token を結び直すので、アプリも覚えた token を捨てる。
- Origin は付けない。サーバーは Origin がない要求を通す（`server/http/app.ts`）。
- User-Agent は `Yoridokoro/<版> (iPhone; iOS x) FamilyHubApp/<版>`。サーバーは、サインイン中の端末の一覧に「iPhone アプリ」「iPad アプリ」と出す（`server/auth/deviceLabel.ts`）。名前を出すだけで、期限や権限は変えない。
- 平文の http は、同じ Mac（127.0.0.1・localhost）のシミュレーターだけで使う（Debug の `App/Info-Debug.plist` と `APIClient.allows`）。
- パスキーは、登録できるドメインと apple-app-site-association の配信が要るので、本物のドメインができるまで画面に出さない。

### シミュレーターから（127.0.0.1）

```sh
npm run dev:server        # API を 127.0.0.1:8799 で動かす（見本の家族。aoi@example.test）
# アプリを FH_DEV_SERVER_URL=http://127.0.0.1:8799 で作り、サーバーにつなぐ UI の試験を流す
TEST_RUNNER_FH_LIVE=1 xcodebuild -project ios/FamilyHub.xcodeproj -scheme FamilyHub \
  -destination 'platform=iOS Simulator,name=iPhone 17' FH_DEV_SERVER_URL=http://127.0.0.1:8799 \
  test -only-testing:FamilyHubUITests/FamilyHubUITests/testLiveServerSignInAndOut
```

### 実機から（同じ Wi-Fi、https）

1. mkcert を入れる（一度だけ）: `brew install mkcert`、`mkcert -install`（Mac にルート証明書を入れる）。
2. `open "$(mkcert -CAROOT)"` で `rootCA.pem` を iPhone に送り、「設定」→「一般」→「VPNとデバイス管理」で入れ、「一般」→「情報」→「証明書信頼設定」で信頼する（一度だけ）。
3. `npm run dev:lan` を流す。API は 127.0.0.1 のまま、Vite だけが https で LAN に出て `/v1` を中継する。証明書は `.certs/` に作る（リポジトリに入れない）。8787・8000・4310 は使わない。
4. 表示された URL を `ios/Config/Local.xcconfig` の `FH_DEV_SERVER_URL` に書く。xcconfig では `//` が注釈になるので、`https:/$()/<Mac の名前>.local:4330` のように書く（表示のとおりに写せばよい）。
5. `npm run ios:device` で入れ、はじめの画面で「サーバーにつなぐ」を選ぶ。初回は「ローカルネットワーク」の許可を聞かれる。

## 確かめ方

```sh
npm run ios:export     # 生成物を作り直す（Web の側を変えたとき）
npm run verify:ios     # 生成物が最新か → xcodegen → swift test → シミュレーター向けのビルド
```

- `swift test --package-path ios/Packages/FamilyHubKit` だけなら数秒で終わる（macOS で動く）。
- `verify:ios` は、iPhone 17 と iPad Pro 11-inch のシミュレーターで UI の試験（`ios/UITests`）を流す。見本のモード（`-FHSampleMode`）で、はじめの画面・今日の画面・タブを動かし、今日の画面を昼と夜で `performAccessibilityAudit()` にかける。
  - 監査で除くのは2つだけ: ガラスのタブの帯と上部に重なった要素の濃さ（下を通る本文を正しく測れない）と、要素を特定できない文字の大きさの指摘（iPad の上のタブの帯、システムの部品）。
- `verify:ios` は `npm run verify` の最後に入っている。macOS と Xcode がない所では飛ばす（`FAMILY_HUB_SKIP_IOS=1` でも飛ばせる）。

## 実機に入れる

1. Xcode の Settings → Apple Accounts に、開発者のチームの Apple ID を足す（一度だけ）。
2. iPhone で「設定」→「プライバシーとセキュリティ」→「デベロッパモード」を入れ、Mac を信頼する（一度だけ）。
3. `ios/Config/Local.xcconfig.example` を `ios/Config/Local.xcconfig` に写し、次の値を入れる。
   - `FH_TEAM_ID`（チームの ID。証明書の名前の括弧の中の ID ではない。`Local.xcconfig.example` に調べ方がある）
   - `FH_BUNDLE_PREFIX`（世界で1つの名前）
   - `FH_DEVICE_ID`（`xcrun devicectl list devices` で分かる）
4. `npm run ios:device` で、作って入れて開く。

## 段階

| 段階 | 中身 | 状態 |
|---|---|---|
| S0 土台 | 型、文言、テーマ、ブランド、見本の仕組み（JavaScriptCore）、日付・祝日・書式の移植、確かめの仕組み、仮の今日の画面 | 済み |
| S1 認証・枠・今日 | サーバーの窓口、サインイン・登録・再設定・はじめに、タブと上部、無操作の期限、本人確認、今日の画面 | 済み |
| S2 予定 | 月・週・日・一覧、編集、繰り返し、シフト表、チラシの読み取り | これから |
| S3 タスク・メモ | 状態と詳細、添付（画像・動画・PDF）、OCR の直し | これから |
| S4 家計 | 4つの表示、精算、図表と表 | これから |
| S5 アルバム | 送信（HEIC から JPEG、動画）、表示、スライドショーと BGM | これから |
| S6 場所・ヒント・検索・通知 | 端末の通知（ローカル） | これから |
| S7 設定 | 12のタブ | これから |
| S8 仕上げ | 送れなかった変更、VoiceOver と文字の大きさ、iPad の3列、文書 | これから |

### S0 で決めたこと
- **型は手で書く。** OpenAPI の契約は型がゆるいので、コードを生成しない。
  - 文字列の値（役割・状態など）は、知らない値も壊さずに読む形（`OpenValue`）にした。
  - Web で `| null` の欄は null のまま書き戻す（`@Nullable`）。
- **見本のモードは、TS の規則をそのまま JavaScriptCore で動かす。** 規則を Swift に移すと、量が多く、ずれ続けるため。
- **絵（挿絵）の書き出しは S1 に回した。** 今日の画面と空の状態で初めて使うため。

### S1 で決めたこと
- **今日の画面の計算は Web の側で関数に分けた。** `src/domain/todayDigest.ts`（と `timeStrip.ts` の `stripLayout`）。Web の画面もそれを使い、Swift の `TodayDigest` は同じ答えになるかを、人・時刻・表示する人を変えた81の組で確かめる。
- **長さの数え方が2つある。** zod の検査（登録の名前・メールアドレス・パスワードの長さ）は Unicode のコードポイントで数え、パスワードの規則（`passwordProblem`）は UTF-16 で数える。Swift もそれぞれに合わせた（絵文字8つのパスワードは、zod では短すぎ、規則では長さが足りる）。
- **パスキーは画面に出さない。** 登録できるドメインができるまで、パスワードと確認コード（TOTP）でサインインする。パスワードの自動入力に対応した。
- **無操作の期限はアプリの側で案内する。** Web の IdleGuard と同じく、触れたら記録し、1分に1回だけサーバーに知らせ、60秒前に予告し、期限を過ぎたらサインアウトする。裏に回っている間は数えず、前に戻ったときに確かめる。サーバーの期限は変えない。
- **本人確認は `AppModel.run`。** REAUTH_REQUIRED と SESSION_EXPIRED を受けたら、入力中の画面の上でパスワードを聞き、同じ操作をやり直す（Web の `withReauthentication`）。
- **iPhone は下のタブ、iPad は横の一覧。** iPhone は今日・予定・タスク・メモと「その他」（Web の mobilePrimary と同じ選び方）。iPad はすべての機能を並べる。
- **日付と天気は画面の副題。** 上部のボタンの中に置くと、文字を大きくしたときに大きくならない（監査で分かった）。iPad では上のタブの帯があるので副題は出ず、今日の画面の見出しが日付を示す。
- **まだ作っていない画面**（予定・タスク・メモ・家計・アルバム・場所・ヒント・設定）は、作る段階を示す空の状態にした。設定は仮の画面（表示・接続先・サインアウト）。
- **サーバーの小さな変更:** 端末の名前（`server/auth/deviceLabel.ts`）、契約の cookie の名前を `__Host-fh_session` に直し、`audit-contract.mjs` が実装と照らす。`npm run dev:lan` を足した。

