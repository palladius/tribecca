/**
 * @fileoverview Board3DView — Three.js 3D Hexagonal 96-Square View + 3D MoveRayHighlighter
 * + Smooth 120° Turn Camera Rotation for TriBecca.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';

export class Board3DView {
  /**
   * @param {HTMLElement} container
   * @param {import('../managers/BoardTopologyManager.js').BoardTopologyManager} topology
   * @param {import('../managers/ThreeChessRulesManager.js').ThreeChessRulesManager} rules
   * @param {import('../managers/PlayerSeatManager.js').PlayerSeatManager} seats
   * @param {import('../core/GameEventBus.js').GameEventBus} bus
   * @param {(squareId: string) => void} onSquareClick
   */
  constructor(container, topology, rules, seats, bus, onSquareClick) {
    this.container = container;
    this.topology = topology;
    this.rules = rules;
    this.seats = seats;
    this.bus = bus;
    this.onSquareClick = onSquareClick;

    /** @type {'tricolore' | 'wood'} */
    this.boardTheme = 'tricolore';
    /** @type {'every_turn' | 'humans_only' | 'fixed'} */
    this.rotationMode = 'every_turn';

    /** @type {Map<string, THREE.Mesh>} */
    this.tileMeshes = new Map();
    /** @type {Map<string, THREE.Group>} */
    this.pieceGroups = new Map();

    this.activeSelection = null;
    this.cameraTween = null;
    this.pieceHopTween = null;

    this._initScene();
    this._buildBoard3D();
    this.syncPieces();
    this._bindEvents();
    this._startLoop();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1324);

    const w = Math.max(320, this.container.clientWidth || 800);
    const h = Math.max(280, this.container.clientHeight || 600);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 120);
    // White starts at South (+z, angle 90° in x/z polar coords)
    this.cameraRadius = 12.2;
    this.cameraHeight = 9.4;
    this.currentCameraDeg = 0; // 0 = White (South), 120 = Red (NW), 240 = Green (NE)
    this._applyCameraAngle(0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 5.5;
    this.controls.maxDistance = 24;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 32;
    const d = 8.5;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    this.scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
    rimLight.position.set(-8, 9, -7);
    this.scene.add(rimLight);

    this.boardGroup = new THREE.Group();
    this.raysGroup = new THREE.Group();
    this.piecesRoot = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.scene.add(this.raysGroup);
    this.scene.add(this.piecesRoot);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._setupPointerInteractions();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const w = Math.max(240, this.container.clientWidth || 640);
    const h = Math.max(220, this.container.clientHeight || 480);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Positions the camera at `sectorAngleDeg` (0° = White South, 120° = Red NW, 240° = Green NE).
   * In world coordinates (`+x` East, `+z` South):
   * - White (0°): azimuth phi = 90° (`x = 0, z = +R`)
   * - Red (120°): azimuth phi = 210° (`x = -R*cos30°, z = -R*sin30°`)
   * - Green (240°): azimuth phi = 330° (`x = +R*cos30°, z = -R*sin30°`)
   */
  _applyCameraAngle(sectorAngleDeg) {
    this.currentCameraDeg = sectorAngleDeg;
    const phiRad = ((90 + sectorAngleDeg) * Math.PI) / 180;
    this.camera.position.set(
      this.cameraRadius * Math.cos(phiRad),
      this.cameraHeight,
      this.cameraRadius * Math.sin(phiRad)
    );
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  /**
   * Smoothly orbits the 3D camera to `targetSectorDeg` (e.g. +120° per turn).
   */
  tweenCameraToAngle(targetSectorDeg, durationMs = 650) {
    // Compute shortest angular delta
    let startDeg = this.currentCameraDeg % 360;
    if (startDeg < 0) startDeg += 360;
    let endDeg = targetSectorDeg % 360;
    if (endDeg < 0) endDeg += 360;

    let delta = endDeg - startDeg;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    // Maintain current user zoom distance & height
    const horizDist = Math.hypot(this.camera.position.x, this.camera.position.z);
    if (horizDist > 2) {
      this.cameraRadius = horizDist;
      this.cameraHeight = Math.max(3.2, this.camera.position.y);
    }

    this.cameraTween = {
      startDeg,
      delta,
      startTime: performance.now(),
      durationMs,
    };
  }

  setTheme(theme) {
    this.boardTheme = theme === 'wood' ? 'wood' : 'tricolore';
    this.scene.background = new THREE.Color(this.boardTheme === 'wood' ? 0x160f0b : 0x0b1324);
    this._buildBoard3D();
    this.syncPieces();
    this.renderRays3D();
  }

  _bindEvents() {
    this.bus.on('PIECE_SELECTED', (payload) => {
      this.activeSelection = payload;
      this._updateTileHighlights();
      this.renderRays3D();
    });
    this.bus.on('SELECTION_CLEARED', () => {
      this.activeSelection = null;
      this._updateTileHighlights();
      this.renderRays3D();
    });
    this.bus.on('MOVE_EXECUTED', (e) => {
      this.activeSelection = null;
      this._updateTileHighlights();
      this.renderRays3D();
      this.syncPieces(e.move);
    });
    this.bus.on('TURN_CHANGED', (e) => {
      this._updateTileHighlights();
      if (this.rotationMode === 'every_turn') {
        this.tweenCameraToAngle(e.cameraAngleDeg, 650);
      } else if (this.rotationMode === 'humans_only' && this.seats.isHumanTurn()) {
        this.tweenCameraToAngle(e.cameraAngleDeg, 650);
      }
    });
    this.bus.on('GAME_RESET', () => {
      this.activeSelection = null;
      this.syncPieces();
      this._updateTileHighlights();
      this.renderRays3D();
      this.tweenCameraToAngle(0, 450);
    });
    this.bus.on('HISTORY_CHANGED', (e) => {
      this.activeSelection = null;
      this.syncPieces();
      this._updateTileHighlights();
      this.renderRays3D();
      if (this.rotationMode !== 'fixed' && typeof e.cameraAngleDeg === 'number') {
        this.tweenCameraToAngle(e.cameraAngleDeg, 450);
      }
    });
    this.bus.on('PLAYER_ELIMINATED', () => {
      this.syncPieces();
    });
  }

  _setupPointerInteractions() {
    let downX = 0;
    let downY = 0;

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 7) return; // Ignore camera orbit drags

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const targets = [...this.tileMeshes.values(), ...this.piecesRoot.children];
      const hits = this.raycaster.intersectObjects(targets, true);

      for (const hit of hits) {
        let obj = hit.object;
        while (obj && !obj.userData?.squareId) {
          obj = obj.parent;
        }
        if (obj?.userData?.squareId) {
          this.onSquareClick(obj.userData.squareId);
          return;
        }
      }
    });
  }

  _buildBoard3D() {
    while (this.boardGroup.children.length > 0) {
      this.boardGroup.remove(this.boardGroup.children[0]);
    }
    this.tileMeshes.clear();

    const R = this.topology.boardRadius;
    const outerR = R + 0.55;

    // 1. Hexagonal wooden/marble base plinth
    const baseShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const rad = ((60 * i) * Math.PI) / 180;
      const x = outerR * Math.cos(rad);
      const y = -outerR * Math.sin(rad);
      if (i === 0) baseShape.moveTo(x, y);
      else baseShape.lineTo(x, y);
    }
    baseShape.closePath();

    const baseGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 2,
    });
    baseGeo.rotateX(-Math.PI / 2);
    // Top of bevel is at +0.42 before translation; translate by -0.44 so plinth top sits at y = -0.02 (below tiles at y = +0.02)
    baseGeo.translate(0, -0.44, 0);

    const baseMat = new THREE.MeshStandardMaterial({
      color: this.boardTheme === 'wood' ? 0x3b1d0a : 0x1e293b,
      roughness: 0.55,
      metalness: 0.12,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.receiveShadow = true;
    this.boardGroup.add(baseMesh);

    // 2. 3 Sector color indicator strips along the 3 player home edges
    const sectorBars = [
      { deg1: 120, deg2: 60, color: 0xf8fafc }, // White (Bottom)
      { deg1: 240, deg2: 180, color: 0xef4444 }, // Red (Top-Left)
      {
        deg1: 360,
        deg2: 300,
        color: this.boardTheme === 'wood' ? 0x9ca3af : 0x22c55e,
      }, // Green / Black (Top-Right)
    ];

    for (const bar of sectorBars) {
      const r1 = (bar.deg1 * Math.PI) / 180;
      const r2 = (bar.deg2 * Math.PI) / 180;
      const p1 = new THREE.Vector3((R + 0.32) * Math.cos(r1), 0.03, (R + 0.32) * Math.sin(r1));
      const p2 = new THREE.Vector3((R + 0.32) * Math.cos(r2), 0.03, (R + 0.32) * Math.sin(r2));
      const curve = new THREE.LineCurve3(p1, p2);
      const tubeGeo = new THREE.TubeGeometry(curve, 4, 0.075, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: bar.color,
        emissive: bar.color,
        emissiveIntensity: 0.25,
        roughness: 0.3,
      });
      this.boardGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    }

    // 3. All 96 quadrilateral tiles
    for (const sq of this.topology.getAllSquares()) {
      const c = sq.corners;
      // Shrink slightly (97.5%) to leave crisp grout/wood seams between tiles
      const shrink = 0.972;
      const pts = c.map((p) => ({
        x: sq.center.x + (p.x - sq.center.x) * shrink,
        z: sq.center.z + (p.z - sq.center.z) * shrink,
      }));

      // Counter-clockwise in Three.js XZ plane so normal points straight UP (+Y) toward the lights!
      const positions = new Float32Array([
        pts[0].x, 0.02, pts[0].z,
        pts[2].x, 0.02, pts[2].z,
        pts[1].x, 0.02, pts[1].z,
        pts[0].x, 0.02, pts[0].z,
        pts[3].x, 0.02, pts[3].z,
        pts[2].x, 0.02, pts[2].z,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();

      const baseColor = this._getTileBaseColor(sq);
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: this.boardTheme === 'wood' ? 0.42 : 0.28,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.userData = { squareId: sq.id, baseColor };
      this.boardGroup.add(mesh);
      this.tileMeshes.set(sq.id, mesh);

      // Highlight golden border on the 6 Rosette squares (D4, D5, I5, I9, E9, E4)
      if (sq.isRosette) {
        const loopPts = [
          new THREE.Vector3(pts[0].x, 0.026, pts[0].z),
          new THREE.Vector3(pts[1].x, 0.026, pts[1].z),
          new THREE.Vector3(pts[2].x, 0.026, pts[2].z),
          new THREE.Vector3(pts[3].x, 0.026, pts[3].z),
        ];
        const loopGeo = new THREE.BufferGeometry().setFromPoints(loopPts);
        const loopMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
        this.boardGroup.add(new THREE.LineLoop(loopGeo, loopMat));
      }

      // Coordinate canvas sprite on outer border
      if (sq.row === 0) {
        const edgeMid = {
          x: 0.5 * (c[0].x + c[1].x) * 1.06,
          z: 0.5 * (c[0].z + c[1].z) * 1.06,
        };
        this.boardGroup.add(this._makeTextSprite(sq.file, edgeMid.x, 0.06, edgeMid.z, '#fbbf24', 0.36));
      }
      if (sq.col === 0 || sq.col === 7) {
        const cA = sq.col === 0 ? c[0] : c[1];
        const cB = sq.col === 0 ? c[3] : c[2];
        const sideMid = {
          x: 0.5 * (cA.x + cB.x) * 1.06,
          z: 0.5 * (cA.z + cB.z) * 1.06,
        };
        this.boardGroup.add(
          this._makeTextSprite(String(sq.rank), sideMid.x, 0.06, sideMid.z, '#e2e8f0', 0.32)
        );
      }
    }

    // 4. Central Rosette golden jewel marker
    const rosetteGem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.4,
        metalness: 0.6,
        roughness: 0.2,
      })
    );
    rosetteGem.position.set(0, 0.035, 0);
    this.boardGroup.add(rosetteGem);
  }

  _getTileBaseColor(sq) {
    if (this.boardTheme === 'wood') {
      return sq.isLight ? 0xeab676 : 0x451a03;
    }
    return sq.isLight ? 0xe2e8f0 : 0x1e293b;
  }

  _updateTileHighlights() {
    const selectedId = this.activeSelection?.squareId;
    const legalMap = new Map();
    if (this.activeSelection?.moves) {
      for (const m of this.activeSelection.moves) {
        legalMap.set(m.to, m);
      }
    }

    for (const [id, mesh] of this.tileMeshes.entries()) {
      const sq = this.topology.getSquare(id);
      const baseColor = this._getTileBaseColor(sq);
      const mat = mesh.material;
      mat.color.setHex(baseColor);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;

      if (id === selectedId) {
        mat.color.setHex(0xfacc15);
        mat.emissive.setHex(0xf59e0b);
        mat.emissiveIntensity = 0.45;
      } else if (legalMap.has(id)) {
        const mv = legalMap.get(id);
        if (mv.captured) {
          mat.emissive.setHex(0xef4444);
          mat.emissiveIntensity = 0.42;
        } else {
          mat.emissive.setHex(mv.crossesRosette ? 0x00e5ff : 0xfde047);
          mat.emissiveIntensity = 0.28;
        }
      }
    }
  }

  /**
   * Builds sculpted 3D Staunton + Crown pieces for all pieces currently on the board.
   */
  syncPieces(lastMove = null) {
    while (this.piecesRoot.children.length > 0) {
      this.piecesRoot.remove(this.piecesRoot.children[0]);
    }
    this.pieceGroups.clear();

    for (const [sqId, piece] of this.rules.board.entries()) {
      const sq = this.topology.getSquare(sqId);
      if (!sq) continue;

      const group = this._createPieceMeshGroup(piece, sqId);
      group.position.set(sq.center.x, 0.02, sq.center.z);
      this.piecesRoot.add(group);
      this.pieceGroups.set(sqId, group);
    }

    if (lastMove) {
      const movedGroup = this.pieceGroups.get(lastMove.to);
      const fromSq = this.topology.getSquare(lastMove.from);
      const toSq = this.topology.getSquare(lastMove.to);
      if (movedGroup && fromSq && toSq) {
        this.pieceHopTween = {
          group: movedGroup,
          from: { x: fromSq.center.x, z: fromSq.center.z },
          to: { x: toSq.center.x, z: toSq.center.z },
          startTime: performance.now(),
          durationMs: 340,
        };
      }
    }
  }

  _createPieceMeshGroup(piece, squareId) {
    const group = new THREE.Group();
    group.userData = { squareId };

    let primaryHex = 0xfafbfd;
    let trimHex = 0xd4af37;

    if (piece.isFlotsam) {
      primaryHex = 0x64748b;
      trimHex = 0x94a3b8;
    } else if (piece.color === 'white') {
      primaryHex = this.boardTheme === 'wood' ? 0xf5deb3 : 0xfafbfd;
      trimHex = 0xf59e0b;
    } else if (piece.color === 'red') {
      primaryHex = this.boardTheme === 'wood' ? 0x991b1b : 0xdc2626;
      trimHex = 0xfbbf24;
    } else if (piece.color === 'green') {
      primaryHex = this.boardTheme === 'wood' ? 0x1c1917 : 0x16a34a;
      trimHex = this.boardTheme === 'wood' ? 0xa8a29e : 0x86efac;
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: primaryHex,
      roughness: this.boardTheme === 'wood' ? 0.38 : 0.24,
      metalness: 0.14,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: trimHex,
      roughness: 0.25,
      metalness: 0.65,
    });

    const scale = piece.type === 'p' ? 0.78 : piece.type === 'k' || piece.type === 'q' ? 1.05 : 0.92;

    // Pedestal base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.31 * scale, 0.12, 18), bodyMat);
    base.position.y = 0.06;
    base.castShadow = true;
    base.userData = { squareId };
    group.add(base);

    const trimRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.275 * scale, 0.275 * scale, 0.035, 18),
      trimMat
    );
    trimRing.position.y = 0.13;
    trimRing.userData = { squareId };
    group.add(trimRing);

    // Stem
    const stemH =
      piece.type === 'k'
        ? 0.56
        : piece.type === 'q'
          ? 0.5
          : piece.type === 'b' || piece.type === 'n' || piece.type === 'r'
            ? 0.38
            : 0.26;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14 * scale, 0.22 * scale, stemH, 16),
      bodyMat
    );
    stem.position.y = 0.14 + stemH / 2;
    stem.castShadow = true;
    stem.userData = { squareId };
    group.add(stem);

    const topY = 0.14 + stemH;

    // Role-specific sculpted head (S2 clarity crowns)
    if (piece.type === 'p') {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 14), bodyMat);
      head.position.y = topY + 0.1;
      head.castShadow = true;
      head.userData = { squareId };
      group.add(head);
    } else if (piece.type === 'r') {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.18, 12), bodyMat);
      tower.position.y = topY + 0.08;
      tower.castShadow = true;
      tower.userData = { squareId };
      group.add(tower);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 6), trimMat);
      crown.position.y = topY + 0.18;
      group.add(crown);
    } else if (piece.type === 'n') {
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.3), bodyMat);
      snout.position.set(0, topY + 0.12, 0.04);
      snout.rotation.x = -0.35;
      snout.castShadow = true;
      snout.userData = { squareId };
      group.add(snout);
      const mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.12), trimMat);
      mane.position.set(0, topY + 0.16, -0.08);
      group.add(mane);
    } else if (piece.type === 'b') {
      const mitre = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 14), bodyMat);
      mitre.position.y = topY + 0.14;
      mitre.castShadow = true;
      mitre.userData = { squareId };
      group.add(mitre);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), trimMat);
      orb.position.y = topY + 0.31;
      group.add(orb);
    } else if (piece.type === 'q') {
      const tiara = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.18, 12), trimMat);
      tiara.position.y = topY + 0.09;
      tiara.castShadow = true;
      tiara.userData = { squareId };
      group.add(tiara);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), bodyMat);
      dome.position.y = topY + 0.16;
      group.add(dome);
    } else if (piece.type === 'k') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.2, 12), bodyMat);
      crown.position.y = topY + 0.1;
      crown.castShadow = true;
      crown.userData = { squareId };
      group.add(crown);
      // Cross finial (just like Riccardo's wooden Kings!)
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), trimMat);
      crossV.position.y = topY + 0.28;
      group.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), trimMat);
      crossH.position.y = topY + 0.3;
      group.add(crossH);
    }

    return group;
  }

  /**
   * Renders 3D illuminated branching ray tubes (`MoveRayHighlighter` 3D) across the board!
   */
  renderRays3D() {
    while (this.raysGroup.children.length > 0) {
      this.raysGroup.remove(this.raysGroup.children[0]);
    }
    if (!this.activeSelection) return;

    const { squareId, moves, rays, forbiddenRosetteSquare } = this.activeSelection;

    // 1. Continuous 3D glowing tubular rays for each branch
    for (const ray of rays) {
      const pointIds = ray.pathIds || [squareId, ...ray.steps.map((s) => s.id)];
      const pts3D = pointIds
        .map((id) => this.topology.getSquare(id)?.center)
        .filter(Boolean)
        .map((c) => new THREE.Vector3(c.x, 0.09, c.z));

      if (pts3D.length < 2) continue;

      let colorHex = 0xffd54f; // Gold
      if (ray.rayKind === 'diagonal_rosette') {
        colorHex = 0x00e5ff; // Electric Cyan for Rosette Y-fork!
      } else if (ray.rayKind === 'knight_L' || ray.rayKind === 'castle') {
        colorHex = 0xc084fc; // Purple for Knight L-jumps
      } else if (ray.steps.some((s) => s.status === 'capture')) {
        colorHex = 0xfb7185;
      }

      const curve = new THREE.CatmullRomCurve3(pts3D, false, 'catmullrom', 0.15);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(8, pts3D.length * 6), 0.042, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.75,
        roughness: 0.2,
        transparent: true,
        opacity: 0.88,
      });
      const mesh = new THREE.Mesh(tubeGeo, tubeMat);
      this.raysGroup.add(mesh);
    }

    // 2. Destination target rings / discs
    for (const m of moves) {
      const tSq = this.topology.getSquare(m.to);
      if (!tSq) continue;

      if (m.captured) {
        const ringGeo = new THREE.RingGeometry(0.32, 0.43, 24);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xef4444,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(tSq.center.x, 0.055, tSq.center.z);
        this.raysGroup.add(ring);
      } else {
        const discGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 18);
        const discColor = m.crossesRosette ? 0x00e5ff : 0xfde047;
        const discMat = new THREE.MeshStandardMaterial({
          color: discColor,
          emissive: discColor,
          emissiveIntensity: 0.65,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.set(tSq.center.x, 0.055, tSq.center.z);
        this.raysGroup.add(disc);
      }
    }

    // 3. Forbidden Rosette opposite-color indicator [01:15] / [01:22]
    if (forbiddenRosetteSquare) {
      const fSq = this.topology.getSquare(forbiddenRosetteSquare);
      if (fSq) {
        this.raysGroup.add(
          this._makeTextSprite('🚫', fSq.center.x, 0.35, fSq.center.z, '#ef4444', 0.45)
        );
      }
    }
  }

  _makeTextSprite(text, x, y, z, color = '#ffffff', scale = 0.35) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '900 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 10;
    ctx.strokeText(text, 64, 66);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 66);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }

  _startLoop() {
    const animate = (now) => {
      requestAnimationFrame(animate);

      // 1. Update 120° camera rotation tween
      if (this.cameraTween) {
        const elapsed = now - this.cameraTween.startTime;
        const t = Math.min(1, elapsed / this.cameraTween.durationMs);
        // easeInOutCubic
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const deg = this.cameraTween.startDeg + this.cameraTween.delta * ease;
        this._applyCameraAngle(deg);
        if (t >= 1) {
          this.cameraTween = null;
        }
      } else if (this.controls) {
        this.controls.update();
      }

      // 2. Update piece parabolic hop tween (`340ms`)
      if (this.pieceHopTween) {
        const elapsed = now - this.pieceHopTween.startTime;
        const t = Math.min(1, elapsed / this.pieceHopTween.durationMs);
        const g = this.pieceHopTween.group;
        if (g) {
          g.position.x =
            this.pieceHopTween.from.x +
            (this.pieceHopTween.to.x - this.pieceHopTween.from.x) * t;
          g.position.z =
            this.pieceHopTween.from.z +
            (this.pieceHopTween.to.z - this.pieceHopTween.from.z) * t;
          g.position.y = 0.02 + Math.sin(t * Math.PI) * 0.65;
        }
        if (t >= 1) {
          if (g) g.position.y = 0.02;
          this.pieceHopTween = null;
        }
      }

      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(animate);
  }
}
