# G414 Chess Engine

A powerful browser-based chess engine and analysis UI with **hundreds of concurrent analysis plans**, multi-colored prediction lines, and a full interactive board.

## Features

| Feature | Detail |
|---|---|
| **Chess board** | 8×8 grid with SVG Staunton pieces, drag-and-drop, touch support |
| **Legal move highlighting** | Dots for quiet moves, rings for captures |
| **Eval bar** | Centipawn evaluation, smooth animated transition |
| **Multi-line analysis** | Up to 32 simultaneous lines, each a different color |
| **Concurrent plans** | 8–512 analysis tasks dispatched in parallel via Web Workers |
| **Color-coded arrows** | Each line drawn as an arrow on the board with its unique hue |
| **Alpha-beta engine** | Iterative deepening, quiescence search, piece-square tables |
| **Move history** | Click any past move to navigate; ← → keyboard shortcuts |
| **FEN import/export** | Load any position by pasting a FEN string |
| **Promotion dialog** | Full UI for pawn promotion to Q/R/B/N |
| **Responsive layout** | Adapts to narrow screens (mobile-friendly) |

## Architecture

```
index.html          – App shell
css/style.css       – Design system + component styles
js/
  chess.js          – chess.js v0.13.4 (move generation / validation)
  pieces.js         – SVG Staunton piece data-URIs
  board.js          – Board renderer, drag-drop, canvas arrow overlay
  engine.js         – Alpha-beta minimax + quiescence + PSTs
  worker.js         – Web Worker entry point (runs engine.js)
  analysis.js       – WorkerPool + PlanQueue + AnalysisCoordinator
  ui.js             – UI controller (controls, panels, move list)
  main.js           – App entry point
```

## How concurrent plans work

1. **PlanQueue** generates up to 512 analysis tasks from the current position:
   - One root task (full position, high depth, multiPV)
   - One task per root move (depth − 1)
   - One task per (root move × opponent reply) pair (depth − 2)

2. **WorkerPool** dispatches all tasks across N Web Workers in parallel.

3. **AnalysisCoordinator** aggregates results, builds the best continuation
   per root move, and emits colored line objects to the UI on each update.

## Running

Open `index.html` directly in a modern browser.
> ⚠️ Web Workers require a server (not `file://`).
> Run with: `npx serve .` or `python -m http.server 8080`

## Keyboard shortcuts

| Key | Action |
|---|---|
| `←` | Go back one move |
| `→` | Go forward one move |
| `f` | Flip board |
