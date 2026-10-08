/**
 * 出牌顺序 bug 测试
 * 场景：A 出牌 → B pass → C pass → 应该回到 A 自由出牌
 * bug：当前 curSeat 会留在 C，导致 C 自由出牌
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function makeClient() { return io(URL, { transports: ['websocket'] }); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rankOf(c) { return c < 52 ? c % 13 : 13 + (c - 52); }

(async () => {
  const a = makeClient(); const b = makeClient(); const c = makeClient();
  await Promise.all([new Promise(r => a.on('connect', r)), new Promise(r => b.on('connect', r)), new Promise(r => c.on('connect', r))]);

  const snaps = { 0: [], 1: [], 2: [] };
  a.on('game_update', s => snaps[0].push(s));
  b.on('game_update', s => snaps[1].push(s));
  c.on('game_update', s => snaps[2].push(s));

  // 3 人开局
  const cr = await new Promise(r => a.emit('create_room', { name: 'A', userId: 'u-A' }, r));
  await new Promise(r => b.emit('join_room', { roomId: cr.roomId, name: 'B', userId: 'u-B' }, r));
  await new Promise(r => c.emit('join_room', { roomId: cr.roomId, name: 'C', userId: 'u-C' }, r));
  await delay(200);

  // A 当地主
  a.emit('bid', { action: 'bid', userId: 'u-A' });
  await delay(200);

  // === 测试出牌顺序 ===
  // A 出最小单张
  const aSnap = snaps[0][snaps[0].length - 1];
  const aHand = aSnap.myHand;
  const aCard = aHand[0];
  console.log('[A] 出:', aCard);
  a.emit('play', { cards: [aCard], pass: false, userId: 'u-A' });
  await delay(100);

  let snap = snaps[2][snaps[2].length - 1];
  console.log('A 出牌后 curSeat:', snap.curSeat, '(期望 1=B)');
  if (snap.curSeat !== 1) throw new Error('A 出牌后应轮到 B');

  // B 压不过 A 的牌（A 出的可能很大），pass
  // 找 B 手牌中所有 rank <= targetRank 的牌
  const bSnap = snaps[1][snaps[1].length - 1];
  const bHand = bSnap.myHand;
  const targetRank = aCard < 52 ? aCard % 13 : 13 + (aCard - 52);
  const bCanBeat = bHand.some(c => { const r = rankOf(c); return r > targetRank && r < 13; });
  if (bCanBeat) {
    console.log('[B] 有牌能压过，但选择 pass（测试需要）');
  }
  console.log('[B] pass');
  b.emit('play', { cards: [], pass: true, userId: 'u-B' });
  await delay(100);

  snap = snaps[2][snaps[2].length - 1];
  console.log('B pass 后 curSeat:', snap.curSeat, '(期望 2=C)');
  if (snap.curSeat !== 2) throw new Error('B pass 后应轮到 C');

  // C 也 pass
  console.log('[C] pass');
  c.emit('play', { cards: [], pass: true, userId: 'u-C' });
  await delay(100);

  snap = snaps[2][snaps[2].length - 1];
  console.log('C pass 后 curSeat:', snap.curSeat, '(期望 0=A 因为 A 是上一个出牌的)');
  if (snap.curSeat !== 0) {
    throw new Error(`❌ BUG: 两人 pass 后 curSeat 应回到 A(0)，实际是 ${snap.curSeat}`);
  }
  console.log('✅ 出牌顺序正确');

  a.disconnect(); b.disconnect(); c.disconnect();
  await delay(100);
  process.exit(0);
})().catch(e => { console.error('失败:', e); process.exit(1); });
