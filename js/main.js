/**
 * main.js – Application entry point.
 * Instantiates Chess, Board, and UI; connects them together.
 */

(function () {
  'use strict';

  // Initialize chess.js game instance
  const chess = new Chess();

  // Initialize board (rendering + input)
  const board = new Board(chess, (from, to, promotion) => {
    ui.onMove(from, to, promotion);
  });

  // Initialize UI controller
  const ui = new UI({ chess, board });

  // Expose to console for debugging
  window._g414 = { chess, board, ui };

  // Kick off initial analysis
  ui.setStatus('Ready – click Analyze or make a move');
})();
