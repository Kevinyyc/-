/**
 * 端到端：打完一局 + 重开
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
  const overP = new Promise(r => a.once('game_over', r));
  a.on('game_update', s => snaps[0].push(s));
  b.on('game_update', s => snaps[1].push(s));
  c.on('game_update', s => snaps[2].push(s));

  const cr = await new Promise(r => a.emit('create_room', { name: 'A', userId: 'u-A' }, r));
  await new Promise(r => b.emit('join_room', { roomId: cr.roomId, name: 'B', userId: 'u-B' }, r));
  await new Promise(r => c.emit('join_room', { roomId: cr.roomId, name: 'C', userId: 'u-C' }, r));
  await delay(200);

  // seat 0 当地主
  let lastC = snaps[2][snaps[2].length - 1];
  console.log('初始 bidder:', lastC.bidOrder[lastC.bidIdx]);

  a.emit('bid', { action: 'bid', userId: 'u-A' });
  await delay(200);
  lastC = snaps[2][snaps[2].length - 1];
  console.log('A 叫后状态:', lastC.state, '地主:', lastC.landlordSeat);
  if (lastC.landlordSeat !== 0) throw new Error('A 应是地主');

  // 让 A 一直出最小单张，B/C 不要
  const clients = [a, b, c];
  const userIds = ['u-A', 'u-B', 'u-C'];

  let turns = 0;
  while (turns < 100) {
    await delay(50);
    const snap = snaps[2][snaps[2].length - 1];
    if (snap.state === 'finished') {
      console.log('本局结束，胜方:', snap.winner);
      break;
    }
    if (snap.state !== 'playing') continue;

    const cur = snap.curSeat;
    const client = clients[cur];
    const mySnap = snaps[cur][snaps[cur].length - 1];
    const hand = mySnap.myHand;
    if (!hand || hand.length === 0) {
      console.log(`seat ${cur} 似乎没手牌了`);
      break;
    }
    const last = snap.lastPlay;
    if (last && last.seat !== cur) {
      const target = last.typeInfo;
      if (target.type === 'single') {
        const card = hand.find(c => { const r = rankOf(c); return r > target.rank && r < 13; });
        if (card) client.emit('play', { cards: [card], pass: false, userId: userIds[cur] });
        else client.emit('play', { cards: [], pass: true, userId: userIds[cur] });
      } else {
        client.emit('play', { cards: [], pass: true, userId: userIds[cur] });
      }
    } else {
      client.emit('play', { cards: [hand[0]], pass: false, userId: userIds[cur] });
    }
    turns++;
  }

  const over = await overP;
  console.log('game_over:', over);

  // 重开
  console.log('--- 重开测试 ---');
  a.emit('restart', { userId: 'u-A' });
  await delay(200);
  const after = snaps[2][snaps[2].length - 1];
  console.log('重开后状态:', after.state);
  if (after.state !== 'bidding') throw new Error('重开后应是 bidding');

  a.disconnect(); b.disconnect(); c.disconnect();
  console.log('\n=== E2E 测试通过 ✓ ===');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
