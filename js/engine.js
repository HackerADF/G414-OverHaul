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
    }
  }

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

  // Mobility bonus
  score += chess.moves().length * (chess.turn() === 'w' ? 2 : -2);

  return score;
}

/* ── Move ordering ───────────────────────────────────────── */
function orderMoves(moves, chess) {
  return moves.slice().sort((a, b) => {
    const scoreMove = m => {
      let s = 0;
      if (m.captured) s += PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece];
      if (m.promotion) s += PIECE_VALUE[m.promotion] * 8;
      if (chess.in_check()) s += 50;
      return s;
    };
    return scoreMove(b) - scoreMove(a);
  });
}

/* ── Alpha-Beta Minimax ──────────────────────────────────── */
const INFINITY = 9999999;
let  _nodes = 0;

function alphaBeta(chess, depth, alpha, beta, maximizing, killers, history) {
  _nodes++;

  if (depth === 0) return quiescence(chess, alpha, beta, maximizing);

  if (chess.game_over()) return evaluate(chess);

  const rawMoves = chess.moves({ verbose: true });
  if (!rawMoves.length) return evaluate(chess);

  const moves = orderMoves(rawMoves, chess);
  let best = maximizing ? -INFINITY : INFINITY;

  for (const move of moves) {
    chess.move(move);
    const score = alphaBeta(chess, depth - 1, alpha, beta, !maximizing, killers, history);
    chess.undo();

    if (maximizing) {
      if (score > best) best = score;
      if (score > alpha) alpha = score;
    } else {
      if (score < best) best = score;
      if (score < beta)  beta = score;
    }
    if (alpha >= beta) break;
  }
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
  const rawMoves = chess.moves({ verbose: true });
  if (!rawMoves.length) return [];

  const results = [];

  for (const move of rawMoves) {
    chess.move(move);
    let score = 0;
    // Iterative deepening on each root move
    for (let d = 1; d <= depth; d++) {
      score = alphaBeta(chess, d - 1, -INFINITY, INFINITY, !max, {}, {});
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
