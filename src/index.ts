import { totalmem, freemem, loadavg, cpus } from "node:os";
import { PalworldApi } from "./palworld.ts";
import { DiscordWebhook, COLOR, type EmbedField } from "./discord.ts";
import type { ServerMetrics } from "./types.ts";

// ---- 設定 (環境変数) ----
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ADMIN_PASSWORD = process.env.PALWORLD_ADMIN_PASSWORD;
const API_BASE = process.env.PALWORLD_API ?? "http://127.0.0.1:8212/v1/api";
const INTERVAL = (Number(process.env.POLL_INTERVAL_SEC) || 60) * 1000;
const MEM_THRESHOLD_PERCENT = Number(process.env.MEM_THRESHOLD_PERCENT) || 85;
// 正常値60fpsの2/3。30fps設定のサーバーに載せる場合は 20 に下げること
const FPS_THRESHOLD = Number(process.env.FPS_THRESHOLD) || 40;

if (!WEBHOOK_URL || !ADMIN_PASSWORD) {
  console.error("DISCORD_WEBHOOK_URL と PALWORLD_ADMIN_PASSWORD を設定してください");
  process.exit(1);
}

const palworld = new PalworldApi(API_BASE, ADMIN_PASSWORD);
const discord = new DiscordWebhook(WEBHOOK_URL, "Palworld通知");

let serverName = "Palworld"; // /info が取れるまでの暫定値
let serverNameResolved = false;

interface KnownPlayer {
  name: string;
  level: number | undefined;
}

/** Embedのfield valueの上限 (Discord仕様) */
const FIELD_VALUE_LIMIT = 1024;
/** プレイヤー名カラムの桁数 (等幅表示)。これより長い名前は末尾を省略する */
const NAME_COLUMN = 16;
/** 等幅フォントで2桁分を占める文字 (CJK・かな・ハングル・全角記号) */
const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** 等幅表示での文字幅 */
function charWidth(ch: string): number {
  return WIDE_CHAR.test(ch) ? 2 : 1;
}

/** プレイヤー名を等幅で NAME_COLUMN 桁に揃える (レベルを縦に並べるため) */
function padName(name: string): string {
  const safe = name.replace(/`/g, "'"); // バッククォートはインラインコードを壊す
  let width = 0;
  for (const ch of safe) width += charWidth(ch);
  if (width <= NAME_COLUMN) return safe + " ".repeat(NAME_COLUMN - width);

  // 収まらないので NAME_COLUMN-1 桁まで詰めて省略記号を足す
  let out = "";
  width = 0;
  for (const ch of safe) {
    const w = charWidth(ch);
    if (width + w > NAME_COLUMN - 1) break;
    out += ch;
    width += w;
  }
  return out + "…" + " ".repeat(NAME_COLUMN - width - 1);
}

/**
 * 現在オンラインのプレイヤー一覧フィールド。
 * 引用(`> `)+ インラインコードで、左に縦線の入った等幅の一覧枠として見せる
 */
function onlineField(current: Map<string, KnownPlayer>): EmbedField {
  const name = `オンライン (${current.size}人)`;
  const players = [...current.values()];
  if (players.length === 0) return { name, value: "> `(なし)`" };

  const lines = players.map(
    (p) => `> \`${padName(p.name)} Lv.${String(p.level ?? "?").padStart(2)}\``
  );
  // 1024文字を超える分は末尾を「他N人」に畳む (行の途中で切ると枠が壊れる)
  while (lines.length > 1 && lines.join("\n").length > FIELD_VALUE_LIMIT) {
    lines.pop();
    lines[lines.length - 1] = `> \`…他${players.length - lines.length + 1}人\``;
  }
  return { name, value: lines.join("\n") };
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
      inline: true,
    },
  };
}

/** VPSホスト全体のCPU負荷。ロードアベレージ5分平均をコア数で正規化した% */
function cpuField(): EmbedField {
  const cores = cpus().length;
  const load5 = loadavg()[1] ?? 0;
  return {
    name: "CPU負荷",
    value: `${Math.round((load5 / cores) * 100)}% (load ${load5.toFixed(2)} / ${cores}コア)`,
    inline: true,
  };
}

/** サーバーFPS。metrics取得に失敗した周期では値を出さない */
function fpsField(metrics: ServerMetrics | null): EmbedField {
  return {
    name: "サーバーFPS",
    value: metrics
      ? `${metrics.serverfps} (${metrics.serverframetime.toFixed(1)}ms)`
      : "(取得失敗)",
    inline: true,
  };
}

/** サーバーの連続稼働時間 */
function uptimeField(metrics: ServerMetrics): EmbedField {
  const h = Math.floor(metrics.uptime / 3600);
  const m = Math.floor((metrics.uptime % 3600) / 60);
  return {
    name: "稼働時間",
    value: h > 0 ? `${h}時間${m}分` : `${m}分`,
    inline: true,
  };
}

/** ゲーム内経過日数 (APIバージョンによっては返らない) */
function daysField(days: number): EmbedField {
  return { name: "ゲーム内日数", value: `${days}日目`, inline: true };
}

/** オンライン一覧 + ホスト負荷3種 + 稼働状況。通常通知・復旧通知で共通 */
function statusFields(
  current: Map<string, KnownPlayer>,
  memField: EmbedField,
  metrics: ServerMetrics | null
): EmbedField[] {
  const fields = [onlineField(current), cpuField(), memField, fpsField(metrics)];
  if (metrics) {
    fields.push(uptimeField(metrics));
    if (metrics.days !== undefined) fields.push(daysField(metrics.days));
  }
  return fields;
}

let prev: Map<string, KnownPlayer> | null = null; // 初回は通知しない
let serverWasDown = false;
let memoryWasHigh = false;
let fpsWasLow = false;

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

/** サーバーFPS低下を検知(しきい値割れの瞬間だけ1回通知) */
async function checkFps(
  metrics: ServerMetrics | null,
  fields: EmbedField[]
): Promise<void> {
  if (metrics === null) return; // 取得失敗の周期は判定を持ち越す
  if (metrics.serverfps < FPS_THRESHOLD) {
    if (!fpsWasLow) {
      fpsWasLow = true;
      await discord.send({
        ...baseEmbed(),
        color: COLOR.perfWarn,
        description: "⚠️ **サーバーの処理が重くなっています**",
        fields,
      });
    }
  } else {
    fpsWasLow = false;
  }
}

async function tick(): Promise<void> {
  const mem = readMemory();
  await checkMemory(mem);

  // ダウン判定は /players のみを根拠にし、/metrics は取れなければ諦める
  const [playersResult, metricsResult] = await Promise.allSettled([
    palworld.getPlayers(),
    palworld.getMetrics(),
  ]);

  if (playersResult.status === "rejected") {
    const err = playersResult.reason;
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

  await resolveServerName(); // 起動時に取れていなければ、繋がった今のうちに
  const metrics =
    metricsResult.status === "fulfilled" ? metricsResult.value : null;
  const current = new Map(
    playersResult.value.map((p) => [
      p.userId ?? p.playerId,
      { name: p.name, level: p.level },
    ])
  );
  const fields = statusFields(current, mem.field, metrics);

  if (serverWasDown) {
    serverWasDown = false;
    await discord.send({
      ...baseEmbed(),
      color: COLOR.info,
      description: "✅ **サーバーとの接続が回復しました**",
      fields,
    });
  }

  await checkFps(metrics, fields);

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
        fields,
      });
    }
  }

  prev = current;
}

/**
 * サーバー名を /info から取得する。VPS再起動直後はPalworld側がまだ起動途中で
 * 失敗しうるため、取得できるまでポーリングのたびに試みる
 */
async function resolveServerName(): Promise<void> {
  if (serverNameResolved) return;
  try {
    const info = await palworld.getInfo();
    if (info.servername) {
      serverName = info.servername;
      serverNameResolved = true;
    }
  } catch {
    // Palworld側がまだ起動していないだけなので、次の周期で再試行する
  }
}

async function main(): Promise<void> {
  await resolveServerName();
  if (!serverNameResolved) {
    console.warn(`サーバー名を取得できず、暫定的に "${serverName}" を使用します`);
  }
  console.log(`監視開始: ${API_BASE} を ${INTERVAL / 1000} 秒ごとにポーリング`);
  void tick();
  setInterval(() => void tick(), INTERVAL);
}

void main();
