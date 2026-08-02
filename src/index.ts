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

/** 現在のメモリ使用率 (VPSホスト全体)。%と表示用フィールドを一度の測定から作る */
function readMemory(): { percent: number; field: EmbedField } {
  const total = totalmem();
  const used = total - freemem();
  const percent = Math.round((used / total) * 100);
  const GiB = 1024 ** 3;
  return {
    percent,
    field: {
      name: "メモリ使用率",
      value: `${percent}% (${(used / GiB).toFixed(1)}GB / ${(total / GiB).toFixed(1)}GB)`,
    },
  };
}

let prev: Map<string, KnownPlayer> | null = null; // 初回は通知しない
let serverWasDown = false;
let memoryWasHigh = false;

/** VPSホストのメモリひっ迫を検知(しきい値超えの瞬間だけ1回通知) */
async function checkMemory(mem: ReturnType<typeof readMemory>): Promise<void> {
  if (mem.percent >= MEM_THRESHOLD_PERCENT) {
    if (!memoryWasHigh) {
      memoryWasHigh = true;
      await discord.send({
        ...baseEmbed(),
        color: COLOR.memWarn,
        description: "⚠️ **メモリ使用率が逼迫しています**",
        fields: [mem.field],
      });
    }
  } else {
    memoryWasHigh = false;
  }
}

async function tick(): Promise<void> {
  const mem = readMemory();
  await checkMemory(mem);

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
      fields: [onlineField(current), mem.field],
    });
  }

  const before = prev;
  if (before !== null) {
    // 人数が同じでも入れ替わりがあれば変化とみなす
    const changed =
      current.size !== before.size ||
      [...current.keys()].some((id) => !before.has(id));

    if (changed) {
      await discord.send({
        ...baseEmbed(),
        color: COLOR.info,
        title: "オンラインプレイヤー",
        fields: [onlineField(current), mem.field],
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
