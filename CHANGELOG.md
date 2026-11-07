# Changelog

All notable changes to **TriBecca (`Scacchi Tricolore 3D`)** are documented here.

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
