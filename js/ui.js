/**
 * ui.js – UI controller: wires controls, move history, lines panel,
 *         engine info, and status bar updates.
 */

class UI {
  constructor(opts) {
    this.chess      = opts.chess;
    this.board      = opts.board;
    this.coordinator = null;

    // DOM refs
    this.$moveList   = document.getElementById('move-list');
    this.$linesList  = document.getElementById('lines-list');
    this.$linesCount = document.getElementById('lines-count');
    this.$engineInfo = document.getElementById('engine-info');
    this.$statusText = document.getElementById('status-text');
    this.$npsText    = document.getElementById('nps-text');
    this.$timeText   = document.getElementById('time-text');
    this.$fenInput   = document.getElementById('fen-input');
    this.$depthSlider   = document.getElementById('depth-slider');
    this.$depthVal      = document.getElementById('depth-val');
    this.$linesSlider   = document.getElementById('lines-slider');
    this.$linesVal      = document.getElementById('lines-val');
    this.$workersSlider = document.getElementById('workers-slider');
    this.$workersVal    = document.getElementById('workers-val');
    this.$plansInput    = document.getElementById('plans-input');

    this._moveHistory = [];  // [{san, fen_before, fen_after}]
    this._currentIdx  = -1;

    this._bindControls();
  }

  /* ── Control bindings ─────────────────────────────────────── */
  _bindControls() {
    document.getElementById('btn-flip').addEventListener('click', () => this.board.flip());
    document.getElementById('btn-new').addEventListener('click', () => this.newGame());
    document.getElementById('btn-analyze').addEventListener('click', () => this.startAnalysis());
    document.getElementById('btn-stop').addEventListener('click', () => this.stopAnalysis());

    document.getElementById('btn-load-fen').addEventListener('click', () => {
      const fen = this.$fenInput.value.trim();
      this.loadFen(fen);
    });

    document.getElementById('btn-copy-fen').addEventListener('click', () => {
      navigator.clipboard.writeText(this.chess.fen()).catch(() => {});
      this.setStatus('FEN copied to clipboard');
    });

    // Sliders
    this.$depthSlider.addEventListener('input', () => {
      this.$depthVal.textContent = this.$depthSlider.value;
    });
    this.$linesSlider.addEventListener('input', () => {
      this.$linesVal.textContent = this.$linesSlider.value;
    });
    this.$workersSlider.addEventListener('input', () => {
      this.$workersVal.textContent = this.$workersSlider.value;
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft')  this.goBack();
      if (e.key === 'ArrowRight') this.goForward();
      if (e.key === 'f') this.board.flip();
    });
  }

  /* ── Game actions ─────────────────────────────────────────── */
  newGame() {
    this.stopAnalysis();
    this.chess.reset();
    this._moveHistory = [];
    this._currentIdx  = -1;
    this.board.lastMove = null;
    this.board.analysisLines = [];
    this.board.render();
    this.renderMoveList();
    this.setStatus('New game started');
    this.board.setEval(0);
    this.$fenInput.value = this.chess.fen();
    this.$linesList.innerHTML = '';
    this.$linesCount.textContent = '';
    this.$engineInfo.innerHTML = '';
  }

  loadFen(fen) {
    const test = new Chess();
    if (!test.load(fen)) {
      this.setStatus('Invalid FEN');
      return;
    }
    this.stopAnalysis();
    this.chess.load(fen);
    this._moveHistory = [];
    this._currentIdx  = -1;
    this.board.lastMove = null;
    this.board.analysisLines = [];
    this.board.render();
    this.renderMoveList();
    this.setStatus('Position loaded');
    this.$fenInput.value = fen;
  }

  onMove(from, to, promotion) {
    const move = this.chess.move({ from, to, promotion: promotion || undefined });
    if (!move) return;

    // Truncate future if we were in history
    if (this._currentIdx < this._moveHistory.length - 1) {
      this._moveHistory = this._moveHistory.slice(0, this._currentIdx + 1);
    }

    this._moveHistory.push({ san: move.san, fen: this.chess.fen() });
    this._currentIdx = this._moveHistory.length - 1;

    this.board.setLastMove(from, to);
    this.board.render();
    this.renderMoveList();
    this.$fenInput.value = this.chess.fen();

    // Auto-analyse after each move
    this.startAnalysis();
  }

  goBack() {
    if (this._currentIdx <= 0) {
      this._currentIdx = -1;
      this.chess.reset();
    } else {
      this._currentIdx--;
      this.chess.load(this._moveHistory[this._currentIdx].fen);
    }
    this.board.render();
    this.renderMoveList();
  }

  goForward() {
    if (this._currentIdx >= this._moveHistory.length - 1) return;
    this._currentIdx++;
    this.chess.load(this._moveHistory[this._currentIdx].fen);
    this.board.render();
    this.renderMoveList();
  }

  /* ── Move list renderer ───────────────────────────────────── */
  renderMoveList() {
    const history = this.chess.history({ verbose: true });
    this.$moveList.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
      const pair = document.createElement('div');
      pair.className = 'move-pair';

      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = `${i/2 + 1}.`;

      const w = document.createElement('span');
      w.className = 'move-san';
      w.textContent = history[i].san;
      w.addEventListener('click', () => this._jumpToMove(i));

      pair.appendChild(num);
      pair.appendChild(w);

      if (history[i+1]) {
        const b = document.createElement('span');
        b.className = 'move-san';
        b.textContent = history[i+1].san;
        b.addEventListener('click', () => this._jumpToMove(i+1));
        pair.appendChild(b);
      }

      this.$moveList.appendChild(pair);
    }

    // Scroll to bottom
    this.$moveList.scrollTop = this.$moveList.scrollHeight;
  }

  _jumpToMove(idx) {
    // Re-play from start
    const chess = new Chess();
    const h = this.chess.history({ verbose: true });
    for (let i = 0; i <= idx; i++) chess.move(h[i]);
    this.chess.load(chess.fen());
    this.board.render();
  }

  /* ── Analysis ─────────────────────────────────────────────── */
  startAnalysis() {
    if (this.chess.game_over()) {
      this.setStatus(this._gameOverReason());
      return;
    }

    const depth   = parseInt(this.$depthSlider.value);
    const workers = parseInt(this.$workersSlider.value);
    const plans   = parseInt(this.$plansInput.value) || 256;

    this.stopAnalysis();

    this.coordinator = new AnalysisCoordinator({
      workerCount: workers,
      maxPlans:    plans,
      maxDepth:    depth,
      onUpdate:    (lines, stats) => this._onAnalysisUpdate(lines, stats),
    });

    this.setStatus(`<span class="spinner"></span>Analysing… ${plans} concurrent plans`, true);
    this.coordinator.start(this.chess.fen());
  }

  stopAnalysis() {
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator = null;
      this.setStatus('Analysis stopped');
    }
  }

  _onAnalysisUpdate(lines, stats) {
    // Update board arrows
    this.board.setAnalysisLines(lines);

    // Update eval bar from best line
    if (lines.length) {
      this.board.setEval(lines[0].score);
    }

    // Render lines panel
    this._renderLines(lines);

    // Stats
    this.$npsText.textContent  = `${(stats.nps / 1000).toFixed(0)}k nps`;
    this.$timeText.textContent = `${stats.elapsed}s`;
    this.$linesCount.textContent = `(${lines.length})`;

    const pct = Math.round((stats.tasks / stats.total) * 100);
    if (stats.final) {
      this.setStatus(`Analysis complete — ${stats.tasks} plans, ${(stats.nodes/1e6).toFixed(1)}M nodes`);
      this.$engineInfo.innerHTML =
        `Depth: ${this.coordinator?.maxDepth ?? ''}<br>` +
        `Plans: ${stats.tasks} / ${stats.total}<br>` +
        `Nodes: ${(stats.nodes/1e6).toFixed(2)}M<br>` +
        `NPS: ${(stats.nps/1000).toFixed(0)}k<br>` +
        `Time: ${stats.elapsed}s`;
    } else {
      this.setStatus(`<span class="spinner"></span>Analysing… ${pct}% (${stats.tasks}/${stats.total} plans)`, true);
    }
  }

  /* ── Lines panel ──────────────────────────────────────────── */
  _renderLines(lines) {
    this.$linesList.innerHTML = '';
    const multiPV = parseInt(this.$linesSlider.value);
    const display = lines.slice(0, Math.max(multiPV, 8));

    display.forEach((line, i) => {
      const item = document.createElement('div');
      item.className = 'line-item';
      if (i === 0) item.classList.add('active');

      const dot = document.createElement('div');
      dot.className = 'line-color-dot';
      dot.style.background = line.color;

      const score = document.createElement('span');
      score.className = 'line-score';
      const s = (line.score / 100).toFixed(2);
      score.textContent = line.score >= 0 ? `+${s}` : s;
      score.style.color = line.score > 50 ? '#4ade80'
                        : line.score < -50 ? '#f87171'
                        : 'var(--accent)';

      const moves = document.createElement('span');
      moves.className = 'line-moves';
      moves.textContent = line.moves.join(' ');

      item.appendChild(dot);
      item.appendChild(score);
      item.appendChild(moves);

      item.addEventListener('click', () => {
        document.querySelectorAll('.line-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        this.board.setAnalysisLines([line]);
      });

      this.$linesList.appendChild(item);
    });
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  setStatus(msg, html = false) {
    if (html) this.$statusText.innerHTML = msg;
    else      this.$statusText.textContent = msg;
  }

  _gameOverReason() {
    if (this.chess.in_checkmate()) return 'Checkmate! ' + (this.chess.turn()==='w' ? 'Black' : 'White') + ' wins';
    if (this.chess.in_stalemate()) return 'Stalemate – Draw';
    if (this.chess.in_threefold_repetition()) return 'Threefold repetition – Draw';
    if (this.chess.insufficient_material()) return 'Insufficient material – Draw';
    return 'Game over';
  }
}
