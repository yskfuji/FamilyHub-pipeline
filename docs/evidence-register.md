# 証拠台帳

最終更新: 2026-10-03。資料を「仕様・ガイダンス」「実験」「質的研究」「レビュー」に分け、主張の強さを越えて一般化しない。効果量が原著で統一報告されない場合は `not consistently reported` とし、推測しない。

| ID | 主張 | 資料種別・標本 | 効果・観察 | 限界・反証 | 採用した設計判断 | 確信度 |
|---|---|---|---|---|---|---|
| E01 | 美観の改善は主観印象を高めうるが、課題成績を保証しない | 対照実験、N=331 | 美観操作で主観評価は改善。検索・創造・転移課題の正確さ・時間に有意な改善なし | 脱落率46%、単一実験文脈。美観の無価値を示す研究でもない | 美観と別に成功率、時間、誤操作、戻りを測る。`docs/audits/human-usability-protocol.md` | 中 | 
| E02 | 分析支援は誤りを減らしても状況認識を下げうる | 実験、N=83 | 支援強化群で誤り減少、一方で状況認識が低下 | 学生標本、特定ダッシュボード、効果量は指標ごとで一様でない | Insightsに根拠・現状態・確信度・無視可能性を併記。自動反映しない | 中 |
| E03 | 家庭カレンダーでは可視性、アクセス性、信頼、冗長性が重要 | 質的研究、N=40 | 家族の調整行動から4特性を同定 | 質的・探索的で、生活改善の因果や母集団割合を示さない | Today・予定・共有相手・同期時刻を明示。効用を断定しない | 中 |
| E04 | 家事の認知的負担の偏在は心理指標と関連する | 横断研究、N=322 | 認知的家事負担と心理指標に関連 | 自己申告、横断、高所得寄り。因果、公平性の最適値は不明 | 担当・レビュアー・作成者を表示。公平性スコアや心理推定は実装しない | 中 |
| E05 | 適切なリマインダーは行動を助けうる | RCT、N=52、およびレビュー | 軽度認知障害等の参加者における2アプリ比較で有効性を示唆 | 小標本・対象限定・無通知対照ではない。一般家庭への直接一般化不可 | 「いつ・何をする」、プレビュー、延期、停止。乱発や効果保証なし | 低〜中 |
| E06 | ポインタ入力の対象サイズに最低線が必要 | WCAG 2.2 Understanding 2.5.8（規範本文への解説） | 例外を除き24×24 CSS pxまたは間隔条件 | 24pxは優れたタッチ体験を保証しない | 主要タッチ操作を44px以上。自動検査と実機確認を分離 | 高 |
| E07 | 日本語UIは一貫したコンポーネント、状態、アクセシビリティ説明が必要 | デジタル庁デザインシステム | 日本語行政サービス向けコンポーネントと利用指針 | 本製品のブランドや全ユースケースを規定しない | ラベル、説明、エラー、フォーカス、余白の最低線として参照 | 中〜高 |
| E08 | パスワードの長さ・漏えい値照合とパスキー優先が現行認証の要点 | NIST SP 800-63B-4 | 単一要素パスワード15文字以上、最大長を十分許容、構成規則・定期変更を避け、blocklist照合 | フロントUIだけでは検証・レート制御・耐フィッシング性を成立させられない | パスキー第一、15〜64文字、文字種強制なし、漏えい拒否理由。サーバー契約を明示 | 高 |
| E09 | セッション・CSRF・CSPはサーバー境界で強制すべき | OWASP Session / CSRF / CSP Cheat Sheets、ASVS | Secure/HttpOnly/SameSite、CSRF token、Origin/Fetch Metadata、strict CSP等 | Cheat Sheetは脅威モデル固有の完全な保証ではない | `__Host-` Cookie、検証、ヘッダーテンプレートを契約化。認証情報をWeb Storageに置かない | 高 |
| E10 | ファイルアップロードは多層検証と隔離が必要 | OWASP File Upload Cheat Sheet | allowlist、MIME/signature、ランダム名、webroot外、AV、認可等 | AVでも未知脅威を完全には排除できない | UIで selected/validating/quarantined/clean/rejected を区別し、サーバー必須要件を明記 | 高 |
| E11 | 警告を重ねれば必ず誤操作が減るわけではない | 警告慣れの実験、N=22 | 反復警告に対する注意低下を観察 | 小規模で均質な実験標本。家庭アプリや全確認画面へ直接一般化できない | 可逆操作は取り消し、高リスク操作だけ対象と影響を示す確認にする | 低〜中 |
| E12 | 認可は最小権限・既定拒否・全リクエスト検査が必要 | OWASP Authorization Cheat Sheet | サーバー側で毎回、属性と対象を含めて認可する指針 | ガイダンスであり、本システムへの侵入試験結果ではない | 能力と公開範囲を分離し、UI非表示を認可境界としない。不可視対象は `NOT_FOUND` | 高 |
| E13 | Web Cryptoは保存暗号化を提供するが、同一オリジンの悪意あるコードを無効化しない | W3C Web Cryptography API | AES-GCM、非抽出鍵等のブラウザ暗号APIを規定 | XSS・端末侵害・実行中データの保護を保証しない | 再送待ちを暗号化するが多層防御と明記し、対象と保存期間を最小化 | 高 |
| E14 | 日本語の製品UIでは「予定・タスク・メモ・招待・メンバー」等へ用語が収束している | Apple／Google／TimeTree／Microsoftの公開日本語UI・ヘルプ5資料の定性的比較 | 予定、タスク、繰り返し、参加者・メンバー、招待の近い語を複数資料で確認 | 無作為抽出でも利用者理解の比較実験でもない。Google資料はAI翻訳を含む可能性を明記。製品ごとの対象差もあるため「普遍的」とは断定できない | 共通語彙へ集約し、内部enum・英語見出し・実装語を非表示。予定とタスクの繰り返し文言を分離。母語話者2名レビューまでは `evidence-pending` | 中 |
| E15 | 入力やエラーは項目との関係、現在状態、修正方法が明確である必要がある | デジタル庁デザインシステムの入力欄・ボタン指針、WCAG 2.2 | ラベルの常時表示、補足・エラーの対応付け、操作名と状態通知の明確化を要求 | ガイダンスであり、本アプリの日本語理解率やタスク成功率を測った結果ではない | placeholderだけに頼らずラベルを表示し、失敗時は原因・入力保持・次の操作を示す。曖昧な「詳細」「確定」を避ける | 中〜高 |
| E16 | 外部の場所検索は距離順に返らず、丸めた位置でも端末内で並べ直せば近い候補をほぼ再現できる | 本リポジトリの実測、28地点・196回（`docs/audits/place-lookup-probe.md`） | 距離順は1/28。小数第3位の丸め＋上限200＋並べ直しで上位10件の再現率 平均0.961、完全一致25/28（95%CI 72.8〜96.3%）。第2位は平均0.25（符号検定 p≈9.5×10⁻⁷） | 1日・1測定元・主要駅中心で、密集地では取りこぼす（三宮0.2）。正解自体が上限200件で打ち切られている | 小数第3位に丸めて送り、端末内で並べ直す。名前検索・手入力を常設 | 中〜高 |
| E17 | 位置の誤差は95%信頼半径で示され、iOSで正確な位置情報がオフだと数km単位になる | W3C Geolocation、Apple WWDC20 | accuracy は95%信頼水準のメートル値。近似位置は都市部で数km、郊外で10km以上 | 実際の誤差分布は端末・環境で異なり、Webから正確な位置情報の設定を直接知ることはできない | 誤差1000m超では近くの候補を出さず名前検索へ、100m超では注意を表示 | 高 |
| E18 | ブラウザに渡す写真からは位置情報が消されることが多い | WebKit不具合報告、Android開発者文書、報道 | iOSはファイル入力からのカメラ撮影で常に除去、ライブラリは「オプション」で含めた場合だけ残る。Androidは標準でEXIFの位置を伏せる | 版による差が大きく、最新OSの既定値は実機で未確認 | 写真は全OSで選べるが、位置がない理由と残し方を説明し、名前検索へ誘導する | 中 |
| E19 | 位置情報の許可は利用者の操作直後に求めるほうが許可されやすい | web.dev（Chromeの許可プロンプト計測）、Apple HIG | 意図の兆候なしの表示は許可12%、操作後は30% | デスクトップChromeの計測で、家庭アプリや位置情報に限った実験ではない | ボタンを押したときだけ位置情報を求め、初回の外部検索の直前に同意を求める | 中 |
| E20 | 座標だけで店を当てるのは屋内で難しい | CheckInside（4施設・20名・6週間） | 既存の位置情報サービスで上位5件に正解が入るのは17% | 小規模・屋内・2016年の研究 | 候補の一覧に加え、名前検索と手入力を同じ画面に置く。自動で場所を決めない | 低〜中 |
| E21 | アカウントに結び付く位置情報は個人情報として扱い、外部送信は公表と同意が要る | 個人情報保護委員会ガイドライン（通則編）、総務省 外部送信規律、de Montjoye ら（Sci Rep 2013） | 位置情報は蓄積で特定個人を識別しうる。4つの時空間点で95%を一意に特定 | 法令の適用可否は事業形態で異なり、本台帳は法的助言ではない | 現在地を保存しない、送信内容を最小化、送信先・内容・目的を公表し同意を記録、子ども・ゲストに返さない | 中〜高 |

## 一次・公的資料

- [美観操作実験（PMC6388663）](https://pmc.ncbi.nlm.nih.gov/articles/PMC6388663/)
- [ダッシュボード支援実験（PMC7234950）](https://pmc.ncbi.nlm.nih.gov/articles/PMC7234950/)
- [家庭カレンダー研究（PMC5533282）](https://pmc.ncbi.nlm.nih.gov/articles/PMC5533282/)
- [家事の認知的負担研究（PMC11761833）](https://pmc.ncbi.nlm.nih.gov/articles/PMC11761833/)
- [リマインダーRCT（PMC8821124）](https://pmc.ncbi.nlm.nih.gov/articles/PMC8821124/)
- [認知的オフローディングのレビュー（PMC9971128）](https://pmc.ncbi.nlm.nih.gov/articles/PMC9971128/)
- [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [デジタル庁デザインシステム](https://design.digital.go.jp/dads/components/)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP ASVS](https://owasp.org/projects/asvs)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [デジタル庁 ボタンのアクセシビリティ](https://design.digital.go.jp/dads/components/button/accessibility/)
- [WCAG 2.2 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
- [WCAG Status Messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages)
- [WCAG 2.2 Error Prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)
- [警告慣れの実験（PMC7751389）](https://pmc.ncbi.nlm.nih.gov/articles/PMC7751389/)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/)
- [Microsoft To Doの期限・リマインダー・繰り返し](https://support.microsoft.com/ja-jp/todo/add-due-dates-and-reminders-in-microsoft-to-do)
- [Google カレンダーの繰り返すタスク](https://support.google.com/calendar/answer/12132599?co=GENIE.Platform%3DDesktop&hl=ja)
- [Apple iCloudカレンダーの共有](https://support.apple.com/ja-jp/guide/icloud/mm6b1a9479/1.0/icloud/1.0)
- [Apple ファミリー共有のメンバーの種類](https://support.apple.com/ja-jp/guide/personal-safety/ips75b3b794f/web)
- [TimeTree 共有カレンダーへの参加](https://support.timetreeapp.com/hc/ja/articles/900006199983-%E5%85%B1%E6%9C%89%E3%82%AB%E3%83%AC%E3%83%B3%E3%83%80%E3%83%BC%E3%81%B8%E5%8F%82%E5%8A%A0%E3%81%97%E3%81%9F%E3%81%84)
- [デジタル庁 インプットテキストの使い方](https://design.digital.go.jp/dads/components/input-text/usage/)
- [OpenPOI API ドキュメント](https://docs.openpoiapi.com/)、[利用規約・プライバシー](https://docs.openpoiapi.com/legal.html)、[出典と権利表示](https://openpoiapi.com/attribution.html)
- [Overture Maps Places ガイド](https://docs.overturemaps.org/guides/places/)
- [W3C Geolocation](https://www.w3.org/TR/geolocation/)
- [MDN Permissions-Policy: geolocation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/geolocation)
- [Apple WWDC20 What's new in location](https://developer.apple.com/videos/play/wwdc2020/10660/)
- [WebKit 257534（写真の位置情報の除去）](https://bugs.webkit.org/show_bug.cgi?id=257534)、[WebKit 263192（カメラ撮影の位置情報除去）](https://bugs.webkit.org/show_bug.cgi?id=263192)、[WebKit 267277（画像の変換）](https://bugs.webkit.org/show_bug.cgi?id=267277)
- [Android 共有メディアへのアクセス](https://developer.android.com/training/data-storage/shared/media)、[Android Photo Pickerと位置情報（報道）](https://www.androidauthority.com/android-photo-picker-location-3683074/)
- [web.dev Permissions best practices](https://web.dev/articles/permissions-best-practices)
- [Apple HIG Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [CheckInside（arXiv:1607.06429）](https://arxiv.org/abs/1607.06429)
- [個人情報保護委員会 ガイドライン（通則編）](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/)
- [総務省 外部送信規律](https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu.html)
- [de Montjoye et al. Unique in the Crowd（Sci Rep 2013）](https://www.nature.com/articles/srep01376)

## 証拠状態

- 実装済みの自動証拠: 型検査、単体、ブラウザE2E、axe、水平オーバーフロー測定、固定シード撮影。
- 人手監査: 全採用PNGの原寸光学確認後、`docs/audits/visual-audit.md` に記録する。
- `evidence-pending`: 最低6世帯・12名のペア評価、VoiceOver/Safari実機、バックエンド侵入試験、実運用のCore Web Vitals、iOS Safari実機での現在地と写真の位置情報（「オプション」の既定値を含む）、Android実機での写真の位置情報、配備先でのCSP・Permissions-Policyの適用。これらが未実施の間、実利用者の成功率・満足・安全性を実証済みとは表現しない。
