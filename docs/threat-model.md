# 脅威モデル

対象はフロントエンドと公開API契約。実バックエンド、端末OS、外部天気事業者の安全性を、この成果物だけで保証しない。

## 資産・主体・境界

- 資産: 家族構成、予定、Todo、学校書類/OCR、支出、招待、セッション、監査記録。
- 主体: owner/adult/child/guest、未認証者、招待受領者、外部サービス、管理者。
- 信頼境界: ブラウザ↔API、API↔DB、API↔ファイル隔離/AV、API↔天気/祝日、世帯A↔世帯B。

## STRIDE要約

| 脅威 | 例 | 必須対策 | この成果物の状態 |
|---|---|---|---|
| Spoofing | セッション窃取、フィッシング | WebAuthn、再認証、`__Host-` Secure HttpOnly SameSite Cookie、ローテーション | UI/API契約のみ |
| Tampering | 予定/Todo/権限の競合上書き、精算額改ざん | version/ETag、整数円、サーバー再計算、監査ログ | モック競合＋契約 |
| Repudiation | 招待や精算操作の否認 | append-only AuditEvent、主体/時刻/対象/結果 | ER/契約のみ |
| Information disclosure | 別世帯の添付参照、通知漏えい | 全問い合わせでhousehold認可、署名URL、通知マスキング、最小化 | 表示UI＋契約 |
| Denial of service | 大容量添付、招待試行 | サイズ/回数制限、レート制御、隔離キュー | UI制限＋契約 |
| Elevation of privilege | guestがowner操作、唯一のownerを消す | Membership roleをサーバー強制、object-level認可、owner数検証 | モック拒否＋契約 |

## セッションとCSRF

本番APIはCookie名を `__Host-family_session` とし、`Path=/; Secure; HttpOnly; SameSite=Lax` を最低線にする。認証・権限変更時にIDをローテーションし、サーバー側失効を実装する。認証情報をlocalStorage/sessionStorageへ保存しない。

参照フロントのパスキー追加は明示的なデモ登録であり、秘密鍵を生成・保存しない。HTTP adapterではsecure contextとWebAuthn credential APIを要求し、challenge・origin・RP ID・attestation/credentialの検証はサーバー責務とする。パスワード変更の入力値と招待tokenはWeb Storageへ保存しない。

状態変更はCSRF tokenに加えて`Origin`/`Sec-Fetch-Site`を検証する。XSS対策の代替にはしない。出力エスケープ、依存管理、strict CSPを併用する。

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

## 依存関係の例外

計画で固定された Vite 8.0.4 には、2026-09-30時点のnpm advisoryで開発サーバーの任意ファイル読取等（最大 high）が報告され、8.3.1が修正版として案内されている。本成果物は要件どおり8.0.4を維持するため、開発・previewを`127.0.0.1`から外部公開せず、納品物は静的`dist`のみとする。これは恒久対策ではなく、実製品化時はVite 8.3.1以降へ更新して回帰確認すべき `security exception` である。実行時依存だけの `npm audit --omit=dev` と全依存監査を区別して報告する。
