/**
 * 统一配置加载
 *
 * 原实现里各处直接读 process.env，有两个问题：
 * 1. WS_PATH 未配置时会拼出 "/undefined"（`'/' + undefined` 是 truthy，`|| '/ws'` 永远不生效）；
 * 2. 配置散落各处，无法按 Durable Object 实例隔离或覆写。
 *
 * 现在改为 RelayRoom 构造时解析一次，向下传递。
 *
 * @file config.js
 */

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env = {}) {
  const rawPath = typeof env.WS_PATH === 'string' ? env.WS_PATH.trim() : '';
  // 空值（或只填 "/"）表示不限制路径：随便填一个链接就能连上
  const anyPath = rawPath === '' || rawPath === '/';
  const normalized = '/' + rawPath.replace(/^\/+/, '').replace(/\/+$/, '');

  return {
    // WebSocket 入口路径；空字符串表示任意路径都接受
    wsPath: anyPath ? '' : normalized,

    heartbeatIntervalMs: toInt(env.EASYTIER_HEARTBEAT_INTERVAL, 10_000),
    connectionTimeoutMs: toInt(env.EASYTIER_CONNECTION_TIMEOUT, 25_000),

    // 私有网络模式：非空时只接受同名网络
    networkName: typeof env.EASYTIER_NETWORK_NAME === 'string' ? env.EASYTIER_NETWORK_NAME.trim() : '',
    publicServerNetworkName: env.EASYTIER_PUBLIC_SERVER_NETWORK_NAME || 'public_server',
    networkLength: toInt(env.EASYTIER_NETWORK_LENGTH, 24),
    easytierVersion: env.EASYTIER_VERSION || 'Easytier-Workers-Websocket',
    hostname: env.EASYTIER_HOSTNAME || 'Easytier-Workers-Websocket',

    latencyFirst: env.EASYTIER_LATENCY_FIRST === '1',
    // 纯 P2P 模式：只做控制面转发，不转发 Data 包
    disableRelay: env.EASYTIER_DISABLE_RELAY === '1',

    sessionTtlMs: toInt(env.EASYTIER_SESSION_TTL_MS, 180_000),
    peerCenterTtlMs: toInt(env.EASYTIER_PEER_CENTER_TTL_MS, 180_000),
    ospfRouteMethodIndex: toInt(env.EASYTIER_OSPF_ROUTE_METHOD_INDEX, 1),
    handshakeMode: String(env.EASYTIER_HANDSHAKE_MODE || 'foreign').toLowerCase(),

    // 防护上限
    maxMessageBytes: toInt(env.EASYTIER_MAX_MESSAGE_BYTES, 1024 * 1024),
    maxPeersPerGroup: toInt(env.EASYTIER_MAX_PEERS_PER_GROUP, 512),

    debug: env.EASYTIER_DEBUG === '1',
  };
}

/**
 * 判断请求路径是否命中 WebSocket 入口。
 * wsPath 为空表示不限制路径（任意链接都可直连）。
 */
export function matchesWsPath(config, pathname) {
  if (!config.wsPath) return true;
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === config.wsPath;
}
