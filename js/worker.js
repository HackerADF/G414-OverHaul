/**
 * worker.js – Web Worker entry point for parallel chess analysis.
 * Loads chess.js and engine.js, then handles search requests.
 *
 * Each worker handles one "plan" (a root-move subtree analysis).
 */

// Load dependencies – paths relative to worker.js location
importScripts('chess.js', 'engine.js');
