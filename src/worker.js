// Cloudflare Worker 入口：把 WebSocket 请求路由到 Durable Object
import { RelayRoom } from './worker/relay_room.js';
import { loadConfig, matchesWsPath } from './worker/core/config.js';

export { RelayRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    const config = loadConfig(env);
    if (!matchesWsPath(config, url.pathname)) {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    const roomId = url.searchParams.get('room') || 'default';
    const options = env.LOCATION_HINT ? { locationHint: env.LOCATION_HINT } : {};
    const roomStub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(roomId), options);
    return roomStub.fetch(request);
  },
};
