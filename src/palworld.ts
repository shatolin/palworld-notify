import type {
  PalworldPlayer,
  PlayersResponse,
  ServerInfo,
  ServerMetrics,
} from "./types.ts";

/** 応答が返らないままtickが積み重なるのを防ぐ打ち切り時間 */
const TIMEOUT_MS = 10_000;

/** Palworld公式REST APIの薄いクライアント */
export class PalworldApi {
  readonly #baseUrl: string;
  readonly #authHeader: string;

  constructor(baseUrl: string, adminPassword: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#authHeader =
      "Basic " + Buffer.from(`admin:${adminPassword}`).toString("base64");
  }

  async #get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      headers: { Authorization: this.#authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Palworld API error: HTTP ${res.status} (${path})`);
    return (await res.json()) as T;
  }

  async #post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.#authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Palworld API error: HTTP ${res.status} (${path})`);
  }

  async getPlayers(): Promise<PalworldPlayer[]> {
    const data = await this.#get<PlayersResponse>("/players");
    return data.players ?? [];
  }

  getInfo(): Promise<ServerInfo> {
    return this.#get<ServerInfo>("/info");
  }

  getMetrics(): Promise<ServerMetrics> {
    return this.#get<ServerMetrics>("/metrics");
  }

  /** ゲーム内アナウンスを送信 (将来のDiscord→ゲーム内通知用) */
  announce(message: string): Promise<void> {
    return this.#post("/announce", { message });
  }
}
