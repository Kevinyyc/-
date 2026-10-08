// 模拟：用户点击"创建房间" -> 跳转到 room.html -> join_room
// 验证整条链路
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

(async () => {
  // === 主页 ===
  const mainSock = io(URL, { transports: ['websocket'] });
  await new Promise(r => mainSock.on('connect', r));
  console.log('[main] connected, id:', mainSock.id);

  // 点击"创建房间"
  const createResp = await new Promise(r => mainSock.emit('create_room', { name: '测试用户' }, r));
  console.log('[main] create_room response:', createResp);

  if (!createResp.ok) {
    console.log('❌ 创建房间失败');
    process.exit(1);
  }

  console.log('[main] 应该跳转到 /room.html?room=' + createResp.roomId);
  // 模拟：断开主页面 socket（页面跳转）
  mainSock.disconnect();
  console.log('[main] socket disconnected (页面跳转)');

  await new Promise(r => setTimeout(r, 200));

  // === 牌桌页 ===
  const roomSock = io(URL, { transports: ['websocket'] });
  await new Promise(r => roomSock.on('connect', r));
  console.log('[room] connected, id:', roomSock.id);

  // 模拟 room.html 的 join_room
  const joinResp = await new Promise(r => roomSock.emit('join_room', { roomId: createResp.roomId, name: '测试用户' }, r));
  console.log('[room] join_room response:', joinResp);

  if (!joinResp.ok) {
    console.log('❌ 加入房间失败:', joinResp.error);
    process.exit(1);
  }

  console.log('✅ 完整流程通过');

  roomSock.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
