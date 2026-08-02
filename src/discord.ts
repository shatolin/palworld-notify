export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  color?: number;
  title?: string;
  description?: string;
  fields?: EmbedField[];
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  timestamp?: string;
}

export const COLOR = {
  info: 0x5865f2, // ブループル (通常のオンライン状況・復旧)
  warn: 0xfee75c, // 黄 (サーバーダウン)
  memWarn: 0xe67e22, // オレンジ (メモリひっ迫)
  perfWarn: 0xd35400, // 濃いオレンジ (サーバーFPS低下)
} as const;

/** Discord WebhookへのEmbed送信クライアント */
export class DiscordWebhook {
  readonly #url: string;
  readonly #username?: string;

  constructor(url: string, username?: string) {
    this.#url = url;
    this.#username = username;
  }

  /** 送信失敗はログに残すだけで例外は投げない (監視ループを止めないため) */
  async send(embed: Embed | Embed[]): Promise<void> {
    const embeds = Array.isArray(embed) ? embed : [embed];
    try {
      const res = await fetch(this.#url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this.#username, embeds }),
      });
      if (!res.ok) {
        console.error(`Webhook error: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      console.error(
        `Webhook送信に失敗: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}
