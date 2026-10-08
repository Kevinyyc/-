/**
 * 斗地主牌型规则
 *
 * 牌的表示：用 0-53 的整数
 *   0-51 : 普通牌 (4 花色 × 13 点数)
 *          索引 = 花色 * 13 + 点数
 *          花色: 0=黑桃 1=红桃 2=梅花 3=方块 (仅用于显示，无大小关系)
 *          点数: 0=3, 1=4, ..., 8=J, 9=Q, 10=K, 11=A, 12=2
 *   52  : 小王
 *   53  : 大王
 *
 * 牌的「点数 rank」: 0=3, 1=4, ..., 12=2, 13=小王, 14=大王
 *   用于大小比较
 */

const POINT_LABEL = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王'];
const SUIT_LABEL  = ['♠','♥','♣','♦'];
const POINT_RANK_FROM_CARD = (c) => (c < 52 ? c % 13 : 13 + (c - 52)); // 0..14
const SUIT_FROM_CARD       = (c) => (c < 52 ? Math.floor(c / 13) : -1);

function cardName(c) {
  if (c < 52) return SUIT_LABEL[SUIT_FROM_CARD(c)] + POINT_LABEL[POINT_RANK_FROM_CARD(c)];
  return POINT_LABEL[POINT_RANK_FROM_CARD(c)];
}

function createDeck() {
  const deck = [];
  for (let i = 0; i < 54; i++) deck.push(i);
  return deck;
}

function shuffle(deck) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortCards(cards) {
  // 升序：点数小的在前；同点数花色无关
  return cards.slice().sort((a, b) => POINT_RANK_FROM_CARD(a) - POINT_RANK_FROM_CARD(b));
}

/**
 * 识别牌型
 * 返回 { type, rank, length, kicker } 或 null
 *   type: 'single' | 'pair' | 'triple' | 'triple_single' | 'triple_pair'
 *       | 'straight' | 'pair_straight' | 'plane' | 'plane_single' | 'plane_pair'
 *       | 'bomb' | 'rocket'
 *   rank:  比较用主值（顺子/连对/飞机的「最小三张/对子」点；单/对/三带/炸弹=该点）
 *   length: 顺子张数、连对对数、飞机连续组数等
 *   kicker: 附带牌的信息（占位用，暂未使用）
 */
function identify(cards) {
  if (!cards || cards.length === 0) return null;
  const sorted = sortCards(cards);
  const ranks = sorted.map(POINT_RANK_FROM_CARD);
  const count = {}; // rank -> count
  for (const r of ranks) count[r] = (count[r] || 0) + 1;
  const groups = Object.entries(count).map(([r, c]) => ({ rank: +r, count: c })).sort((a, b) => a.rank - b.rank);

  // 火箭
  if (ranks.length === 2 && ranks.includes(13) && ranks.includes(14)) {
    return { type: 'rocket', rank: 14, length: 1 };
  }

  // 炸弹
  if (ranks.length === 4 && new Set(ranks).size === 1) {
    return { type: 'bomb', rank: ranks[0], length: 1 };
  }

  const n = cards.length;

  // 单
  if (n === 1) return { type: 'single', rank: ranks[0], length: 1 };

  // 对
  if (n === 2 && new Set(ranks).size === 1) {
    return { type: 'pair', rank: ranks[0], length: 1 };
  }

  // 三张
  if (n === 3 && new Set(ranks).size === 1) {
    return { type: 'triple', rank: ranks[0], length: 1 };
  }

  // 三带一
  if (n === 4) {
    const tri = groups.find((g) => g.count === 3);
    if (tri) return { type: 'triple_single', rank: tri.rank, length: 1 };
  }

  // 三带二
  if (n === 5) {
    const tri = groups.find((g) => g.count === 3);
    const pair = groups.find((g) => g.count === 2);
    if (tri && pair) return { type: 'triple_pair', rank: tri.rank, length: 1 };
  }

  // 顺子：5+ 张连续单，不能含 2(12) 和王(13,14)
  if (n >= 5) {
    const allSingle = groups.every((g) => g.count === 1);
    if (allSingle && ranks.every((r) => r < 12)) {
      let consecutive = true;
      for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) { consecutive = false; break; }
      if (consecutive) return { type: 'straight', rank: ranks[0], length: ranks.length };
    }
  }

  // 连对：3+ 对连续对子，不能含 2 和王
  if (n >= 6 && n % 2 === 0) {
    const allPair = groups.every((g) => g.count === 2);
    if (allPair && groups.every((g) => g.rank < 12)) {
      let consecutive = true;
      for (let i = 1; i < groups.length; i++) if (groups[i].rank !== groups[i - 1].rank + 1) { consecutive = false; break; }
      if (consecutive) return { type: 'pair_straight', rank: groups[0].rank, length: groups.length };
    }
  }

  // 飞机：2+ 个连续三张（可带或不带）
  // 飞机纯：n = 3*k, k>=2, 含 k 个连续三张
  // 飞机带单：n = 4*k, k>=2, 含 k 个连续三张 + k 个单
  // 飞机带对：n = 5*k, k>=2, 含 k 个连续三张 + k 个对
  {
    const triples = groups.filter((g) => g.count === 3).map((g) => g.rank);
    if (triples.length >= 2) {
      // 检查连续
      let consecutive = true;
      for (let i = 1; i < triples.length; i++) if (triples[i] !== triples[i - 1] + 1) { consecutive = false; break; }
      if (consecutive && triples[0] < 12) {
        const k = triples.length;
        const triplesTotal = 3 * k;
        const rest = n - triplesTotal;

        if (rest === 0) {
          return { type: 'plane', rank: triples[0], length: k };
        }
        if (rest === k) {
          // 带 k 个单
          const singleCount = groups.filter((g) => g.count === 1).length;
          if (singleCount === k) return { type: 'plane_single', rank: triples[0], length: k };
        }
        if (rest === 2 * k) {
          // 带 k 个对
          const pairCount = groups.filter((g) => g.count === 2).length;
          if (pairCount === k) return { type: 'plane_pair', rank: triples[0], length: k };
        }
      }
    }
  }

  // 四带二：4 张 + 2 单 或 2 对（简化为可选实现，本版支持）
  if (n === 6) {
    const four = groups.find((g) => g.count === 4);
    if (four && groups.length === 3) {
      // 4 + 1 + 1
      const singles = groups.filter((g) => g.count === 1).length;
      if (singles === 2) return { type: 'four_two_single', rank: four.rank, length: 1 };
    }
    if (n === 8) {
      const four = groups.find((g) => g.count === 4);
      if (four && groups.length === 3) {
        const pairs = groups.filter((g) => g.count === 2).length;
        if (pairs === 2) return { type: 'four_two_pair', rank: four.rank, length: 1 };
      }
    }
  }

  return null; // 非法牌型
}

/**
 * 判断 out 能否压过 top
 * top 为 null/undefined 时，out 一定合法
 * 同类型：主值 rank 必须更大（顺子/连对/飞机还需 length 相等）
 * 火箭最大
 * 炸弹 > 所有非炸弹/火箭（同 rank 比大小）
 */
function canBeat(out, top) {
  if (!top) return true;
  if (out.type === 'rocket') return true;
  if (top.type === 'rocket') return false;
  if (out.type === 'bomb' && top.type !== 'bomb') return true;
  if (out.type === 'bomb' && top.type === 'bomb') return out.rank > top.rank;
  if (out.type !== top.type) return false;
  if (out.type === 'straight' || out.type === 'pair_straight' || out.type === 'plane'
      || out.type === 'plane_single' || out.type === 'plane_pair') {
    return out.length === top.length && out.rank > top.rank;
  }
  return out.rank > top.rank;
}

module.exports = {
  POINT_LABEL, SUIT_LABEL,
  POINT_RANK_FROM_CARD, SUIT_FROM_CARD,
  cardName, createDeck, shuffle, sortCards,
  identify, canBeat,
};
