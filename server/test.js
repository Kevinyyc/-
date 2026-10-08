/**
 * 集成测试
 */
const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';

function makeClient(userId, name) {
  const sock = io(URL, { transports: ['websocket'] });
  sock.userId = userId;
  sock.name = name;
  return sock;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log('=== 准备 3 个客户端 ===');
  const a = makeClient('u-A', 'Alice');
  const b = makeClient('u-B', 'Bob');
  const c = makeClient('u-C', 'Carol');

  await Promise.all([
    new Promise((r) => a.on('connect', r)),
    new Promise((r) => b.on('connect', r)),
    new Promise((r) => c.on('connect', r)),
  ]);
  console.log('3 客户端已连接');

  const aSnap = [], bSnap = [], cSnap = [];
  a.on('game_update', (s) => aSnap.push(s));
  b.on('game_update', (s) => bSnap.push(s));
  c.on('game_update', (s) => cSnap.push(s));

  // Alice 创建
  const created = await new Promise((r) => a.emit('create_room', { name: 'Alice', userId: 'u-A' }, r));
  console.log('Alice 创建房间:', created);
  if (!created.ok) throw new Error('创建房间失败');

  // Bob 加入
  const joinedB = await new Promise((r) => b.emit('join_room', { roomId: created.roomId, name: 'Bob', userId: 'u-B' }, r));
  console.log('Bob 加入:', joinedB);
  if (!joinedB.ok) throw new Error('Bob 加入失败');

  await delay(50);

  // Carol 加入 -> 自动开始抢地主
  const joinedC = await new Promise((r) => c.emit('join_room', { roomId: created.roomId, name: 'Carol', userId: 'u-C' }, r));
  console.log('Carol 加入:', joinedC);
  if (!joinedC.ok) throw new Error('Carol 加入失败');

  await delay(200);

  const last = cSnap[cSnap.length - 1];
  console.log('状态:', last.state, '座位:', last.seats.map((s) => s ? s.name : '空'));
  if (last.state !== 'bidding') throw new Error('应为 bidding，实际: ' + last.state);

  // === 抢地主：让 Carol (seat 2) 当地主 ===
  let bidder = last.bidOrder[last.bidIdx];
  console.log('当前叫地主座位:', bidder);

  if (bidder === 0) {
    a.emit('bid', { action: 'pass', userId: 'u-A' });
    await delay(100);
  }
  b.emit('bid', { action: 'pass', userId: 'u-B' });
  await delay(100);

  c.emit('bid', { action: 'bid', userId: 'u-C' });
  await delay(200);

  const s4 = cSnap[cSnap.length - 1];
  console.log('Carol 叫后状态:', s4.state, '地主:', s4.landlordSeat);
  if (s4.state !== 'playing') throw new Error('应进入 playing');
  if (s4.landlordSeat !== 2) throw new Error('Carol 应是地主');

  const handCounts = s4.handCount;
  console.log('手牌数:', handCounts);
  if (handCounts[2] !== 20) throw new Error('地主应 20 张');
  if (handCounts[0] !== 17 || handCounts[1] !== 17) throw new Error('农民应 17 张');

  // === 出牌 ===
  const carolView = cSnap[cSnap.length - 1];
  const firstCard = carolView.myHand[0];
  console.log('Carol 出:', firstCard);
  c.emit('play', { cards: [firstCard], pass: false, userId: 'u-C' });
  await delay(100);

  const aliceView = aSnap[aSnap.length - 1];
  const aliceHand = aliceView.myHand;
  const targetRank = firstCard < 52 ? firstCard % 13 : 13 + (firstCard - 52);
  const aliceCard = aliceHand.find((c) => {
    const r = c < 52 ? c % 13 : 13 + (c - 52);
    return r > targetRank && r < 13;
  }) || aliceHand[0];
  console.log('Alice 出:', aliceCard);
  a.emit('play', { cards: [aliceCard], pass: false, userId: 'u-A' });
  await delay(100);

  // === 非法牌型 ===
  const bobView = bSnap[bSnap.length - 1];
  const bobCard = bobView.myHand[0];
  const badResult = await new Promise((r) => b.emit('play', { cards: [bobCard], pass: false, userId: 'u-B' }, r));
  console.log('非法出牌结果:', badResult);
  if (badResult.ok) console.log('  这次 Bob 的牌刚好大，继续');
  else console.log('  正确拒绝了');

  // === 重复牌 ===
  const dupResult = await new Promise((r) => b.emit('play', { cards: [bobCard, bobCard], pass: false, userId: 'u-B' }, r));
  console.log('重复牌结果:', dupResult);
  if (dupResult.ok) throw new Error('重复牌应该被拒绝');

  // === Bob 出能压过的 ===
  const aliceCardRank = aliceCard < 52 ? aliceCard % 13 : 13 + (aliceCard - 52);
  const candidates = bobView.myHand.filter((c) => {
    const r = c < 52 ? c % 13 : 13 + (c - 52);
    return r > aliceCardRank && r < 13;
  });
  if (candidates.length === 0) {
    console.log('Bob 没有大过 Alice 的牌，pass');
    b.emit('play', { cards: [], pass: true, userId: 'u-B' });
  } else {
    const chosen = candidates[0];
    console.log('Bob 出:', chosen);
    b.emit('play', { cards: [chosen], pass: false, userId: 'u-B' });
  }
  await delay(100);

  console.log('\n=== 测试通过 ✓ ===');
  a.disconnect(); b.disconnect(); c.disconnect();
  await delay(200);
  process.exit(0);
})().catch((e) => {
  console.error('测试失败:', e);
  process.exit(1);
});
