import { totalmem, freemem } from "node:os";
import { PalworldApi } from "./palworld.ts";
import { DiscordWebhook, COLOR, type EmbedField } from "./discord.ts";

// ---- 設定 (環境変数) ----
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ADMIN_PASSWORD = process.env.PALWORLD_ADMIN_PASSWORD;
const API_BASE = process.env.PALWORLD_API ?? "http://127.0.0.1:8212/v1/api";
const INTERVAL = (Number(process.env.POLL_INTERVAL_SEC) || 60) * 1000;
const MEM_THRESHOLD_PERCENT = Number(process.env.MEM_THRESHOLD_PERCENT) || 85;

if (!WEBHOOK_URL || !ADMIN_PASSWORD) {
  console.error("DISCORD_WEBHOOK_URL と PALWORLD_ADMIN_PASSWORD を設定してください");
  process.exit(1);
}

const palworld = new PalworldApi(API_BASE, ADMIN_PASSWORD);
const discord = new DiscordWebhook(WEBHOOK_URL, "Palworld通知");

let serverName = "Palworld";

interface KnownPlayer {
  name: string;
  level: number | undefined;
}

/** 現在オンラインのプレイヤー一覧フィールド (field valueは最大1024文字) */
function onlineField(current: Map<string, KnownPlayer>): EmbedField {
  let value =
    [...current.values()]
      .map((p) => `• ${p.name} (Lv.${p.level ?? "?"})`)
      .join("\n") || "(なし)";
  if (value.length > 1024) value = value.slice(0, 1020) + "\n…";
  return { name: `オンライン (${current.size}人)`, value };
}

function baseEmbed() {
  return {
    footer: { text: serverName },
    timestamp: new Date().toISOString(),
  };
}

/** 現在のメモリ使用率フィールド (VPSホスト全体、%と実量) */
function memoryField(): EmbedField {
  const total = totalmem();
  const used = total - freemem();
  const percent = Math.round((used / total) * 100);
  const GiB = 1024 ** 3;
  return {
    name: "メモリ使用率",
    value: `${percent}% (${(used / GiB).toFixed(1)}GB / ${(total / GiB).toFixed(1)}GB)`,
  };
}

let prev: Map<string, KnownPlayer> | null = null; // 初回は通知しない
let serverWasDown = false;
let memoryWasHigh = false;

/** VPSホストのメモリひっ迫を検知(しきい値超えの瞬間だけ1回通知) */
async function checkMemory(): Promise<void> {
  const percent = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
  if (percent >= MEM_THRESHOLD_PERCENT) {
    if (!memoryWasHigh) {
      memoryWasHigh = true;
      await discord.send({
        ...baseEmbed(),
        color: COLOR.memWarn,
        description: "⚠️ **メモリ使用率が逼迫しています**",
        fields: [memoryField()],
      });
    }
  } else {
    memoryWasHigh = false;
  }
}

async function tick(): Promise<void> {
  await checkMemory();

  let current: Map<string, KnownPlayer>;
  try {
    const players = await palworld.getPlayers();
    current = new Map(
      players.map((p) => [
        p.userId ?? p.playerId,
        { name: p.name, level: p.level },
      ])
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    if (!serverWasDown) {
      serverWasDown = true;
      await discord.send({
        ...baseEmbed(),
        color: COLOR.warn,
        description: "⚠️ **Palworldサーバーに接続できません**(停止中?)",
      });
    }
    return;
  }

  if (serverWasDown) {
    serverWasDown = false;
    await discord.send({
      ...baseEmbed(),
      color: COLOR.info,
      description: "✅ **サーバーとの接続が回復しました**",
      fields: [onlineField(current), memoryField()],
    });
  }

  if (prev !== null) {
    const joined = [...current.keys()].filter((id) => !prev!.has(id)).length;
    const left = [...prev.keys()].filter((id) => !current.has(id)).length;

    if (joined > 0 || left > 0) {
      await discord.send({
        ...baseEmbed(),
        color: COLOR.info,
        title: "オンラインプレイヤー",
        fields: [onlineField(current), memoryField()],
      });
    }
  }

  prev = current;
}

async function main(): Promise<void> {
  try {
    const info = await palworld.getInfo();
    if (info.servername) serverName = info.servername;
  } catch {
    console.warn("サーバー名の取得に失敗(既定値を使用)");
  }
  console.log(`監視開始: ${API_BASE} を ${INTERVAL / 1000} 秒ごとにポーリング`);
  void tick();
  setInterval(() => void tick(), INTERVAL);
}

void main();
