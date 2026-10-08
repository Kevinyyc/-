/**
 * 端到端测试：打完一局 + 重开
 * 让 3 个玩家把所有牌出完，验证胜负判定和重开
 */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function makeClient(name) {
  const sock = io(URL, { transports: ['websocket'] });
  sock.name = name;
  return sock;
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rankOf(c) { return c < 52 ? c % 13 : 13 + (c - 52); }

(async () => {
  const a = makeClient('A'); const b = makeClient('B'); const c = makeClient('C');
  await Promise.all([new Promise(r => a.on('connect', r)), new Promise(r => b.on('connect', r)), new Promise(r => c.on('connect', r))]);

  const snaps = { 0: [], 1: [], 2: [] };
  const overP = new Promise(r => a.once('game_over', r));
  a.on('game_update', s => snaps[0].push(s));
  b.on('game_update', s => snaps[1].push(s));
  c.on('game_update', s => snaps[2].push(s));

  const cr = await new Promise(r => a.emit('create_room', { name: 'A' }, r));
  await new Promise(r => b.emit('join_room', { roomId: cr.roomId, name: 'B' }, r));
  await new Promise(r => c.emit('join_room', { roomId: cr.roomId, name: 'C' }, r));
  await delay(200);

  // 强制：让 seat 0 当地主
  let lastC = snaps[2][snaps[2].length - 1];
  console.log('初始 bidder:', lastC.bidOrder[lastC.bidIdx]);

  // seat 0 (A) 叫
  a.emit('bid', { action: 'bid' });
  await delay(200);
  lastC = snaps[2][snaps[2].length - 1];
  console.log('A 叫后状态:', lastC.state, '地主:', lastC.landlordSeat);
  if (lastC.landlordSeat !== 0) throw new Error('A 应是地主');

  // 现在让 A 一直出最小单张，B/C 不要（除非能压过）
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
    const client = [a, b, c][cur];
    const mySnap = snaps[cur][snaps[cur].length - 1];
    const hand = mySnap.myHand;
    if (!hand || hand.length === 0) {
      console.log(`seat ${cur} 似乎没手牌了`);
      break;
    }
    const last = snap.lastPlay;
    if (last && last.seat !== cur) {
      // 尝试压过
      const target = last.typeInfo;
      if (target.type === 'single') {
        const card = hand.find(c => { const r = rankOf(c); return r > target.rank && r < 13; });
        if (card) {
          client.emit('play', { cards: [card], pass: false });
        } else {
          client.emit('play', { cards: [], pass: true });
        }
      } else {
        // 其他牌型直接 pass
        client.emit('play', { cards: [], pass: true });
      }
    } else {
      // 自由出：出最小单张
      client.emit('play', { cards: [hand[0]], pass: false });
    }
    turns++;
  }

  // 等 game_over
  const over = await overP;
  console.log('game_over:', over);

  // 重开
  console.log('--- 重开测试 ---');
  a.emit('restart', {});
  await delay(200);
  const after = snaps[2][snaps[2].length - 1];
  console.log('重开后状态:', after.state);
  if (after.state !== 'bidding') throw new Error('重开后应是 bidding');

  a.disconnect(); b.disconnect(); c.disconnect();
  console.log('\n=== E2E 测试通过 ✓ ===');
  process.exit(0);
})().catch((e) => { console.error('失败:', e); process.exit(1); });
