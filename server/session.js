const { generateRoomId } = require('./wordlist');

// rooms: Map<roomId, {
//   peers:      [WebSocket|null, WebSocket|null],
//   clientIds:  [string|null,    string|null],   // stable per-client identity (for reconnect)
//   createdAt:  number,
//   lastRestartAt: number,                        // debounce for server-coordinated restarts
// }>
const rooms = new Map();

const ROOM_TTL_MS        = 4 * 60 * 60 * 1000;
const ROOM_GRACE_MS      = 30 * 1000;
const RESTART_DEBOUNCE_MS = 2000;
const WS_OPEN            = 1; // WebSocket.OPEN — avoids importing ws here

function createRoom() {
  let id;
  do { id = generateRoomId(); } while (rooms.has(id));
  rooms.set(id, {
    peers:        [null, null],
    clientIds:    [null, null],
    createdAt:    Date.now(),
    lastRestartAt: 0,
    deleteTimer:  null,
  });
  return id;
}

function getRoom(id) { return rooms.get(id) || null; }
function deleteRoom(id) { rooms.delete(id); }

// Decide which slot a connecting socket should occupy.
// Returns { slot, evict } where:
//   slot  = 0 | 1, or -1 if the room is full with two live peers / doesn't exist
//   evict = an existing socket that must be closed because we're taking its slot
//           (its own reconnect, or a stale/dead socket), or null
//
// Reclaiming by clientId is what makes a reload / dropped-connection rejoin
// seamless: the same client takes its old slot back instead of being rejected.
function claimSlot(id, clientId) {
  const room = rooms.get(id);
  if (!room) return { slot: -1, evict: null };

  // 1. Reconnect: this client already holds a slot — reclaim it.
  if (clientId) {
    const mine = room.clientIds.indexOf(clientId);
    if (mine !== -1) return { slot: mine, evict: room.peers[mine] };
  }

  // 2. A free slot is available.
  const free = room.peers.indexOf(null);
  if (free !== -1) return { slot: free, evict: null };

  // 3. No free slot, but one is held by a socket that's already closed/closing.
  const stale = room.peers.findIndex(ws => !ws || ws.readyState !== WS_OPEN);
  if (stale !== -1) return { slot: stale, evict: room.peers[stale] };

  // 4. Genuinely full with two live peers.
  return { slot: -1, evict: null };
}

function setPeer(id, slot, ws, clientId) {
  const room = rooms.get(id);
  if (room) {
    room.peers[slot]     = ws;
    room.clientIds[slot] = clientId ?? null;
    if (room.deleteTimer) { clearTimeout(room.deleteTimer); room.deleteTimer = null; }
  }
}

function scheduleDelete(id) {
  const room = rooms.get(id);
  if (!room || room.deleteTimer) return;
  room.deleteTimer = setTimeout(() => deleteRoom(id), ROOM_GRACE_MS);
}

// Clear a slot, but only if it still points at `ws`. After an eviction the slot
// already holds the replacement socket, so the evicted socket's close handler
// must not wipe it.
function clearPeer(id, slot, ws) {
  const room = rooms.get(id);
  if (!room || room.peers[slot] !== ws) return false;
  room.peers[slot]     = null;
  room.clientIds[slot] = null;
  return true;
}

function getOtherPeer(id, slot) {
  const room = rooms.get(id);
  return room ? (room.peers[slot === 0 ? 1 : 0] ?? null) : null;
}

function bothPresent(id) {
  const room = rooms.get(id);
  return !!room && room.peers[0] && room.peers[1];
}

function isRoomEmpty(id) {
  const room = rooms.get(id);
  return room ? room.peers.every(p => p === null) : true;
}

// Rate-limit server-coordinated restarts so two peers both asking at once
// (or a flaky link) can't trigger a reset storm. Returns true if allowed.
function allowRestart(id) {
  const room = rooms.get(id);
  if (!room) return false;
  const now = Date.now();
  if (now - room.lastRestartAt < RESTART_DEBOUNCE_MS) return false;
  room.lastRestartAt = now;
  return true;
}

function purgeStaleRooms() {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(id);
  }
}

setInterval(purgeStaleRooms, 30 * 60 * 1000);

module.exports = {
  createRoom, getRoom, deleteRoom, scheduleDelete,
  claimSlot, setPeer, clearPeer, getOtherPeer,
  bothPresent, isRoomEmpty, allowRestart,
};
