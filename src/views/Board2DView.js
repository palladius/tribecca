/**
 * @fileoverview Board2DView — Interactive SVG 2D Hexagonal 96-Square View + MoveRayHighlighter 2D.
 * Renders the exact geometry of Riccardo's 96-square board (`A..L` x `1..12`), the central Rosette,
 * and continuous animated glowing rays (`»`) that branch out from any clicked/hovered piece.
 */

import { SECTOR_META, ROSETTE_SQUARES } from '../managers/BoardTopologyManager.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PIECE_UNICODE = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

const PIECE_LABEL_IT = {
  k: 'Re',
  q: 'Regina',
  r: 'Torre',
  b: 'Alfiere',
  n: 'Cavallo',
  p: 'Pedone',
};

export class Board2DView {
  /**
   * @param {HTMLElement} container
   * @param {import('../managers/BoardTopologyManager.js').BoardTopologyManager} topology
   * @param {import('../managers/ThreeChessRulesManager.js').ThreeChessRulesManager} rules
   * @param {import('../core/GameEventBus.js').GameEventBus} bus
   * @param {(squareId: string) => void} onSquareClick
   */
  constructor(container, topology, rules, bus, onSquareClick) {
    this.container = container;
    this.topology = topology;
    this.rules = rules;
    this.bus = bus;
    this.onSquareClick = onSquareClick;

    /** @type {'tricolore' | 'wood'} */
    this.boardTheme = 'tricolore';
    this.rotate2DWithTurn = false;
    this.currentRotationDeg = 0;
    this.hoveredTargetSquare = null;
    this.activeSelection = null;

    this._initSvg();
    this._bindEvents();
    this.render();
  }

  _initSvg() {
    this.container.innerHTML = '';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-7.4 -7.4 14.8 14.8');
    svg.setAttribute('class', 'board-2d-svg');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.userSelect = 'none';

    this.rootGroup = document.createElementNS(SVG_NS, 'g');
    this.rootGroup.setAttribute('class', 'board-2d-rotatable');
    svg.appendChild(this.rootGroup);

    this.frameLayer = document.createElementNS(SVG_NS, 'g');
    this.squaresLayer = document.createElementNS(SVG_NS, 'g');
    this.raysLayer = document.createElementNS(SVG_NS, 'g');
    this.piecesLayer = document.createElementNS(SVG_NS, 'g');
    this.labelsLayer = document.createElementNS(SVG_NS, 'g');

    this.rootGroup.appendChild(this.frameLayer);
    this.rootGroup.appendChild(this.squaresLayer);
    this.rootGroup.appendChild(this.raysLayer);
    this.rootGroup.appendChild(this.piecesLayer);
    this.rootGroup.appendChild(this.labelsLayer);

    this.svg = svg;
    this.container.appendChild(svg);
  }

  _bindEvents() {
    this.bus.on('PIECE_SELECTED', (payload) => {
      this.activeSelection = payload;
      this.hoveredTargetSquare = null;
      this.render();
    });
    this.bus.on('SELECTION_CLEARED', () => {
      this.activeSelection = null;
      this.hoveredTargetSquare = null;
      this.render();
    });
    this.bus.on('MOVE_EXECUTED', () => {
      this.activeSelection = null;
      this.hoveredTargetSquare = null;
      this.render();
    });
    this.bus.on('GAME_RESET', () => {
      this.activeSelection = null;
      this.hoveredTargetSquare = null;
      this.setRotationAngle(0);
      this.render();
    });
    this.bus.on('HISTORY_CHANGED', (e) => {
      this.activeSelection = null;
      if (this.rotate2DWithTurn && typeof e.cameraAngleDeg === 'number') {
        this.setRotationAngle(e.cameraAngleDeg);
      }
      this.render();
    });
    this.bus.on('TURN_CHANGED', (e) => {
      if (this.rotate2DWithTurn && typeof e.cameraAngleDeg === 'number') {
        this.setRotationAngle(e.cameraAngleDeg);
      }
      this.render();
    });
  }

  setTheme(theme) {
    this.boardTheme = theme === 'wood' ? 'wood' : 'tricolore';
    this.render();
  }

  setRotationAngle(deg) {
    this.currentRotationDeg = deg;
    if (this.rootGroup) {
      // Rotate counter-clockwise so active sector (120° Red, 240° Green) comes to the bottom (South)!
      const rot = this.rotate2DWithTurn ? -deg : 0;
      this.rootGroup.style.transition = 'transform 650ms cubic-bezier(0.33, 1, 0.68, 1)';
      this.rootGroup.setAttribute('transform', `rotate(${rot})`);
    }
    this.renderPieces();
  }

  render() {
    this.renderFrameAndSquares();
    this.renderRays();
    this.renderPieces();
  }

  _getArmyPalette(color, isFlotsam = false) {
    if (isFlotsam) {
      return {
        fill: '#78909c',
        stroke: '#37474f',
        text: '#eceff1',
        glow: 'rgba(120,144,156,0.45)',
      };
    }
    if (color === 'white') {
      return {
        fill: '#fafbfd',
        stroke: '#b8860b',
        text: '#1e293b',
        glow: 'rgba(250,204,21,0.55)',
      };
    }
    if (color === 'red') {
      return {
        fill: this.boardTheme === 'wood' ? '#991b1b' : '#dc2626',
        stroke: '#fef08a',
        text: '#ffffff',
        glow: 'rgba(239,68,68,0.55)',
      };
    }
    // Green (Tricolore) or Ebony Black (Wood mode)
    if (this.boardTheme === 'wood') {
      return {
        fill: '#1e1b18',
        stroke: '#d6d3d1',
        text: '#f5f5f4',
        glow: 'rgba(168,162,158,0.5)',
      };
    }
    return {
      fill: '#15803d',
      stroke: '#bbf7d0',
      text: '#ffffff',
      glow: 'rgba(34,197,94,0.55)',
    };
  }

  renderFrameAndSquares() {
    this.frameLayer.innerHTML = '';
    this.squaresLayer.innerHTML = '';
    this.labelsLayer.innerHTML = '';

    const R = this.topology.boardRadius;
    const outerR = R + 0.68;

    // Outer hexagonal frame
    const hexPts = [];
    for (let i = 0; i < 6; i++) {
      const rad = ((60 * i) * Math.PI) / 180;
      hexPts.push(`${(outerR * Math.cos(rad)).toFixed(3)},${(outerR * Math.sin(rad)).toFixed(3)}`);
    }
    const framePoly = document.createElementNS(SVG_NS, 'polygon');
    framePoly.setAttribute('points', hexPts.join(' '));
    framePoly.setAttribute('fill', this.boardTheme === 'wood' ? '#2c1810' : '#0f172a');
    framePoly.setAttribute('stroke', this.boardTheme === 'wood' ? '#78350f' : '#334155');
    framePoly.setAttribute('stroke-width', '0.12');
    this.frameLayer.appendChild(framePoly);

    // 3 Sector colored rim bars
    const sectorRimColors = [
      { deg1: 120, deg2: 60, color: '#f8fafc', label: '⚪ BIANCO (A..H)' },
      { deg1: 240, deg2: 180, color: '#ef4444', label: '🔴 ROSSO (L..I, D..A)' },
      {
        deg1: 360,
        deg2: 300,
        color: this.boardTheme === 'wood' ? '#a8a29e' : '#22c55e',
        label: this.boardTheme === 'wood' ? '⚫ NERO (H..E, I..L)' : '🟢 VERDE (H..E, I..L)',
      },
    ];
    for (const rim of sectorRimColors) {
      const r1 = (rim.deg1 * Math.PI) / 180;
      const r2 = (rim.deg2 * Math.PI) / 180;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (outerR * 0.98 * Math.cos(r1)).toFixed(3));
      line.setAttribute('y1', (outerR * 0.98 * Math.sin(r1)).toFixed(3));
      line.setAttribute('x2', (outerR * 0.98 * Math.cos(r2)).toFixed(3));
      line.setAttribute('y2', (outerR * 0.98 * Math.sin(r2)).toFixed(3));
      line.setAttribute('stroke', rim.color);
      line.setAttribute('stroke-width', '0.16');
      line.setAttribute('stroke-linecap', 'round');
      this.frameLayer.appendChild(line);
    }

    const selectedSq = this.activeSelection?.squareId;
    const legalDestinations = new Map();
    if (this.activeSelection?.moves) {
      for (const m of this.activeSelection.moves) {
        legalDestinations.set(m.to, m);
      }
    }

    // Draw all 96 squares
    for (const sq of this.topology.getAllSquares()) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.style.cursor = 'pointer';

      const pts = sq.corners.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(' ');
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', pts);

      let fill = sq.isLight
        ? this.boardTheme === 'wood'
          ? '#eab676'
          : '#f1f5f9'
        : this.boardTheme === 'wood'
          ? '#451a03'
          : '#1e293b';

      if (sq.id === selectedSq) {
        fill = '#facc15';
      } else if (legalDestinations.has(sq.id)) {
        const mv = legalDestinations.get(sq.id);
        fill = mv.captured ? 'rgba(239, 68, 68, 0.48)' : sq.isLight ? '#fef08a' : '#4d7c0f';
      }

      poly.setAttribute('fill', fill);
      poly.setAttribute(
        'stroke',
        sq.isRosette ? '#f59e0b' : this.boardTheme === 'wood' ? '#290f02' : '#0f172a'
      );
      poly.setAttribute('stroke-width', sq.isRosette ? '0.045' : '0.025');
      g.appendChild(poly);

      // Coordinate label in corner of each square
      const txt = document.createElementNS(SVG_NS, 'text');
      const labelPos = {
        x: sq.corners[0].x * 0.72 + sq.center.x * 0.28,
        z: sq.corners[0].z * 0.72 + sq.center.z * 0.28,
      };
      txt.setAttribute('x', labelPos.x.toFixed(3));
      txt.setAttribute('y', labelPos.z.toFixed(3));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('font-size', sq.isRosette ? '0.22' : '0.18');
      txt.setAttribute('font-weight', sq.isRosette ? '800' : '600');
      txt.setAttribute(
        'fill',
        sq.isLight
          ? this.boardTheme === 'wood'
            ? '#5c2406'
            : '#475569'
          : this.boardTheme === 'wood'
            ? '#d6a374'
            : '#94a3b8'
      );
      txt.textContent = sq.id;
      g.appendChild(txt);

      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onSquareClick(sq.id);
      });
      g.addEventListener('mouseenter', () => {
        if (legalDestinations.has(sq.id) && this.hoveredTargetSquare !== sq.id) {
          this.hoveredTargetSquare = sq.id;
          this.renderRays();
        }
      });
      g.addEventListener('mouseleave', () => {
        if (this.hoveredTargetSquare === sq.id) {
          this.hoveredTargetSquare = null;
          this.renderRays();
        }
      });

      this.squaresLayer.appendChild(g);

      // Outer border coordinates (A..L and 1..12) matching Riccardo's board
      if (sq.row === 0) {
        const edgeMid = {
          x: 0.5 * (sq.corners[0].x + sq.corners[1].x),
          z: 0.5 * (sq.corners[0].z + sq.corners[1].z),
        };
        const outX = edgeMid.x * 1.075;
        const outZ = edgeMid.z * 1.075;
        const bTxt = document.createElementNS(SVG_NS, 'text');
        bTxt.setAttribute('x', outX.toFixed(3));
        bTxt.setAttribute('y', outZ.toFixed(3));
        bTxt.setAttribute('text-anchor', 'middle');
        bTxt.setAttribute('dominant-baseline', 'central');
        bTxt.setAttribute('font-size', '0.28');
        bTxt.setAttribute('font-weight', '800');
        bTxt.setAttribute('fill', '#fbbf24');
        bTxt.textContent = sq.file;
        this.labelsLayer.appendChild(bTxt);
      }
      if (sq.col === 0 || sq.col === 7) {
        const cA = sq.col === 0 ? sq.corners[0] : sq.corners[1];
        const cB = sq.col === 0 ? sq.corners[3] : sq.corners[2];
        const sideMid = { x: 0.5 * (cA.x + cB.x), z: 0.5 * (cA.z + cB.z) };
        const outX = sideMid.x * 1.075;
        const outZ = sideMid.z * 1.075;
        const rTxt = document.createElementNS(SVG_NS, 'text');
        rTxt.setAttribute('x', outX.toFixed(3));
        rTxt.setAttribute('y', outZ.toFixed(3));
        rTxt.setAttribute('text-anchor', 'middle');
        rTxt.setAttribute('dominant-baseline', 'central');
        rTxt.setAttribute('font-size', '0.26');
        rTxt.setAttribute('font-weight', '700');
        rTxt.setAttribute('fill', '#e2e8f0');
        rTxt.textContent = String(sq.rank);
        this.labelsLayer.appendChild(rTxt);
      }
    }

    // Draw the 3 sector dividing lines and the central Rosette star
    const centerDot = document.createElementNS(SVG_NS, 'circle');
    centerDot.setAttribute('cx', '0');
    centerDot.setAttribute('cy', '0');
    centerDot.setAttribute('r', '0.13');
    centerDot.setAttribute('fill', '#f59e0b');
    centerDot.setAttribute('stroke', '#fff');
    centerDot.setAttribute('stroke-width', '0.03');
    this.squaresLayer.appendChild(centerDot);
  }

  /**
   * Renders all illuminated branching rays (`MoveRayHighlighter` 2D) starting from the selected piece!
   */
  renderRays() {
    this.raysLayer.innerHTML = '';
    if (!this.activeSelection) return;

    const { squareId, moves, rays, forbiddenRosetteSquare } = this.activeSelection;
    const originNode = this.topology.getSquare(squareId);
    if (!originNode) return;

    const hoveredMove = this.hoveredTargetSquare
      ? moves.find((m) => m.to === this.hoveredTargetSquare)
      : null;

    // 1. Draw continuous ray paths from origin through all steps
    for (const ray of rays) {
      const pointIds = ray.pathIds || [squareId, ...ray.steps.map((s) => s.id)];
      const coords = pointIds
        .map((id) => this.topology.getSquare(id)?.center)
        .filter(Boolean);
      if (coords.length < 2) continue;

      const isHoveredRay =
        hoveredMove &&
        hoveredMove.path.length <= pointIds.length &&
        hoveredMove.path.every((id, idx) => pointIds[idx] === id);

      const opacity = hoveredMove ? (isHoveredRay ? '1.0' : '0.28') : '0.92';

      let strokeColor = '#ffd54f'; // Gold default
      if (ray.rayKind === 'diagonal_rosette') {
        strokeColor = '#00e5ff'; // Electric Cyan for Rosette Y-fork!
      } else if (ray.rayKind === 'knight_L' || ray.rayKind === 'castle') {
        strokeColor = '#c084fc'; // Magic Purple for Knight L-paths & Castling
      } else if (ray.steps.some((s) => s.status === 'capture')) {
        strokeColor = '#fb7185';
      }

      const ptsStr = coords.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`).join(' ');

      // Outer glow polyline
      const glowLine = document.createElementNS(SVG_NS, 'polyline');
      glowLine.setAttribute('points', ptsStr);
      glowLine.setAttribute('fill', 'none');
      glowLine.setAttribute('stroke', strokeColor);
      glowLine.setAttribute('stroke-width', isHoveredRay ? '0.22' : '0.15');
      glowLine.setAttribute('stroke-linecap', 'round');
      glowLine.setAttribute('stroke-linejoin', 'round');
      glowLine.setAttribute('opacity', String(Number(opacity) * 0.38));
      glowLine.style.pointerEvents = 'none';
      this.raysLayer.appendChild(glowLine);

      // Core laser polyline
      const coreLine = document.createElementNS(SVG_NS, 'polyline');
      coreLine.setAttribute('points', ptsStr);
      coreLine.setAttribute('fill', 'none');
      coreLine.setAttribute('stroke', strokeColor);
      coreLine.setAttribute('stroke-width', isHoveredRay ? '0.095' : '0.065');
      coreLine.setAttribute('stroke-linecap', 'round');
      coreLine.setAttribute('stroke-linejoin', 'round');
      if (ray.rayKind === 'knight_L') {
        coreLine.setAttribute('stroke-dasharray', '0.14 0.08');
      }
      coreLine.setAttribute('opacity', opacity);
      coreLine.style.pointerEvents = 'none';
      this.raysLayer.appendChild(coreLine);
    }

    // 2. Draw destination markers (circles for empty targets, target rings for captures)
    for (const m of moves) {
      const targetSq = this.topology.getSquare(m.to);
      if (!targetSq) continue;

      const isHovered = this.hoveredTargetSquare === m.to;
      const marker = document.createElementNS(SVG_NS, 'circle');
      marker.setAttribute('cx', targetSq.center.x.toFixed(3));
      marker.setAttribute('cy', targetSq.center.z.toFixed(3));
      marker.style.pointerEvents = 'none';

      if (m.captured) {
        marker.setAttribute('r', isHovered ? '0.44' : '0.38');
        marker.setAttribute('fill', 'rgba(239, 68, 68, 0.22)');
        marker.setAttribute('stroke', '#ef4444');
        marker.setAttribute('stroke-width', '0.075');
      } else {
        marker.setAttribute('r', isHovered ? '0.23' : '0.17');
        marker.setAttribute('fill', m.crossesRosette ? '#00e5ff' : '#fde047');
        marker.setAttribute('stroke', '#0f172a');
        marker.setAttribute('stroke-width', '0.035');
      }
      this.raysLayer.appendChild(marker);
    }

    // 3. If hoveredMove is active, draw step numbers (1, 2, 3...) along its path!
    if (hoveredMove && hoveredMove.path.length > 1) {
      for (let i = 1; i < hoveredMove.path.length; i++) {
        const stSq = this.topology.getSquare(hoveredMove.path[i]);
        if (!stSq) continue;
        const badge = document.createElementNS(SVG_NS, 'text');
        badge.setAttribute('x', stSq.center.x.toFixed(3));
        badge.setAttribute('y', (stSq.center.z - 0.28).toFixed(3));
        badge.setAttribute('text-anchor', 'middle');
        badge.setAttribute('dominant-baseline', 'central');
        badge.setAttribute('font-size', '0.24');
        badge.setAttribute('font-weight', '900');
        badge.setAttribute('fill', '#ffffff');
        badge.setAttribute('stroke', '#0f172a');
        badge.setAttribute('stroke-width', '0.04');
        badge.setAttribute('paint-order', 'stroke');
        badge.style.pointerEvents = 'none';
        badge.textContent = `${i}`;
        this.raysLayer.appendChild(badge);
      }
    }

    // 4. Draw forbidden opposite-color Rosette badge [01:15] / [01:22]
    if (forbiddenRosetteSquare) {
      const fSq = this.topology.getSquare(forbiddenRosetteSquare);
      if (fSq) {
        const fTxt = document.createElementNS(SVG_NS, 'text');
        fTxt.setAttribute('x', fSq.center.x.toFixed(3));
        fTxt.setAttribute('y', fSq.center.z.toFixed(3));
        fTxt.setAttribute('text-anchor', 'middle');
        fTxt.setAttribute('dominant-baseline', 'central');
        fTxt.setAttribute('font-size', '0.38');
        fTxt.style.pointerEvents = 'none';
        fTxt.textContent = '🚫';
        this.raysLayer.appendChild(fTxt);
      }
    }
  }

  renderPieces() {
    this.piecesLayer.innerHTML = '';
    const counterRot = this.rotate2DWithTurn ? this.currentRotationDeg : 0;

    for (const [sqId, piece] of this.rules.board.entries()) {
      const sq = this.topology.getSquare(sqId);
      if (!sq) continue;

      const pal = this._getArmyPalette(piece.color, piece.isFlotsam);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute(
        'transform',
        `translate(${sq.center.x.toFixed(3)}, ${sq.center.z.toFixed(3)}) rotate(${counterRot})`
      );
      g.style.pointerEvents = 'none';

      // Medallion disc
      const disc = document.createElementNS(SVG_NS, 'circle');
      disc.setAttribute('cx', '0');
      disc.setAttribute('cy', '0');
      disc.setAttribute('r', piece.type === 'p' ? '0.29' : '0.34');
      disc.setAttribute('fill', pal.fill);
      disc.setAttribute('stroke', pal.stroke);
      disc.setAttribute('stroke-width', '0.045');
      g.appendChild(disc);

      // Chess icon
      const icon = document.createElementNS(SVG_NS, 'text');
      icon.setAttribute('x', '0');
      icon.setAttribute('y', '0.02');
      icon.setAttribute('text-anchor', 'middle');
      icon.setAttribute('dominant-baseline', 'central');
      icon.setAttribute('font-size', piece.type === 'p' ? '0.38' : '0.45');
      icon.setAttribute('fill', pal.text);
      icon.textContent = PIECE_UNICODE[piece.type] || '♟';
      g.appendChild(icon);

      this.piecesLayer.appendChild(g);
    }
  }
}
