const rules = require('./rules');

const STATE = {
  WAITING:   'waiting',    // 等待 3 人入座
  BIDDING:   'bidding',    // 抢地主中
  PLAYING:   'playing',    // 出牌中
  FINISHED:  'finished',   // 一局结束
};

const SEAT_NAMES = ['A', 'B', 'C'];

/**
 * 牌局
 * - 3 个座位
 * - 状态机：WAITING -> BIDDING -> PLAYING -> FINISHED
 * - 不带断线托管，由 index.js 层负责
 */
class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.createdAt = Date.now();
    this.state = STATE.WAITING;
    this.seats = [null, null, null]; // 每个座位：{ id, name, connected, offlineSince }
    this.deck = [];
    this.hands = [[], [], []];       // 各玩家手牌
    this.bottom = [];                // 底牌 3 张
    this.landlordSeat = -1;          // 地主座位
    this.bidOrder = [];              // 抢地主顺序：座位数组
    this.bidIdx = 0;                 // 当前轮到叫的座位索引（指向 bidOrder）
    this.firstBidder = 0;            // 第一个叫地主的座位（首局为 0，后续轮换）
    this.curSeat = -1;               // 当前出牌玩家座位
    this.lastPlay = null;            // { seat, cards, typeInfo } 最近一次出牌
    this.passCount = 0;              // 连续 pass 数
    this.winner = null;              // 'landlord' | 'farmer'
    this.history = [];               // 操作记录
  }

  // 外部 API
  getSnapshot(forSeat) {
    return {
      state: this.state,
      seats: this.seats.map((s, i) => s ? { seat: i, name: s.name, id: s.id, connected: s.connected } : null),
      myHand: forSeat != null ? rules.sortCards(this.hands[forSeat]) : null,
      handCount: this.hands.map((h) => h.length),
      bottom: this.landlordSeat !== -1 ? this.bottom : null, // 抢地主期间不显示
      landlordSeat: this.landlordSeat,
      curSeat: this.curSeat,
      lastPlay: this.lastPlay,
      bidOrder: this.bidOrder,
      bidIdx: this.bidIdx,
      firstBidder: this.firstBidder,
      winner: this.winner,
    };
  }

  // === 座位管理 ===
  sitDown(playerId, playerName) {
    if (this.seats.some((s) => s && s.id === playerId)) return { ok: false, error: '已在房间' };

    if (this.state === STATE.WAITING) {
      // 清理同名的旧玩家（兜底：跳转页面时旧 disconnect 还没传到）
      for (let i = 0; i < 3; i++) {
        if (this.seats[i] && this.seats[i].name === playerName) {
          this.seats[i] = null;
        }
      }
      const empty = this.seats.findIndex((s) => s === null);
      if (empty === -1) return { ok: false, error: '房间已满' };
      this.seats[empty] = { id: playerId, name: playerName, connected: true, offlineSince: null };
      if (this.seats.every((s) => s !== null)) {
        this.startBidding();
      }
      return { ok: true, seat: empty };
    }

    // 游戏中：只能接管离线的座位
    const offline = this.seats.findIndex((s) => s && !s.connected);
    if (offline === -1) return { ok: false, error: '游戏已开始' };
    this.seats[offline] = { id: playerId, name: playerName, connected: true, offlineSince: null };
    return { ok: true, seat: offline, reconnected: true };
  }

  leaveSeat(playerId) {
    const idx = this.seats.findIndex((s) => s && s.id === playerId);
    if (idx === -1) return;
    if (this.state === STATE.WAITING) {
      this.seats[idx] = null;
    } else {
      this.seats[idx].connected = false;
      this.seats[idx].offlineSince = Date.now();
    }
  }

  reconnect(playerId) {
    const idx = this.seats.findIndex((s) => s && s.id === playerId);
    if (idx === -1) return -1;
    this.seats[idx].connected = true;
    this.seats[idx].offlineSince = null;
    return idx;
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

    // 发牌：每人 17 张，最后 3 张为底牌
    for (let i = 0; i < 51; i++) this.hands[i % 3].push(this.deck[i]);
    this.bottom = this.deck.slice(51, 54);
    for (let i = 0; i < 3; i++) this.hands[i] = rules.sortCards(this.hands[i]);

    // 抢地主顺序：firstBidder 之后 3 人都问一遍
    this.bidOrder = [0, 1, 2]; // 简化：固定从 firstBidder 开始
    this.bidIdx = 0;
  }

  /**
   * 当前叫地主的玩家
   */
  get currentBidder() {
    if (this.state !== STATE.BIDDING) return -1;
    return this.bidOrder[this.bidIdx];
  }

  /**
   * 处理玩家叫/不叫
   * action: 'bid' | 'pass'
   */
  bid(playerId, action) {
    if (this.state !== STATE.BIDDING) return { ok: false, error: '当前不在抢地主阶段' };
    const seat = this.seats.findIndex((s) => s && s.id === playerId);
    if (seat === -1) return { ok: false, error: '玩家不在房间' };
    if (seat !== this.currentBidder) return { ok: false, error: '还没轮到你' };

    if (action === 'pass') {
      this.history.push({ type: 'bid_pass', seat });
      // 不叫：移到下一个
      this.bidIdx++;
      if (this.bidIdx >= 3) {
        // 没人叫，重洗
        return this._redeal();
      }
      return { ok: true, event: 'pass' };
    } else {
      // 叫地主
      this.landlordSeat = seat;
      this.history.push({ type: 'bid_ok', seat });
      // 把底牌给地主
      this.hands[seat] = rules.sortCards([...this.hands[seat], ...this.bottom]);
      this.bottom = [];
      // 进入出牌
      this._startPlay();
      return { ok: true, event: 'bid' };
    }
  }

  _redeal() {
    // 简单重来：把 firstBidder 往后挪一位
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

  /**
   * 出牌
   * cards: 数字数组
   * pass: true 表示不要
   */
  play(playerId, cards, pass) {
    if (this.state !== STATE.PLAYING) return { ok: false, error: '当前不在出牌阶段' };
    const seat = this.seats.findIndex((s) => s && s.id === playerId);
    if (seat === -1) return { ok: false, error: '玩家不在房间' };
    if (seat !== this.curSeat) return { ok: false, error: '还没轮到你出牌' };

    if (pass) {
      // 不要
      if (this.lastPlay === null) {
        return { ok: false, error: '首家必须出牌' };
      }
      // 跳过地主/上家等：直接 pass
      this.history.push({ type: 'pass', seat });
      this.passCount++;
      this._nextTurn();
      return { ok: true, event: 'pass' };
    }

    // 校验出牌
    if (!cards || cards.length === 0) return { ok: false, error: '请选择要出的牌' };
    // 必须在手牌中
    const hand = this.hands[seat].slice();
    for (const c of cards) {
      const idx = hand.indexOf(c);
      if (idx === -1) return { ok: false, error: '出的牌不在手牌中' };
      hand.splice(idx, 1);
    }
    const typeInfo = rules.identify(cards);
    if (!typeInfo) return { ok: false, error: '非法牌型' };
    // 与上家比较
    if (this.lastPlay && this.lastPlay.seat !== seat) {
      if (!rules.canBeat(typeInfo, this.lastPlay.typeInfo)) {
        return { ok: false, error: '牌不够大' };
      }
    } else {
      // 首家 / 上一手是自己：自由出
    }

    // 真正出牌
    this.hands[seat] = hand;
    this.lastPlay = { seat, cards: rules.sortCards(cards), typeInfo };
    this.passCount = 0;
    this.history.push({ type: 'play', seat, cards: this.lastPlay.cards });

    // 检查胜负
    if (hand.length === 0) {
      this._finish(seat);
      return { ok: true, event: 'play_and_finish' };
    }

    this._nextTurn();
    return { ok: true, event: 'play' };
  }

  _nextTurn() {
    if (this.passCount >= 2) {
      // 上一手玩家重新获得自由出牌权
      this.lastPlay = null;
      this.passCount = 0;
      // 仍轮到上家
      return;
    }
    this.curSeat = (this.curSeat + 1) % 3;
  }

  _finish(winnerSeat) {
    this.state = STATE.FINISHED;
    this.winner = (winnerSeat === this.landlordSeat) ? 'landlord' : 'farmer';
    this.history.push({ type: 'finish', winnerSeat });
  }

  // === 重开 ===
  restart() {
    if (this.state !== STATE.FINISHED) return { ok: false, error: '未结束，不能重开' };
    if (this.seats.some((s) => !s)) return { ok: false, error: '有人不在座位上' };
    this.firstBidder = (this.firstBidder + 1) % 3;
    this.startBidding();
    return { ok: true };
  }

  // === 托管：自动出最小牌 ===
  autoPlay(seat) {
    if (this.state !== STATE.PLAYING) return null;
    if (this.curSeat !== seat) return null;
    const hand = this.hands[seat];
    if (hand.length === 0) return null;

    // 尝试接上家：找出能压过的最小牌
    if (this.lastPlay && this.lastPlay.seat !== seat) {
      // 找最小的同类型
      const target = this.lastPlay.typeInfo;
      const cand = this._findMinBeat(hand, target);
      if (cand) return { cards: cand, pass: false };
      return { cards: [], pass: true };
    } else {
      // 自由出：出最小单张
      return { cards: [hand[0]], pass: false };
    }
  }

  _findMinBeat(hand, target) {
    // 简化：只考虑单张、对子、炸弹
    if (target.type === 'rocket') return null;
    if (target.type === 'bomb') {
      // 找更大的炸弹
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
    if (target.type === 'bomb') return null;
    if (target.type === 'single') {
      for (const c of hand) {
        if (rules.POINT_RANK_FROM_CARD(c) > target.rank && rules.POINT_RANK_FROM_CARD(c) < 13) {
          return [c];
        }
      }
      // 火箭
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
    return null; // 其他牌型托管直接 pass
  }
}

module.exports = { Game, STATE };
