const rules = require('./rules');

const STATE = {
  WAITING:   'waiting',    // 等待 3 人入座
  BIDDING:   'bidding',    // 抢地主中
  PLAYING:   'playing',    // 出牌中
  FINISHED:  'finished',   // 一局结束
};

const SEAT_NAMES = ['A', 'B', 'C'];

/**
 * 一局游戏
 *
 * 座位结构：seats[i] = { socketId, userId, name, connected, offlineSince }
 *   - socketId: 当前连接（会变）
 *   - userId:   稳定标识（前端 localStorage UUID）
 *   - connected: 当前 socketId 是否在线
 *
 * 所有方法（sitDown/reconnect/bid/play/restart）按 userId 识别玩家。
 * 只有 leaveSeatBySocket 按 socketId（disconnect 事件只给 socketId）。
 */
class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.createdAt = Date.now();
    this.state = STATE.WAITING;
    this.seats = [null, null, null];
    this.deck = [];
    this.hands = [[], [], []];
    this.bottom = [];
    this.landlordSeat = -1;
    this.bidOrder = [];
    this.bidIdx = 0;
    this.firstBidder = 0;
    this.curSeat = -1;
    this.lastPlay = null;
    this.passCount = 0;
    this.winner = null;
    this.history = [];
  }

  // === Snapshot ===
  getSnapshot(forSeat) {
    return {
      state: this.state,
      seats: this.seats.map((s, i) => s ? {
        seat: i, name: s.name, connected: s.connected,
      } : null),
      myHand: forSeat != null ? rules.sortCards(this.hands[forSeat]) : null,
      handCount: this.hands.map((h) => h.length),
      bottom: this.landlordSeat !== -1 ? this.bottom : null,
      landlordSeat: this.landlordSeat,
      curSeat: this.curSeat,
      lastPlay: this.lastPlay,
      bidOrder: this.bidOrder,
      bidIdx: this.bidIdx,
      firstBidder: this.firstBidder,
      winner: this.winner,
    };
  }

  // === 找座位 ===
  _seatOfUser(userId) {
    return this.seats.findIndex((s) => s && s.userId === userId);
  }

  _seatOfSocket(socketId) {
    return this.seats.findIndex((s) => s && s.socketId === socketId);
  }

  // === 座位管理 ===
  /**
   * 加入或重连
   * - 如果 userId 已在某个座位（不论 connected），接管那个座位
   * - 否则找空位坐下（WAITING）或找离线接管（游戏中）
   */
  sitDown(socketId, userId, playerName) {
    // 优先按 userId 重连（关键修复）
    if (userId) {
      const existing = this._seatOfUser(userId);
      if (existing !== -1) {
        this.seats[existing] = {
          socketId, userId, name: playerName,
          connected: true, offlineSince: null,
        };
        return { ok: true, seat: existing, reconnected: true };
      }
    }

    // 同 socketId 已在座位（理论不可能，兜底）
    if (this.seats.some((s) => s && s.socketId === socketId)) {
      return { ok: false, error: '已在房间' };
    }

    if (this.state === STATE.WAITING) {
      const empty = this.seats.findIndex((s) => s === null);
      if (empty === -1) return { ok: false, error: '房间已满' };
      this.seats[empty] = { socketId, userId: userId || null, name: playerName, connected: true, offlineSince: null };
      if (this.seats.every((s) => s !== null && s.connected)) {
        this.startBidding();
      }
      return { ok: true, seat: empty };
    }

    // 游戏中：接管离线的座位
    const offline = this.seats.findIndex((s) => s && !s.connected);
    if (offline === -1) return { ok: false, error: '游戏已开始，无空位' };
    this.seats[offline] = { socketId, userId: userId || null, name: playerName, connected: true, offlineSince: null };
    return { ok: true, seat: offline, reconnected: true };
  }

  /**
   * 仅用于「用户已确定在房间里」，仅恢复 connected 状态
   * 返回座位或 -1
   */
  reconnect(socketId, userId, playerName) {
    const idx = this._seatOfUser(userId);
    if (idx === -1) return -1;
    this.seats[idx] = { socketId, userId: userId || null, name: playerName, connected: true, offlineSince: null };
    return idx;
  }

  /**
   * 按 socketId 离开（disconnect 事件只能拿到 socketId）
   */
  leaveSeatBySocket(socketId) {
    const idx = this._seatOfSocket(socketId);
    if (idx === -1) return;
    if (this.state === STATE.WAITING) {
      // WAITING 时不清空座位，保留 userId 让重连可接管
      this.seats[idx].socketId = null;
      this.seats[idx].connected = false;
      this.seats[idx].offlineSince = Date.now();
    } else {
      this.seats[idx].connected = false;
      this.seats[idx].offlineSince = Date.now();
    }
  }

  // === 抢地主 ===
  startBidding() {
    this.state = STATE.BIDDING;
    this.deck = rules.shuffle(rules.createDeck());
    this.hands = [[], [], []];
    this.bottom = [];
    this.landlordSeat = -1;
    this.lastPlay = null;
    this.passCount = 0;
    this.winner = null;
    this.history = [];

    for (let i = 0; i < 51; i++) this.hands[i % 3].push(this.deck[i]);
    this.bottom = this.deck.slice(51, 54);
    for (let i = 0; i < 3; i++) this.hands[i] = rules.sortCards(this.hands[i]);

    this.bidOrder = [0, 1, 2];
    this.bidIdx = 0;
  }

  get currentBidder() {
    if (this.state !== STATE.BIDDING) return -1;
    return this.bidOrder[this.bidIdx];
  }

  bid(userId, action) {
    if (this.state !== STATE.BIDDING) return { ok: false, error: '当前不在抢地主阶段' };
    const seat = this._seatOfUser(userId);
    if (seat === -1) return { ok: false, error: '玩家不在房间' };
    if (seat !== this.currentBidder) return { ok: false, error: '还没轮到你' };
    if (!this.seats[seat].connected) return { ok: false, error: '你已离线' };

    if (action === 'pass') {
      this.history.push({ type: 'bid_pass', seat });
      this.bidIdx++;
      if (this.bidIdx >= 3) {
        return this._redeal();
      }
      return { ok: true, event: 'pass' };
    } else {
      this.landlordSeat = seat;
      this.history.push({ type: 'bid_ok', seat });
      this.hands[seat] = rules.sortCards([...this.hands[seat], ...this.bottom]);
      this.bottom = [];
      this._startPlay();
      return { ok: true, event: 'bid' };
    }
  }

  _redeal() {
    this.firstBidder = (this.firstBidder + 1) % 3;
    this.startBidding();
    return { ok: true, event: 'redeal' };
  }

  // === 出牌 ===
  _startPlay() {
    this.state = STATE.PLAYING;
    this.curSeat = this.landlordSeat;
    this.lastPlay = null;
    this.passCount = 0;
  }

  play(userId, cards, pass) {
    if (this.state !== STATE.PLAYING) return { ok: false, error: '当前不在出牌阶段' };
    const seat = this._seatOfUser(userId);
    if (seat === -1) return { ok: false, error: '玩家不在房间' };
    if (seat !== this.curSeat) return { ok: false, error: '还没轮到你出牌' };
    if (!this.seats[seat].connected) return { ok: false, error: '你已离线' };

    if (pass) {
      if (this.lastPlay === null) return { ok: false, error: '首家必须出牌' };
      this.history.push({ type: 'pass', seat });
      this.passCount++;
      this._nextTurn();
      return { ok: true, event: 'pass' };
    }

    if (!cards || cards.length === 0) return { ok: false, error: '请选择要出的牌' };
    const hand = this.hands[seat].slice();
    for (const c of cards) {
      const idx = hand.indexOf(c);
      if (idx === -1) return { ok: false, error: '出的牌不在手牌中' };
      hand.splice(idx, 1);
    }
    const typeInfo = rules.identify(cards);
    if (!typeInfo) return { ok: false, error: '非法牌型' };
    if (this.lastPlay && this.lastPlay.seat !== seat) {
      if (!rules.canBeat(typeInfo, this.lastPlay.typeInfo)) {
        return { ok: false, error: '牌不够大' };
      }
    }

    this.hands[seat] = hand;
    this.lastPlay = { seat, cards: rules.sortCards(cards), typeInfo };
    this.passCount = 0;
    this.history.push({ type: 'play', seat, cards: this.lastPlay.cards });

    if (hand.length === 0) {
      this._finish(seat);
      return { ok: true, event: 'play_and_finish' };
    }

    this._nextTurn();
    return { ok: true, event: 'play' };
  }

  _nextTurn() {
    if (this.passCount >= 2) {
      this.lastPlay = null;
      this.passCount = 0;
      return;
    }
    this.curSeat = (this.curSeat + 1) % 3;
  }

  _finish(winnerSeat) {
    this.state = STATE.FINISHED;
    this.winner = (winnerSeat === this.landlordSeat) ? 'landlord' : 'farmer';
    this.history.push({ type: 'finish', winnerSeat });
  }

  restart() {
    if (this.state !== STATE.FINISHED) return { ok: false, error: '未结束，不能重开' };
    if (this.seats.some((s) => !s)) return { ok: false, error: '有人不在座位上' };
    this.firstBidder = (this.firstBidder + 1) % 3;
    this.startBidding();
    return { ok: true };
  }

  // === 托管 ===
  autoPlay(seat) {
    if (this.state !== STATE.PLAYING) return null;
    if (this.curSeat !== seat) return null;
    const hand = this.hands[seat];
    if (hand.length === 0) return null;

    if (this.lastPlay && this.lastPlay.seat !== seat) {
      const cand = this._findMinBeat(hand, this.lastPlay.typeInfo);
      if (cand) return { cards: cand, pass: false };
      return { cards: [], pass: true };
    } else {
      return { cards: [hand[0]], pass: false };
    }
  }

  _findMinBeat(hand, target) {
    if (target.type === 'rocket') return null;
    if (target.type === 'bomb') {
      const rankCount = {};
      for (const c of hand) {
        const r = rules.POINT_RANK_FROM_CARD(c);
        rankCount[r] = (rankCount[r] || 0) + 1;
      }
      for (const r of Object.keys(rankCount).map(Number).sort((a, b) => a - b)) {
        if (rankCount[r] === 4 && r > target.rank) {
          return hand.filter((c) => rules.POINT_RANK_FROM_CARD(c) === r).slice(0, 4);
        }
      }
      return null;
    }
    if (target.type === 'single') {
      for (const c of hand) {
        if (rules.POINT_RANK_FROM_CARD(c) > target.rank && rules.POINT_RANK_FROM_CARD(c) < 13) {
          return [c];
        }
      }
      const hasSmall = hand.includes(52);
      const hasBig = hand.includes(53);
      if (hasSmall && hasBig) return [52, 53];
      return null;
    }
    if (target.type === 'pair') {
      const rankCount = {};
      for (const c of hand) {
        const r = rules.POINT_RANK_FROM_CARD(c);
        if (r >= 13) continue;
        rankCount[r] = (rankCount[r] || 0) + 1;
      }
      for (const r of Object.keys(rankCount).map(Number).sort((a, b) => a - b)) {
        if (rankCount[r] >= 2 && r > target.rank) {
          return hand.filter((c) => rules.POINT_RANK_FROM_CARD(c) === r).slice(0, 2);
        }
      }
      return null;
    }
    return null;
  }
}

module.exports = { Game, STATE };
