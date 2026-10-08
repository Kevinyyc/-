const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager } = require('./room');
const rules = require('./rules');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const manager = new RoomManager();

// 15 秒未操作自动出牌
const IDLE_TIMEOUT_MS = 15000;
const idleTimers = new Map(); // playerId -> timer

function clearIdle(playerId) {
  const t = idleTimers.get(playerId);
  if (t) clearTimeout(t);
  idleTimers.delete(playerId);
}

function armIdle(playerId) {
  clearIdle(playerId);
  const t = setTimeout(() => {
    const room = manager.getRoomOf(playerId);
    if (!room) return;
    const seat = room.seats.findIndex((s) => s && s.id === playerId);
    if (seat === -1) return;
    if (room.state === 'bidding' && room.currentBidder === seat) {
      // 抢地主超时：自动 pass
      const r = room.bid(playerId, 'pass');
      if (r.ok) {
        io.to(room.roomId).emit('game_update', room.getSnapshot());
        io.to(room.roomId).emit('toast', { msg: `${room.seats[seat].name} 超时未叫，自动放弃` });
        if (room.state === 'playing') {
          armAllIdles();
        } else if (room.state === 'finished') {
          // 抢地主三家都 pass 后会重新发牌
          armAllIdles();
        }
      }
    } else if (room.state === 'playing' && room.curSeat === seat) {
      // 出牌超时：托管
      const action = room.autoPlay(seat);
      if (action) {
        const r = room.play(playerId, action.cards, action.pass);
        if (r.ok) {
          io.to(room.roomId).emit('game_update', room.getSnapshot());
          if (r.event === 'play_and_finish') {
            io.to(room.roomId).emit('game_over', { winner: room.winner, landlord: room.landlordSeat });
          }
          armAllIdles();
        }
      }
    }
  }, IDLE_TIMEOUT_MS);
  idleTimers.set(playerId, t);
}

function armAllIdles() {
  const room = manager.rooms; // 当前所有
  // 简化：只对最后一个活跃房间 arm；这里改为遍历该房间座位
  // 实际由调用方指定 roomId
}

function armRoomIdles(roomId) {
  const room = manager.getRoom(roomId);
  if (!room) return;
  for (const s of room.seats) {
    if (s && s.connected) armIdle(s.id);
  }
}

function broadcastRoom(roomId) {
  const room = manager.getRoom(roomId);
  if (!room) return;
  // 给每个玩家发各自的快照
  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    if (!s) continue;
    const sock = io.sockets.sockets.get(s.id);
    if (sock) {
      sock.emit('game_update', room.getSnapshot(i));
    }
  }
}

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id}`);

  socket.on('create_room', ({ name }, cb) => {
    if (!name || !name.trim()) return cb && cb({ ok: false, error: '请输入昵称' });
    const roomId = manager.createRoom();
    const r = manager.join(roomId, socket.id, name.trim().slice(0, 12));
    if (r.ok) {
      socket.join(roomId);
      cb && cb({ ok: true, roomId, seat: r.seat });
      broadcastRoom(roomId);
    } else {
      cb && cb({ ok: false, error: r.error });
    }
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    if (!name || !name.trim()) return cb && cb({ ok: false, error: '请输入昵称' });
    if (!roomId) return cb && cb({ ok: false, error: '请输入房间号' });
    const r = manager.join(roomId.toUpperCase(), socket.id, name.trim().slice(0, 12));
    if (r.ok) {
      socket.join(r.roomId);
      cb && cb({ ok: true, roomId: r.roomId, seat: r.seat, reconnected: !!r.reconnected });
      broadcastRoom(r.roomId);
      if (manager.getRoom(r.roomId).state === 'playing') {
        armRoomIdles(r.roomId);
      } else if (manager.getRoom(r.roomId).state === 'bidding') {
        armRoomIdles(r.roomId);
      }
    } else {
      cb && cb({ ok: false, error: r.error });
    }
  });

  socket.on('bid', ({ action }, cb) => {
    const room = manager.getRoomOf(socket.id);
    if (!room) return cb && cb({ ok: false, error: '未在房间' });
    const r = room.bid(socket.id, action);
    cb && cb(r);
    if (r.ok) {
      clearIdle(socket.id);
      broadcastRoom(room.roomId);
      if (room.state === 'playing') armRoomIdles(room.roomId);
    }
  });

  socket.on('play', ({ cards, pass }, cb) => {
    const room = manager.getRoomOf(socket.id);
    if (!room) return cb && cb({ ok: false, error: '未在房间' });
    const r = room.play(socket.id, cards, pass);
    cb && cb(r);
    if (r.ok) {
      clearIdle(socket.id);
      broadcastRoom(room.roomId);
      if (room.state === 'finished') {
        // 通知前端
        const winnerSeat = room.history[room.history.length - 1].winnerSeat;
        io.to(room.roomId).emit('game_over', { winner: room.winner, winnerSeat, landlord: room.landlordSeat });
      } else {
        armRoomIdles(room.roomId);
      }
    }
  });

  socket.on('restart', (_x, cb) => {
    const room = manager.getRoomOf(socket.id);
    if (!room) return cb && cb({ ok: false, error: '未在房间' });
    const r = room.restart();
    cb && cb(r);
    if (r.ok) {
      broadcastRoom(room.roomId);
      armRoomIdles(room.roomId);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[disc] ${socket.id}`);
    // 注意：不要 clearIdle，让超时自动出牌继续生效（断线 = 离线托管）
    const room = manager.getRoomOf(socket.id);
    if (room) {
      manager.leave(socket.id);
      // 通知房间其他人
      io.to(room.roomId).emit('toast', { msg: '有人断开了，TA 会被自动托管' });
      broadcastRoom(room.roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`斗地主服务已启动: http://localhost:${PORT}`);
});
