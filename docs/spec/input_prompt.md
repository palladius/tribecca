# Input Prompt: Scacchi Tricolore 3D (CarChess3 — Scacchi a 3 Giocatori)

## Context
Un gioco didattico e pragmatico di Scacchi a 3 Giocatori (3D + 2D) ispirato a `carchess3d`, pensato per insegnare ad Alessandro (8 anni) e Sebastian (6 anni) a padroneggiare le regole e le traiettorie delle due scacchiere fisiche a 3 giocatori di casa Carlesso (vedi foto reale in `assets/scacchiera_fisica_riccardo.png`, video di riferimento `https://www.youtube.com/watch?v=NMLVaFImzVs` e documento di appunti di Riccardo `https://docs.google.com/document/d/1ztb0he8aDtqgzpmq_pQGncOVvNn3jxCw61pJKM90zPg/edit?tab=t.0`), con turnazione **Bianco ⚪ → Rosso 🔴 → Verde 🟢** (omaggio al Tricolore italiano 🇮🇹, più opzione palette legno originale **Bianco / Rosso Bordeaux / Nero Ebano**), rotazione automatica della visuale di $120^\circ$ a ogni mossa, tutte le combinazioni Umano/Computer (incluso `0 Umani` auto-play), e illuminazione visiva di tutti i raggi di movimento che si dipartono dal pezzo selezionato.

## Raw Prompt #1 from Riccardo Carlesso (2026-11-05)
> "comincia a creare delle SPEC.md per uin gioco di scacchi a 3, vedo che ci sono molte regole per gestire la scacchiera , ho 2 scacchiere e voglio insegnare ai miei figli a giocare. pensavo a un gioco 3d molto simile a carchess3d dove giochi 1 contro 2 computer o 2 contro 1 computer, beh insomma tutte le combo, il gioco sa giocare da solo, e il 3d ruota di 120gradi a ogni mossa, bianco rosso verde si turnano, possibilmente con qualcosa di italiano visti i colori delle pedine. feature importante, quando clicchi su un pezzo ti fa vedere illuminate tutte le mosse possibili che si dipartono. Visulaizza2d e 3d. tutto come carchess3d ma senza le battaglie animate, molto piu pragmatico, meno grafica figa molta piu' funzionalita.
>
> Cominciamo con le spec, mettile in respec/ e poi penseremo all'implementazione"

## Raw Prompt #2 & Physical Board Photo from Riccardo Carlesso (2026-11-07)
> "ecco la mia scacchiera"
> "leggi https://docs.google.com/document/d/1ztb0he8aDtqgzpmq_pQGncOVvNn3jxCw61pJKM90zPg/edit?tab=t.0"
>
> - **Reference Photo**: [`assets/scacchiera_fisica_riccardo.png`](assets/scacchiera_fisica_riccardo.png) (Scacchiera esagonale pieghevole in legno pirografato polacco a 96 caselle, coordinate `A..L` × `1..12`, cerniera centrale tra `D/E` e `5/9`, pezzi in legno Bianco, Rosso Bordeaux e Nero/Ebano).
> - **Reference Video**: `https://www.youtube.com/watch?v=NMLVaFImzVs` (*"How to play 3 Player Chess"* — Triple S Games).
> - **Reference Google Doc Notes (by Riccardo)**:
>   - **Win Modes**:
>     1. `(default/destroy)`: remove pieces of loser and continue.
>     2. `Protoss conquer`: who wins can use the pieces.
>     3. `Flotsam`: Player removed from game but pieces are staging. Pieces do not move and can't check a king. You can take those pieces.
>     4. `Sudden Death` `[03:06]`: The game ends as soon as one player is checkmated; the player who delivered the checkmate wins.
>   - **Timestamped Rosette Rules `[00:15]`–`[03:30]`**: Complete breakdown of Bishop, Rook, Queen, King, Knight, and Pawn behavior inside and around the central 6-square Rosette.

## Raw Prompt #3 from Riccardo Carlesso (2026-11-07)
> "meglio se supporta il PuffinLogin direttamente cosi c'e' il colore abbinato al giocatore (ale, Seby, Papino, computer <=> bianco verde rosso). il computer puo' essere debole per cominciare non importa"

