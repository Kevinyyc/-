const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager } = require('./room');

const PORT = process.env.PORT || 3000;
const IDLE_TIMEOUT_MS = 60000; // 60 秒超时自动托管（抢地主 + 出牌都用）

const app = express();
// 禁用缓存，确保浏览器每次拿到最新前端代码
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  },
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const manager = new RoomManager();

// 托管定时器：userId -> Timer
const idleTimers = new Map();

function clearIdle(userId) {
  const t = idleTimers.get(userId);
  if (t) clearTimeout(t);
  idleTimers.delete(userId);
}

function armIdle(userId, roomId) {
  clearIdle(userId);
  const t = setTimeout(() => {
    const room = manager.getRoomOfUser(userId);
    if (!room || room.roomId !== roomId) return;
    const seat = room.seats.findIndex((s) => s && s.userId === userId);
    if (seat === -1) return;
    if (room.state === 'bidding' && room.currentBidder === seat) {
      const r = room.bid(userId, 'pass');
      if (r.ok) {
        io.to(roomId).emit('game_update', room.getSnapshot());
        const s = room.seats[seat];
        io.to(roomId).emit('toast', { msg: `${s.name} 超时未叫，自动放弃` });
        if (room.state === 'playing' || room.state === 'bidding') {
          armRoomIdles(roomId);
        }
      }
    } else if (room.state === 'playing' && room.curSeat === seat) {
      const action = room.autoPlay(seat);
      if (action) {
        const r = room.play(userId, action.cards, action.pass);
        if (r.ok) {
          io.to(roomId).emit('game_update', room.getSnapshot());
          if (r.event === 'play_and_finish') {
            const winnerSeat = room.history[room.history.length - 1].winnerSeat;
            io.to(roomId).emit('game_over', { winner: room.winner, winnerSeat, landlord: room.landlordSeat });
          }
          armRoomIdles(roomId);
        }
      }
    }
  }, IDLE_TIMEOUT_MS);
  idleTimers.set(userId, t);
}

function armRoomIdles(roomId) {
  const room = manager.getRoom(roomId);
  if (!room) return;
  for (const s of room.seats) {
    if (s && s.connected) armIdle(s.userId, roomId);
  }
}

function broadcastRoom(roomId) {
  const room = manager.getRoom(roomId);
  if (!room) return;
  let count = 0;
  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    if (!s) continue;
    // 找到该 userId 对应的 socket（最新连接）
    let sockId = null;
    for (const [id, uid] of manager.socketToUser.entries()) {
      if (uid === s.userId) { sockId = id; break; }
    }
    if (!sockId) continue;
    const sock = io.sockets.sockets.get(sockId);
    if (sock && sock.connected) {
      sock.emit('game_update', room.getSnapshot(i));
      count++;
    }
  }
  if (room.state === 'bidding' || room.state === 'playing') {
    console.log(`[room ${roomId}] broadcast state=${room.state} → ${count} sockets`);
    require('fs').appendFileSync('debug.log', `[${new Date().toISOString()}] room ${roomId} broadcast state=${room.state} → ${count} sockets\n`);
  }
}

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id}`);

  socket.on('create_room', ({ name, userId }, cb) => {
    if (!name || !name.trim()) return cb && cb({ ok: false, error: '请输入昵称' });
    if (!userId) return cb && cb({ ok: false, error: '缺少 userId' });
    const roomId = manager.createRoom();
    const r = manager.join(roomId, socket.id, userId, name.trim().slice(0, 12));
    if (r.ok) {
      socket.join(roomId);
      cb && cb({ ok: true, roomId, seat: r.seat, reconnected: !!r.reconnected });
      broadcastRoom(roomId);
    } else {
      cb && cb({ ok: false, error: r.error });
    }
  });

  socket.on('join_room', ({ roomId, name, userId }, cb) => {
    if (!name || !name.trim()) return cb && cb({ ok: false, error: '请输入昵称' });
    if (!roomId) return cb && cb({ ok: false, error: '请输入房间号' });
    if (!userId) return cb && cb({ ok: false, error: '缺少 userId' });
    const r = manager.join(roomId.toUpperCase(), socket.id, userId, name.trim().slice(0, 12));
    if (r.ok) {
      socket.join(r.roomId);
      cb && cb({ ok: true, roomId: r.roomId, seat: r.seat, reconnected: !!r.reconnected });
      broadcastRoom(r.roomId);
      const room = manager.getRoom(r.roomId);
      if (room.state === 'playing' || room.state === 'bidding') {
        armRoomIdles(r.roomId);
      }
    } else {
      cb && cb({ ok: false, error: r.error });
    }
  });

  socket.on('bid', ({ action, userId }, cb) => {
    if (!userId) return cb && cb({ ok: false, error: '缺少 userId' });
    const room = manager.getRoomOfUser(userId);
    if (!room) return cb && cb({ ok: false, error: '未在房间' });
    const r = room.bid(userId, action);
    cb && cb(r);
    if (r.ok) {
      clearIdle(userId);
      broadcastRoom(room.roomId);
      if (room.state === 'playing') armRoomIdles(room.roomId);
    }
  });

  socket.on('play', ({ cards, pass, userId }, cb) => {
    if (!userId) return cb && cb({ ok: false, error: '缺少 userId' });
    const room = manager.getRoomOfUser(userId);
    if (!room) return cb && cb({ ok: false, error: '未在房间' });
    const r = room.play(userId, cards, pass);
    cb && cb(r);
    if (r.ok) {
      clearIdle(userId);
      broadcastRoom(room.roomId);
      if (room.state === 'finished') {
        const winnerSeat = room.history[room.history.length - 1].winnerSeat;
        io.to(room.roomId).emit('game_over', { winner: room.winner, winnerSeat, landlord: room.landlordSeat });
      } else {
        armRoomIdles(room.roomId);
      }
    }
  });

  socket.on('restart', ({ userId }, cb) => {
    if (!userId) return cb && cb({ ok: false, error: '缺少 userId' });
    const room = manager.getRoomOfUser(userId);
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
    const userId = manager.socketToUser.get(socket.id);
    const room = userId ? manager.getRoomOfUser(userId) : null;
    manager.leaveBySocket(socket.id);
    if (room) {
      broadcastRoom(room.roomId);
      io.to(room.roomId).emit('toast', { msg: '有人断开了，会自动托管' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`斗地主服务已启动: http://localhost:${PORT}`);
});
