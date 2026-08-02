# palworld-notify

PalworldサーバーのREST APIを監視し、オンラインプレイヤーの変化・サーバーダウン・VPSホストのメモリひっ迫をDiscord Webhookに通知する常駐スクリプト。依存パッケージなし(実行時)。

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

環境変数(任意): `PALWORLD_API` (既定 http://127.0.0.1:8212/v1/api)、`POLL_INTERVAL_SEC` (既定 60)、`MEM_THRESHOLD_PERCENT` (既定 85、超えるとメモリひっ迫を通知)

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
- `src/palworld.ts` — REST APIクライアント (`getPlayers` / `getInfo` / `getMetrics` / `announce`)
- `src/discord.ts` — Webhookクライアント、Embed型、カラー定義
- `src/types.ts` — Palworld公式APIスキーマの型定義
