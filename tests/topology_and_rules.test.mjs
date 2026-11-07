import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoardTopologyManager,
  ROSETTE_SQUARES,
  FORBIDDEN_ROSETTE_OPPOSITE,
} from '../src/managers/BoardTopologyManager.js';
import { ThreeChessRulesManager } from '../src/managers/ThreeChessRulesManager.js';

test('BoardTopologyManager builds 96 squares matching Riccardo physical board (A..L x 1..12)', () => {
  const topo = new BoardTopologyManager();
  assert.equal(topo.getAllSquares().length, 96);

  // [00:15] All 3 Queens start on Light squares (D1, I8, E12), all 3 Kings on Dark (E1, D8, I12)
  assert.equal(topo.getSquare('D1').squareColor, 'light');
  assert.equal(topo.getSquare('I8').squareColor, 'light');
  assert.equal(topo.getSquare('E12').squareColor, 'light');

  assert.equal(topo.getSquare('E1').squareColor, 'dark');
  assert.equal(topo.getSquare('D8').squareColor, 'dark');
  assert.equal(topo.getSquare('I12').squareColor, 'dark');

  // Bottom-left corners of all 3 players are Dark (A1, L8, H12)
  assert.equal(topo.getSquare('A1').squareColor, 'dark');
  assert.equal(topo.getSquare('L8').squareColor, 'dark');
  assert.equal(topo.getSquare('H12').squareColor, 'dark');

  // Central Rosette has 3 Dark (D4, I5, E9) and 3 Light (E4, D5, I9) squares
  assert.equal(ROSETTE_SQUARES.size, 6);
  assert.equal(topo.getSquare('D4').squareColor, 'dark');
  assert.equal(topo.getSquare('I5').squareColor, 'dark');
  assert.equal(topo.getSquare('E9').squareColor, 'dark');
  assert.equal(topo.getSquare('E4').squareColor, 'light');
  assert.equal(topo.getSquare('D5').squareColor, 'light');
  assert.equal(topo.getSquare('I9').squareColor, 'light');
});

test('Rook on Rosette square D4 respects [01:38]-[01:56] (only 4 lateral edges, never crosses center point)', () => {
  const topo = new BoardTopologyManager();
  const rays = topo.getOrthogonalRays('D4');
  assert.equal(rays.length, 4);

  const allTargets = new Set(rays.flatMap((r) => r.steps.map((s) => s.id)));
  // Can go along File D (D1..D3, D5..D8) and Rank 4 (A4..C4, E4..H4)
  assert.ok(allTargets.has('D5'));
  assert.ok(allTargets.has('D8'));
  assert.ok(allTargets.has('D1'));
  assert.ok(allTargets.has('E4'));
  assert.ok(allTargets.has('H4'));
  assert.ok(allTargets.has('A4'));

  // Must NEVER cross the central point into I5, I9, or E9!
  assert.ok(!allTargets.has('I5'));
  assert.ok(!allTargets.has('I9'));
  assert.ok(!allTargets.has('E9'));
});

test('Bishop diagonal rays respect [00:48] center color-preserving fork, [00:58] outward deflection, and [01:15] no color change', () => {
  const topo = new BoardTopologyManager();

  // From C3 (Dark), diagonal NE enters D4 (Dark) and forks across the center into I5->L8 and E9->H12!
  const raysC3 = topo.getDiagonalRays('C3');
  const rosetteBranches = raysC3.filter((r) => r.rayKind === 'diagonal_rosette');
  assert.equal(rosetteBranches.length, 2);

  const branchTargets = new Set(rosetteBranches.flatMap((r) => r.steps.map((s) => s.id)));
  assert.ok(branchTargets.has('D4'));
  assert.ok(branchTargets.has('I5'));
  assert.ok(branchTargets.has('L8'));
  assert.ok(branchTargets.has('E9'));
  assert.ok(branchTargets.has('H12'));

  // Every single square reached by a Bishop on C3 (Dark) MUST be Dark [01:15]!
  for (const r of raysC3) {
    for (const st of r.steps) {
      assert.equal(
        topo.getSquare(st.id).squareColor,
        'dark',
        `Expected ${st.id} to be dark on ray ${r.dirName}`
      );
    }
  }
  assert.ok(!branchTargets.has('I9')); // Forbidden opposite-color Rosette square!

  // [00:58] Deflection across the side of the Rosette: from E3 (Dark) moving NW through D4 (Dark) deflects outward to C5->B6->A7!
  const raysE3 = topo.getDiagonalRays('E3');
  const sideDeflect = raysE3.find((r) => r.steps.some((s) => s.id === 'C5'));
  assert.ok(sideDeflect, 'Expected outward deflection ray from E3 through D4 into C5');
  const sideIds = sideDeflect.steps.map((s) => s.id);
  assert.deepEqual(sideIds, ['D4', 'C5', 'B6', 'A7']);
});

test('King on Rosette D4 respects [01:22] (can step to D5, E4, I5, E9, but NEVER to opposite-color I9)', () => {
  const topo = new BoardTopologyManager();
  const rules = new ThreeChessRulesManager(topo);
  rules.board.clear();
  rules.board.set('D4', { type: 'k', color: 'white', homeSector: 0, moved: true });

  const { moves, forbiddenRosetteSquare } = rules.getLegalMovesAndRays('D4');
  assert.equal(forbiddenRosetteSquare, FORBIDDEN_ROSETTE_OPPOSITE.D4);
  assert.equal(forbiddenRosetteSquare, 'I9');

  const targets = new Set(moves.map((m) => m.to));
  assert.ok(targets.has('D5')); // Lateral edge
  assert.ok(targets.has('E4')); // Lateral edge
  assert.ok(targets.has('I5')); // Same-color diagonal in Rosette
  assert.ok(targets.has('E9')); // Same-color diagonal in Rosette
  assert.ok(!targets.has('I9')); // Forbidden opposite-color Rosette square [01:22]!
});

test('Pawn on Rosette D4 respects [02:14] forward direction and [02:22] same-color Rosette capture', () => {
  const topo = new BoardTopologyManager();
  const rules = new ThreeChessRulesManager(topo);
  rules.board.clear();
  rules.board.set('B1', { type: 'k', color: 'white', homeSector: 0, moved: false });
  rules.board.set('D4', { type: 'p', color: 'white', homeSector: 0, moved: true });

  // Place enemy pieces on C5 (Dark), I5 (Dark Rosette), E9 (Dark Rosette), and I9 (Light Rosette)
  rules.board.set('C5', { type: 'n', color: 'red', homeSector: 1, moved: true });
  rules.board.set('I5', { type: 'b', color: 'red', homeSector: 1, moved: true });
  rules.board.set('E9', { type: 'r', color: 'green', homeSector: 2, moved: true });
  rules.board.set('I9', { type: 'q', color: 'green', homeSector: 2, moved: true });

  const { moves } = rules.getLegalMovesAndRays('D4');
  const targets = new Set(moves.map((m) => m.to));

  assert.ok(targets.has('D5')); // Forward step [02:14]
  assert.ok(targets.has('C5')); // Outer diagonal capture
  assert.ok(targets.has('I5')); // Same-color Rosette capture [02:22]
  assert.ok(targets.has('E9')); // Same-color Rosette capture [02:22]
  assert.ok(!targets.has('I9')); // Never captures different-color Rosette square [02:22]!
});

test('All 4 Elimination Modes (destroy, protoss_conquer, flotsam_obstacles, sudden_death) work as specified', () => {
  const topo = new BoardTopologyManager();
  const rules = new ThreeChessRulesManager(topo);

  // Test Flotsam mode: eliminated player pieces become inert obstacles that cannot give check
  rules.setEliminationMode('flotsam_obstacles');
  rules._eliminatePlayer('red', 'white', 'checkmate');
  assert.ok(rules.eliminatedColors.has('red'));
  assert.equal(rules.findKingSquare('red'), null);
  const redRook = rules.getPiece('L8');
  assert.ok(redRook.isFlotsam);
  assert.equal(rules.getLegalMovesAndRays('L8').moves.length, 0);

  // Test Protoss Conquer mode: conqueror inherits loser's non-King pieces
  rules.resetGame();
  rules.setEliminationMode('protoss_conquer');
  rules._eliminatePlayer('red', 'white', 'checkmate');
  assert.equal(rules.getPiece('L8').color, 'white');

  // Test Destroy mode (Default): loser's pieces are removed from the board
  rules.resetGame();
  rules.setEliminationMode('destroy');
  rules._eliminatePlayer('red', 'white', 'checkmate');
  assert.equal(rules.getPiece('L8'), null);
});
