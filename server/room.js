const { Game } = require('./game');

const ROOM_KEEP_ALIVE_MS = 10 * 60 * 1000; // 空房间保留 10 分钟

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Game
    this.playerToRoom = new Map(); // playerId -> roomId
    // 定时清理：每分钟扫描一次
    setInterval(() => this._gc(), 60 * 1000);
  }

  createRoom() {
    let id;
    do {
      id = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (this.rooms.has(id));
    this.rooms.set(id, new Game(id));
    console.log(`[room ${id}] created`);
    return id;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  join(roomId, playerId, playerName) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    // 已经在该房间（重连）
    if (this.playerToRoom.get(playerId) === roomId) {
      const seat = room.reconnect(playerId);
      return { ok: true, roomId, seat, reconnected: true };
    }
    const r = room.sitDown(playerId, playerName);
    if (r.ok) {
      this.playerToRoom.set(playerId, roomId);
    }
    return { ok: r.ok, error: r.error, roomId, seat: r.seat };
  }

  leave(playerId) {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (room) {
      room.leaveSeat(playerId);
      console.log(`[room ${roomId}] seat left, remaining: ${room.seats.filter(Boolean).length}`);
    }
    this.playerToRoom.delete(playerId);
    // 房间没人了，保留 10 分钟再清理（允许跳页/重连）
  }

  _gc() {
    const now = Date.now();
    for (const [id, room] of this.rooms.entries()) {
      const hasPeople = room.seats.some((s) => s !== null);
      if (hasPeople) continue;
      if (now - room.createdAt > ROOM_KEEP_ALIVE_MS) {
        this.rooms.delete(id);
        console.log(`[room ${id}] gc deleted (空房间超过 ${ROOM_KEEP_ALIVE_MS / 1000}s)`);
      }
    }
  }

  getRoomOf(playerId) {
    const id = this.playerToRoom.get(playerId);
    if (!id) return null;
    return this.rooms.get(id);
  }
}

module.exports = { RoomManager };
