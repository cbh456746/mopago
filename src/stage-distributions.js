import {DEFAULT_CATALOG} from './game.js';

// One published assumption. Nexon's exact piece probabilities are unknown.
// At stage five, a one-cell piece has 0.6 times the weight of a ten-cell piece.
export const FINAL_SMALL_PIECE_RATIO=.6;
export const DEFAULT_STAGE_WEIGHTS=Array.from({length:5},(_,stage)=>{
  const ratio=FINAL_SMALL_PIECE_RATIO**(stage/4);
  return Object.fromEntries(DEFAULT_CATALOG.map(piece=>[
    piece.name,Number((ratio**((10-piece.size)/9)).toFixed(10))
  ]));
});
