/**
 * analysis.js – Concurrent multi-plan analysis coordinator.
 *
 * Architecture:
 *   • WorkerPool   – manages a fixed set of Web Workers
 *   • PlanQueue    – generates hundreds of (fen, depth, movePrefix) tasks
 *   • AnalysisCoordinator – wires them together, aggregates results,
 *                           emits colored lines back to the UI
 *
 * "Hundreds of concurrent plans" means hundreds of tasks are dispatched
 * across the worker pool simultaneously; each task explores a different
 * variation subtree.
 */

/**
 * COLOR_PALETTE provides 32 distinct, vivid hues for analysis lines.
 * Earlier lines (better eval) receive warmer, more saturated colors.
 */
/* ── Distinct line colors (32 vivid hues) ─────────────────── */
const LINE_COLORS = [
  '#ff4d4d','#ff9f40','#ffdd57','#48c774',
  '#00d1b2','#3273dc','#9b59b6','#ff6b9d',
  '#f97316','#84cc16','#06b6d4','#8b5cf6',
  '#ec4899','#14b8a6','#f59e0b','#10b981',
  '#ef4444','#a855f7','#22c55e','#0ea5e9',
  '#fb923c','#d946ef','#4ade80','#38bdf8',
  '#fbbf24','#e879f9','#86efac','#67e8f9',
  '#fcd34d','#f0abfc','#bbf7d0','#a5f3fc',
];

/* ════════════════════════════════════════════════════════════
   WorkerPool
   ════════════════════════════════════════════════════════════ */
class WorkerPool {
  constructor(size) {
    this.size    = size;
    this.workers = [];
    this.queue   = [];          // pending tasks
    this.active  = new Map();   // worker-index → task
    this._init();
  }

  _init() {
    for (let i = 0; i < this.size; i++) {
      const w = new Worker('js/worker.js');
      w.onmessage = e => this._onMessage(i, e.data);
      w.onerror   = e => this._onError(i, e);
      this.workers.push(w);
    }
  }

  /** Dispatch a task; resolves promise with result */
  dispatch(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.active.has(i)) continue;
      const job = this.queue.shift();
      if (!job) break;
      this.active.set(i, job);
      this.workers[i].postMessage(job.task);
    }
  }

  _onMessage(idx, data) {
    const job = this.active.get(idx);
    this.active.delete(idx);
    if (job) job.resolve(data);
    this._drain();
  }

  _onError(idx, err) {
    const job = this.active.get(idx);
    this.active.delete(idx);
    if (job) job.reject(err);
    this._drain();
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.queue   = [];
    this.active.clear();
  }
}

/* ════════════════════════════════════════════════════════════
   PlanQueue – generates analysis tasks from the current position
   ════════════════════════════════════════════════════════════ */
class PlanQueue {
  /**
   * @param {string} fen       – position to analyse
   * @param {number} maxPlans  – total plans to generate (e.g. 256)
   * @param {number} maxDepth  – max depth per plan
   */
  static generate(fen, maxPlans, maxDepth) {
    const chess = new Chess(fen);
    const tasks = [];

    const rootMoves = chess.moves({ verbose: true });
    if (!rootMoves.length) return tasks;

    // Plan 0: full position, high depth, multiPV
    tasks.push({
      fen,
      depth:   maxDepth,
      multiPV: Math.min(8, rootMoves.length),
      taskId:  'root',
    });

    // Plans 1-N: each root move gets progressively deeper exploration
    let id = 1;
    for (const rm of rootMoves) {
      if (tasks.length >= maxPlans) break;
      chess.move(rm);
      const fen1 = chess.fen();

      // Level-1 plan: search after this root move
      tasks.push({
        fen:    fen1,
        depth:  Math.max(1, maxDepth - 1),
        multiPV: Math.min(4, chess.moves().length),
        taskId: `l1-${id++}`,
        rootMove: rm.san,
        moves: [rm.san],
      });

      // Level-2 plans: search after root + each reply
      const replies = chess.moves({ verbose: true });
      for (const rp of replies.slice(0, Math.ceil((maxPlans - tasks.length) / rootMoves.length))) {
        if (tasks.length >= maxPlans) break;
        chess.move(rp);
        tasks.push({
          fen:    chess.fen(),
          depth:  Math.max(1, maxDepth - 2),
          multiPV: 1,
          taskId: `l2-${id++}`,
          rootMove: rm.san,
          moves: [rm.san, rp.san],
        });
        chess.undo();
      }

      chess.undo();
    }

    return tasks;
  }
}

/* ════════════════════════════════════════════════════════════
   AnalysisCoordinator
   ════════════════════════════════════════════════════════════ */
class AnalysisCoordinator {
  constructor(opts = {}) {
    this.workerCount = opts.workerCount || 8;
    this.maxPlans    = opts.maxPlans    || 256;
    this.maxDepth    = opts.maxDepth    || 12;
    this.onUpdate    = opts.onUpdate    || (() => {});  // (lines, stats) => void

    this.pool   = null;
    this.running = false;
    this._results   = new Map();   // taskId → result
    this._startTime = 0;
    this._totalNodes = 0;
  }

  /** Start analysis of a FEN */
  async start(fen) {
    this.stop();
    this.running     = true;
    this._results    = new Map();
    this._totalNodes = 0;
    this._startTime  = performance.now();

    this.pool = new WorkerPool(this.workerCount);

    const tasks = PlanQueue.generate(fen, this.maxPlans, this.maxDepth);

    // Dispatch all tasks concurrently; the pool throttles to workerCount
    const promises = tasks.map(task =>
      this.pool.dispatch(task).then(result => {
        if (!this.running) return;
        this._results.set(task.taskId, { task, result });
        this._totalNodes += result.nodes || 0;
        this._emit();
      }).catch(() => {})
    );

    await Promise.allSettled(promises);
    if (this.running) {
      this.running = false;
      this._emit(true);
    }
  }

  stop() {
    this.running = false;
    if (this.pool) {
      this.pool.terminate();
      this.pool = null;
    }
  }

  /* Build colored lines array from collected results */
  _buildLines() {
    // Start from root result
    const rootEntry = this._results.get('root');
    const rootLines = rootEntry?.result?.lines || [];

    const lineMap = new Map(); // rootMove → best line data
    let colorIdx = 0;

    // Seed from root result
    for (const rl of rootLines) {
      const san = rl.move?.san;
      if (!san) continue;
      lineMap.set(san, {
        rootMove: san,
        score:    rl.score,
        moves:    [san],
        color:    LINE_COLORS[colorIdx++ % LINE_COLORS.length],
        depth:    this.maxDepth,
      });
    }

    // Count how many plans support each root move
    const planCount = new Map();

    // Enrich with level-1 and level-2 results
    for (const [, entry] of this._results) {
      const { task, result } = entry;
      if (task.taskId === 'root') continue;
      if (!result?.lines?.length) continue;

      const rm   = task.rootMove;
      const best = result.lines[0];
      if (!rm || !best) continue;

      // Track plan count for this root move
      planCount.set(rm, (planCount.get(rm) || 0) + 1);

      const existing = lineMap.get(rm);
      const taskScore = task.moves.length === 1
        ? best.score
        : -(best.score); // negate for opponent's reply

      if (!existing) {
        lineMap.set(rm, {
          rootMove: rm,
          score:    taskScore,
          moves:    task.moves.concat(best.move?.san || []),
          color:    LINE_COLORS[colorIdx++ % LINE_COLORS.length],
          depth:    task.depth,
        });
      } else if (task.moves.length > existing.moves.length && result.lines[0]?.move) {
        // Extend the line with deeper continuation
        const continuation = result.lines[0].move.san;
        if (!existing.moves.includes(continuation)) {
          existing.moves = task.moves.concat(continuation);
        }
      }
    }

    // Attach plan counts and sort by score (best first)
    return Array.from(lineMap.values())
      .map(line => ({ ...line, plans: planCount.get(line.rootMove) || 1 }))
      .sort((a, b) => b.score - a.score);
  }

  _emit(final = false) {
    const lines = this._buildLines();
    const elapsed = (performance.now() - this._startTime) / 1000;
    const nps = elapsed > 0 ? Math.round(this._totalNodes / elapsed) : 0;

    this.onUpdate(lines, {
      nodes:    this._totalNodes,
      nps,
      elapsed:  elapsed.toFixed(1),
      tasks:    this._results.size,
      total:    this.maxPlans,
      final,
    });
  }
}
