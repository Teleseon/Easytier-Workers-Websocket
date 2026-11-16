/**
 * EasyTier 基础消息处理器
 *
 * 处理握手、心跳应答与报文转发。
 * 旧实现中模块级的 networkDigestRegistry / networkGroups 仅在 /admin 端点使用，
 * 且存在跨 Durable Object 串台与泄漏问题，现已整体移除。
 *
 * @file basic_handlers.js
 */

import { MAGIC, VERSION, MY_PEER_ID, PacketType } from './constants.js';
import { createHeader } from './packet.js';
import { wrapPacket, randomU64String } from './crypto.js';

const WS_OPEN = 1;

function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * @param {object} ws
 * @param {object} header
 * @param {Uint8Array} payload
 * @param {object} ctx { config, types, pm, globalState }
 * @returns {boolean} 握手是否成功
 */
function handleHandshake(ws, header, payload, ctx) {
  const { config, types, pm } = ctx;

  let req;
  try {
    req = types.HandshakeRequest.decode(payload);
  } catch (e) {
    ws.close(1002, 'Bad handshake');
    return false;
  }

  if (req.magic !== MAGIC) {
    ws.close(1008, 'Magic mismatch');
    return false;
  }

  // 拒绝客户端自称服务端 ID 或使用无效 ID
  if (!req.myPeerId || req.myPeerId === MY_PEER_ID) {
    ws.close(1008, 'Invalid peer id');
    return false;
  }

  const clientNetworkName = req.networkName || '';
  if (clientNetworkName.length > 64) {
    ws.close(1008, 'Network name too long');
    return false;
  }

  // 私有模式：配置了网络名就只接受同名客户端
  if (config.networkName && clientNetworkName !== config.networkName) {
    ws.close(1008, 'Network name mismatch');
    return false;
  }

  // 密钥摘要必须是固定 32 字节（或完全不提供），否则无法作为稳定的分组标识，
  // 同时避免任意长度的摘要进入 groupKey 与日志
  if (req.networkSecretDigrest && req.networkSecretDigrest.length !== 32) {
    ws.close(1008, 'Invalid network secret digest');
    return false;
  }

  const isPublicServer = !config.networkName;
  const serverNetworkName = config.networkName || config.publicServerNetworkName;
  const digestHex = toHex(req.networkSecretDigrest || new Uint8Array(0));

  ws.domainName = clientNetworkName;
  ws.groupKey = `${clientNetworkName}:${digestHex}`;
  ws.peerId = req.myPeerId;

  if (!pm.addPeer(req.myPeerId, ws)) {
    ws.close(1013, 'Too many peers');
    return false;
  }

  // 先回握手，再推路由；同一个 WebSocket 上消息有序，客户端会先看到握手响应
  const respPayload = {
    magic: MAGIC,
    myPeerId: MY_PEER_ID,
    version: VERSION,
    networkName: serverNetworkName,
    // 注意：官方 proto 里这个字段拼写就是 Digrest
    networkSecretDigrest: new Uint8Array(32),
  };
  const respBuffer = types.HandshakeRequest.encode(respPayload).finish();
  ws.send(wrapPacket(createHeader, MY_PEER_ID, req.myPeerId, PacketType.HandShake, respBuffer, ws));

  pm.updatePeerInfo(ws.groupKey, req.myPeerId, {
    peerId: req.myPeerId,
    version: 1,
    lastUpdate: { seconds: Math.floor(Date.now() / 1000), nanos: 0 },
    instId: { part1: 0, part2: 0, part3: 0, part4: 0 },
    networkLength: Number(config.networkLength || 24),
  });
  pm.setPublicServerFlag(isPublicServer);

  if (!ws.serverSessionId) ws.serverSessionId = randomU64String();
  if (ws.weAreInitiator === undefined) ws.weAreInitiator = false;

  pm.pushRouteUpdateTo(req.myPeerId, ws, types, { forceFull: true });
  // 广播时排除新节点，避免它同一轮收到两份全量路由
  pm.broadcastRouteUpdate(types, ws.groupKey, req.myPeerId, { forceFull: true });

  if (config.debug) {
    console.log(`[Handshake] peer=${req.myPeerId} network="${clientNetworkName}" group=${ws.groupKey}`);
  }
  return true;
}

function handlePing(ws, header, payload, ctx) {
  const msg = wrapPacket(createHeader, MY_PEER_ID, header.fromPeerId, PacketType.Pong, payload, ws);
  ws.send(msg);
}

function handleForwarding(sourceWs, header, fullMessage, ctx) {
  const { config, types, pm } = ctx;

  if (config.disableRelay && header.packetType === PacketType.Data) {
    return; // 纯 P2P 模式：不中转数据面
  }

  const targetWs = pm.getPeerWs(header.toPeerId, sourceWs && sourceWs.groupKey);
  if (!targetWs || targetWs.readyState !== WS_OPEN) {
    return;
  }

  // 禁止跨网络组转发
  if (sourceWs && targetWs.groupKey && sourceWs.groupKey && targetWs.groupKey !== sourceWs.groupKey) {
    return;
  }

  try {
    targetWs.send(fullMessage);
  } catch (e) {
    pm.removePeer(targetWs);
    try {
      pm.broadcastRouteUpdate(types, sourceWs && sourceWs.groupKey, null, { forceFull: true });
    } catch (_) {
      // 广播失败不影响当前处理
    }
  }
}

export { handleHandshake, handlePing, handleForwarding };
