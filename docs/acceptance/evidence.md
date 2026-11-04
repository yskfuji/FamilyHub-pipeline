# 根拠の台帳

合格基準（[criteria.md](criteria.md)）の数値と方針がどこから来たかを記録する。2026-11-03 に一次資料を確かめた。

## 根拠の強さ

| 記号 | 意味 | 基準での使い方 |
|---|---|---|
| N | 規格・勧告（W3C Recommendation、NIST、IETF RFC、OWASP ASVS） | 数値の基準に使う |
| R | 査読された論文 | 数値の基準に使う |
| O | 公式文書（ベンダー、政府、OWASP Cheat Sheet） | 数値の基準に使う |
| B | ブログ、二次資料、印刷向けの W3C Note | 方針にとどめ、数値の基準にしない |
| U | 今回は原文を確かめていない | 参照先だけを示す。基準の根拠にしない |

引用のうち、Node.js の文書、NIST 800-63B-4 の禁止リストの文、JLREQ、SQLite の変更履歴、llama.cpp の README、Apple の QuickTime と HIG、sharp の文書は原文から直接取った。それ以外は要約を介して確かめたので、文言の細部は原文で確かめること。

## 1. コントラスト

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| 通常の文字 4.5:1、大きな文字 3:1 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)（Recommendation、2024-12-12） | 大きな文字は 18pt 以上、または 14pt 以上の太字 | N | |
| 比は丸めない | [Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 「4.499:1 は 4.5:1 を満たさない」 | N（参考） | |
| プレースホルダーも対象 | 同上 | プレースホルダーの文字も含む | N（参考） | |
| 使えない状態の部品は対象外 | 1.4.3 本文 | 無効な部品にはコントラストの要件がない | N | 弱視の利用者には問題が残る |
| 文字以外 3:1 | WCAG 2.2 1.4.11 | 部品・状態・図の、隣り合う色との比 | N | |
| WCAG 3 はコントラストの計算式を決めていない | [WCAG 3](https://www.w3.org/TR/WCAG3/)（Working Draft、2026-09-10） | 「計算式は未定」 | N（草案） | APCA の支持者は、WCAG 2 の式が暗い色で知覚と合わないと主張している（B） |

## 2. 操作の大きさ

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| 最小 24×24 CSS px（AA） | WCAG 2.2 2.5.8、[Understanding](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 間隔・同等・文中・ブラウザの部品・必須の例外がある | N | 妥協の下限で、最適値ではない |
| 44×44 CSS px（AAA） | WCAG 2.2 2.5.5 | | N | |
| iOS 44×44pt、macOS 28×28pt | [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | 最小の部品の大きさの表 | O | |
| Android 48×48dp、間隔 8dp | [Android のアクセシビリティ](https://support.google.com/accessibility/android/answer/7101858) | 約 9mm | O | |
| 親指の操作では 9.2〜9.6mm で誤りが頭打ちになる | Parhi, Karlson & Bederson, MobileHCI 2006, doi:10.1145/1152215.1152260 | | R | 標本が小さい。片手の親指だけ。2006年の端末 |

## 3. フォーカスと認証

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| フォーカスが見える | WCAG 2.2 2.4.7 | | N | 大きさとコントラストは定めていない |
| 作者のコンテンツで完全には隠さない | WCAG 2.2 2.4.11（AA） | | N | 一部だけ隠れるのは AA では通る。固定の上部と下部が典型の失敗 |
| 2px の周囲と同じ面積、3:1 | WCAG 2.2 2.4.13（AAA） | | N | AAA |
| 貼り付けとパスワード管理を妨げない。確認コードの手での書き写しを強いない | [Understanding 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | WebAuthn は認知の試験に当たらない | N（参考） | 6つの欄に分けた入力は、貼り付けを壊しやすい |
| 文字の間隔の上書きで内容が失われない | WCAG 2.2 1.4.12 | 行間 1.5、段落 2、字間 0.12、語間 0.16 | N | |

## 4. 認知と応答

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| 作業記憶はおよそ4つのまとまり | Cowan 2001, BBS 24(1):87–114, [PubMed](https://pubmed.ncbi.nlm.nih.gov/11515286/) | Miller の7は大まかな見積もりで修辞 | R | メニューの項目数の規則には使えない |
| 0.1秒・1秒・10秒の目安 | [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)（Miller 1968、Card ほか 1991 を引用） | | B（R に基づく） | 測った閾値ではなく丸めた目安 |
| Doherty の 400ms | Doherty & Thadhani 1982（原文を確かめていない） | | B・弱い | 認知の定数ではないという批判がある。**基準に使わない** |
| 骨組みの表示とスピナー | [NN/g 2023](https://www.nngroup.com/articles/skeleton-screens/) | 1秒未満は不要。全体の読み込みに骨組み、10秒を超えたら進み具合 | B | 逆の結果を示す小さな試験もある。どちらの根拠も弱い |
| 確認のダイアログには慣れてしまう | Vance ほか, MIS Quarterly 42(2) 2018, doi:10.25300/MISQ/2018/14124 | 繰り返しの警告で注意が急に下がる。固定の警告は 55%、変化する警告は 76% が従った | R | |
| 段階的に見せる | [NN/g 2006](https://www.nngroup.com/articles/progressive-disclosure/) | 開閉が2段を超えると使いにくい | B | 方針として使う |
| Hick–Hyman の法則 | Seow 2005, HCI 20(3), doi:10.1207/s15327051hci2003_3 | Fitts の法則ほど HCI で使われていない | R | 等しく起こる選択に当てはまる。探す作業には当てはまらない |
| 動きを止められる | WCAG 2.2 2.3.3（AAA）、技法 C39 | `prefers-reduced-motion` | N | |
| 動きの時間 | [NN/g 2020](https://www.nngroup.com/articles/animation-duration/) | 100〜500ms。重ね表示は 200〜300ms | B | 本文自身が意見だと書いている。方針として使う |

## 5. 図表の読み取り

| 主張 | 出典 | 強さ | 反証・注意 |
|---|---|---|---|
| 共通の尺度上の位置 ＞ 長さ ＞ 角度 ＞ 面積 ＞ 色の濃さ | Cleveland & McGill, JASA 79(387) 1984, doi:10.1080/01621459.1984.10478080 | R | |
| クラウドソーシングで並びがおおむね再現した | Heer & Bostock, CHI 2010, doi:10.1145/1753326.1753357 | R | |
| 円グラフで中心の角度は最も弱い手がかり | Skau & Kosara, CGF 35(3) 2016, doi:10.1111/cgf.12888 | R | 「円は角度で読まれる」という前提を崩す。比較には棒のほうがよい |
| 色覚に配慮した組（Okabe–Ito） | Wong, Nat Methods 8:441 (2011), doi:10.1038/nmeth.1618 | O/B | 黄色は白の上で 3:1 に届かないので、直接ラベルを付ける |

## 6. 日本語の文字組み

| 主張 | 出典 | 強さ | 反証・注意 |
|---|---|---|---|
| 横組の1行は最大40字くらい | [JLREQ](https://www.w3.org/TR/jlreq/)（W3C Group Note、2020-08-11） | B（印刷向けの Note） | 画面での査読された研究は見つからなかった。方針として使う |
| 行間は二分から全角 | 同上 | B | 同上 |
| 本文は9ポイントくらい、最小8ポイント | 同上 | B | 印刷向け。画面の最小値は定めていない |

## 7. パスワード

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| 単要素なら最小15文字、最大は64文字以上を許す。構成の規則を課さない | [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)（Final、2025-07-31） | | N | |
| 禁止リストは全体で比べる。大きすぎても効果は少ない。最小の長さに満たない項目は不要 | 同上 3.1.1.2、付録 A | | N | 15文字以上に絞った同梱の一覧を支持する |
| 頻出の上位3000件を確かめる（L1）、貼り付けを許す（L1）、漏えいの照会（L2） | [ASVS 5.0 V6](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md) | 6.2.4、6.2.7、6.2.12 | N | 漏えいの照会は外部送信になるので入れない（criteria A9） |
| Argon2id m=19MiB t=2 p=1 以上 | [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | 46MiB t=1 などの組もある | O | |
| Argon2 の推奨 | [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)（Informational） | 2GiB または 64MiB | N（参考） | OWASP の最低値よりかなり重い |
| `crypto.argon2` は v24.7.0 で追加 | Node.js の crypto の文書 | 個別の安定度の表示はない | O | 本人の決定で `@node-rs/argon2` に移す |
| 同梱した頻出パスワードの一覧の出典 | [SecLists `Passwords/Common-Credentials/Pwdb_top-1000000.txt`](https://github.com/danielmiessler/SecLists/blob/35d74839e66f44d116e694369d86a5bf07aaed6f/Passwords/Common-Credentials/Pwdb_top-1000000.txt)（commit `35d74839e66f44d116e694369d86a5bf07aaed6f`、2026-11-03 取得、git blob `99665aeb16c221dfb9a258e39dd58fa37116cfdd`） | 100万行。sha256 `e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8`。ライセンスは [MIT License](https://github.com/danielmiessler/SecLists/blob/35d74839e66f44d116e694369d86a5bf07aaed6f/LICENSE)（Copyright (c) 2018 Daniel Miessler。LICENSE の sha256 `3dbdc93d5f8829de0941744841730a09c106d0732e5ae0e98ca1d77be7ded66c`） | O（データ） | 漏えいから集めた一覧で、利用者の母集団（日本の家族）とは違う。日本語の項目はほぼない。中身に不快な語を含む |
| 同梱した形 | `src/domain/commonPasswords.json`（`scripts/build-password-list.mjs` で作る） | NFKC と小文字にそろえ、15〜64文字（UTF-16 の長さ。入力の長さの検査と同じ数え方）の項目を、出現の順のまま重複を除いて残す。メールアドレスの形の項目（12件）は、実在する人の連絡先かもしれないので除いた（自分のメールアドレスの @ より前は、文脈の語として別に拒否する）。**5317件**、sha256 `4816280f240d5d7934ee3bb63eea1be68b46ee6e0634929e7c7c649a1d92783f`、gzip で約44KB | — | 64文字を超える項目は入力できないので除いた。画面では別のファイルとして、新しいパスワードを確かめるときにだけ読む |
| 漏えいしたパスワードの照会（Have I Been Pwned の k-anonymity）は使わない | criteria A9-6 | 入力の SHA-1 の先頭5文字を外部へ送ることになる | — | 家族の情報を外部へ送らない方針を優先した。代わりに同梱の一覧と文脈・並びの規則で確かめる |
| `@node-rs/argon2` 2.2.2 | [npm](https://www.npmjs.com/package/@node-rs/argon2)（MIT） | `hashRaw` に salt・m・t・p・出力の長さ・版（0x13）を渡せる。Node 24.22.1（darwin-arm64）で読み込めることを確かめた | O | ネイティブのモジュール。配備先の OS と CPU に合う部品を `npm ci` で入れる |

## 8. 鍵

| 主張 | 出典 | 内容 | 強さ | 反証・注意 |
|---|---|---|---|---|
| 漏えいの疑い・期間・使用量の上限で鍵を替える。鍵の ID を付ける。入れ替えの手順を前もって用意する | [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) | | O | 鍵の ID を付けるより、全部を暗号化し直すほうを勧めている |
| 暗号化の鍵の使用期間は2年以下 | NIST SP 800-57 Pt1 Rev5 | 表1（二次資料で確かめた） | N（B 経由） | Rev 6 の草案で変わる可能性がある |
| TOTP の秘密は暗号化して保存する | [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.txt) 5.1 | | N | |
| 用途ごとの鍵を1つの秘密から導く | [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html)（HKDF） | salt と info で用途を分ける | N（Informational） | 実装は salt `family-hub`、info に用途（`mac:csrf`・`mac:reset`・`mac:attachment`・`totp-secret`・`key-fingerprint`）。`totp-secret` は以前の形式と同じ導き方なので、`legacy` の暗号文をそのまま読める |
| AES-GCM の IV は鍵ごとに重ねない。96ビットの乱数 IV の上限 | [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) 8.3 | 乱数の IV では、1つの鍵で 2^32 回まで | N | 二段階認証の秘密は人数分しかなく、上限に遠い |

## 9. 監査記録

| 主張 | 出典 | 強さ | 反証・注意 |
|---|---|---|---|
| 書いた後の記録を、気づかれずに読み書きさせない | Schneier & Kelsey, ACM TISSEC 1(3) 1999 | R | 1台の機械では、外に基準点を置かないと末尾を切られても気づけない |
| 改ざんに気づく仕組みを入れる。パスワードやトークンを記録しない | [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | O | |
| trigger の `RAISE(ABORT)` | [SQLite CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html) | O | 書き込める者は trigger を消せる。守りの境界ではない |
| WAL では ATTACH した複数のファイルをまたぐトランザクションは、全体として原子的にならない | [SQLite ATTACH](https://www.sqlite.org/lang_attach.html) | O | outbox を使う理由 |

## 10. バックアップ

| 主張 | 出典 | 強さ |
|---|---|---|
| バックアップ API は一貫した写しを作る | [SQLite Backup API](https://www.sqlite.org/backup.html) | O |
| 動いている途中のファイルの単純な複写は壊れることがある | [How To Corrupt](https://www.sqlite.org/howtocorrupt.html) | O |
| `integrity_check` は外部キーを見ないので `foreign_key_check` も行う | [PRAGMA](https://www.sqlite.org/pragma.html) | O |
| `node:sqlite` の `backup()` は v23.8.0 と v22.16.0 で追加。モジュールは Release candidate | [Node.js sqlite](https://nodejs.org/api/sqlite.html) | O |
| AES-GCM の AAD は暗号化しないが認証する。塊のファイル・番号・最後かを AAD に入れると、入れ替え・並べ替え・切り捨ては復号の確認で失敗する | [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) | O |
| 1つの秘密から用途ごとの鍵を HKDF で導く | [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) | O |
| 写しを3つ、2種類の媒体に、1つは別の場所に置く（3-2-1） | [CISA Data Backup Options](https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf) | O |

## 11. 外への通信

| 主張 | 出典 | 強さ |
|---|---|---|
| 解決したアドレスを確かめ、そのアドレスにだけ接続する（DNS rebinding 対策） | [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | O |
| ポートの指針はない | 同上 | O（443 だけにするのはこのアプリの方針） |
| Ollama は `localhost:11434/v1`、LM Studio は `localhost:1234/v1`、llama.cpp の既定のポートは 9931 | [Ollama](https://docs.ollama.com/api/openai-compatibility)、[LM Studio](https://lmstudio.ai/docs/developer/openai-compat)、llama.cpp の README | O |
| 外から取り込んだ文書による間接的なプロンプトの注入 | [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | O |

## 12. 写真と動画のメタデータ

| 主張 | 出典 | 強さ | 注意 |
|---|---|---|---|
| `mvhd` の作成日時は 1904-01-01 からの秒数。UTC が望ましいが、古い版では現地時刻のことがある | Apple QuickTime File Format | O | UTC とは限らない |
| `com.apple.quicktime.creationdate` と `...location.ISO6709` | 同上 | O | 書式は緩く書かれている |
| `OffsetTimeOriginal` は Exif 2.31 で追加 | CIPA DC-008-2016 | N/B | |
| sharp の既定はメタデータをすべて消す。`withExif` は入力の EXIF を無視して置き換える | [sharp の出力](https://sharp.pixelplumbing.com/api-output) | O | GPS だけを残す設定はない |

## 13. 利用者がアップロードしたファイルの表示

| 主張 | 出典 | 強さ |
|---|---|---|
| `nosniff` で、HTML として解釈させない | [MDN X-Content-Type-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options) | O |
| CSP の `sandbox` はヘッダーで送る | [MDN sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) | O |
| `sandbox` は Chromium と Safari の PDF の表示を壊すという報告がある | redmine.org #40647 など | B（そのため PDF はアプリの中で描く） |
| PDF はアプリの中で pdf.js（`pdfjs-dist` 6.5.438、Apache-2.0、Mozilla）で描く。依存として固定し、PDF を開いたときにだけ読み込む | [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist)・[LICENSE](https://github.com/mozilla/pdf.js/blob/master/LICENSE) | O |
| pdf.js 6 は `isEvalSupported` の設定も、文字列を評価する道も持たない（ビルドに `new Function(`・`eval(` がないことを `audit:security` が確かめる）。前の版へ戻したときのために `isEvalSupported: false` を渡す | `node_modules/pdfjs-dist/types/src/display/api.d.ts`（6.5.438 の `DocumentInitParameters`） | O |
| `useWasm: false` で WebAssembly を使わない。JPX・JBIG2・色の変換・PostScript の関数には JavaScript の代わりの道がある。CSP に `'wasm-unsafe-eval'` を足さない | 同上の `useWasm` の説明、`PDFFunctionFactory`（WebAssembly に失敗すると JavaScript で計算する） | O |
| 同梱して同じオリジンから配る CMap（Adobe の CMap、BSD 3 条項に近い Adobe の許諾）と標準の書体（Foxit の書体は PDFium の BSD 3 条項、Liberation Sans は SIL OFL 1.1）。許諾の文は `dist*/pdfjs/cmaps/LICENSE`・`dist*/pdfjs/standard_fonts/LICENSE_*` として一緒に配る | `node_modules/pdfjs-dist/cmaps/LICENSE`・`standard_fonts/LICENSE_FOXIT`・`LICENSE_LIBERATION` | O |

## 14. 日本の法令

| 主張 | 出典 | 強さ | 注意 |
|---|---|---|---|
| 安全管理措置（組織・人・物理・技術・外的環境） | [個人情報保護法ガイドライン（通則編）](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/) | O | |
| 令和8年の改正: 16歳未満は法定代理人が通知を受け同意する | [個人情報保護委員会](https://www.ppc.go.jp/personalinfo/legal/r8kaiseihogohou/)（2026-07-17 公布） | O（要約） | 施行は政令で2年以内。条文は読んでいない |
| 外部送信規律（2023-06-16 施行） | [総務省](https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu.html) | O | 外部へ送らない構成では、知らせる対象がない（解釈は U） |
| 家族が自分で動かすなら、個人情報取扱事業者に当たらない可能性が高い | — | U | 法的助言ではない。法務の確認は evidence-pending |

## 15. まとめた精算

| 主張 | 出典 | 強さ |
|---|---|---|
| 送金の数を最小にするのは強 NP 困難 | Verhoeff 2004、[arXiv 1402.6556](https://ar5iv.labs.arxiv.org/html/1402.6556) | R |
| 最大の貸し手と最大の借り手を組む貪欲法は n−1 件以下 | 初等的な証明 | — |
