# 引き継ぎドキュメント — palworld-notify

## これは何か

Palworld専用サーバー(VPS)の接続プレイヤーを監視し、参加/退出・サーバーダウン/復旧をDiscordにEmbed通知する常駐スクリプト。TypeScript製・実行時依存ゼロ・ビルドレス。

## アーキテクチャ

```
[VPS(同一マシン、追加の公開ポートなし)]
  Palworldサーバー ── REST API 127.0.0.1:8212 (Basic認証, ローカル限定)
        ▲ GET /v1/api/players 毎分ポーリング
  Node常駐スクリプト(本プロジェクト, systemd/pm2管理)
        │ 変化時のみ外向きHTTPSでPOST
        ▼
  Discord Webhook
```

設計方針:
- REST APIは公式が「インターネット直接公開は非推奨」としているため、localhost内に閉じる。外向き通信のみでFWに穴を開けない
- Discord側はWebhookのみ(Botトークン・Gateway接続なし)
- 状態はメモリ上のみ(前回プレイヤーのMap)。再起動すると差分検知がリセットされ、直後の1周期は通知なしで現状把握に使われる(仕様)

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/index.ts` | 監視ループ本体。差分検知・Embed組み立て・状態管理 |
| `src/palworld.ts` | `PalworldApi` クライアント。`getPlayers` / `getInfo` / `getMetrics` / `announce` |
| `src/discord.ts` | `DiscordWebhook` クライアント、`Embed` 型、`COLOR` 定義 |
| `src/types.ts` | 公式APIスキーマ準拠の型定義 (`PalworldPlayer` など) |
| `package.json` | `npm start` / `npm run typecheck`。devDepsにtypescriptと@types/nodeのみ |
| `tsconfig.json` | strict。`erasableSyntaxOnly` / `allowImportingTsExtensions` / `noEmit` |

## 現在の通知仕様

1. **オンライン状況更新**: 前回ポーリングからプレイヤーの入退室があった時点で1つのEmbedを送信。誰が参加/退出したかは文言にしない(タイトル「オンラインプレイヤー」のみ)。
   フィールド `オンライン (N人)` に現在の全接続者を `• 名前 (Lv.xx)` で列挙(0人なら `(なし)`、1024文字超は `…` で切り詰め)、末尾に `メモリ使用率` フィールドを付与。
   カラーバー: `0x5865f2`(ブループル、固定)
2. **サーバーダウン**: API接続失敗に転じた瞬間に1回だけ黄色 `0xfee75c` で通知(連投しない)
3. **復旧**: 接続回復時に1回、オンライン一覧+メモリ使用率つきで通知(色はオンライン状況更新と同じ `0x5865f2`)
4. **メモリひっ迫**: VPSホスト全体のメモリ使用率が `MEM_THRESHOLD_PERCENT`(既定85%)を超えた瞬間に1回だけオレンジ `0xe67e22` で通知。下回っても復旧通知は送らない(ユーザー選択)。Palworld API疎通とは独立に毎tick先頭でチェックするため、サーバーダウン中でも発報しうる
5. **メモリ使用率フィールド**: `os.totalmem()` / `os.freemem()`(Node組み込み、追加依存なし)で算出したVPSホスト全体の使用率。`{percent}% ({used}GB / {total}GB)` 形式。オンライン状況更新・復旧Embedの一番下に付与
6. 全Embed共通: footer=サーバー名(起動時に `/info` から取得、失敗時 "Palworld")、timestamp付き、送信名 `Palworld通知`
7. 起動直後の初回取得は通知しない(再起動のたびに全員分の参加通知が流れるのを防ぐ)

## セットアップ / 実行

```bash
# Palworld側 (PalWorldSettings.ini → 要サーバー再起動)
RESTAPIEnabled=True, RESTAPIPort=8212, AdminPassword="..."

# 実行 (Node 22.6+)
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export PALWORLD_ADMIN_PASSWORD="AdminPasswordの値"
npm start   # = node --experimental-strip-types src/index.ts

# 型チェック (開発時)
npm install && npm run typecheck
```

環境変数(任意): `PALWORLD_API`(既定 `http://127.0.0.1:8212/v1/api`)、`POLL_INTERVAL_SEC`(既定 60)、`MEM_THRESHOLD_PERCENT`(既定 85、VPSホストのメモリ使用率がこれを超えると警告)

常駐化はsystemd推奨(`Restart=always`、READMEにユニット例あり)。pm2でも可。

## 技術上の決定事項と制約

- **ビルドレスTS**: Nodeの型剥がし(type stripping)で `.ts` を直接実行。tsc/バンドラ不要。
  - Node 22系は `--experimental-strip-types` フラグ必須。**v23+ / 現行LTS v24ならフラグ不要**
  - 制約: `enum` / `namespace` / パラメータプロパティは使用不可(erasable syntaxのみ)。定数は `as const` で書く。tsconfigの `erasableSyntaxOnly: true` がこれを強制する
  - import指定子は拡張子つき `./xxx.ts`(`allowImportingTsExtensions`)
- **実行時依存ゼロ**: fetchはNode組み込み。npm installは型チェック時のみ必要
- **例外方針**: `DiscordWebhook.send` は例外を投げない(ログのみ)。Discord側の一時障害で監視ループを殺さないため。※JS版にはここにクラッシュバグがあり、TS化時のスモークテストで発見・修正済み
- `PalworldApi` 側の例外は `tick` 内でcatchし、ダウン検知に利用している

## 参考資料

- 公式REST APIリファレンス: https://docs.palworldgame.com/category/rest-api/ (日本語: /ja/ 配下)
- `/players` のスキーマ: name, accountName, playerId, userId, ip, ping, location_x/y, level, building_count
- `/metrics` で currentplayernum, serverfps, uptime など取得可(`getMetrics` 実装済み・未使用)

## 今後の拡張候補(土台は準備済み)

- 定期レポート(毎朝の人数サマリなど) → `getMetrics` + cron的なタイマー追加
- Discord→ゲーム内アナウンス → `announce()` 実装済み。受け側を作るならWebhookでは不可、discord.jsでBot化が必要
- Botステータス欄への人数常時表示 → 同上、Bot化が必要
- Embedのthumbnail/authorアイコン → `Embed` 型に定義済み、値を渡すだけ

## 検証状況

- `tsc --noEmit`(strict + noUncheckedIndexedAccess)パス
- Node 22.22で型剥がし実行のスモークテスト済(API未接続時のダウン通知経路、Webhook到達不能時の生存を確認)
- 実際のPalworldサーバー・実Webhookに対する結合テストは**未実施** — VPS上での初回起動時に、テスト参加/退出で通知内容を確認すること
