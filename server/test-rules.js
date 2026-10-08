/**
 * 出牌逻辑详细测试
 * 覆盖：牌型识别 + 大小比较 + 各种边界 case
 */
const rules = require('./rules');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✓', msg); }
  else { fail++; console.log('✗', msg); }
}

// 牌编码助手
// 0-51: 普通牌（花色0-3 × 点数0-12，点数0=3, 12=2）
// 52: 小王, 53: 大王
function card(suit, point) { return suit * 13 + point; } // 普通牌
const S = 52, B = 53;

// === 牌型识别 ===
console.log('\n=== 牌型识别 ===');
// 单张
assert(rules.identify([card(0, 0)]).type === 'single', '单张 ♠3');
assert(rules.identify([card(0, 12)]).type === 'single', '单张 ♠2');
assert(rules.identify([S]).type === 'single', '单张小王');
// 对子
assert(rules.identify([card(0, 0), card(1, 0)]).type === 'pair', '对子 3');
// 三张
assert(rules.identify([card(0, 5), card(1, 5), card(2, 5)]).type === 'triple', '三张 8');
// 三带一
assert(rules.identify([card(0, 5), card(1, 5), card(2, 5), card(3, 0)]).type === 'triple_single', '三带一 8+3');
// 三带二
assert(rules.identify([card(0, 5), card(1, 5), card(2, 5), card(0, 0), card(1, 0)]).type === 'triple_pair', '三带二 8+33');
// 顺子
assert(rules.identify([card(0, 0), card(1, 1), card(2, 2), card(3, 3), card(0, 4)]).type === 'straight', '顺子 3-7');
// 顺子不能含 2 或王
assert(rules.identify([card(0, 11), card(1, 11), card(2, 11), card(3, 11), card(0, 12)]) === null, '顺子不能含 2 (5 张结尾到 2)');
assert(rules.identify([card(0, 0), card(1, 1), card(2, 2), card(3, 3), S]) === null, '顺子不能含王');
// 连对
assert(rules.identify([card(0, 0), card(1, 0), card(2, 1), card(3, 1), card(0, 2), card(1, 2)]).type === 'pair_straight', '连对 33 44 55');
// 飞机
assert(rules.identify([card(0, 5), card(1, 5), card(2, 5), card(0, 6), card(1, 6), card(2, 6)]).type === 'plane', '飞机 888 999 (纯)');
// 飞机带单
const planeSingle = [card(0, 5), card(1, 5), card(2, 5), card(0, 6), card(1, 6), card(2, 6), card(3, 0), card(3, 1)];
assert(rules.identify(planeSingle).type === 'plane_single', '飞机带单 888 999 + 3 + 4');
// 飞机带对
const planePair = [card(0, 5), card(1, 5), card(2, 5), card(0, 6), card(1, 6), card(2, 6), card(3, 0), card(1, 0), card(0, 7), card(1, 7)];
assert(rules.identify(planePair).type === 'plane_pair', '飞机带对 888 999 + 33 + 44');
// 炸弹
assert(rules.identify([card(0, 0), card(1, 0), card(2, 0), card(3, 0)]).type === 'bomb', '炸弹 3333');
// 火箭
assert(rules.identify([S, B]).type === 'rocket', '火箭 双王');
// 非法牌型
assert(rules.identify([card(0, 0), card(1, 0), card(2, 1)]) === null, '非法: 2+1');
assert(rules.identify([]) === null, '非法: 空');

// === 大小比较 ===
console.log('\n=== 大小比较 ===');
// 单张
const s3 = rules.identify([card(0, 0)]);
const s4 = rules.identify([card(0, 1)]);
const sK = rules.identify([card(0, 10)]);
const sA = rules.identify([card(0, 11)]);
const s2 = rules.identify([card(0, 12)]);
const sS = rules.identify([S]);
const sB = rules.identify([B]);
const sR = rules.identify([S, B]);

assert(rules.canBeat(s4, s3) === true, '4 > 3');
assert(rules.canBeat(s3, s4) === false, '3 不 > 4');
assert(rules.canBeat(sA, sK) === true, 'A > K');
assert(rules.canBeat(s2, sA) === true, '2 > A');
assert(rules.canBeat(sS, s2) === true, '小王 > 2');
assert(rules.canBeat(sB, sS) === true, '大王 > 小王');
assert(rules.canBeat(sR, sB) === true, '火箭 > 大王');
assert(rules.canBeat(sR, s2) === true, '火箭 > 2');
assert(rules.canBeat(s2, sR) === false, '2 不 > 火箭');
assert(rules.canBeat(s3, null) === true, '首家出牌合法');

// 对子
const p3 = rules.identify([card(0, 0), card(1, 0)]);
const p4 = rules.identify([card(0, 1), card(1, 1)]);
assert(rules.canBeat(p4, p3) === true, '对4 > 对3');
assert(rules.canBeat(p3, s4) === false, '对3 不 > 单4');
assert(rules.canBeat(p3, s3) === false, '类型不同不能比');

// 三张
const t5 = rules.identify([card(0, 4), card(1, 4), card(2, 4)]);
const t6 = rules.identify([card(0, 5), card(1, 5), card(2, 5)]);
assert(rules.canBeat(t6, t5) === true, '三6 > 三5');

// 顺子
const sh1 = rules.identify([card(0, 0), card(1, 1), card(2, 2), card(3, 3), card(0, 4)]);  // 3-7
const sh2 = rules.identify([card(0, 1), card(1, 2), card(2, 3), card(3, 4), card(0, 5)]);  // 4-8
const sh3 = rules.identify([card(0, 0), card(1, 1), card(2, 2), card(3, 3), card(0, 4), card(1, 5)]); // 3-8
assert(rules.canBeat(sh2, sh1) === true, '顺子 4-8 > 3-7');
assert(rules.canBeat(sh3, sh1) === false, '顺子不同长度不能比 (6张 vs 5张)');
assert(rules.canBeat(sh1, t5) === false, '顺子不能压三张');

// 炸弹
const b3 = rules.identify([card(0, 0), card(1, 0), card(2, 0), card(3, 0)]);
const b4 = rules.identify([card(0, 1), card(1, 1), card(2, 1), card(3, 1)]);
assert(rules.canBeat(b3, sA) === true, '炸弹3333 > 单A');
assert(rules.canBeat(b3, t5) === true, '炸弹 > 三张');
assert(rules.canBeat(b4, b3) === true, '炸弹4444 > 炸弹3333');
assert(rules.canBeat(b3, b4) === false, '炸弹3333 不 > 炸弹4444');
assert(rules.canBeat(sR, b4) === true, '火箭 > 任何炸弹');
assert(rules.canBeat(b4, sR) === false, '炸弹 不 > 火箭');

// 飞机
const p1 = rules.identify([card(0, 5), card(1, 5), card(2, 5), card(0, 6), card(1, 6), card(2, 6), card(3, 0), card(3, 1)]); // 888 999 +3 +4
const p2 = rules.identify([card(0, 6), card(1, 6), card(2, 6), card(0, 7), card(1, 7), card(2, 7), card(3, 2), card(3, 3)]); // 999 JJJ +5 +6
assert(rules.canBeat(p2, p1) === true, '飞机 999JJJ > 888999');

// 飞机带对
const pp1 = rules.identify([card(0, 5), card(1, 5), card(2, 5), card(0, 6), card(1, 6), card(2, 6), card(3, 0), card(3, 1), card(0, 7), card(1, 7)]);
const pp2 = rules.identify([card(0, 6), card(1, 6), card(2, 6), card(0, 7), card(1, 7), card(2, 7), card(3, 2), card(3, 3), card(0, 8), card(1, 8)]);
assert(rules.canBeat(pp2, pp1) === true, '飞机带对 999JJJ+55 > 888999+33');

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
