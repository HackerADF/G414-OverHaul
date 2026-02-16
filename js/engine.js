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
  let wKingFile = -1, wKingRank = -1;
  let bKingFile = -1, bKingRank = -1;
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
      if (p.type === 'k') {
        if (p.color === 'w') { wKingFile = f; wKingRank = 8 - r; }
        else                  { bKingFile = f; bKingRank = 8 - r; }
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

  // Pawn structure + rook files + pawn shield
  score += pawnEval(board, wPawnFiles, bPawnFiles, wKingFile, wKingRank, bKingFile, bKingRank, endgameW);

  // Tempo bonus: the side to move has a small initiative advantage
  score += chess.turn() === 'w' ? 10 : -10;

  // Mobility bonus
  score += chess.moves().length * (chess.turn() === 'w' ? 2 : -2);

  return score;
}

/* ── Pawn structure evaluation ───────────────────────────── */
function pawnEval(board, wPawnFiles, bPawnFiles, wKingFile, wKingRank, bKingFile, bKingRank, endgameW) {
  let s = 0;
  const passedBonus = [0, 0, 10, 20, 35, 55, 80, 120];

  // Passed pawn bonus
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((bPawnFiles[bf] || []).some(br => br > rank)) { passed = false; break; }
      }
      if (passed) s += passedBonus[rank] || 0;
    }
    for (const rank of (bPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((wPawnFiles[bf] || []).some(wr => wr < rank)) { passed = false; break; }
      }
      if (passed) s -= passedBonus[9 - rank] || 0;
    }
  }

  // Doubled pawn penalty
  for (let f = 0; f < 8; f++) {
    const wc = (wPawnFiles[f] || []).length;
    const bc = (bPawnFiles[f] || []).length;
    if (wc > 1) s -= (wc - 1) * 25;
    if (bc > 1) s += (bc - 1) * 25;
  }

  // Rook on open / semi-open file
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'r') continue;
      const own = p.color === 'w' ? (wPawnFiles[f] || []) : (bPawnFiles[f] || []);
      const opp = p.color === 'w' ? (bPawnFiles[f] || []) : (wPawnFiles[f] || []);
      if (own.length === 0 && opp.length === 0) {
        if (p.color === 'w') s += 25; else s -= 25;
      } else if (own.length === 0) {
        if (p.color === 'w') s += 12; else s -= 12;
      }
    }
  }

  // Isolated pawn penalty
  for (let f = 0; f < 8; f++) {
    const wc = (wPawnFiles[f] || []).length;
    const bc = (bPawnFiles[f] || []).length;
    if (wc > 0 && !wPawnFiles[f - 1] && !wPawnFiles[f + 1]) s -= wc * 20;
    if (bc > 0 && !bPawnFiles[f - 1] && !bPawnFiles[f + 1]) s += bc * 20;
  }

  // Pawn shield (middlegame only)
  if (endgameW < 0.6) {
    const shieldMg = Math.round(8 * (1 - endgameW));
    if (wKingFile >= 0) {
      for (let df = -1; df <= 1; df++) {
        const sf = wKingFile + df;
        if (sf < 0 || sf > 7) continue;
        const ranks = wPawnFiles[sf] || [];
        if (ranks.some(rk => rk === wKingRank + 1 || rk === wKingRank + 2)) s += shieldMg;
      }
    }
    if (bKingFile >= 0) {
      for (let df = -1; df <= 1; df++) {
        const sf = bKingFile + df;
        if (sf < 0 || sf > 7) continue;
        const ranks = bPawnFiles[sf] || [];
        if (ranks.some(rk => rk === bKingRank - 1 || rk === bKingRank - 2)) s -= shieldMg;
      }
    }
  }

  return s;
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

/* ── Null-move FEN helper ────────────────────────────────── */
function makeNullMoveFen(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w'; // swap side to move
  parts[3] = '-';                           // clear en passant
  parts[4] = String(parseInt(parts[4]) + 1);
  return parts.join(' ');
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

  // Null-move pruning: pass our turn; if opponent still can't beat beta, prune
  const NMP_R = 3;
  const inCheckNow = chess.in_check();
  if (!inCheckNow && depth >= NMP_R + 1) {
    const nullFen = makeNullMoveFen(chess.fen());
    try {
      const nullChess = new Chess(nullFen);
      if (!nullChess.in_check()) { // legal null-move position
        const ns = alphaBeta(nullChess, depth - 1 - NMP_R, alpha, beta, !maximizing, ply + 1);
        if (maximizing && ns >= beta) return beta;
        if (!maximizing && ns <= alpha) return alpha;
      }
    } catch (_) {}
  }

  // Futility pruning: at low depths, skip quiet moves that cannot improve alpha
  const FUTILITY_MARGIN = [0, 150, 300];
  let staticEval = null;
  if (!inCheckNow && depth <= 2) staticEval = evaluate(chess);

  const moves = orderMoves(rawMoves, chess, ply);
  let best = maximizing ? -INFINITY : INFINITY;
  const origAlpha = alpha;

  for (let mi = 0; mi < moves.length; mi++) {
    const move = moves[mi];

    // Skip quiet moves that statically cannot reach alpha
    if (staticEval !== null && !move.captured && !move.promotion) {
      if (maximizing && staticEval + FUTILITY_MARGIN[depth] <= alpha) continue;
      if (!maximizing && staticEval - FUTILITY_MARGIN[depth] >= beta) continue;
    }

    chess.move(move);

    // Check extension: add one extra ply when the move gives check
    const givesCheck = chess.in_check();
    const ext = (depth <= 2 && givesCheck) ? 1 : 0;

    // Late-move reductions: reduce quiet moves after the first 3 at depth >= 3
    const isQuiet = !move.captured && !move.promotion;
    let score;
    if (mi >= 3 && depth >= 3 && isQuiet && !givesCheck) {
      score = alphaBeta(chess, depth - 2 + ext, alpha, beta, !maximizing, ply + 1);
      const needsResearch = maximizing ? score > alpha : score < beta;
      if (needsResearch) {
        score = alphaBeta(chess, depth - 1 + ext, alpha, beta, !maximizing, ply + 1);
      }
    } else {
      score = alphaBeta(chess, depth - 1 + ext, alpha, beta, !maximizing, ply + 1);
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

  const DELTA = 200; // delta pruning margin
  const captures = chess.moves({ verbose: true }).filter(m => m.captured || m.promotion);
  for (const move of captures) {
    // Delta pruning: skip captures whose maximum gain cannot reach alpha
    if (move.captured) {
      const gain = PIECE_VALUE[move.captured];
      if (maximizing  && stand + gain + DELTA < alpha) continue;
      if (!maximizing && stand - gain - DELTA > beta)  continue;
    }
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

  const ASP_WINDOW = 50; // aspiration window half-width in centipawns

  for (const move of rawMoves) {
    chess.move(move);
    let score = 0;
    let prevScore = 0;
    // Iterative deepening with aspiration windows
    for (let d = 1; d <= depth; d++) {
      let s;
      if (d > 1) {
        // Try narrow window first
        const lo = prevScore - ASP_WINDOW, hi = prevScore + ASP_WINDOW;
        s = alphaBeta(chess, d - 1, lo, hi, !max, 0);
        if (s <= lo || s >= hi) {
          // Window miss – fall back to full search
          s = alphaBeta(chess, d - 1, -INFINITY, INFINITY, !max, 0);
        }
      } else {
        s = alphaBeta(chess, d - 1, -INFINITY, INFINITY, !max, 0);
      }
      // Stop early on forced mate
      if (Math.abs(s) >= 29000) { score = s; break; }
      score = s;
      prevScore = score;
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
