// 牌桌逻辑
const socket = io();
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const roomId = (params.get('room') || '').toUpperCase();
const myName = params.get('name') || '玩家';

// 稳定用户标识
function getOrCreateUserId() {
  let id = localStorage.getItem('doudizhu_userId');
  if (!id) {
    if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
    else id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('doudizhu_userId', id);
  }
  return id;
}
const myUserId = getOrCreateUserId();

let mySeat = -1;
let lastSnapshot = null;
let selectedCards = new Set();

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
  navigator.clipboard?.writeText(url).then(
    () => toast('链接已复制，发给同学即可'),
    () => toast('房间号：' + roomId)
  );
});

// === 抢地主弹窗按钮（页面加载时就绑一次） ===
$('bidYes').addEventListener('click', () => doBid('bid'));
$('bidNo').addEventListener('click', () => doBid('pass'));

// === 连接后加入房间 ===
socket.on('connect', () => {
  socket.emit('join_room', { roomId, name: myName, userId: myUserId }, (resp) => {
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

  if (mySeat >= 0 && snap.seats[mySeat]) {
    $('myInfo').textContent = `座位 ${['A','B','C'][mySeat]} · ${snap.seats[mySeat].name}${snap.landlordSeat === mySeat ? ' · 地主' : (snap.landlordSeat !== -1 ? ' · 农民' : '')}`;
  }

  renderSeats(snap);
  renderCenter(snap);
  renderMyHand(snap);
  renderActions(snap);
}

function renderSeats(snap) {
  const top0 = (mySeat + 1) % 3;
  const top1 = (mySeat + 2) % 3;

  renderSeatEl($('seat-other-0'), snap.seats[top0], snap, top0);
  renderSeatEl($('seat-other-1'), snap.seats[top1], snap, top1);

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
    const el = document.createElement('div');
    el.style.cssText = 'color:#8ab5a0; padding: 20px;';
    el.textContent = '连接中...';
    handEl.appendChild(el);
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
    });
    handEl.appendChild(card);
  }
}

function renderActions(snap) {
  const bar = $('myActions');
  bar.innerHTML = '';

  if (snap.state === 'bidding') {
    if (snap.bidOrder[snap.bidIdx] === mySeat) {
      // 弹窗已经在 DOMContentLoaded 时绑了 onclick，这里只需要显示
      $('bidModal').style.display = 'flex';
      // 底部也保留按钮作为备用入口
      bar.innerHTML = `
        <button class="btn primary" id="btnBid">叫地主</button>
        <button class="btn ghost" id="btnPass">不叫</button>
      `;
      $('btnBid').onclick = () => doBid('bid');
      $('btnPass').onclick = () => doBid('pass');
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

// === 操作 ===
function doBid(action) {
  socket.emit('bid', { action, userId: myUserId }, (resp) => {
    if (!resp || !resp.ok) {
      toast('抢地主失败：' + (resp && resp.error || '未知'));
    } else if (resp.event === 'redeal') {
      toast('三家都不叫，重新发牌');
    } else if (resp.event === 'bid') {
      $('bidModal').style.display = 'none';
    }
  });
}

function doPlay(pass) {
  const cards = pass ? [] : Array.from(selectedCards);
  socket.emit('play', { cards, pass, userId: myUserId }, (resp) => {
    if (!resp || !resp.ok) {
      toast((resp && resp.error) || '出牌失败');
      return;
    }
    selectedCards.clear();
  });
}

function doHint() {
  if (!lastSnapshot || lastSnapshot.state !== 'playing') return;
  const hand = lastSnapshot.myHand;
  if (!hand) return;
  const target = lastSnapshot.lastPlay && lastSnapshot.lastPlay.seat !== mySeat ? lastSnapshot.lastPlay.typeInfo : null;

  if (!target) {
    selectedCards = new Set([hand[0]]);
  } else if (target.type === 'single') {
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
    selectedCards = new Set();
    toast('暂不支持此牌型提示');
  }
  render(lastSnapshot);
}

function doRestart() {
  socket.emit('restart', { userId: myUserId }, (resp) => {
    if (!resp || !resp.ok) {
      toast((resp && resp.error) || '重开失败');
    } else {
      $('resultModal').style.display = 'none';
      selectedCards.clear();
    }
  });
}

$('leaveBtn').addEventListener('click', () => {
  location.href = '/';
});
$('restartBtn').addEventListener('click', () => {
  $('resultModal').style.display = 'none';
  doRestart();
});

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

// === utils ===
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
