/**
 * 报文封装工具
 *
 * 说明：本 Worker 只做明文中继（协议模拟），不参与 EasyTier 的密钥协商，
 * 因此这里只保留实际用到的两个函数，删除了原先整套未被调用的
 * SipHash/AES-GCM/密钥派生实现。
 *
 * @file crypto.js
 */

export function randomU64String() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value.toString();
}

/**
 * 拼接 16 字节头与负载。
 *
 * @param {Function} createHeader 头部构造函数（由上层注入，避免循环依赖）
 * @param {number} fromPeerId
 * @param {number} toPeerId
 * @param {number} packetType
 * @param {Uint8Array} payload
 * @param {object} ws 目标连接，读取其 relayFlags（延迟优先标志位）
 */
export function wrapPacket(createHeader, fromPeerId, toPeerId, packetType, payload, ws) {
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const flags = (ws && ws.relayFlags) || 0;
  const headerBuf = createHeader(fromPeerId, toPeerId, packetType, body.length, flags);

  const out = new Uint8Array(headerBuf.length + body.length);
  out.set(headerBuf, 0);
  out.set(body, headerBuf.length);
  return out;
}

/**
 * 发送报文并累计出向流量。
 *
 * ws.stats 由 relay_room 在连接建立（或休眠恢复）时初始化；
 * 统计失败不应影响正常发送，因此单独 try 包裹。
 */
export function sendWithStats(ws, data) {
  try {
    let bytes = 0;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data).length;
    else if (data && data.byteLength !== undefined) bytes = data.byteLength;
    ws.stats.msgsOut += 1;
    ws.stats.bytesOut += bytes;
  } catch (_) {
    // 没有统计对象时照常发送
  }
  return ws.send(data);
}
