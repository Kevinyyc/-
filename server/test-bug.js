/**
 * Bug 复现 + 修复测试：第二个人进入房间后出现两个自己
 * 用 userId 验证重连不会产生重复
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function makeClient() { return io(URL, { transports: ['websocket'] }); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // === A 创建房间（userId=u-A）===
  const a1 = makeClient();
  await new Promise(r => a1.on('connect', r));
  const snaps = { a2: [], b2: [] };
  a1.on('game_update', s => { /* a1 不用 */ });

  const cr = await new Promise(r => a1.emit('create_room', { name: 'A', userId: 'u-A' }, r));
  console.log('[A] create:', cr);

  // A 跳转页面
  a1.disconnect();
  await delay(50);

  const a2 = makeClient();
  await new Promise(r => a2.on('connect', r));
  a2.on('game_update', s => snaps.a2.push(s));
  const ar = await new Promise(r => a2.emit('join_room', { roomId: cr.roomId, name: 'A', userId: 'u-A' }, r));
  console.log('[A] rejoin:', ar);
  if (!ar.reconnected) throw new Error('A rejoin should be reconnected');

  await delay(50);

  // === B 加入 + 跳转（模拟时序问题）===
  const b1 = makeClient();
  await new Promise(r => b1.on('connect', r));
  b1.on('game_update', s => { /* b1 不用 */ });

  const bj = await new Promise(r => b1.emit('join_room', { roomId: cr.roomId, name: 'B', userId: 'u-B' }, r));
  console.log('[B] join:', bj);

  await delay(50);

  // B 的新连接先到，旧连接后断
  const b2 = makeClient();
  await new Promise(r => b2.on('connect', r));
  b2.on('game_update', s => snaps.b2.push(s));
  const bj2 = await new Promise(r => b2.emit('join_room', { roomId: cr.roomId, name: 'B', userId: 'u-B' }, r));
  console.log('[B] rejoin (新连接先到):', bj2);
  if (!bj2.reconnected) throw new Error('B rejoin should be reconnected');

  await delay(20);
  b1.disconnect();
  await delay(100);

  // === 验证：A 视角不应有重复 ===
  const lastA = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] 座位:', lastA.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  const nameCount = {};
  for (const s of lastA.seats) {
    if (s) nameCount[s.name] = (nameCount[s.name] || 0) + 1;
  }
  console.log('[A 视角] 名字计数:', nameCount);
  for (const [name, count] of Object.entries(nameCount)) {
    if (count > 1) throw new Error(`❌ 名字 "${name}" 出现了 ${count} 次`);
  }
  console.log('✅ 没有重复玩家');

  // === 3 人开局，游戏中重连 ===
  const c = makeClient();
  await new Promise(r => c.on('connect', r));
  const cj = await new Promise(r => c.emit('join_room', { roomId: cr.roomId, name: 'C', userId: 'u-C' }, r));
  console.log('[C] join:', cj);

  await delay(200);

  // B 游戏中断线
  b2.disconnect();
  await delay(100);
  const afterDisc = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] B 断线后:', afterDisc.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  // B 重新加入
  const b3 = makeClient();
  await new Promise(r => b3.on('connect', r));
  const bj3 = await new Promise(r => b3.emit('join_room', { roomId: cr.roomId, name: 'B', userId: 'u-B' }, r));
  console.log('[B] 游戏中重连:', bj3);
  if (!bj3.reconnected) throw new Error('B 游戏中重连 should be reconnected');

  await delay(100);
  const finalState = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] B 重连后:', finalState.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  const finalCount = {};
  for (const s of finalState.seats) {
    if (s) finalCount[s.name] = (finalCount[s.name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(finalCount)) {
    if (count > 1) throw new Error(`❌ "${name}" 重复 ${count} 次`);
  }
  if (finalCount['B'] !== 1) throw new Error(`B 应有 1 个，实际 ${finalCount['B']}`);
  console.log('✅ 游戏中重连正常，无重复');

  a2.disconnect();
  c.disconnect();
  b3.disconnect();
  await delay(100);
  process.exit(0);
})().catch(e => { console.error('失败:', e); process.exit(1); });
