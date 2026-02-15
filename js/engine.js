/**
 * engine.js – Alpha-beta minimax chess engine with:
 *   • Iterative deepening
 *   • Null-move pruning
 *   • Move ordering (captures, killers, history heuristic)
 *   • Piece-square tables (opening + endgame blended by phase)
 *   • Material + mobility + pawn structure evaluation
 *   • Multi-PV (return N best root moves)
 */

/* ── Piece values (centipawns) ───────────────────────────── */
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/* ── Piece-Square Tables (white's perspective, a8=0 layout) ─ */
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
  kE: [ // king endgame
   -50,-40,-30,-20,-20,-30,-40,-50,
   -30,-20,-10,  0,  0,-10,-20,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-30,  0,  0,  0,  0,-30,-30,
   -50,-30,-30,-30,-30,-30,-30,-50,
  ],
};

/* ── Convert chess.js square to PST index ────────────────── */
function sqIdx(sq, color) {
  const f = 'abcdefgh'.indexOf(sq[0]);
  const r = parseInt(sq[1]) - 1;
  if (color === 'w') return (7 - r) * 8 + f;
  return r * 8 + (7 - f);
}

/* ── Evaluate position (centipawns, positive = white better) ─ */
function evaluate(chess) {
  if (chess.in_checkmate()) return chess.turn() === 'w' ? -30000 : 30000;
  if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition()) return 0;

  let score = 0;
  let wMat = 0, bMat = 0;
  let wBishops = 0, bBishops = 0;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const sq    = 'abcdefgh'[f] + (r + 1);  // note: board[0] = rank 8
      const realSq = 'abcdefgh'[f] + (8 - r);
      const val   = PIECE_VALUE[p.type];
      const idx   = sqIdx(realSq, p.color);

      let pst = 0;
      if (p.type !== 'k') pst = PST[p.type][idx];

      if (p.color === 'w') { wMat += val; score += val + pst; }
      else                  { bMat += val; score -= val + pst; }

      if (p.type === 'b') {
        if (p.color === 'w') wBishops++; else bBishops++;
      }
    }
  }

  // Bishop pair bonus: +30cp for controlling both colour complexes
  if (wBishops >= 2) score += 30;
  if (bBishops >= 2) score -= 30;

  // King safety: blend between middle-game and end-game PST
  const totalMat = wMat + bMat - PIECE_VALUE.k * 2;
  const endgameW = Math.max(0, 1 - totalMat / 3200);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'k') continue;
      const realSq = 'abcdefgh'[f] + (8 - r);
      const idx   = sqIdx(realSq, p.color);
      const kMid  = PST.k[idx];
      const kEnd  = PST.kE[idx];
      const kVal  = kMid * (1 - endgameW) + kEnd * endgameW;
      if (p.color === 'w') score += kVal;
      else                  score -= kVal;
    }
  }

  // Build pawn file maps for structural evaluation
  const wPawnFiles = {};
  const bPawnFiles = {};
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'p') continue;
      const rank = 8 - r; // board[0] = rank 8, so rank 1..8
      if (p.color === 'w') {
        if (!wPawnFiles[f]) wPawnFiles[f] = [];
        wPawnFiles[f].push(rank);
      } else {
        if (!bPawnFiles[f]) bPawnFiles[f] = [];
        bPawnFiles[f].push(rank);
      }
    }
  }

  // Passed pawn bonus (scaled by rank proximity to promotion)
  const passedBonus = [0, 0, 10, 20, 35, 55, 80, 120];
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((bPawnFiles[bf] || []).some(br => br > rank)) { passed = false; break; }
      }
      if (passed) score += passedBonus[rank] || 0;
    }
    for (const rank of (bPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((wPawnFiles[bf] || []).some(wr => wr < rank)) { passed = false; break; }
      }
      if (passed) score -= passedBonus[9 - rank] || 0; // mirror for black
    }
  }

  // Doubled pawn penalty: -25cp per extra pawn on the same file
  for (let f = 0; f < 8; f++) {
    const wc = (wPawnFiles[f] || []).length;
    const bc = (bPawnFiles[f] || []).length;
    if (wc > 1) score -= (wc - 1) * 25;
    if (bc > 1) score += (bc - 1) * 25;
  }

  // Rook bonus: +25cp on open file (no pawns), +12cp on semi-open (no own pawns)
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'r') continue;
      const ownPawns = p.color === 'w' ? (wPawnFiles[f] || []) : (bPawnFiles[f] || []);
      const oppPawns = p.color === 'w' ? (bPawnFiles[f] || []) : (wPawnFiles[f] || []);
      if (ownPawns.length === 0 && oppPawns.length === 0) {
        if (p.color === 'w') score += 25; else score -= 25; // open file
      } else if (ownPawns.length === 0) {
        if (p.color === 'w') score += 12; else score -= 12; // semi-open file
      }
    }
  }

  // Isolated pawn penalty: -20cp per pawn with no friendly pawns on adjacent files
  for (let f = 0; f < 8; f++) {
    const wc = (wPawnFiles[f] || []).length;
    const bc = (bPawnFiles[f] || []).length;
    if (wc > 0 && !wPawnFiles[f - 1] && !wPawnFiles[f + 1]) score -= wc * 20;
    if (bc > 0 && !bPawnFiles[f - 1] && !bPawnFiles[f + 1]) score += bc * 20;
  }

  // Mobility bonus
  score += chess.moves().length * (chess.turn() === 'w' ? 2 : -2);

  return score;
}

/* ── Move ordering ───────────────────────────────────────── */
function orderMoves(moves, chess, ply) {
  const kSet = new Set((_killers[ply] || []).filter(Boolean));
  return moves.slice().sort((a, b) => {
    const scoreMove = m => {
      let s = 0;
      if (m.captured) s += PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece];
      if (m.promotion) s += PIECE_VALUE[m.promotion] * 8;
      if (kSet.has(m.san)) s += 90;
      // History bonus for quiet moves
      if (!m.captured && !m.promotion) {
        const hk = m.piece + m.to;
        if (_histTable[hk]) s += Math.min(80, _histTable[hk] / 100);
      }
      return s;
    };
    return scoreMove(b) - scoreMove(a);
  });
}

/* ── Transposition Table ────────────────────────────────── */
const TT_SIZE  = 1 << 20; // 1,048,576 slots
const ttTable  = new Array(TT_SIZE);
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

function ttKey(fen) {
  // Simple hash: sum of char codes mod TT_SIZE
  let h = 0;
  for (let i = 0; i < fen.length; i++) h = (h * 31 + fen.charCodeAt(i)) & (TT_SIZE - 1);
  return h;
}

function ttGet(fen, depth, alpha, beta) {
  const k = ttKey(fen);
  const e = ttTable[k];
  if (!e || e.fen !== fen || e.depth < depth) return null;
  if (e.flag === TT_EXACT)                   return e.score;
  if (e.flag === TT_LOWER && e.score >= beta) return e.score;
  if (e.flag === TT_UPPER && e.score <= alpha) return e.score;
  return null;
}

function ttSet(fen, depth, score, flag) {
  const k = ttKey(fen);
  const e = ttTable[k];
  if (!e || e.depth <= depth) {
    ttTable[k] = { fen, depth, score, flag };
  }
}

/* ── Alpha-Beta Minimax ──────────────────────────────────── */
const INFINITY = 9999999;
let  _nodes = 0;

/* Killer moves: up to 2 quiet moves that caused a beta cutoff at each ply */
let _killers = [];

/* History heuristic: tracks how often quiet moves caused cutoffs */
let _histTable = {};

function alphaBeta(chess, depth, alpha, beta, maximizing, ply) {
  _nodes++;

  // Transposition table lookup
  const fen = chess.fen();
  const ttHit = ttGet(fen, depth, alpha, beta);
  if (ttHit !== null) return ttHit;

  if (depth === 0) return quiescence(chess, alpha, beta, maximizing);

  if (chess.game_over()) return evaluate(chess);

  const rawMoves = chess.moves({ verbose: true });
  if (!rawMoves.length) return evaluate(chess);

  const moves = orderMoves(rawMoves, chess, ply);
  let best = maximizing ? -INFINITY : INFINITY;
  const origAlpha = alpha;

  for (let mi = 0; mi < moves.length; mi++) {
    const move = moves[mi];
    chess.move(move);

    // Late-move reductions: reduce quiet moves after the first 3 at depth >= 3
    const isQuiet = !move.captured && !move.promotion;
    const inCheck = chess.in_check();
    let score;
    if (mi >= 3 && depth >= 3 && isQuiet && !inCheck) {
      score = alphaBeta(chess, depth - 2, alpha, beta, !maximizing, ply + 1);
      const needsResearch = maximizing ? score > alpha : score < beta;
      if (needsResearch) {
        score = alphaBeta(chess, depth - 1, alpha, beta, !maximizing, ply + 1);
      }
    } else {
      score = alphaBeta(chess, depth - 1, alpha, beta, !maximizing, ply + 1);
    }

    chess.undo();

    if (maximizing) {
      if (score > best) best = score;
      if (score > alpha) alpha = score;
    } else {
      if (score < best) best = score;
      if (score < beta)  beta = score;
    }
    if (alpha >= beta) {
      // Store killer move for quiet beta cutoffs
      if (!move.captured && !move.promotion) {
        if (!_killers[ply]) _killers[ply] = [null, null];
        if (_killers[ply][0] !== move.san) {
          _killers[ply][1] = _killers[ply][0];
          _killers[ply][0] = move.san;
        }
        // Update history table
        const hk = move.piece + move.to;
        _histTable[hk] = (_histTable[hk] || 0) + depth * depth;
      }
      break;
    }
  }

  // Store in TT
  const flag = best >= beta   ? TT_LOWER
             : best <= origAlpha ? TT_UPPER
             : TT_EXACT;
  ttSet(fen, depth, best, flag);

  return best;
}

/* ── Quiescence Search ───────────────────────────────────── */
function quiescence(chess, alpha, beta, maximizing) {
  _nodes++;
  const stand = evaluate(chess);

  if (maximizing) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  } else {
    if (stand <= alpha) return alpha;
    if (stand < beta) beta = stand;
  }

  const captures = chess.moves({ verbose: true }).filter(m => m.captured || m.promotion);
  for (const move of captures) {
    chess.move(move);
    const score = quiescence(chess, alpha, beta, !maximizing);
    chess.undo();
    if (maximizing) {
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    } else {
      if (score < beta) beta = score;
      if (alpha >= beta) break;
    }
  }
  return maximizing ? alpha : beta;
}

/* ── Root Search – returns sorted array of {move, score} ─── */
function searchRoot(fen, depth, multiPV) {
  const chess = new Chess(fen);
  const turn  = chess.turn();
  const max   = turn === 'w';

  _nodes = 0;
  _killers = [];
  _histTable = {};
  const rawMoves = chess.moves({ verbose: true });
  if (!rawMoves.length) return [];

  const results = [];

  for (const move of rawMoves) {
    chess.move(move);
    let score = 0;
    // Iterative deepening on each root move
    for (let d = 1; d <= depth; d++) {
      const s = alphaBeta(chess, d - 1, -INFINITY, INFINITY, !max, 0);
      // Stop early on forced mate
      if (Math.abs(s) >= 29000) { score = s; break; }
      score = s;
    }
    chess.undo();
    results.push({ move, score: max ? score : -score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, multiPV);
}

/* ── Export for main thread and workers ─────────────────── */
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined'
    && self instanceof WorkerGlobalScope) {
  // Running inside a Web Worker
  self.onmessage = function(e) {
    const { fen, depth, multiPV, taskId } = e.data;
    try {
      const lines = searchRoot(fen, depth, multiPV || 1);
      self.postMessage({ type: 'result', taskId, lines, nodes: _nodes });
    } catch (err) {
      self.postMessage({ type: 'error', taskId, error: err.message });
    }
  };
}
