# AGENTS.md: TriBecca (`Scacchi Tricolore 3D`) 🇮🇹♟️🔺

This is the implementation repository for **TriBecca** (*Scacchi Tricolore 3D*), the Carlesso family 2D/3D 3-player hexagonal chess game (`96 squares`, `A..L` × `1..12`).

- **Spec = source of truth**: [`docs/spec/SPEC.md`](docs/spec/SPEC.md) (originally drafted in `palladius/respec/specs/games/tricolore-chess-3d/SPEC.md`).
- **3D Game Architecture**: Always follow `niccolo-game-design` (Managers + Typed Event Bus + Headless logic managers with zero DOM/Three.js imports).
- **AI Ethics (`Carlessian Commons v1.0`)**: Follow [`AI_ETHICS.md`](AI_ETHICS.md).
- **PuffinLogin**: Integrated via `src/puffin-login.js` (`app-id="tricolore-chess-3d"`). Never commit plaintext passwords or PINs.
- **Verification**: Run `just test` (`node --test`) before every commit/push, and maintain `VERSION` + `CHANGELOG.md`.
