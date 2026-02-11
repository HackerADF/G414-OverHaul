/**
 * board.js – Chess board rendering, drag-and-drop, and input handling.
 */

class Board {
  constructor(chess, onMove) {
    this.chess   = chess;
    this.onMove  = onMove;          // callback(from, to, promotion)
    this.flipped = false;
    this.selected = null;           // algebraic square like 'e2'
    this.legalMoves = [];           // Move objects for selected piece
    this.lastMove   = null;         // {from, to}
    this.analysisLines = [];        // [{moves, color, score}]

    this.$board     = document.getElementById('board');
    this.$canvas    = document.getElementById('lines-canvas');
    this.$evalFill  = document.getElementById('eval-fill');
    this.$evalScore = document.getElementById('eval-score');
    this.ctx        = this.$canvas.getContext('2d');

    this._drag      = null;         // drag state
    this._squares   = {};           // sq id → DOM element

    this._buildGrid();
    this._bindResize();
  }

  /* ── Grid Construction ──────────────────────────────────── */
  _buildGrid() {
    this.$board.innerHTML = '';
    this._squares = {};

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = this._sq(r, f);
        const el = document.createElement('div');
        el.className = `sq ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
        el.dataset.sq = sq;

        // Coordinates
        if (f === 0) {
          const rank = document.createElement('span');
          rank.className = 'coord-rank';
          rank.textContent = this.flipped ? r + 1 : 8 - r;
          el.appendChild(rank);
        }
        if (r === 7) {
          const file = document.createElement('span');
          file.className = 'coord-file';
          file.textContent = 'abcdefgh'[this.flipped ? 7 - f : f];
          el.appendChild(file);
        }

        el.addEventListener('mousedown', e => this._onSquareMouseDown(e, sq));
        el.addEventListener('mouseup',   e => this._onSquareMouseUp(e, sq));

        this.$board.appendChild(el);
        this._squares[sq] = el;
      }
    }

    this.render();
  }

  /* ── Square index → algebraic ───────────────────────────── */
  _sq(row, col) {
    const r = this.flipped ? row + 1 : 8 - row;
    const f = this.flipped ? 7 - col : col;
    return 'abcdefgh'[f] + r;
  }

  /* ── Full render ─────────────────────────────────────────── */
  render() {
    // Clear all highlights
    for (const el of Object.values(this._squares)) {
      el.classList.remove('selected','move-target','capture-target','last-from','last-to','in-check');
      const piece = el.querySelector('.piece');
      if (piece) piece.remove();
    }

    // Last-move highlights
    if (this.lastMove) {
      this._squares[this.lastMove.from]?.classList.add('last-from');
      this._squares[this.lastMove.to]?.classList.add('last-to');
    }

    // Selected + legal moves
    if (this.selected) {
      this._squares[this.selected]?.classList.add('selected');
      for (const m of this.legalMoves) {
        const target = this._squares[m.to];
        if (!target) continue;
        if (this.chess.get(m.to)) {
          target.classList.add('capture-target');
        } else {
          target.classList.add('move-target');
        }
      }
    }

    // In-check highlight
    if (this.chess.in_check()) {
      const board = this.chess.board();
      const turn  = this.chess.turn();
      outer: for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === turn) {
            const sq = 'abcdefgh'[f] + (8 - r);
            this._squares[sq]?.classList.add('in-check');
            break outer;
          }
        }
      }
    }

    // Place pieces
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (!p) continue;
        const sq  = 'abcdefgh'[f] + (8 - r);
        const key = (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase();
        const img = document.createElement('div');
        img.className = 'piece';
        img.style.backgroundImage = `url("${PIECE_SVG[key]}")`;
        img.dataset.sq = sq;
        img.addEventListener('mousedown', e => {
          e.stopPropagation();
          this._onSquareMouseDown(e, sq);
        });
        this._squares[sq]?.appendChild(img);
      }
    }

    this._drawLines();
  }

  /* ── Canvas Arrow Drawing ────────────────────────────────── */
  _drawLines() {
    const c = this.$canvas;
    const size = this.$board.offsetWidth;
    c.width  = size;
    c.height = size;
    const sqSize = size / 8;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, size, size);

    if (!this.analysisLines || !this.analysisLines.length) return;

    // Draw each line (up to the first 4 moves per line)
    this.analysisLines.forEach((line, idx) => {
      if (!line.moves || !line.moves.length) return;
      const color = line.color || `hsl(${(idx * 37) % 360},90%,55%)`;

      ctx.strokeStyle = color;
      ctx.fillStyle   = color;
      ctx.lineWidth   = Math.max(2, 6 - idx * 0.3);
      ctx.globalAlpha = Math.max(0.25, 0.9 - idx * 0.04);

      // Draw arrows for first few moves of the line
      const preview = line.moves.slice(0, 3);
      preview.forEach((mv, mi) => {
        const fromSq = typeof mv === 'string' ? mv.slice(0,2) : mv.from;
        const toSq   = typeof mv === 'string' ? mv.slice(2,4) : mv.to;
        if (!fromSq || !toSq) return;

        const [fx, fy] = this._sqCenter(fromSq, sqSize);
        const [tx, ty] = this._sqCenter(toSq,   sqSize);

        ctx.lineWidth = Math.max(1.5, (5 - idx * 0.25) - mi * 0.8);
        this._drawArrow(ctx, fx, fy, tx, ty);
      });
    });

    ctx.globalAlpha = 1;
  }

  _sqCenter(sq, sqSize) {
    const file = 'abcdefgh'.indexOf(sq[0]);
    const rank = parseInt(sq[1]);
    const col  = this.flipped ? 7 - file : file;
    const row  = this.flipped ? rank - 1 : 8 - rank;
    return [col * sqSize + sqSize / 2, row * sqSize + sqSize / 2];
  }

  _drawArrow(ctx, x1, y1, x2, y2) {
    const angle   = Math.atan2(y2 - y1, x2 - x1);
    const len     = Math.hypot(x2 - x1, y2 - y1);
    const headLen = Math.min(18, len * 0.35);
    const shaftEnd = len - headLen * 0.7;

    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    // Shaft
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(shaftEnd, 0);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(len - headLen, -headLen * 0.45);
    ctx.lineTo(len - headLen, headLen * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /* ── Input Handlers ──────────────────────────────────────── */
  _onSquareMouseDown(e, sq) {
    e.preventDefault();
    const piece = this.chess.get(sq);
    const turn  = this.chess.turn();

    if (this.selected) {
      const isLegal = this.legalMoves.some(m => m.to === sq);
      if (isLegal) {
        this._attemptMove(this.selected, sq);
        return;
      }
      if (piece && piece.color === turn) {
        this._select(sq);
        return;
      }
      this._deselect();
      return;
    }

    if (piece && piece.color === turn) {
      this._select(sq);
      this._startDrag(e, sq);
    }
  }

  _onSquareMouseUp(e, sq) {
    if (this._drag && this._drag.from !== sq) {
      const isLegal = this.legalMoves.some(m => m.to === sq);
      if (isLegal) this._attemptMove(this._drag.from, sq);
    }
    this._endDrag();
  }

  _startDrag(e, sq) {
    const pieceEl = this._squares[sq]?.querySelector('.piece');
    if (!pieceEl) return;
    pieceEl.classList.add('dragging');
    this._drag = { from: sq, el: pieceEl };

    const onMove = ev => {
      if (!this._drag) return;
      const rect = this.$board.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      this._drag.el.style.position = 'fixed';
      this._drag.el.style.left = `${ev.clientX - 28}px`;
      this._drag.el.style.top  = `${ev.clientY - 28}px`;
      this._drag.el.style.width = this._drag.el.style.height = '56px';
    };

    const onUp = ev => {
      if (!this._drag) return;
      // Find target square
      this._drag.el.style.display = 'none';
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      this._drag.el.style.display = '';
      const tSq = el?.closest('[data-sq]')?.dataset.sq;
      if (tSq && tSq !== sq) {
        const isLegal = this.legalMoves.some(m => m.to === tSq);
        if (isLegal) this._attemptMove(sq, tSq);
      }
      this._endDrag();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _endDrag() {
    if (!this._drag) return;
    const el = this._drag.el;
    el.classList.remove('dragging');
    el.style.position = el.style.left = el.style.top = el.style.width = el.style.height = '';
    this._drag = null;
  }

  _select(sq) {
    this.selected    = sq;
    this.legalMoves  = this.chess.moves({ square: sq, verbose: true });
    this.render();
  }

  _deselect() {
    this.selected   = null;
    this.legalMoves = [];
    this.render();
  }

  _attemptMove(from, to) {
    // Check for promotion
    const piece = this.chess.get(from);
    const needsPromo = piece?.type === 'p' &&
      ((piece.color === 'w' && to[1] === '8') ||
       (piece.color === 'b' && to[1] === '1'));

    if (needsPromo) {
      this._showPromoDialog(from, to, piece.color);
    } else {
      this._commitMove(from, to, null);
    }
  }

  _commitMove(from, to, promotion) {
    this._deselect();
    this.onMove(from, to, promotion);
  }

  /* ── Promotion dialog ─────────────────────────────────────── */
  _showPromoDialog(from, to, color) {
    const dialog = document.getElementById('promo-dialog');
    const box    = document.getElementById('promo-box');
    box.innerHTML = '';
    const pieces = ['q','r','b','n'];
    pieces.forEach(p => {
      const key = (color === 'w' ? 'w' : 'b') + p.toUpperCase();
      const el  = document.createElement('div');
      el.className = 'promo-piece';
      el.style.backgroundImage = `url("${PIECE_SVG[key]}")`;
      el.addEventListener('click', () => {
        dialog.classList.remove('open');
        this._commitMove(from, to, p);
      });
      box.appendChild(el);
    });
    dialog.classList.add('open');
    // Close on backdrop click
    const onBackdrop = e => {
      if (e.target === dialog) {
        dialog.classList.remove('open');
        dialog.removeEventListener('click', onBackdrop);
      }
    };
    dialog.addEventListener('click', onBackdrop);
  }

  /* ── Public API ───────────────────────────────────────────── */
  flip() {
    this.flipped = !this.flipped;
    this._buildGrid();
  }

  setLastMove(from, to) {
    this.lastMove = { from, to };
  }

  setAnalysisLines(lines) {
    this.analysisLines = lines;
    this._drawLines();
  }

  setEval(centipawns) {
    // centipawns from white's perspective
    const clamped = Math.max(-1000, Math.min(1000, centipawns));
    const pct = 50 + (clamped / 1000) * 50;
    this.$evalFill.style.width = pct + '%';
    const score = (centipawns / 100).toFixed(2);
    this.$evalScore.textContent = centipawns >= 0 ? `+${score}` : score;
  }

  /* ── Resize handler ───────────────────────────────────────── */
  _bindResize() {
    const ro = new ResizeObserver(() => this._drawLines());
    ro.observe(this.$board);
  }
}
