# 脅威モデル

対象はフロントエンドと公開API契約。実バックエンド、端末OS、外部天気事業者の安全性を、この成果物だけで保証しない。

## 資産・主体・境界

- 資産: 家族構成、予定、タスク、学校書類/OCR、支出、招待、セッション、監査記録。
- 主体: 管理者／大人のメンバー／子どもメンバー／ゲスト、未認証者、招待受領者、外部サービス。API内部値は `owner/adult/child/guest` を維持する。
- 信頼境界: ブラウザ↔API、API↔DB、API↔ファイル隔離/AV、API↔天気/祝日、世帯A↔世帯B。

## STRIDE要約

| 脅威 | 例 | 必須対策 | この成果物の状態 |
|---|---|---|---|
| Spoofing | セッション窃取、フィッシング | WebAuthn、再認証、`__Host-` Secure HttpOnly SameSite Cookie、ローテーション | UI/API契約のみ |
| Tampering | 予定/タスク/権限の競合上書き、精算額改ざん | version/権限revision、冪等キー、整数円、サーバー再計算、監査ログ | モック競合＋契約 |
| Repudiation | 招待や精算操作の否認 | append-only AuditEvent、主体/時刻/対象/結果 | ER/契約のみ |
| Information disclosure | 別世帯の添付参照、通知漏えい | 全問い合わせでhousehold認可、署名URL、通知マスキング、最小化 | 表示UI＋契約 |
| Denial of service | 大容量添付、招待試行 | サイズ/回数制限、レート制御、隔離キュー | UI制限＋契約 |
| Elevation of privilege | ゲストが管理者操作、唯一の管理者を消す | Membership roleをサーバー強制、既定拒否、object-level認可、管理者数検証 | UI非表示＋モック拒否＋契約 |

一覧・検索・詳細取得も、能力と対象の公開範囲をサーバーで毎回判定する。閲覧不可の個別対象は `NOT_FOUND` とし、存在の有無を漏らさない。フロント側の非表示は誤操作防止であって認可境界ではない。権限、招待、金融操作は再認証と監査イベントを必須契約とする。

## セッションとCSRF

本番APIはCookie名を `__Host-family_session` とし、`Path=/; Secure; HttpOnly; SameSite=Lax` を最低線にする。認証・権限変更時にIDをローテーションし、サーバー側失効を実装する。認証情報をlocalStorage/sessionStorageへ保存しない。

参照フロントのパスキー追加は明示的なデモ登録であり、秘密鍵を生成・保存しない。HTTP adapterではsecure contextとWebAuthn credential APIを要求し、challenge・origin・RP ID・attestation/credentialの検証はサーバー責務とする。パスワード変更の入力値と招待tokenはWeb Storageへ保存しない。

状態変更はCSRF tokenに加えて`Origin`/`Sec-Fetch-Site`を検証する。XSS対策の代替にはしない。出力エスケープ、依存管理、strict CSPを併用する。

## オフライン再送

予定・タスク・メモ本文の作成／更新だけを再送対象とし、削除、添付、家計、精算、招待、権限、認証、セッション、通知停止はキューへ入れない。再送待ちはIndexedDBへ最大50件・24時間だけ保存し、非抽出AES-GCM鍵、操作ごとのランダムIV、利用者・世帯・操作・schema versionを追加認証データにする。復帰時は自動送信せず、本人が内容を確認してから送る。別利用者への切替では消去し、セッション失効時は同じ利用者の再認証までロックする。

これは保存データの偶発的な読み出しへの多層防御であり、同一オリジンXSS、悪意ある実行コード、端末侵害から秘密を守る仕組みではない。再送前にはセッション、能力、権限リビジョン、対象版を再検証する。

## 添付

1. 許可拡張子をPDF/JPEG/PNGに限定。
2. MIMEとmagic bytesを照合し、ファイル名をランダム化。
3. webroot外の隔離領域へ置き、AV/CDRを実行。
4. `clean`になるまで内容配信しない。配信時も世帯/オブジェクト認可。
5. サイズ、個数、解凍後サイズ、処理時間を制限。
6. 拒否・検査結果をAuditEventへ記録。

AVのclean判定は絶対安全を意味しない。未知脅威、パーサ脆弱性、誤検知に備え、最小権限と更新・監視を併用する。

## 配備ヘッダー

`public/_headers`と`deploy/nginx.conf`はstrict CSP、HSTS、`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'self'`、nosniffを含む。TLS証明書、HSTS preload、reporting endpointは配備先で検証する。

## 依存関係

Viteは既知問題の修正版8.3.1へ固定更新した。2026-10-01時点で `npm audit --omit=dev` と全依存の `npm audit` はともに0件。これは将来の脆弱性不存在を保証しないため、lockfileを含む継続監査とlocalhost限定の開発サーバー運用を維持する。
