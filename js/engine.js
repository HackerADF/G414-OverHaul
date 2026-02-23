/**
 * engine.js – Alpha-beta minimax chess engine with:
 *   • Iterative deepening with aspiration windows
 *   • Null-move pruning (R=3)
 *   • Late-move reductions (LMR) with log-based depth/move-index table
 *   • Razoring (depth ≤ 2) + futility pruning + delta pruning in quiescence
 *   • Check extensions (depth ≤ 2)
 *   • Move ordering: MVV/LVA, killers (from+to key), history heuristic with gravity decay
 *   • PVS (Principal Variation Search) with null-window re-search
 *   • 1M-slot transposition table
 *   • Piece-square tables (opening + endgame blended by phase)
 *   • Material + symmetric mobility (phase-scaled, skipped in QS) + pawn structure evaluation:
 *     – Passed pawns (phase-scaled), candidate passed pawns, doubled, isolated
 *     – Rook on open/semi-open file, rook on 7th rank
 *     – Bishop pair bonus, tempo bonus
 *     – Pawn shield king safety, king attack zone (piece proximity)
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
function evaluate(chess, skipMobility = false) {
  if (chess.in_checkmate()) return chess.turn() === 'w' ? -30000 : 30000;
  if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition()) return 0;

  let score = 0;
  let wMat = 0, bMat = 0;
  let wBishops = 0, bBishops = 0;
  let wPawnCount = 0, bPawnCount = 0;
  let wKingFile = -1, wKingRank = -1;
  let bKingFile = -1, bKingRank = -1;
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const realSq = 'abcdefgh'[f] + (8 - r);
      const val   = PIECE_VALUE[p.type];
      const idx   = sqIdx(realSq, p.color);

      let pst = 0;
      if (p.type !== 'k') pst = PST[p.type][idx];

      if (p.color === 'w') { wMat += val; score += val + pst; }
      else                  { bMat += val; score -= val + pst; }

      if (p.type === 'b') { if (p.color === 'w') wBishops++; else bBishops++; }
      if (p.type === 'p') { if (p.color === 'w') wPawnCount++; else bPawnCount++; }
      if (p.type === 'k') {
        if (p.color === 'w') { wKingFile = f; wKingRank = 8 - r; }
        else                  { bKingFile = f; bKingRank = 8 - r; }
      }
    }
  }

  // Bishop pair bonus scales with board openness: fewer pawns = more valuable bishops
  const bpOpenScale = Math.max(0.3, 1 - (wPawnCount + bPawnCount) / 16);
  if (wBishops >= 2) score += Math.round(30 * bpOpenScale);
  if (bBishops >= 2) score -= Math.round(30 * bpOpenScale);

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

  // King attack zone: penalise opponent pieces swarming king proximity
  score += kingAttackScore(board, wKingFile, wKingRank, bKingFile, bKingRank, endgameW);

  // King tropism: reward pieces that are geometrically close to the enemy king
  score += kingTropismScore(board, wKingFile, wKingRank, bKingFile, bKingRank);

  // Rook on 7th rank: bonus when rook reaches the opponent's pawn rank or traps the enemy king
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'r') continue;
      const rank = 8 - r;
      if (p.color === 'w' && rank === 7) {
        const has7thPawns = (bPawnFiles[f] || []).includes(7) ||
          Object.values(bPawnFiles).some(ranks => ranks.includes(7));
        if (has7thPawns || bKingRank === 8) score += 25;
      }
      if (p.color === 'b' && rank === 2) {
        const has2ndPawns = Object.values(wPawnFiles).some(ranks => ranks.includes(2));
        if (has2ndPawns || wKingRank === 1) score -= 25;
      }
    }
  }

  // Knight outpost: bonus for a knight on an advanced square protected by a
  // friendly pawn where no enemy pawn can challenge it
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type !== 'n') continue;
      const rank = 8 - r;
      if (p.color === 'w' && rank >= 5) {
        const protectedByPawn = (wPawnFiles[f - 1] || []).includes(rank - 1)
                             || (wPawnFiles[f + 1] || []).includes(rank - 1);
        const challengeable = (bPawnFiles[f - 1] || []).some(br => br < rank)
                           || (bPawnFiles[f + 1] || []).some(br => br < rank);
        if (protectedByPawn && !challengeable) score += 20;
      }
      if (p.color === 'b' && rank <= 4) {
        const protectedByPawn = (bPawnFiles[f - 1] || []).includes(rank + 1)
                             || (bPawnFiles[f + 1] || []).includes(rank + 1);
        const challengeable = (wPawnFiles[f - 1] || []).some(wr => wr > rank)
                           || (wPawnFiles[f + 1] || []).some(wr => wr > rank);
        if (protectedByPawn && !challengeable) score -= 20;
      }
    }
  }

  // Space advantage: total pawn rank advance on central files (c-f), middlegame only
  {
    let wSpace = 0, bSpace = 0;
    for (let f = 2; f <= 5; f++) {
      for (const rank of (wPawnFiles[f] || [])) wSpace += rank - 2;
      for (const rank of (bPawnFiles[f] || [])) bSpace += 7 - rank;
    }
    const spaceMgW = Math.max(0, 1 - endgameW) * 0.5;
    score += Math.round((wSpace - bSpace) * spaceMgW);
  }

  // Tempo bonus: initiative advantage scales from 15cp in opening to 5cp in endgame
  const tempoVal = Math.round(15 - 10 * endgameW);
  score += chess.turn() === 'w' ? tempoVal : -tempoVal;

  // Rook battery bonus: doubled rooks on the same file or rank
  {
    const wRooks = [], bRooks = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'r') (p.color === 'w' ? wRooks : bRooks).push({ r, f });
      }
    }
    for (let i = 0; i < wRooks.length - 1; i++)
      for (let j = i + 1; j < wRooks.length; j++)
        if (wRooks[i].f === wRooks[j].f || wRooks[i].r === wRooks[j].r) score += 15;
    for (let i = 0; i < bRooks.length - 1; i++)
      for (let j = i + 1; j < bRooks.length; j++)
        if (bRooks[i].f === bRooks[j].f || bRooks[i].r === bRooks[j].r) score -= 15;
  }

  // Hanging piece penalty: penalise pieces attacked by enemy pawns but not defended by own pawns
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type === 'p' || p.type === 'k') continue;
      if (PIECE_VALUE[p.type] < 300) continue;
      const rank = 8 - r;
      if (p.color === 'w') {
        const attackedByBPawn = (bPawnFiles[f - 1] || []).some(br => br === rank + 1)
                             || (bPawnFiles[f + 1] || []).some(br => br === rank + 1);
        if (attackedByBPawn) {
          const defendedByWPawn = (wPawnFiles[f - 1] || []).some(wr => wr === rank - 1)
                               || (wPawnFiles[f + 1] || []).some(wr => wr === rank - 1);
          if (!defendedByWPawn) score -= 20;
        }
      } else {
        const attackedByWPawn = (wPawnFiles[f - 1] || []).some(wr => wr === rank - 1)
                             || (wPawnFiles[f + 1] || []).some(wr => wr === rank - 1);
        if (attackedByWPawn) {
          const defendedByBPawn = (bPawnFiles[f - 1] || []).some(br => br === rank + 1)
                               || (bPawnFiles[f + 1] || []).some(br => br === rank + 1);
          if (!defendedByBPawn) score += 20;
        }
      }
    }
  }

  // Symmetric mobility: score difference between both sides' legal move counts,
  // scaled by middlegame weight (mobility matters less in the endgame)
  if (!skipMobility) {
    const toMoveCount = chess.moves().length;
    const fenParts = chess.fen().split(' ');
    fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
    fenParts[3] = '-'; // clear en passant (invalid for swapped side)
    let oppCount = 0;
    try { oppCount = new Chess(fenParts.join(' ')).moves().length; } catch (_) {}
    const mgW = Math.max(0, 1 - endgameW);
    const wMobility = chess.turn() === 'w' ? toMoveCount : oppCount;
    const bMobility = chess.turn() === 'w' ? oppCount : toMoveCount;
    score += Math.round((wMobility - bMobility) * 2 * mgW);
  }

  return score;
}

/* ── King tropism: piece proximity to enemy king ────────── */
// Bonus for having pieces close to the enemy king (Chebyshev distance).
// Returns centipawns positive = white pieces closer to black king.
function kingTropismScore(board, wKingFile, wKingRank, bKingFile, bKingRank) {
  const TROPISM_W = { n: 3, b: 2, r: 2, q: 4 };
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const w = TROPISM_W[p.type];
      if (!w) continue;
      const pr = 8 - r;
      if (p.color === 'w' && bKingFile >= 0) {
        const dist = Math.max(Math.abs(f - bKingFile), Math.abs(pr - bKingRank));
        score += Math.max(0, (7 - dist) * w);
      }
      if (p.color === 'b' && wKingFile >= 0) {
        const dist = Math.max(Math.abs(f - wKingFile), Math.abs(pr - wKingRank));
        score -= Math.max(0, (7 - dist) * w);
      }
    }
  }
  return Math.round(score * 0.5);
}

/* ── King attack zone safety ─────────────────────────────── */
// Counts opponent pieces in the 3×3 zone around each king and applies a
// non-linear penalty. Returns centipawns, positive = white king safer.
function kingAttackScore(board, wKingFile, wKingRank, bKingFile, bKingRank, endgameW) {
  if (endgameW > 0.7) return 0; // king centralisation in endgame is fine
  const ATTACK_WEIGHT = { p: 1, n: 2, b: 2, r: 3, q: 5, k: 0 };
  let wZoneAttacks = 0, bZoneAttacks = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p || p.type === 'k') continue;
      const pieceRank = 8 - r;
      const w = ATTACK_WEIGHT[p.type] || 0;
      if (p.color === 'b' && wKingFile >= 0) {
        if (Math.abs(f - wKingFile) <= 1 && Math.abs(pieceRank - wKingRank) <= 1)
          wZoneAttacks += w;
      }
      if (p.color === 'w' && bKingFile >= 0) {
        if (Math.abs(f - bKingFile) <= 1 && Math.abs(pieceRank - bKingRank) <= 1)
          bZoneAttacks += w;
      }
    }
  }
  const penalty = att => att === 0 ? 0 : att === 1 ? 10 : att === 2 ? 25
                       : att === 3 ? 45 : 70 + (att - 3) * 15;
  return Math.round((penalty(bZoneAttacks) - penalty(wZoneAttacks)) * (1 - endgameW));
}

/* ── Pawn structure evaluation ───────────────────────────── */
function pawnEval(board, wPawnFiles, bPawnFiles, wKingFile, wKingRank, bKingFile, bKingRank, endgameW) {
  let s = 0;
  const passedBonus = [0, 0, 10, 20, 35, 55, 80, 120];

  // Passed pawn bonus (phase-scaled: half value in opening, full in endgame)
  const CANDIDATE_BONUS = [0, 0, 5, 10, 20, 35, 0, 0];
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((bPawnFiles[bf] || []).some(br => br > rank)) { passed = false; break; }
      }
      if (passed) {
        const phaseScale = 0.5 + 0.5 * endgameW;
        s += Math.round((passedBonus[rank] || 0) * phaseScale);
      } else {
        // Candidate passed pawn: open path ahead, more supporters than stoppers
        if ((bPawnFiles[f] || []).filter(br => br > rank).length === 0) {
          let supporters = 0, stoppers = 0;
          for (let df = -1; df <= 1; df += 2) {
            const af = f + df;
            if (af < 0 || af > 7) continue;
            supporters += (wPawnFiles[af] || []).filter(wr => wr >= rank - 1 && wr <= rank + 2).length;
            stoppers   += (bPawnFiles[af] || []).filter(br => br > rank).length;
          }
          if (supporters > stoppers) s += CANDIDATE_BONUS[rank] || 0;
        }
      }
    }
    for (const rank of (bPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df;
        if (bf < 0 || bf > 7) continue;
        if ((wPawnFiles[bf] || []).some(wr => wr < rank)) { passed = false; break; }
      }
      if (passed) {
        const phaseScale = 0.5 + 0.5 * endgameW;
        s -= Math.round((passedBonus[9 - rank] || 0) * phaseScale);
      } else {
        if ((wPawnFiles[f] || []).filter(wr => wr < rank).length === 0) {
          let supporters = 0, stoppers = 0;
          for (let df = -1; df <= 1; df += 2) {
            const af = f + df;
            if (af < 0 || af > 7) continue;
            supporters += (bPawnFiles[af] || []).filter(br => br <= rank + 1 && br >= rank - 2).length;
            stoppers   += (wPawnFiles[af] || []).filter(wr => wr < rank).length;
          }
          if (supporters > stoppers) s -= CANDIDATE_BONUS[9 - rank] || 0;
        }
      }
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

  // Rook behind passed pawn: rook on the same file behind a passed pawn supports its advance
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df; if (bf < 0 || bf > 7) continue;
        if ((bPawnFiles[bf] || []).some(br => br > rank)) { passed = false; break; }
      }
      if (passed) {
        for (let rr = 0; rr < 8; rr++) {
          const p = board[rr][f];
          if (p && p.type === 'r' && p.color === 'w' && (8 - rr) < rank) {
            s += Math.round(15 * endgameW); break;
          }
        }
      }
    }
    for (const rank of (bPawnFiles[f] || [])) {
      let passed = true;
      for (let df = -1; df <= 1; df++) {
        const bf = f + df; if (bf < 0 || bf > 7) continue;
        if ((wPawnFiles[bf] || []).some(wr => wr < rank)) { passed = false; break; }
      }
      if (passed) {
        for (let rr = 0; rr < 8; rr++) {
          const p = board[rr][f];
          if (p && p.type === 'r' && p.color === 'b' && (8 - rr) > rank) {
            s -= Math.round(15 * endgameW); break;
          }
        }
      }
    }
  }

  // Backward pawn penalty: pawn that cannot be supported by friendly pawns,
  // whose stop square is controlled by an enemy pawn, and is blocked by one
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      const hasSupport = (wPawnFiles[f - 1] || []).some(wr => wr <= rank)
                      || (wPawnFiles[f + 1] || []).some(wr => wr <= rank);
      if (!hasSupport) {
        const stopControlled = (bPawnFiles[f - 1] || []).some(br => br === rank + 1)
                            || (bPawnFiles[f + 1] || []).some(br => br === rank + 1);
        const blocked = (bPawnFiles[f] || []).some(br => br === rank + 1);
        if (stopControlled && blocked) s -= 15;
      }
    }
    for (const rank of (bPawnFiles[f] || [])) {
      const hasSupport = (bPawnFiles[f - 1] || []).some(br => br >= rank)
                      || (bPawnFiles[f + 1] || []).some(br => br >= rank);
      if (!hasSupport) {
        const stopControlled = (wPawnFiles[f - 1] || []).some(wr => wr === rank - 1)
                            || (wPawnFiles[f + 1] || []).some(wr => wr === rank - 1);
        const blocked = (wPawnFiles[f] || []).some(wr => wr === rank - 1);
        if (stopControlled && blocked) s += 15;
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

  // Pawn chain bonus: pawn that defends another pawn diagonally one rank ahead
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      if ((wPawnFiles[f - 1] || []).includes(rank + 1) || (wPawnFiles[f + 1] || []).includes(rank + 1))
        s += 10;
    }
    for (const rank of (bPawnFiles[f] || [])) {
      if ((bPawnFiles[f - 1] || []).includes(rank - 1) || (bPawnFiles[f + 1] || []).includes(rank - 1))
        s -= 10;
    }
  }

  // Connected pawns bonus: mutual pawn defense on adjacent files (±1 rank)
  for (let f = 0; f < 8; f++) {
    for (const rank of (wPawnFiles[f] || [])) {
      const connected = (f > 0 && (wPawnFiles[f - 1] || []).some(wr => Math.abs(wr - rank) <= 1))
                     || (f < 7 && (wPawnFiles[f + 1] || []).some(wr => Math.abs(wr - rank) <= 1));
      if (connected) s += 8;
    }
    for (const rank of (bPawnFiles[f] || [])) {
      const connected = (f > 0 && (bPawnFiles[f - 1] || []).some(br => Math.abs(br - rank) <= 1))
                     || (f < 7 && (bPawnFiles[f + 1] || []).some(br => Math.abs(br - rank) <= 1));
      if (connected) s -= 8;
    }
  }

  // Endgame king proximity to passed pawns: friendly king close = good, enemy king close = bad
  if (endgameW > 0.3) {
    for (let f = 0; f < 8; f++) {
      for (const rank of (wPawnFiles[f] || [])) {
        let passed = true;
        for (let df = -1; df <= 1; df++) {
          const bf = f + df; if (bf < 0 || bf > 7) continue;
          if ((bPawnFiles[bf] || []).some(br => br > rank)) { passed = false; break; }
        }
        if (passed && wKingFile >= 0) {
          const wDist = Math.max(Math.abs(wKingFile - f), Math.abs(wKingRank - rank));
          const bDist = bKingFile >= 0 ? Math.max(Math.abs(bKingFile - f), Math.abs(bKingRank - rank)) : 7;
          s += Math.round((bDist - wDist) * 5 * endgameW);
        }
      }
      for (const rank of (bPawnFiles[f] || [])) {
        let passed = true;
        for (let df = -1; df <= 1; df++) {
          const bf = f + df; if (bf < 0 || bf > 7) continue;
          if ((wPawnFiles[bf] || []).some(wr => wr < rank)) { passed = false; break; }
        }
        if (passed && bKingFile >= 0) {
          const bDist = Math.max(Math.abs(bKingFile - f), Math.abs(bKingRank - rank));
          const wDist = wKingFile >= 0 ? Math.max(Math.abs(wKingFile - f), Math.abs(wKingRank - rank)) : 7;
          s -= Math.round((wDist - bDist) * 5 * endgameW);
        }
      }
    }
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
function orderMoves(moves, chess, ply, prevMoveKey, ttMove) {
  // Killers stored as from+to keys (position-independent, transposition-safe)
  const kSet = new Set((_killers[ply] || []).filter(Boolean));
  const counterKey = prevMoveKey ? _counterMoves[prevMoveKey] : null;
  return moves.slice().sort((a, b) => {
    const scoreMove = m => {
      let s = 0;
      // TT best move from a previous search at this position gets highest priority
      if (ttMove && m.from + m.to === ttMove) s += 300;
      if (m.captured) s += PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece];
      if (m.promotion) s += PIECE_VALUE[m.promotion] * 8;
      if (kSet.has(m.from + m.to)) s += 90;
      // Countermove bonus: quiet move that historically refutes the opponent's last move
      if (counterKey && !m.captured && !m.promotion && counterKey === m.piece + m.from + m.to) s += 75;
      // History bonus uses piece+from+to for finer granularity
      if (!m.captured && !m.promotion) {
        const hk = m.piece + m.from + m.to;
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

function ttSet(fen, depth, score, flag, bestMove) {
  const k = ttKey(fen);
  const e = ttTable[k];
  if (!e || e.depth <= depth) {
    ttTable[k] = { fen, depth, score, flag, bestMove: bestMove || null };
  }
}

function ttGetMove(fen) {
  const k = ttKey(fen);
  const e = ttTable[k];
  return (e && e.fen === fen && e.bestMove) ? e.bestMove : null;
}

/* ── Alpha-Beta Minimax ──────────────────────────────────── */
const INFINITY = 9999999;
let  _nodes = 0;

/* Killer moves: up to 2 quiet moves that caused a beta cutoff at each ply */
let _killers = [];

/* History heuristic: tracks how often quiet moves caused cutoffs */
let _histTable = {};

/* Countermove heuristic: best refutation for each opponent move (piece+from+to → counter key) */
let _counterMoves = {};

/* Move stack: records the move made at each ply for countermove lookup */
let _moveStack = [];

/* ── LMR reduction table [depth][moveIndex] ─────────────── */
const LMR_TABLE = (() => {
  const t = [];
  for (let d = 0; d < 32; d++) {
    t[d] = [];
    for (let m = 0; m < 64; m++) {
      t[d][m] = d === 0 || m === 0
        ? 0
        : Math.max(1, Math.floor(0.75 + Math.log(d) * Math.log(m + 1) / 2.25));
    }
  }
  return t;
})();

function alphaBeta(chess, depth, alpha, beta, maximizing, ply) {
  _nodes++;

  // Mate distance pruning: tighten alpha/beta based on the soonest possible mate
  alpha = Math.max(alpha, -(30000 - ply));
  beta  = Math.min(beta,   30000 - ply);
  if (alpha >= beta) return alpha;

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

  // Razoring: if static eval is far below alpha at depth 1-2, skip directly to QS
  const RAZOR_MARGIN = [0, 200, 350];
  let staticEval = null;
  if (!inCheckNow && depth <= 3) {
    staticEval = evaluate(chess);
    if (maximizing && depth >= 1 && depth <= 2 && staticEval + RAZOR_MARGIN[depth] < alpha) {
      const qsScore = quiescence(chess, alpha - 1, alpha, maximizing);
      if (qsScore < alpha) return qsScore;
    }
  }

  // Futility pruning extended to depth 3 with a larger margin
  const FUTILITY_MARGIN = [0, 150, 300, 500];

  const prevMoveKey = ply > 0 ? _moveStack[ply - 1] : null;
  const ttMove = ttGetMove(fen);
  const moves = orderMoves(rawMoves, chess, ply, prevMoveKey, ttMove);
  let best = maximizing ? -INFINITY : INFINITY;
  let bestMoveSoFar = null;
  const origAlpha = alpha;
  let searchedFirst = false;
  let quietSearched = 0;
  // Late move pruning thresholds per depth (max quiet moves before skipping the rest)
  const LMP_THRESHOLD = [0, 5, 12];

  for (let mi = 0; mi < moves.length; mi++) {
    const move = moves[mi];
    const isQuiet = !move.captured && !move.promotion;

    // Skip quiet moves that statically cannot reach alpha
    if (staticEval !== null && isQuiet) {
      if (maximizing && staticEval + FUTILITY_MARGIN[depth] <= alpha) continue;
      if (!maximizing && staticEval - FUTILITY_MARGIN[depth] >= beta) continue;
    }

    // Late move pruning: after searching enough quiet moves at low depth, skip the rest
    if (!inCheckNow && depth <= 2 && isQuiet && searchedFirst) {
      quietSearched++;
      if (quietSearched > LMP_THRESHOLD[depth]) continue;
    }

    _moveStack[ply] = move.piece + move.from + move.to;
    chess.move(move);

    const givesCheck = chess.in_check();
    let score;
    const newDepth = depth - 1;

    if (!searchedFirst) {
      // PV move: full-window search
      score = alphaBeta(chess, newDepth, alpha, beta, !maximizing, ply + 1);
      searchedFirst = true;
    } else if (mi >= 2 && depth >= 3 && isQuiet && !givesCheck && !inCheckNow) {
      // LMR + PVS null-window at reduced depth
      const r = Math.min(newDepth, LMR_TABLE[Math.min(31, depth)][Math.min(63, mi)]);
      const reducedDepth = newDepth - r;
      const nullLo = maximizing ? alpha : beta - 1;
      const nullHi = maximizing ? alpha + 1 : beta;
      score = alphaBeta(chess, reducedDepth, nullLo, nullHi, !maximizing, ply + 1);
      if (score > alpha && score < beta) {
        score = alphaBeta(chess, newDepth, alpha, beta, !maximizing, ply + 1);
      }
    } else {
      // PVS null-window for subsequent non-LMR moves
      const nullLo = maximizing ? alpha : beta - 1;
      const nullHi = maximizing ? alpha + 1 : beta;
      score = alphaBeta(chess, newDepth, nullLo, nullHi, !maximizing, ply + 1);
      if (score > alpha && score < beta) {
        score = alphaBeta(chess, newDepth, alpha, beta, !maximizing, ply + 1);
      }
    }

    chess.undo();

    if (maximizing) {
      if (score > best) { best = score; bestMoveSoFar = move.from + move.to; }
      if (score > alpha) {
        alpha = score;
        // History bonus for quiet moves that raise alpha (not just cutoffs)
        if (isQuiet) {
          const hk = move.piece + move.from + move.to;
          _histTable[hk] = (_histTable[hk] || 0) + depth;
        }
      }
    } else {
      if (score < best) { best = score; bestMoveSoFar = move.from + move.to; }
      if (score < beta) {
        beta = score;
        if (isQuiet) {
          const hk = move.piece + move.from + move.to;
          _histTable[hk] = (_histTable[hk] || 0) + depth;
        }
      }
    }
    if (alpha >= beta) {
      // Store killer move for quiet beta cutoffs (from+to key is transposition-safe)
      if (!move.captured && !move.promotion) {
        if (!_killers[ply]) _killers[ply] = [null, null];
        const kk = move.from + move.to;
        if (_killers[ply][0] !== kk) {
          _killers[ply][1] = _killers[ply][0];
          _killers[ply][0] = kk;
        }
        // Update history table with piece+from+to key
        const hk = move.piece + move.from + move.to;
        _histTable[hk] = (_histTable[hk] || 0) + depth * depth;
        // Countermove: record which move refuted the opponent's previous move
        if (prevMoveKey) _counterMoves[prevMoveKey] = hk;
      }
      break;
    }
  }

  // Store in TT with best move for future move ordering
  const flag = best >= beta   ? TT_LOWER
             : best <= origAlpha ? TT_UPPER
             : TT_EXACT;
  ttSet(fen, depth, best, flag, bestMoveSoFar);

  return best;
}

/* ── Quiescence Search ───────────────────────────────────── */
function quiescence(chess, alpha, beta, maximizing) {
  _nodes++;
  const inCheck = chess.in_check();
  let stand;

  if (!inCheck) {
    stand = evaluate(chess, true); // skip mobility for speed
    if (maximizing) {
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    } else {
      if (stand <= alpha) return alpha;
      if (stand < beta) beta = stand;
    }
  }

  const DELTA = 200; // delta pruning margin
  // In check: must search all evasions, not just captures
  let allMoves;
  if (inCheck) {
    allMoves = chess.moves({ verbose: true });
    if (!allMoves.length) return maximizing ? -30000 : 30000; // checkmate
  } else {
    allMoves = chess.moves({ verbose: true }).filter(m => m.captured || m.promotion);
  }

  // Sort by MVV-LVA for earlier cutoffs
  allMoves.sort((a, b) => {
    const val = m => (m.captured ? PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece] : 0)
                   + (m.promotion ? PIECE_VALUE[m.promotion] : 0);
    return val(b) - val(a);
  });

  for (const move of allMoves) {
    // Delta pruning only when not in check (we have a stand pat value)
    if (!inCheck && move.captured) {
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
  _moveStack = [];
  // Countermove table persists across calls (positions/responses are stable)
  // History gravity: preserve prior-iteration data at half weight so hot
  // moves from shallower depths guide move ordering in deeper iterations
  const oldHist = _histTable;
  _histTable = {};
  for (const k in oldHist) {
    const v = oldHist[k] >> 1;
    if (v > 0) _histTable[k] = v;
  }
  const rawMoves = chess.moves({ verbose: true });
  if (!rawMoves.length) return [];

  const results = [];

  const ASP_DELTA = 50; // initial aspiration window half-width in centipawns

  for (const move of rawMoves) {
    chess.move(move);
    let score = 0;
    let prevScore = 0;
    // Iterative deepening with incrementally widening aspiration windows
    for (let d = 1; d <= depth; d++) {
      let s;
      if (d > 1) {
        // Try narrow window; on miss widen to 3× before falling back to full
        let lo = prevScore - ASP_DELTA, hi = prevScore + ASP_DELTA;
        s = alphaBeta(chess, d - 1, lo, hi, !max, 0);
        if (s <= lo || s >= hi) {
          lo = prevScore - ASP_DELTA * 3;
          hi = prevScore + ASP_DELTA * 3;
          s = alphaBeta(chess, d - 1, lo, hi, !max, 0);
          if (s <= lo || s >= hi) {
            s = alphaBeta(chess, d - 1, -INFINITY, INFINITY, !max, 0);
          }
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
