# palworld-notify

PalworldサーバーのREST APIを監視し、オンラインプレイヤーの変化・サーバーダウン・メモリひっ迫・サーバーFPS低下をDiscord Webhookに通知する常駐スクリプト。依存パッケージなし(実行時)。

## 必要環境

- Node.js 22.6+ (v23以降なら `--experimental-strip-types` フラグ不要)
- Palworld側で REST API を有効化:
  `PalWorldSettings.ini` に `RESTAPIEnabled=True`, `RESTAPIPort=8212`, `AdminPassword="..."`

## 実行

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export PALWORLD_ADMIN_PASSWORD="AdminPasswordの値"
npm start          # = node --experimental-strip-types src/index.ts
```

環境変数(任意): `PALWORLD_API` (既定 http://127.0.0.1:8212/v1/api)、`POLL_INTERVAL_SEC` (既定 60)、`MEM_THRESHOLD_PERCENT` (既定 85、超えるとメモリひっ迫を通知)、`FPS_THRESHOLD` (既定 40、下回るとサーバー高負荷を通知)

### 警告通知の間引き

FPS・メモリの警告は、しきい値付近を行き来しても連発しないよう3段構えで抑制している。

| 環境変数 | 既定 | 役割 |
| --- | --- | --- |
| `ALERT_SUSTAIN_TICKS` | 3 | この回数だけ連続でしきい値を割って初めて通知(セーブ処理などの一瞬の落ち込みを無視) |
| `ALERT_COOLDOWN_MIN` | 30 | 一度鳴らしたら、この分数は同じ警告を再送しない |
| `FPS_RECOVER` | `FPS_THRESHOLD`+10 | ここまで戻って初めて「回復」とみなす(境界を跨ぐだけでは再通知しない) |
| `MEM_RECOVER_PERCENT` | `MEM_THRESHOLD_PERCENT`-5 | 同上(メモリ側) |

通知が多すぎるときは `ALERT_SUSTAIN_TICKS` か `ALERT_COOLDOWN_MIN` を上げる。

## ゲーム内アナウンス(手動)

再起動予告・メンテ告知をゲーム内に流す単発コマンド。常駐プロセスとは別に実行する。

```bash
export PALWORLD_ADMIN_PASSWORD="AdminPasswordの値"
npm run announce -- "20時にサーバーを再起動します"
```

`DISCORD_WEBHOOK_URL` は不要(`PALWORLD_ADMIN_PASSWORD` のみ必須、接続先は `PALWORLD_API` で上書き可)。成功で終了コード0、失敗で1を返すので再起動スクリプトから成否を判定できる。

systemdの `Environment=` はそのユニット専用でシェルには渡らないため、CLI実行時は自分で `export` する(または `systemctl show palworld-notify -p Environment` から拾う)。

## 型チェック

```bash
npm install       # typescript / @types/node (開発時のみ)
npm run typecheck
```

## systemd例

```ini
[Unit]
Description=Palworld Discord Notifier
After=network-online.target

[Service]
ExecStart=/usr/bin/node --experimental-strip-types /opt/palworld-notify/src/index.ts
Environment=DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
Environment=PALWORLD_ADMIN_PASSWORD=xxxx
Restart=always
RestartSec=10
User=steam

[Install]
WantedBy=multi-user.target
```

## 構成

- `src/index.ts` — 監視ループ本体 (差分検知、Embed組み立て)
- `src/announce.ts` — 手動アナウンス用CLI (`npm run announce`)
- `src/palworld.ts` — REST APIクライアント (`getPlayers` / `getInfo` / `getMetrics` / `announce`)
- `src/discord.ts` — Webhookクライアント、Embed型、カラー定義
- `src/types.ts` — Palworld公式APIスキーマの型定義
