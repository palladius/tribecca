# Changelog

All notable changes to **TriBecca (`Scacchi Tricolore 3D`)** are documented here.

## [0.2.0] - 2026-11-08

### ✨ Added
- **Start-of-Game Setup & Progressive Multi-Login Dialog (`index.html`, `src/main.js`, `src/managers/PlayerSeatManager.js`)**:
  - Built a native HTML `<dialog id="welcome-dialog">` (following `modern-web-guidance` Top-Layer & scroll-containment best practices) that opens at the start of a match.
  - Defaults to **`Ospite vs 2 Computer`** (`Giocatore 1 · Bianco = Ospite`, `Giocatore 2 · Rosso = CPU`, `Giocatore 3 · Verde = CPU`) for 99% of casual visitors, with 1-click segmented radio presets for **`2 Giocatori vs 1 Computer`**, **`3 Giocatori al Tavolo (Ospiti / Famiglia)`**, and **`Auto-Play (3 Computer)`**.
  - Added **Progressive Family Multi-Login (`assignNextProgressiveLogin()`)**: as family members log in sequentially via `<puffin-login>`, the game greets each player and assigns them to the next open seat in order:
    - 1st login: *"Ah sei Papino Riccardo? Bene, allora ti do Giocatore 1 (Bianco)!"*
    - 2nd login: *"Ah sei Ale? Bene, allora ti do Giocatore 2 (Rosso)!"*
    - 3rd login: *"Ah sei Seby? Bene, allora ti do Giocatore 3 (Verde)!"*
- **Monochrome `currentColor` SVG Icon System & Carlessian UI Polish (`src/ui/icons.js`, `index.html`, `src/views/Board2DView.js`)**:
  - Replaced polychrome OS emojis across all toolbars, `<select>` options, 2D board medallions, and toasts with crisp Lucide-style `stroke="currentColor"` inline SVGs (`split`, `cube`, `hexagon`, `palette`, `user`, `users`, `bot`, `play`, `pause`, `stepForward`, `undo`, `redo`, `lightbulb`, `wrench`, `refresh`, `key`, `lock`, `check`, `shieldCheck`, `shieldAlert`, `trophy`, `crown`, `crosshair`, `bug`, `code`, `globe`) and geometric `.army-dot` indicators (`webapp-that-riccardo-likes` Section 2 & `modern-web-guidance` `icons`).
  - Added joined segmented radio controls (`role="radiogroup"`), `tabular-nums`, soft-tinted numeric micro-badges (`.num-chip--info`, `.num-chip--ok`, `.num-chip--warn`, `.num-chip--bad`), URL query string + `localStorage` state persistence across `F5` reload (`?view=split&theme=tricolore&mode=1v2&autostart=1`), and the canonical **Carlessian Footer** (`v0.2.0`, `ENV` badge, `GH Repo`, `GHP Live`, `GHI Issues`, `Add a Bug`).

## [0.1.6] - 2026-11-07

### ✨ Added
- **Multi-Login for 1–3 Human Players at the Table (`src/managers/PlayerSeatManager.js`, `src/main.js`, `index.html`, `src/views/Board2DView.js`)**:
  - Added per-player verification tracking (`verifiedProfiles` persisted in `localStorage`) so up to 3 family players (`Papino Riccardo 🦖`, `Ale 🐉`, `Seby 🐴`, `Kate 👸`, `Nonna 👵`) can authenticate sequentially via `<puffin-login>` PIN/password at the same table.
  - Added per-seat **`🔒 Login` / `✅ Loggato`** pill buttons, a top-bar **`🔑 Multi-Login (N/M)`** queue button, and **`✅` / `🔒`** indicators on the 2D board medallions.
  - Synced the top-right `<puffin-login>` badge to automatically display the currently moving verified family player on every turn rotation.
  - Fixed `GAME_OVER` Hall of Fame submission to record scores under the winning seat's verified `player_id` (`riccardo`, `ale`, `seby`, etc.) instead of `Guest`, added a 1-click **`🔐 Fai Login ora per salvare questa vittoria a tuo nome!`** recovery button in the Hall of Fame modal, and retroactively upgraded Riccardo's 95-move (`810 pt`) victory from `Guest` to `Papino Riccardo`.

## [0.1.5] - 2026-11-07

### 🐛 Fixed
- **Interactive Pawn Promotion Picker Modal (`index.html`, `src/main.js`, `src/managers/ThreeChessRulesManager.js`)**:
  - When a human player's pawn reaches the promotion rank (`row === 0` of an enemy sector, e.g., `E11 -> E12`), the game now opens the **`👑 Promozione Pedone`** modal displaying the player's PuffinLogin avatar and 4 choices (`♕ Regina`, `♖ Torre`, `♗ Alfiere`, `♘ Cavallo`, plus `✖️ Annulla mossa`) instead of silently auto-promoting to a Queen.

## [0.1.4] - 2026-11-07

### ✨ Added
- **PuffinLogin Player Avatars on Active Turn & 2D/3D Board Sides (`index.html`, `src/main.js`, `src/views/Board2DView.js`, `src/managers/PlayerSeatManager.js`)**:
  - Added large circular PuffinLogin avatar (`assets/avatars/ale.png`, `assets/avatars/seby.png`, `assets/avatars/riccardo.png`, etc.) directly inside the top `#active-turn-banner` Turn Pill and in a floating `#stage-turn-hero-card` badge on the 3D view (`[Avatar] Tocca a: Ale 🐉 · 🔴 Armata Rossa`).
  - Added 3 upright SVG PuffinLogin Seat Medallions (`renderSeatsMedallions()`) outside the 3 home edges of the 2D hexagonal board (`⚪ Bianco` at `90°`, `🔴 Rosso` at `210°`, `🟢 Verde` at `330°`) that counter-rotate with the 120° turn rotation and light up with a golden halo and `👈 TOCCA A TE!` when it is that child/player's turn.

## [0.1.3] - 2026-11-07

### ✨ Added
- **Tactical Checkmate & King-Hunt AI (`src/managers/SimpleAIManager.js`)**:
  - Upgraded `SimpleAIManager.chooseMove(color)` with 1-ply lookahead for **Checkmate (`+100000`)**, **Check & Escape Restriction (`+220` to `+750`)**, hanging-piece blunder prevention, enemy-sector pawn promotion march (`row 3 -> 2 -> 1 -> 0`), endgame King-hunt constriction toward the weakest surviving opponent, anti-oscillation history penalty, and optional deterministic Mulberry32 seeding (`setSeed`).
- **Tactical Check / Checkmate Toast & Victory Banner (`index.html`, `src/main.js`)**:
  - Added floating `#tactical-toast` alerts for `PLAYER_CHECKED` (`⚠️ SCACCO AL RE ...`), `PLAYER_ELIMINATED`, and `GAME_OVER` (`👑 SCACCO MATTO!`), plus `#hof-victory-banner` inside the Hall of Fame modal with semi-transparent backdrop so the final 3D + 2D checkmate board position remains visible.

### 🐛 Fixed
- **Castling & Empty-Square Attack Detection (`src/managers/ThreeChessRulesManager.js`)**:
  - Fixed `getAttackersOf(targetSquareId, defenderColor)` so empty squares (such as castling transit squares `F1`/`D1`) accurately detect diagonal pawn attacks while ignoring non-capturing straight pawn pushes and castling rays.
  - Enforced FIDE castling checks in `getLegalMovesAndRays` so a King can never castle out of check or across an attacked transit square.
  - Added cascade elimination loop, 3-player stalemate elimination, and insufficient-material draw detection in `_advanceTurnAndCheckEliminations`.
  - Added `PLAYER_ELIMINATED` and `GAME_OVER` re-render listeners in `Board2DView.js` and preview-timer cancellation on pause/undo in `SimpleAIManager.js`.

## [0.1.2] - 2026-11-07

### 🐛 Fixed
- **3D Chessboard Tile Visibility (`src/views/Board3DView.js`)**:
  - Lowered the hexagonal plinth (`baseGeo.translate(0, -0.44, 0)`) so its beveled top face (`y = -0.02`) no longer covers the 96 tiles at `y = +0.02`.
  - Fixed counter-clockwise triangle winding (`pts[0], pts[2], pts[1]` and `pts[0], pts[3], pts[2]`) in the Three.js XZ plane so all 96 tile normals point straight up (`+Y`) toward the directional lights, and added golden 3D borders around the 6 central Rosette squares (`D4, D5, I5, I9, E9, E4`).

## [0.1.1] - 2026-11-07

### 🐛 Fixed
- **`ThreeChessRulesManager` `Map` Iteration Fix**: Snapshot `[...this.board.entries()]` inside `getAllLegalMovesForColor`, `getAttackersOf`, and `findKingSquare` so temporary piece move/restore checks never mutate live `Map` iteration order during turn transitions.
- **Self-Hosted Three.js Importmap & SVG Ray Click-Through**: Added local `./vendor/three/` importmap in `index.html`, set `require-login="false"` on `<puffin-login>` so the board is immediately playable on load, and added `pointer-events: none` on 2D ray/piece overlay layers so clicking highlighted target squares never gets intercepted by ray circles.

## [0.1.0] - 2026-11-07

### ✨ Added
- Initial release of **TriBecca (`Scacchi Tricolore 3D`)** — pragmatic 2D + 3D 3-player hexagonal chess game (`96 squares`, `A..L` × `1..12`) designed for Riccardo, Ale & Seby.
- **Exact Physical Board Topology (`src/managers/BoardTopologyManager.js`)**:
  - Replicates Riccardo's foldable Polish pyrography wooden 3-player board (`docs/spec/assets/scacchiera_fisica_riccardo.png`), with all 3 Queens starting on Light squares (`D1`, `I8`, `E12` `[00:15]`), all 3 Kings on Dark squares (`E1`, `D8`, `I12`), and the 6-square central Rosette (`D4, D5, I5, I9, E9, E4`).
- **Complete Rosette Rules Engine (`src/managers/ThreeChessRulesManager.js`)**:
  - Implements all rules from video `NMLVaFImzVs` and Riccardo's Google Doc (`[00:15]`–`[03:30]`): Bishop color-preserving center fork (`[00:48]`) and side outward deflection (`[00:58]`), Rook lateral-edge-only movement (`[01:38]`–`[01:56]`), forbidden opposite-color Rosette transitions for Bishop/Queen/King (`[01:15]`, `[01:22]`), Knight `2+1` orthogonal steps around the Rosette (`[02:36]`), and Pawn Rosette forward/capture rules (`[02:14]`–`[02:29]`).
  - Supports all **4 Elimination / Win Modes**: `1. Destroy (Default)`, `2. Assimilazione (Protoss Conquer)`, `3. Relitti Inerti (Flotsam Obstacles)`, and `4. Sudden Death`.
- **Illuminated Branching Rays (`MoveRayHighlighter` in 2D SVG & 3D Three.js)**:
  - Clicking any piece illuminates all continuous ray trajectories branching out from that square (`#FFD54F` Gold for standard rays, `#00E5FF` Electric Cyan for Rosette Y-forks, `#C084FC` Purple for Knight L-paths, `#EF4444` Red for captures, and `🚫` on the forbidden opposite-color Rosette square).
- **120° Turn Camera Rotation & Dual View (`🎲 3D` ⇄ `📐 2D` ⇄ `🌓 Split 3D+2D`)**:
  - Smooth $120^\circ$ clockwise camera rotation on every move (`⚪ Bianco 0° → 🔴 Rosso 120° → 🟢 Verde 240°`), plus instant toggle between **🇮🇹 Tricolore** and **🪵 Legno Pirografato** themes.
- **PuffinLogin Integration (`<puffin-login>` & `<puffin-leaderboard>`) & All 27 Human/CPU Combinations**:
  - Direct seat-to-color mapping (`Papino 🦖`, `Ale 🐉`, `Seby 🐴`, `Kate 👸`, `Nonna 👵`, `Ospite 🐧`, `Computer 🤖` $\Longleftrightarrow$ `⚪ Bianco`, `🔴 Rosso`, `🟢 Verde`), including `1v2`, `2v1`, `3v0`, and `0v3 Auto-Play ("Il Gioco Gioca da Solo")`.
