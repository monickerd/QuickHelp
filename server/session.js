const { generateRoomId } = require('./wordlist');

// rooms: Map<roomId, { peers: [WebSocket|null, WebSocket|null], createdAt: number }>
const rooms = new Map();

const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

function createRoom() {
  let id;
  do { id = generateRoomId(); } while (rooms.has(id));
  rooms.set(id, { peers: [null, null], createdAt: Date.now() });
  return id;
}

function getRoom(id) { return rooms.get(id) || null; }
function deleteRoom(id) { rooms.delete(id); }

// Returns 0 or 1, or -1 if room is full / doesn't exist
function claimSlot(id) {
  const room = rooms.get(id);
  if (!room) return -1;
  const slot = room.peers.indexOf(null);
  return slot;
}

function setPeer(id, slot, ws) {
  const room = rooms.get(id);
  if (room) room.peers[slot] = ws;
}

function getOtherPeer(id, slot) {
  const room = rooms.get(id);
  return room ? (room.peers[slot === 0 ? 1 : 0] ?? null) : null;
}

function isRoomEmpty(id) {
  const room = rooms.get(id);
  return room ? room.peers.every(p => p === null) : true;
}

function purgeStaleRooms() {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(id);
  }
}

setInterval(purgeStaleRooms, 30 * 60 * 1000);

module.exports = { createRoom, getRoom, deleteRoom, claimSlot, setPeer, getOtherPeer, isRoomEmpty };
