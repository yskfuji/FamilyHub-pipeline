# 開発環境を外付けのディスク（SSD）へ移す

このリポジトリで開発する場所を、Mac の内蔵のディスクから外付けの SSD へ移すときの手順です。実の道（ユーザー名やディスクの名前）は書かず、`<SSD>` のように書きます。

## SSD の条件

- **形式:** APFS（暗号化）。大文字と小文字を区別しない既定の形にする。区別する形にすると、Xcode や npm の一部の道具が動かないことがある。
- **所有権:** Finder の「情報を見る」で「このボリューム上の所有権を無視」をオフにする。オンだと、`.certs/` や `ios/Config/Local.xcconfig` の権限が保てない。
- **速さ:** USB 3.2 Gen 2（10Gbps）以上か Thunderbolt。`node_modules` と Xcode のビルドは小さなファイルを多く読み書きするので、遅いディスクではビルドと試験が大きく遅れる。
- **バックアップ:** Time Machine の対象に入れるかを決める。`node_modules`・`ios/build`・`dist*` は作り直せるので、除いてよい。

## 移すもの・移さないもの

| もの | 移すか | 理由 |
|---|---|---|
| リポジトリ（`git clone` し直す） | 移す | 追跡しているものは GitHub から取り直せる |
| `ios/Config/Local.xcconfig` | 写す | チーム ID・バンドルの接頭辞・端末の ID・開発サーバーの URL。リポジトリに入れていない |
| `.certs/`（LAN の https の証明書） | 作り直す | `npm run dev:lan` が mkcert で作る。iPhone に入れたルート証明書はそのまま使える |
| `data/`（手元の開発用のデータベースなど） | 本人が決める | 中身を開かずに、要るならそのまま写す。見本の家族だけなら、開発用のサーバーを起動すると作り直す |
| `node_modules` | 移さない | `npm ci` で作り直す |
| `ios/build`、`dist*`、`release/` の生成物 | 移さない | ビルドで作り直す。`ios/build` はリポジトリの中なので、作り直すと SSD に置かれる |
| Xcode の DerivedData、シミュレーター、端末のサポートのファイル、`~/.npm` | 移さない | 内蔵のディスクに残す。Xcode がまとめて持つもので、このリポジトリのビルドは `ios/build` を使う |

## 手順

1. 内蔵のディスクで、作業中の変更をすべてコミットして push する（`git status` が空、`git log origin/<ブランチ>..` が空）。
2. SSD に clone する。

   ```sh
   cd <SSD>/<置き場所>
   git clone https://github.com/<アカウント>/<リポジトリ>.git
   cd <リポジトリ>
   ```

3. 追跡していない設定を写す。

   ```sh
   cp <内蔵の古い場所>/ios/Config/Local.xcconfig ios/Config/
   ```

4. 依存を入れて、生成物とビルドを確かめる。

   ```sh
   npm ci
   npm run ios:export -- --check     # 生成物が最新か
   xcodegen generate --spec ios/project.yml
   swift test --package-path ios/Packages/FamilyHubKit
   npm run verify:ios                # シミュレーターで UI の試験まで
   npm run ios:device                # 実機に入れる
   ```

5. Web の側も確かめる（`npm run lint`・`typecheck`・`test:unit`・`build`）。
6. 古い場所は、新しい場所で全部が動くことを確かめてから消す。

## 移したあとに直すもの

- **エディターの作業場所:** VS Code の `.code-workspace` などに書いた道を、新しい場所に直す。
- **Claude Code の記録:** 作業の記録とメモは、リポジトリの道ごとに分かれて保存される。新しい場所で開くと、前の記録は引き継がれない（必要なら前の場所のメモを見て、新しい場所で書き直す）。
- **開発用のサーバー:** `npm run dev:server` は、`data/` がなければ見本の家族を作り直す。
- **実機:** `Local.xcconfig` をそのまま写せば、署名と端末の ID は変わらない。
