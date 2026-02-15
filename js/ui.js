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

    this.$gameOverBanner = document.getElementById('game-over-banner');
    this.$plansProgressWrap  = document.getElementById('plans-progress-wrap');
    this.$plansProgressBar   = document.getElementById('plans-progress-bar');
    this.$plansProgressLabel = document.getElementById('plans-progress-label');
    this._moveHistory = [];  // [{san, fen_before, fen_after}]
    this._currentIdx  = -1;

    this._svsActive   = false;
    this._svsTimer    = null;
    this._svsMoveCount = 0;
    this._svsStats    = { w: 0, b: 0, d: 0, games: 0 };

    this._bindControls();
  }

  /* ── Control bindings ─────────────────────────────────────── */
  _bindControls() {
    document.getElementById('btn-theme').addEventListener('click', () => {
      document.body.classList.toggle('light');
      const isLight = document.body.classList.contains('light');
      document.getElementById('btn-theme').textContent = isLight ? '🌙' : '☀';
    });
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

    document.getElementById('btn-copy-pgn').addEventListener('click', () => {
      const pgn = this.chess.pgn({ max_width: 80, newline_char: '\n' });
      navigator.clipboard.writeText(pgn).catch(() => {});
      this.setStatus('PGN copied to clipboard');
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

    document.getElementById('btn-play-engine').addEventListener('click', () => this.togglePlayVsEngine());
    document.getElementById('btn-svs').addEventListener('click', () => this.toggleSelfVsSelf());
    document.getElementById('btn-heatmap').addEventListener('click', e => {
      this.board.showHeatMap = !this.board.showHeatMap;
      e.target.classList.toggle('primary', this.board.showHeatMap);
      this.board._drawLines();
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
    this.$gameOverBanner?.classList.remove('show');
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

    if (this.chess.game_over()) {
      const msg = this._gameOverReason();
      this.$gameOverBanner.textContent = msg;
      this.$gameOverBanner.classList.add('show');
      this.setStatus(msg);
      return;
    }

    this.$gameOverBanner.classList.remove('show');

    // If playing vs engine and it's engine's turn, trigger engine move
    if (this._playVsEngine) {
      setTimeout(() => this._maybeEngineMove(), 100);
      return;
    }

    // SVS mode handles its own scheduling
    if (this._svsActive) return;

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

  /* ── Self vs Self ─────────────────────────────────────────── */
  toggleSelfVsSelf() {
    this._svsActive = !this._svsActive;
    const btn = document.getElementById('btn-svs');
    const panel = document.getElementById('svs-panel');
    if (this._svsActive) {
      btn.textContent = '⏹ Stop SVS';
      btn.classList.add('primary');
      if (panel) panel.style.display = '';
      this._svsMoveCount = 0;
      this.stopAnalysis();
      this._svsNext();
    } else {
      btn.textContent = '⚙ Self vs Self';
      btn.classList.remove('primary');
      if (this._svsTimer) { clearTimeout(this._svsTimer); this._svsTimer = null; }
    }
  }

  _svsNext() {
    if (!this._svsActive) return;
    if (this.chess.game_over()) { this._svsOnGameOver(); return; }
    const delay = parseInt(document.getElementById('svs-delay')?.value || '500');
    this._svsTimer = setTimeout(() => this._svsMakeMove(), delay);
  }

  _svsMakeMove() {
    if (!this._svsActive) return;
    const turn = this.chess.turn();
    const fen   = this.chess.fen();
    const depth = parseInt(this.$depthSlider.value);
    const w = new Worker('js/worker.js');
    w.onmessage = e => {
      w.terminate();
      if (!this._svsActive) return;
      const lines = e.data.lines;
      if (!lines?.length) return;
      const best = lines[0].move;
      if (!best) return;
      this._svsMoveCount++;
      this.onMove(best.from, best.to, best.promotion || null);
      if (!this.chess.game_over()) this._svsNext();
    };
    w.postMessage({ fen, depth, multiPV: 1, taskId: 'svs' });
  }

  _svsOnGameOver() {
    const isCheckmate = this.chess.in_checkmate();
    this._svsStats.games++;
    if (isCheckmate) {
      if (this.chess.turn() === 'w') this._svsStats.b++;
      else                           this._svsStats.w++;
    } else {
      this._svsStats.d++;
    }
    this._updateSvsStats();
  }

  _updateSvsStats() {
    const el = document.getElementById('svs-stats');
    if (!el) return;
    const s = this._svsStats;
    el.innerHTML =
      `Games: ${s.games}<br>` +
      `White wins: ${s.w}<br>` +
      `Black wins: ${s.b}<br>` +
      `Draws: ${s.d}`;
  }

  /* ── Play vs Engine ───────────────────────────────────────── */
  togglePlayVsEngine() {
    this._playVsEngine = !this._playVsEngine;
    const btn = document.getElementById('btn-play-engine');
    if (this._playVsEngine) {
      btn.textContent = '⏹ Stop Playing';
      btn.classList.add('primary');
      this.setStatus('Playing vs Engine — you are White');
      this._maybeEngineMove();
    } else {
      btn.textContent = '▶ Play vs Engine';
      btn.classList.remove('primary');
      this.setStatus('Play mode off');
    }
  }

  _maybeEngineMove() {
    if (!this._playVsEngine) return;
    if (this.chess.game_over()) return;
    if (this.chess.turn() !== 'b') return; // engine plays black

    this.setStatus('<span class="spinner"></span>Engine thinking…', true);
    const fen   = this.chess.fen();
    const depth = parseInt(this.$depthSlider.value);
    const w = new Worker('js/worker.js');
    w.onmessage = e => {
      w.terminate();
      const lines = e.data.lines;
      if (!lines?.length) return;
      const best = lines[0].move;
      if (!best) return;
      this.onMove(best.from, best.to, best.promotion || null);
    };
    w.postMessage({ fen, depth, multiPV: 1, taskId: 'play' });
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

    // Plans progress bar
    const pct2 = Math.round((stats.tasks / stats.total) * 100);
    if (this.$plansProgressWrap) {
      this.$plansProgressWrap.style.display = 'flex';
      this.$plansProgressBar.style.width    = pct2 + '%';
      this.$plansProgressLabel.textContent  = `${stats.tasks} / ${stats.total}`;
      if (stats.final) {
        setTimeout(() => { this.$plansProgressWrap.style.display = 'none'; }, 2000);
      }
    }

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
      let scoreText;
      if (Math.abs(line.score) >= 29000) {
        const mateIn = Math.ceil((30000 - Math.abs(line.score)) / 2);
        scoreText = line.score > 0 ? `M${mateIn}` : `-M${mateIn}`;
      } else {
        const s = (line.score / 100).toFixed(2);
        scoreText = line.score >= 0 ? `+${s}` : s;
      }
      score.textContent = scoreText;
      score.style.color = line.score > 50 ? '#4ade80'
                        : line.score < -50 ? '#f87171'
                        : 'var(--accent)';

      const moves = document.createElement('span');
      moves.className = 'line-moves';
      moves.textContent = line.moves.join(' ');

      const plansBadge = document.createElement('span');
      plansBadge.style.cssText = 'font-size:0.68rem;color:var(--text-muted);flex-shrink:0;align-self:center;';
      plansBadge.title = `${line.plans || 1} analysis plan(s) for this move`;
      plansBadge.textContent = `×${line.plans || 1}`;

      item.appendChild(dot);
      item.appendChild(score);
      item.appendChild(moves);
      item.appendChild(plansBadge);

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
