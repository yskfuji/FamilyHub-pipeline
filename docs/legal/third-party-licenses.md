# 使っているソフトと素材のライセンス

`node scripts/audit-licenses.mjs --write` が `package-lock.json` から作る。手で書き換えない。

- 許すライセンス: MIT、MIT-0、ISC、BSD-2-Clause、BSD-3-Clause、0BSD、Apache-2.0、BlueOak-1.0.0、CC0-1.0、Unlicense。
- 名前を付けた例外: LGPL-3.0-or-later（sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない）。
- 画面の配信物に入る部品のライセンスの全文は、ビルドが `licenses.md` として配信物の中に出す。

## 素材

| 名前 | 置き場所 | ライセンス | 備考 |
|---|---|---|---|
| Noto Serif JP（字形の書き出し） | `src/design-system/wordmark.ts` | OFL-1.1 | ブランドの名前「よりどころ」の SVG の字形。書体そのものは配らない |
| SecLists（頻出のパスワードの一覧） | `src/domain/commonPasswords.json` | MIT | 15文字以上の項目だけを、そろえて同梱（scripts/build-password-list.mjs） |

## 本番で使う依存（139件）

| パッケージ | 版 | ライセンス | 備考 |
|---|---|---|---|
| @emnapi/runtime | 1.11.3 | MIT |  |
| @fastify/ajv-compiler | 4.0.7 | MIT |  |
| @fastify/busboy | 3.2.4 | MIT |  |
| @fastify/cookie | 11.1.5 | MIT |  |
| @fastify/deepmerge | 3.2.4 | MIT |  |
| @fastify/error | 4.2.1 | MIT |  |
| @fastify/fast-json-stringify-compiler | 5.1.1 | MIT |  |
| @fastify/forwarded | 3.1.2 | MIT |  |
| @fastify/merge-json-schemas | 0.2.2 | MIT |  |
| @fastify/multipart | 10.1.6 | MIT |  |
| @fastify/proxy-addr | 5.1.2 | MIT |  |
| @hexagon/base64 | 1.1.28 | MIT |  |
| @img/colour | 1.1.0 | MIT |  |
| @img/sharp-darwin-arm64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-darwin-x64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-freebsd-wasm32 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-darwin-x64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-arm | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-ppc64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-riscv64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-s390x | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-linux-arm | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linux-ppc64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linux-riscv64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linux-s390x | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linux-x64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linuxmusl-arm64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-linuxmusl-x64 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-webcontainers-wasm32 | 0.35.5 | Apache-2.0 |  |
| @img/sharp-win32-arm64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-win32-ia32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない |
| @levischuck/tiny-cbor | 0.2.11 | MIT |  |
| @napi-rs/canvas | 1.1.0 | MIT |  |
| @napi-rs/canvas-android-arm64 | 1.1.0 | MIT |  |
| @napi-rs/canvas-darwin-arm64 | 1.1.0 | MIT |  |
| @napi-rs/canvas-darwin-x64 | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-arm-gnueabihf | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-arm64-gnu | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-arm64-musl | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-riscv64-gnu | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-x64-gnu | 1.1.0 | MIT |  |
| @napi-rs/canvas-linux-x64-musl | 1.1.0 | MIT |  |
| @napi-rs/canvas-win32-arm64-msvc | 1.1.0 | MIT |  |
| @napi-rs/canvas-win32-x64-msvc | 1.1.0 | MIT |  |
| @node-rs/argon2 | 2.2.2 | MIT |  |
| @node-rs/argon2-android-arm-eabi | 2.2.2 | MIT |  |
| @node-rs/argon2-android-arm64 | 2.2.2 | MIT |  |
| @node-rs/argon2-darwin-arm64 | 2.2.2 | MIT |  |
| @node-rs/argon2-darwin-x64 | 2.2.2 | MIT |  |
| @node-rs/argon2-freebsd-x64 | 2.2.2 | MIT |  |
| @node-rs/argon2-linux-arm-gnueabihf | 2.2.2 | MIT |  |
| @node-rs/argon2-linux-arm64-gnu | 2.2.2 | MIT |  |
| @node-rs/argon2-linux-arm64-musl | 2.2.2 | MIT |  |
| @node-rs/argon2-linux-x64-gnu | 2.2.2 | MIT |  |
| @node-rs/argon2-linux-x64-musl | 2.2.2 | MIT |  |
| @node-rs/argon2-win32-arm64-msvc | 2.2.2 | MIT |  |
| @node-rs/argon2-win32-ia32-msvc | 2.2.2 | MIT |  |
| @node-rs/argon2-win32-x64-msvc | 2.2.2 | MIT |  |
| @peculiar/asn1-android | 2.11.1 | MIT |  |
| @peculiar/asn1-asym-key | 2.11.1 | MIT |  |
| @peculiar/asn1-cms | 2.11.1 | MIT |  |
| @peculiar/asn1-csr | 2.11.1 | MIT |  |
| @peculiar/asn1-ecc | 2.11.1 | MIT |  |
| @peculiar/asn1-pfx | 2.11.1 | MIT |  |
| @peculiar/asn1-pkcs8 | 2.11.1 | MIT |  |
| @peculiar/asn1-pkcs9 | 2.11.1 | MIT |  |
| @peculiar/asn1-rsa | 2.11.1 | MIT |  |
| @peculiar/asn1-schema | 2.11.1 | MIT |  |
| @peculiar/asn1-x509 | 2.11.1 | MIT |  |
| @peculiar/asn1-x509-attr | 2.11.1 | MIT |  |
| @peculiar/asn1-x509-post-quantum | 2.11.1 | MIT |  |
| @peculiar/utils | 2.0.3 | MIT |  |
| @peculiar/x509 | 2.2.0 | MIT |  |
| @pinojs/redact | 0.4.0 | MIT |  |
| @simplewebauthn/server | 14.0.3 | MIT |  |
| abstract-logging | 2.0.1 | MIT |  |
| ajv | 8.20.0 | MIT |  |
| ajv-formats | 3.0.1 | MIT |  |
| asn1js | 3.1.0 | BSD-3-Clause |  |
| atomic-sleep | 1.0.0 | MIT |  |
| avvio | 9.3.1 | MIT |  |
| cookie | 2.0.1 | MIT |  |
| dequal | 2.0.3 | MIT |  |
| detect-libc | 2.1.2 | Apache-2.0 |  |
| fast-decode-uri-component | 1.0.1 | MIT |  |
| fast-deep-equal | 3.1.3 | MIT |  |
| fast-json-stringify | 7.2.1 | MIT |  |
| fast-querystring | 1.1.2 | MIT |  |
| fast-uri | 3.1.9 | BSD-3-Clause |  |
| fast-uri | 4.2.3 | BSD-3-Clause |  |
| fastify | 5.12.7 | MIT |  |
| fastify-plugin | 6.0.1 | MIT |  |
| fastq | 1.20.3 | ISC |  |
| find-my-way | 9.10.0 | MIT |  |
| ipaddr.js | 2.5.0 | MIT |  |
| json-schema-ref-resolver | 3.0.1 | MIT |  |
| json-schema-traverse | 1.0.0 | MIT |  |
| light-my-request | 6.8.0 | BSD-3-Clause |  |
| nodemailer | 10.3.1 | MIT-0 |  |
| on-exit-leak-free | 2.1.2 | MIT |  |
| pdfjs-dist | 6.5.438 | Apache-2.0 |  |
| pino | 10.4.0 | MIT |  |
| pino-abstract-transport | 3.0.0 | MIT |  |
| pino-std-serializers | 7.1.0 | MIT |  |
| process-warning | 5.1.1 | MIT |  |
| pvtsutils | 1.3.6 | MIT |  |
| pvutils | 1.2.0 | MIT |  |
| quick-format-unescaped | 4.0.4 | MIT |  |
| react | 19.2.4 | MIT |  |
| react-dom | 19.2.4 | MIT |  |
| real-require | 1.0.0 | MIT |  |
| reflect-metadata | 0.2.2 | Apache-2.0 |  |
| require-from-string | 2.0.2 | MIT |  |
| ret | 0.5.1 | MIT |  |
| reusify | 1.1.0 | MIT |  |
| rfdc | 1.4.1 | MIT |  |
| safe-regex2 | 5.1.2 | MIT |  |
| safe-stable-stringify | 2.5.0 | MIT |  |
| scheduler | 0.27.0 | MIT |  |
| secure-json-parse | 4.1.1 | BSD-3-Clause |  |
| semver | 7.8.5 | ISC |  |
| set-cookie-parser | 3.2.2 | MIT |  |
| sharp | 0.35.5 | Apache-2.0 |  |
| sonic-boom | 4.2.1 | MIT |  |
| split2 | 4.2.0 | ISC |  |
| thread-stream | 4.2.0 | MIT |  |
| toad-cache | 3.7.4 | MIT |  |
| tslib | 1.14.1 | 0BSD |  |
| tslib | 2.8.1 | 0BSD |  |
| tsyringe | 4.10.0 | MIT |  |
| zod | 4.6.7 | MIT |  |
