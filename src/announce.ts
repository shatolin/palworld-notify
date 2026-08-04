// 再起動予告・メンテ告知をゲーム内に流すワンショットCLI。
// 常駐プロセス(index.ts)はDISCORD_WEBHOOK_URL必須なので、そちらは読み込まない
import { DEFAULT_API_BASE, PalworldApi } from "./palworld.ts";

const USAGE = 'アナウンス本文を渡してください: npm run announce -- "20時に再起動します"';

/** fetchは失敗理由を cause に隠す ("fetch failed" だけでは接続拒否か何か分からない) */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause: unknown = err.cause;
  if (cause instanceof AggregateError && cause.errors[0] instanceof Error) {
    return `${err.message}: ${cause.errors[0].message}`;
  }
  if (cause instanceof Error) return `${err.message}: ${cause.message}`;
  return err.message;
}

/** 再起動スクリプトから成否を判定できるよう、結果は終了コードで返す */
async function main(): Promise<number> {
  // 引用符なしで複数語を渡されても1文として扱う
  const message = process.argv.slice(2).join(" ").trim();
  if (!message) {
    console.error(USAGE);
    return 1;
  }

  const adminPassword = process.env.PALWORLD_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("PALWORLD_ADMIN_PASSWORD を設定してください");
    return 1;
  }

  const palworld = new PalworldApi(
    process.env.PALWORLD_API ?? DEFAULT_API_BASE,
    adminPassword
  );

  try {
    await palworld.announce(message);
    console.log(`アナウンス送信: ${message}`);
    return 0;
  } catch (err) {
    console.error(describeError(err));
    return 1;
  }
}

// process.exit() は使わない。POSIXでは出力先がパイプ・ソケットのとき書き込みが
// 非同期なので、systemdや呼び出し元スクリプト配下だとログが出る前に落ちうる
process.exitCode = await main();
