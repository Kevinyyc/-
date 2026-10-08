// 牌桌逻辑
const socket = io();
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const roomId = (params.get('room') || '').toUpperCase();
const myName = params.get('name') || '玩家';

let mySeat = -1;
let lastSnapshot = null;
let selectedCards = new Set();      // 当前选中的牌

// === 牌的渲染 ===
const POINT_LABEL = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUIT_LABEL  = ['♠','♥','♣','♦'];
const RED_SUITS = new Set([1, 3]);

function cardInfo(c) {
  if (c < 52) {
    const suit = Math.floor(c / 13);
    const p = c % 13;
    return { text: SUIT_LABEL[suit] + POINT_LABEL[p], red: RED_SUITS.has(suit), joker: false };
  }
  if (c === 52) return { text: '小王', red: false, joker: true };
  if (c === 53) return { text: '大王', red: false, joker: true };
}

function renderCardEl(c) {
  const info = cardInfo(c);
  const el = document.createElement('div');
  el.className = 'card-pic' + (info.red ? ' red' : '') + (info.joker ? ' joker' : '');
  el.dataset.card = c;
  if (info.joker) {
    el.innerHTML = `<span class="rank">${info.text}</span>`;
  } else {
    el.innerHTML = `<span class="suit">${info.text.slice(0,1)}</span><span class="rank">${info.text.slice(1)}</span>`;
  }
  return el;
}

function renderCardBack() {
  const el = document.createElement('div');
  el.className = 'card-back';
  return el;
}

// === Toast ===
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// === 复制链接 ===
$('copyBtn').addEventListener('click', () => {
  const url = `${location.origin}/?room=${roomId}`;
  // 直接把房间号填到主页更直接
  navigator.clipboard?.writeText(url).then(
    () => toast('链接已复制，发给同学即可'),
    () => toast('房间号：' + roomId)
  );
});

// === 连接后加入房间 ===
socket.on('connect', () => {
  socket.emit('join_room', { roomId, name: myName }, (resp) => {
    if (!resp || !resp.ok) {
      toast('加入失败：' + (resp && resp.error || '未知错误'));
      setTimeout(() => location.href = '/', 2000);
      return;
    }
    mySeat = resp.seat;
  });
});

socket.on('disconnect', () => {
  toast('连接已断开，尝试重连...');
});

// === 渲染 ===
function render(snap) {
  if (!snap) return;
  lastSnapshot = snap;
  $('roomId').textContent = roomId;

  // 自己信息
  if (mySeat >= 0 && snap.seats[mySeat]) {
    $('myInfo').textContent = `座位 ${['A','B','C'][mySeat]} · ${snap.seats[mySeat].name}${snap.landlordSeat === mySeat ? ' · 地主' : (snap.landlordSeat !== -1 ? ' · 农民' : '')}`;
  }

  // 渲染 3 个座位
  renderSeats(snap);

  // 渲染桌面
  renderCenter(snap);

  // 渲染自己手牌
  renderMyHand(snap);

  // 渲染操作按钮 / 弹窗
  renderActions(snap);
}

function renderSeats(snap) {
  // 顶部 2 个 + 底部自己
  const otherSeats = [];
  for (let i = 0; i < 3; i++) if (i !== mySeat) otherSeats.push(i);

  const topEls = [$('seat-other-0'), $('seat-other-1')];
  // 如果 mySeat 是 0：top[0] = seat 1, top[1] = seat 2
  // 如果 mySeat 是 1：top[0] = seat 2, top[1] = seat 0
  // 如果 mySeat 是 2：top[0] = seat 0, top[1] = seat 1
  // 即 top[0] = (mySeat + 1) % 3, top[1] = (mySeat + 2) % 3

  // 直接根据 mySeat 计算 top 顺序
  const top0 = (mySeat + 1) % 3;
  const top1 = (mySeat + 2) % 3;

  renderSeatEl(topEls[0], snap.seats[top0], snap, top0);
  renderSeatEl(topEls[1], snap.seats[top1], snap, top1);

  // 自己的座位
  const meEl = $('seat-me');
  renderSeatEl(meEl, snap.seats[mySeat], snap, mySeat);
  meEl.classList.add('is-me');
}

function renderSeatEl(el, s, snap, seatIdx) {
  if (!el) return;
  if (!s) {
    el.className = 'player';
    el.innerHTML = `<div class="name">等待加入</div><div class="meta">座位 ${['A','B','C'][seatIdx]}</div>`;
    return;
  }
  const isTurn = snap.curSeat === seatIdx && (snap.state === 'playing' || snap.state === 'bidding');
  const isLandlord = snap.landlordSeat === seatIdx;
  const isOffline = s.connected === false;

  el.className = 'player'
    + (isTurn ? ' is-turn' : '')
    + (isLandlord ? ' is-landlord' : '')
    + (isOffline ? ' offline' : '');

  // 牌数（手牌数）
  const cardCount = snap.handCount[seatIdx];

  el.innerHTML = `
    <div class="name">${escapeHtml(s.name)}${isOffline ? ' (离线)' : ''}</div>
    <div class="meta">座位 ${['A','B','C'][seatIdx]}${cardCount != null ? ' · ' + cardCount + ' 张' : ''}</div>
    ${isLandlord ? '<div class="landlord-mark">👑 地主</div>' : ''}
  `;
}

function renderCenter(snap) {
  const status = $('statusText');
  const hint = $('hintText');
  const last = $('lastPlay');
  last.innerHTML = '';

  if (snap.state === 'waiting') {
    status.textContent = '等待其他玩家加入...';
    hint.textContent = `当前 ${snap.seats.filter(Boolean).length}/3 人`;
  } else if (snap.state === 'bidding') {
    const bidder = snap.bidOrder[snap.bidIdx];
    const bidderName = snap.seats[bidder]?.name || '?';
    status.textContent = `抢地主中：轮到 ${bidderName}`;
    hint.textContent = '第一个「叫地主」的人当地主';
  } else if (snap.state === 'playing') {
    const cur = snap.seats[snap.curSeat]?.name || '?';
    if (snap.lastPlay) {
      const lastPlayer = snap.seats[snap.lastPlay.seat]?.name || '?';
      status.textContent = `轮到 ${cur} 出牌`;
      hint.textContent = `上家 ${lastPlayer} 出了 ${snap.lastPlay.cards.length} 张`;
    } else {
      status.textContent = `轮到 ${cur} 自由出牌`;
      hint.textContent = '首家可出任意牌型';
    }
  } else if (snap.state === 'finished') {
    status.textContent = '本局结束';
    hint.textContent = '';
  }

  // 渲染最后出牌
  if (snap.lastPlay && snap.lastPlay.cards) {
    for (const c of snap.lastPlay.cards) {
      last.appendChild(renderCardEl(c));
    }
  }
}

function renderMyHand(snap) {
  const handEl = $('myHand');
  handEl.innerHTML = '';

  if (mySeat < 0 || !snap.myHand) {
    handEl.appendChild(renderEmpty('连接中...'));
    return;
  }

  for (const c of snap.myHand) {
    const card = renderCardEl(c);
    if (selectedCards.has(c)) card.classList.add('selected');
    card.addEventListener('click', () => {
      if (selectedCards.has(c)) {
        selectedCards.delete(c);
        card.classList.remove('selected');
      } else {
        selectedCards.add(c);
        card.classList.add('selected');
      }
      updateActions();
    });
    handEl.appendChild(card);
  }
}

function renderEmpty(text) {
  const el = document.createElement('div');
  el.style.cssText = 'color:#8ab5a0; padding: 20px;';
  el.textContent = text;
  return el;
}

function renderActions(snap) {
  const bar = $('myActions');
  bar.innerHTML = '';

  if (snap.state === 'bidding') {
    if (snap.bidOrder[snap.bidIdx] === mySeat) {
      // 弹窗已经在 socket.on('bid_turn') 触发；这里按钮也展示一份
      bar.innerHTML = `
        <button class="btn primary" id="btnBid">叫地主</button>
        <button class="btn ghost" id="btnPass">不叫</button>
      `;
      $('btnBid').onclick = () => doBid('bid');
      $('btnPass').onclick = () => doBid('pass');
      // 显示弹窗
      $('bidModal').style.display = 'flex';
    } else {
      $('bidModal').style.display = 'none';
    }
    return;
  } else {
    $('bidModal').style.display = 'none';
  }

  if (snap.state === 'playing') {
    if (snap.curSeat === mySeat) {
      const canPass = snap.lastPlay && snap.lastPlay.seat !== mySeat;
      bar.innerHTML = `
        <button class="btn primary" id="btnPlay">出牌</button>
        ${canPass ? '<button class="btn ghost" id="btnPass">不要</button>' : ''}
        <button class="btn ghost" id="btnHint">提示</button>
        <button class="btn ghost" id="btnClear">清空</button>
      `;
      $('btnPlay').onclick = () => doPlay(false);
      if (canPass) $('btnPass').onclick = () => doPlay(true);
      $('btnHint').onclick = () => doHint();
      $('btnClear').onclick = () => { selectedCards.clear(); render(lastSnapshot); };
    }
    return;
  }

  if (snap.state === 'finished') {
    bar.innerHTML = `<button class="btn primary" id="btnRestart">再来一局</button>`;
    $('btnRestart').onclick = () => doRestart();
  }
}

function updateActions() {
  // 选中变化时，提示一下牌型
  if (selectedCards.size === 0) return;
  if (!lastSnapshot || lastSnapshot.state !== 'playing' || lastSnapshot.curSeat !== mySeat) return;
  // 简化：让后端校验
}

// === 操作 ===
function doBid(action) {
  socket.emit('bid', { action }, (resp) => {
    if (!resp || !resp.ok) {
      toast('抢地主失败：' + (resp && resp.error || '未知'));
    } else if (resp.event === 'redeal') {
      toast('三家都不叫，重新发牌');
    }
  });
}

function doPlay(pass) {
  const cards = pass ? [] : Array.from(selectedCards);
  socket.emit('play', { cards, pass }, (resp) => {
    if (!resp || !resp.ok) {
      toast((resp && resp.error) || '出牌失败');
      return;
    }
    selectedCards.clear();
  });
}

function doHint() {
  // 简单的智能提示：尝试找能压过上一手的最小牌
  if (!lastSnapshot || lastSnapshot.state !== 'playing') return;
  const hand = lastSnapshot.myHand;
  if (!hand) return;
  const target = lastSnapshot.lastPlay && lastSnapshot.lastPlay.seat !== mySeat ? lastSnapshot.lastPlay.typeInfo : null;

  if (!target) {
    // 自由出：出最小单张
    selectedCards = new Set([hand[0]]);
  } else if (target.type === 'single') {
    // 找最小能压的单张
    let chosen = null;
    for (const c of hand) {
      const r = c < 52 ? c % 13 : 13 + (c - 52);
      if (r > target.rank && r < 13) { chosen = c; break; }
    }
    if (!chosen && hand.includes(52) && hand.includes(53)) chosen = [52, 53];
    selectedCards = chosen == null ? new Set() : new Set(Array.isArray(chosen) ? chosen : [chosen]);
  } else if (target.type === 'pair') {
    const cnt = {};
    for (const c of hand) {
      const r = c < 52 ? c % 13 : 13 + (c - 52);
      if (r >= 13) continue;
      cnt[r] = (cnt[r] || 0) + 1;
    }
    let chosen = null;
    for (const c of hand) {
      const r = c < 52 ? c % 13 : 13 + (c - 52);
      if (r > target.rank && r < 13 && cnt[r] >= 2) { chosen = c; break; }
    }
    if (chosen != null) {
      const r = chosen < 52 ? chosen % 13 : 13 + (chosen - 52);
      const sameRank = hand.filter((x) => (x < 52 ? x % 13 : 13 + (x - 52)) === r);
      selectedCards = new Set(sameRank.slice(0, 2));
    } else {
      // 找炸弹
      const cntAll = {};
      for (const c of hand) {
        const r = c < 52 ? c % 13 : 13 + (c - 52);
        cntAll[r] = (cntAll[r] || 0) + 1;
      }
      for (const r of Object.keys(cntAll).map(Number).sort((a, b) => a - b)) {
        if (cntAll[r] === 4 && r > target.rank) {
          selectedCards = new Set(hand.filter((x) => (x < 52 ? x % 13 : 13 + (x - 52)) === r).slice(0, 4));
          break;
        }
      }
    }
  } else if (target.type === 'bomb') {
    // 找更大炸弹
    const cnt = {};
    for (const c of hand) {
      const r = c < 52 ? c % 13 : 13 + (c - 52);
      cnt[r] = (cnt[r] || 0) + 1;
    }
    let chosenRank = -1;
    for (const r of Object.keys(cnt).map(Number).sort((a, b) => a - b)) {
      if (cnt[r] === 4 && r > target.rank) { chosenRank = r; break; }
    }
    if (chosenRank === -1 && hand.includes(52) && hand.includes(53)) {
      selectedCards = new Set([52, 53]);
    } else if (chosenRank !== -1) {
      selectedCards = new Set(hand.filter((x) => (x < 52 ? x % 13 : 13 + (x - 52)) === chosenRank).slice(0, 4));
    } else {
      selectedCards = new Set();
    }
  } else {
    // 其他牌型：先 pass
    selectedCards = new Set();
    toast('暂不支持此牌型提示');
  }
  render(lastSnapshot);
}

function doRestart() {
  socket.emit('restart', {}, (resp) => {
    if (!resp || !resp.ok) {
      toast((resp && resp.error) || '重开失败');
    } else {
      $('resultModal').style.display = 'none';
      selectedCards.clear();
    }
  });
}

// 离开
$('leaveBtn').addEventListener('click', () => {
  location.href = '/';
});
$('restartBtn').addEventListener('click', () => {
  $('resultModal').style.display = 'none';
  doRestart();
});

// === Socket events ===
socket.on('game_update', (snap) => {
  render(snap);
});

socket.on('game_over', (data) => {
  const modal = $('resultModal');
  const title = $('resultTitle');
  const roles = $('resultRoles');

  if (data.winner === 'landlord') {
    title.textContent = '🏆 地主胜利！';
  } else {
    title.textContent = '🏆 农民胜利！';
  }

  // 显示角色
  const lines = [];
  if (lastSnapshot) {
    for (let i = 0; i < 3; i++) {
      const s = lastSnapshot.seats[i];
      if (!s) continue;
      const isL = i === data.landlord;
      lines.push(`<span class="${isL ? 'role-landlord' : 'role-farmer'}">${['A','B','C'][i]} ${escapeHtml(s.name)} - ${isL ? '地主' : '农民'}</span>`);
    }
  }
  roles.innerHTML = lines.join('<br>');

  modal.style.display = 'flex';
});

socket.on('toast', (data) => {
  if (data && data.msg) toast(data.msg);
});

socket.on('room_update', () => {
  // 提示
});

// === utils ===
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
