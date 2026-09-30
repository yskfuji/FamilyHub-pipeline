# 証拠台帳

最終更新: 2026-09-30。資料を「仕様・ガイダンス」「実験」「質的研究」「レビュー」に分け、主張の強さを越えて一般化しない。効果量が原著で統一報告されない場合は `not consistently reported` とし、推測しない。

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

## 証拠状態

- 実装済みの自動証拠: 型検査、単体、ブラウザE2E、axe、水平オーバーフロー測定、固定シード撮影。
- 人手監査: 全採用PNGの原寸光学確認後、`docs/audits/visual-audit.md` に記録する。
- `evidence-pending`: 最低6世帯・12名のペア評価、VoiceOver/Safari実機、バックエンド侵入試験、実運用のCore Web Vitals。これらが未実施の間、実利用者の成功率・満足・安全性を実証済みとは表現しない。
