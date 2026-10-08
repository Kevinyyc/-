/**
 * 模拟主页 -> 跳转 -> room.html 的完整流程
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

(async () => {
  // === 主页 ===
  const mainSock = io(URL, { transports: ['websocket'] });
  await new Promise(r => mainSock.on('connect', r));
  console.log('[main] connected, id:', mainSock.id);

  const createResp = await new Promise(r => mainSock.emit('create_room', { name: '测试用户', userId: 'u-main' }, r));
  console.log('[main] create_room response:', createResp);
  if (!createResp.ok) {
    console.log('❌ 创建房间失败');
    process.exit(1);
  }

  console.log('[main] 跳转到 /room.html?room=' + createResp.roomId);
  mainSock.disconnect();
  await new Promise(r => setTimeout(r, 200));

  // === 牌桌页 ===
  const roomSock = io(URL, { transports: ['websocket'] });
  await new Promise(r => roomSock.on('connect', r));
  console.log('[room] connected, id:', roomSock.id);

  const joinResp = await new Promise(r => roomSock.emit('join_room', { roomId: createResp.roomId, name: '测试用户', userId: 'u-main' }, r));
  console.log('[room] join_room response:', joinResp);

  if (!joinResp.ok) {
    console.log('❌ 加入房间失败:', joinResp.error);
    process.exit(1);
  }

  if (!joinResp.reconnected) throw new Error('应该返回 reconnected: true');
  console.log('✅ 完整流程通过（reconnected: true 表明用 userId 正确重连了）');

  roomSock.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
