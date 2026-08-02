# 引き継ぎドキュメント — palworld-notify

## これは何か

Palworld専用サーバー(VPS)の接続プレイヤーとホスト負荷を監視し、オンライン状況の変化・サーバーダウン/復旧・メモリひっ迫・FPS低下をDiscordにEmbed通知する常駐スクリプト。TypeScript製・実行時依存ゼロ・ビルドレス。

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
   フィールドは `オンライン (N人)`(フル幅)+ 下記の状態フィールド群。
   カラーバー: `0x5865f2`(ブループル、固定)
2. **サーバーダウン**: API接続失敗に転じた瞬間に1回だけ黄色 `0xfee75c` で通知(連投しない)
3. **復旧**: 接続回復時に1回、状態フィールドつきで通知(色はオンライン状況更新と同じ `0x5865f2`)
4. **メモリひっ迫**: VPSホスト全体のメモリ使用率が `MEM_THRESHOLD_PERCENT`(既定85%)を超えた瞬間に1回だけオレンジ `0xe67e22` で通知。下回っても復旧通知は送らない(ユーザー選択)。Palworld API疎通とは独立に毎tick先頭でチェックするため、サーバーダウン中でも発報しうる
5. **サーバーFPS低下**: `serverfps` が `FPS_THRESHOLD`(既定40)を下回った瞬間に1回だけ濃いオレンジ `0xd35400` で通知。既定値は本番サーバーの実測正常値60fpsの2/3として決めた値。**30fps設定のサーバーに載せる場合は20程度まで下げないと発報しない**復旧通知はなし。`/metrics` が取れなかった周期は判定をスキップして前回状態を持ち越す(取得失敗を「回復」と誤認して連投するのを防ぐ)
6. **状態フィールド群**(オンライン状況更新・復旧・FPS低下の各Embedで共通、すべて `inline: true` で横並び):
   - `オンライン (N人)`: 現在の全接続者を1人1行の `> `+インラインコード(`` > `名前(16桁で左揃え) Lv.xx` ``)で列挙。引用が連続するとDiscord側で1本の縦線にまとまるため、等幅の一覧枠として見える。名前は全角2桁換算で16桁に揃え、超える分は末尾を `…` に。レベルは `padStart(2)` で右揃え。0人なら `> `(なし)``。1024文字を超える場合は行単位で畳んで最終行を `> `…他N人`` にする(行の途中で切ると枠が壊れるため)。ここだけフル幅
   - `CPU負荷`: `os.loadavg()` の5分平均をコア数で正規化。`{percent}% (load {load5} / {cores}コア)`
   - `メモリ使用率`: `os.totalmem()` / `os.freemem()` から算出。`{percent}% ({used}GB / {total}GB)`
   - `サーバーFPS`: `{serverfps} ({serverframetime}ms)`。metrics取得失敗時は `(取得失敗)`
   - `稼働時間` / `ゲーム内日数`: `/metrics` の `uptime` / `days` から。`days` はAPIバージョンによって返らないため、無ければフィールドごと省略
7. 全Embed共通: footer=サーバー名(`/info` から取得、取れるまで毎tick再試行、暫定値 "Palworld")、timestamp付き。**送信名・アイコンは指定しない**(`username` を送るとDiscord側のWebhook設定名を上書きしてしまうため、設定画面で付けた名前をそのまま使う)
8. 起動直後の初回取得は通知しない(再起動のたびに全員分の参加通知が流れるのを防ぐ)

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

環境変数(任意): `PALWORLD_API`(既定 `http://127.0.0.1:8212/v1/api`)、`POLL_INTERVAL_SEC`(既定 60)、`MEM_THRESHOLD_PERCENT`(既定 85、VPSホストのメモリ使用率がこれを超えると警告)、`FPS_THRESHOLD`(既定 40、サーバーFPSがこれを下回ると警告)

常駐化はsystemd推奨(`Restart=always`、READMEにユニット例あり)。pm2でも可。

## 技術上の決定事項と制約

- **ビルドレスTS**: Nodeの型剥がし(type stripping)で `.ts` を直接実行。tsc/バンドラ不要。
  - Node 22系は `--experimental-strip-types` フラグ必須。**v23+ / 現行LTS v24ならフラグ不要**
  - 制約: `enum` / `namespace` / パラメータプロパティは使用不可(erasable syntaxのみ)。定数は `as const` で書く。tsconfigの `erasableSyntaxOnly: true` がこれを強制する
  - import指定子は拡張子つき `./xxx.ts`(`allowImportingTsExtensions`)
- **実行時依存ゼロ**: fetchはNode組み込み。npm installは型チェック時のみ必要
- **例外方針**: `DiscordWebhook.send` は例外を投げない(ログのみ)。Discord側の一時障害で監視ループを殺さないため。※JS版にはここにクラッシュバグがあり、TS化時のスモークテストで発見・修正済み
  - HTTPエラー時はレスポンス本文もログに出す(`Webhook error: HTTP {status} {body}`)。ステータスコードだけでは原因(不正なURL、embed形式ミスなど)が分からないため
- `PalworldApi` 側の例外は `tick` 内でcatchし、ダウン検知に利用している
- **ダウン判定の根拠は `/players` のみ**: `/players` と `/metrics` を `Promise.allSettled` で並列取得しているが、`/metrics` だけ失敗してもダウンとは扱わない(FPS欄が `(取得失敗)` になるだけ)
- **REST APIには10秒のタイムアウト**(`AbortSignal.timeout`)。応答が返らないままtickが積み重なるのを防ぐ。ポーリング間隔を10秒未満にする場合はこの値も見直すこと
- **サーバー名は取得できるまで再試行**: systemdの `After=palworld-server.service` は起動順序を決めるだけで準備完了を待たないため、VPS再起動直後は `/info` が接続拒否になり暫定値 "Palworld" のまま固定されてしまう。`tick` 内で `/players` 成功直後に未取得なら再取得する

## 参考資料

- 公式REST APIリファレンス: https://docs.palworldgame.com/category/rest-api/ (日本語: /ja/ 配下)
- `/players` のスキーマ: name, accountName, playerId, userId, ip, ping, location_x/y, level, building_count
- `/metrics` のスキーマ: serverfps, currentplayernum, serverframetime, maxplayernum, uptime, days(任意)。CPU使用率は含まれないため、ホスト側の負荷は `os.loadavg()` で代替している

## 今後の拡張候補(土台は準備済み)

- 定期レポート(毎朝の人数サマリなど) → `/metrics` は毎tick取得済みなので、タイマーを足すだけ
- Discord→ゲーム内アナウンス → `announce()` 実装済み。受け側を作るならWebhookでは不可、discord.jsでBot化が必要
- Botステータス欄への人数常時表示 → 同上、Bot化が必要
- Embedのthumbnail/authorアイコン → `Embed` 型に定義済み、値を渡すだけ

## 検証状況

- `tsc --noEmit`(strict + noUncheckedIndexedAccess)パス
- Node 22.22で型剥がし実行のスモークテスト済(API未接続時のダウン通知経路、Webhook到達不能時の生存を確認)
- **実機結合テスト完了(2026-08-02、ConoHa VPS)**: 実際のPalworldサーバー・実Discord Webhookで参加検知・メモリ使用率フィールド・Webhookエラー経路を確認済み

## デプロイ先固有の注意点(ConoHa「Palworld専用VPS」テンプレート)

今回デプロイしたConoHa VPSでの構成・ハマりどころ。他環境やVPS再構築時の参考用。

- Palworld本体は `/opt/palworld` にインストールされ、`palworld-server.service`(systemd)で管理される。設定ファイルは `/opt/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini`
- ConoHa製の管理ツール `palworld-manager`(`/opt/palworld-manager`)が `palworld-manager.service` として常駐し、127.0.0.1:60001でWeb UIを提供(ブラウザ経由でstart/stop操作、バックアップ機能あり)。`palworld-server.service`とは別プロセスで、iniを定期的に上書きするような仕組みは無い
- **既知の事故**: `sudo systemctl restart palworld-server.service` を直接叩いたところ、`PalWorldSettings.ini` が完全に空になった(停止シグナルとPalServer自身の設定書き戻し処理が競合したと推測、未確定)。その後は管理画面のstart/stop操作では再現していない。
  → **Palworldサーバー本体の再起動は、CLIから直接`systemctl restart`せず、管理画面(palworld-manager Web UI)のstart/stopを使うこと**。CLIしか使えない場合は`stop`→ini内容確認→`start`と分けて、都度ファイルの中身を確認する
- `RESTAPIPort` / `AdminPassword` はConoHaテンプレートの時点で既に設定済みのことがある(`RESTAPIEnabled`のみ`false`になっていた)。まず`cat`で確認してから変更するとよい
- バックアップは`backup_palworld.timer`(毎日03:30 JST)で自動実行、`palworld-manager backup`コマンド経由。設定ファイルが壊れた際は管理画面から復元可能(ただしバックアップ取得時点の内容に戻るため、直前の設定変更は失われる)
