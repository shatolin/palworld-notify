// Palworld REST API レスポンス型
// 公式リファレンス: https://docs.palworldgame.com/category/rest-api

export interface PalworldPlayer {
  /** プレイヤー名 */
  name: string;
  /** プラットフォームのアカウント名 */
  accountName: string;
  /** プレイヤーID */
  playerId: string;
  /** ユーザーID (Steam IDなど) */
  userId: string;
  /** 接続元IPアドレス */
  ip: string;
  /** ping (ms) */
  ping: number;
  /** ワールド座標X */
  location_x: number;
  /** ワールド座標Y */
  location_y: number;
  /** 現在のレベル */
  level: number;
  /** 所有している建築物の数 */
  building_count: number;
}

export interface PlayersResponse {
  players: PalworldPlayer[];
}

/** GET /v1/api/info */
export interface ServerInfo {
  version: string;
  servername: string;
  description: string;
  worldguid?: string;
}

/** GET /v1/api/metrics */
export interface ServerMetrics {
  serverfps: number;
  currentplayernum: number;
  serverframetime: number;
  maxplayernum: number;
  uptime: number;
  days?: number;
}
