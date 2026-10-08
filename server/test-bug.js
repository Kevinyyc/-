/**
 * Bug 复现 + 修复测试：第二个人进入房间后出现两个自己
 *
 * 场景：
 * 1. A 创建房间（seat 0）
 * 2. A 跳转页面（断+重连，模拟时序问题）
 * 3. B 加入（主页 socket Z）
 * 4. B 跳转页面（断+重连，**模拟新连接先到、旧连接后断**）
 * 5. 验证：房间里应该只有 A 和 B 各一个，不能有「两个 B」
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function makeClient() { return io(URL, { transports: ['websocket'] }); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // === A 创建房间 ===
  const a1 = makeClient();
  await new Promise(r => a1.on('connect', r));
  const snaps = { a1: [], a2: [], b1: [], b2: [] };
  a1.on('game_update', s => snaps.a1.push(s));

  const cr = await new Promise(r => a1.emit('create_room', { name: 'A' }, r));
  console.log('[A] create:', cr);

  // 模拟 A 跳转页面（先 disconnect 旧的，再 connect 新的）
  a1.disconnect();
  await delay(50);

  const a2 = makeClient();
  await new Promise(r => a2.on('connect', r));
  a2.on('game_update', s => snaps.a2.push(s));
  const ar = await new Promise(r => a2.emit('join_room', { roomId: cr.roomId, name: 'A' }, r));
  console.log('[A] rejoin:', ar);
  if (!ar.ok) throw new Error('A rejoin failed');

  await delay(50);

  // === B 加入（模拟时序问题：B 的新连接先到，旧连接后断）===
  const b1 = makeClient();
  await new Promise(r => b1.on('connect', r));
  b1.on('game_update', s => snaps.b1.push(s));

  // B 主页 join
  const bj = await new Promise(r => b1.emit('join_room', { roomId: cr.roomId, name: 'B' }, r));
  console.log('[B] join:', bj);
  if (!bj.ok) throw new Error('B join failed');

  await delay(50);

  // **模拟时序问题**：B 的新连接先连上并 join，旧的 socket 后断
  const b2 = makeClient();
  await new Promise(r => b2.on('connect', r));
  b2.on('game_update', s => snaps.b2.push(s));
  const bj2 = await new Promise(r => b2.emit('join_room', { roomId: cr.roomId, name: 'B' }, r));
  console.log('[B] rejoin (新连接先到):', bj2);

  // 现在才让旧 socket 断
  await delay(20);
  b1.disconnect();
  await delay(100);

  // === 验证：从 A 的视角看，不应该有重复的玩家 ===
  // 拿到 server 端的房间状态
  const lastA = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] 座位:', lastA.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  // 统计每个名字出现的次数
  const nameCount = {};
  for (const s of lastA.seats) {
    if (s) nameCount[s.name] = (nameCount[s.name] || 0) + 1;
  }
  console.log('[A 视角] 名字计数:', nameCount);

  for (const [name, count] of Object.entries(nameCount)) {
    if (count > 1) {
      throw new Error(`❌ 名字 "${name}" 出现了 ${count} 次！bug 没修好`);
    }
  }
  console.log('✅ 没有重复玩家');

  // === 加入 C，3 人开局，验证游戏中重连不会导致重复 ===
  const c = makeClient();
  await new Promise(r => c.on('connect', r));
  const cj = await new Promise(r => c.emit('join_room', { roomId: cr.roomId, name: 'C' }, r));
  console.log('[C] join:', cj);
  if (!cj.ok) throw new Error('C join failed');

  await delay(200);
  const stateMid = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] 3 人开局后状态:', stateMid.state, '座位:', stateMid.seats.map(s => s?.name || '空'));

  // === 游戏中：B 模拟断线（不重连），验证不会出现重复 ===
  b2.disconnect();
  await delay(100);
  const stateAfterDisc = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] B 断线后:', stateAfterDisc.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  // === B 重新加入，验证接管离线座位 ===
  const b3 = makeClient();
  await new Promise(r => b3.on('connect', r));
  const bj3 = await new Promise(r => b3.emit('join_room', { roomId: cr.roomId, name: 'B' }, r));
  console.log('[B] 游戏中重连:', bj3);
  if (!bj3.ok) throw new Error('B 游戏中重连失败');

  await delay(100);
  const finalState = snaps.a2[snaps.a2.length - 1];
  console.log('[A 视角] B 重连后:', finalState.seats.map((s, i) => s ? `${i}:${s.name}(${s.connected ? '在线' : '离线'})` : `${i}:空`));

  // 验证
  const finalCount = {};
  for (const s of finalState.seats) {
    if (s) finalCount[s.name] = (finalCount[s.name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(finalCount)) {
    if (count > 1) throw new Error(`❌ "${name}" 重复 ${count} 次`);
  }
  if (finalCount['B'] !== 1) throw new Error(`B 应该有 1 个，实际 ${finalCount['B']}`);
  console.log('✅ 游戏中重连正常，无重复');

  a2.disconnect();
  c.disconnect();
  b3.disconnect();
  await delay(100);
  process.exit(0);
})().catch(e => { console.error('失败:', e); process.exit(1); });
