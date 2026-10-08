const { Game } = require('./game');

const ROOM_KEEP_ALIVE_MS = 10 * 60 * 1000;

class RoomManager {
  constructor() {
    this.rooms = new Map();           // roomId -> Game
    this.playerToRoom = new Map();     // userId -> roomId (稳定，跨连接保留)
    this.socketToUser = new Map();     // socketId -> userId (临时)
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

  getRoom(id) { return this.rooms.get(id); }

  /**
   * 加入或重连
   * @param {string} roomId
   * @param {string} socketId 当前连接 id
   * @param {string} userId   稳定用户标识（前端 localStorage UUID）
   * @param {string} playerName
   */
  join(roomId, socketId, userId, playerName) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };

    // 同 userId 已在房间 → 重连路径
    if (userId && this.playerToRoom.get(userId) === roomId) {
      const seat = room.reconnect(socketId, userId, playerName);
      if (seat !== -1) {
        this.socketToUser.set(socketId, userId);
        return { ok: true, roomId, seat, reconnected: true };
      }
      // 兜底：playerToRoom 还在但房间没座位（异常），走 sitDown
    }

    // 同 socketId 已在房间（兜底）
    if (this.socketToUser.get(socketId) === roomId) {
      const seat = room.reconnect(socketId, userId, playerName);
      if (seat !== -1) {
        return { ok: true, roomId, seat, reconnected: true };
      }
    }

    // 新加入
    const r = room.sitDown(socketId, userId, playerName);
    if (r.ok) {
      this.playerToRoom.set(userId, roomId);
      this.socketToUser.set(socketId, userId);
    }
    return { ok: r.ok, error: r.error, roomId, seat: r.seat, reconnected: !!r.reconnected };
  }

  /**
   * disconnect 时调用，按 socketId 离开
   * 不删 playerToRoom（让 userId 重连可以走 reconnect 路径）
   */
  leaveBySocket(socketId) {
    const userId = this.socketToUser.get(socketId);
    this.socketToUser.delete(socketId);
    if (!userId) {
      // 兜底：遍历找座位
      for (const room of this.rooms.values()) {
        if (room._seatOfSocket(socketId) !== -1) {
          room.leaveSeatBySocket(socketId);
          return;
        }
      }
      return;
    }
    const roomId = this.playerToRoom.get(userId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (room) room.leaveSeatBySocket(socketId);
    // 不删 playerToRoom，让重连可走 reconnect
  }

  getRoomOfUser(userId) {
    const id = this.playerToRoom.get(userId);
    if (!id) return null;
    return this.rooms.get(id);
  }

  _gc() {
    const now = Date.now();
    for (const [id, room] of this.rooms.entries()) {
      const hasPeople = room.seats.some((s) => s !== null);
      if (hasPeople) continue;
      if (now - room.createdAt > ROOM_KEEP_ALIVE_MS) {
        // 清掉相关的 playerToRoom
        for (const [uid, rid] of this.playerToRoom.entries()) {
          if (rid === id) this.playerToRoom.delete(uid);
        }
        this.rooms.delete(id);
        console.log(`[room ${id}] gc deleted`);
      }
    }
  }
}

module.exports = { RoomManager };
