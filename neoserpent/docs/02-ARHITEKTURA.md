# NEOSERPENT — Tehnička arhitektura

> Dokument pokriva: **(A)** arhitekturu prototipa (implementiran, `prototype/`),
> **(B)** produkcionu arhitekturu za multiplayer (monorepo, PixiJS + Colyseus),
> **(C)** umrežavanje sa client-side prediction i interpolacijom,
> **(D)** optimizacije i performance budžete.

---

## A. Arhitektura prototipa (šta već radi)

```
neoserpent/prototype/
├── index.html                  # canvas + DOM overlay-i (meni, death, touch)
├── style.css                   # neon UI, vinjeta, scanlines (CSS post-FX)
└── src/
    ├── main.js                 # bootstrap: DOM refs → Game
    ├── Game.js                 # petlja, state mašina (menu/playing/dead), DOM wiring
    ├── core/                   # ── ČIST JS, bez DOM-a (testabilno u Node-u) ──
    │   ├── math.js             # vec2, angDiff, smoothDamp, Catmull-Rom, mulberry32 RNG
    │   ├── PathBuffer.js       # ring-buffer putanje + CR uzorkovanje (SRCE kretanja)
    │   ├── SpatialHash.js      # uniformni grid, int32 ključevi, pooled nizovi
    │   ├── Camera.js           # follow + look-ahead + zoom + shake + konverzije
    │   ├── Input.js            # pointer events + tastatura (ujedinjeno miš/dodir)
    │   └── Audio.js            # proceduralni Web Audio SFX (bez asset-a)
    ├── entities/
    │   ├── Snake.js            # entitet: steering, putanja, segmenti, BAL konstante
    │   ├── Controllers.js      # LocalController | BotController (ista input interfejs!)
    │   └── Food.js             # pellet / mega / drop / power — svako svoje ponašanje
    ├── systems/
    │   ├── World.js            # arena: redosled update-a, sudari, smrt, respavn, heševi
    │   └── Effects.js          # čestice/shardovi/shockwave/tekst/trauma-shake/slow-mo
    └── render/
        ├── Renderer.js         # neon-ribbon zmije, glow sprite keš, čestice
        ├── Background.js       # parallax, reaktivna mreža, nebula, granica
        └── Hud.js              # paneli, ability bar, kill feed, minimapa
```

**Ključna pravila:**
1. **`core/` + `entities/` + `systems/` ne znaju za DOM** → ista logika se izvršava u pregledaču i na serveru (Node) i u testovima (`node test/sim.test.mjs`).
2. **Controller pattern:** `Snake` ne zna ko njome upravlja. Igrač, bot i (u produkciji) mreža samo popunjavaju `snake.input {tx, ty, boost, dash, magnet, emp}`.
3. **Hooks pattern:** `World` ne zove audio/HUD direktno — emituje `hooks.eat/death/dash/...` koje `Game` pretvara u zvuk/UI. Omogućava headless server.
4. **Nula alokacija u hot path-u:** segmenti i putanja su u `Float32Array` ring baferima; čestice su pool; heš nizovi se recikliraju.

---

## B. Produkciona arhitektura (multiplayer)

### B.1 Monorepo struktura

```
neoserpent/                        # pnpm workspaces + turborepo
├── apps/
│   ├── client/                    # Vite + TypeScript + PixiJS v8 (WebGL/WebGPU)
│   │   ├── src/
│   │   │   ├── game/              # ── SIM (deljen sa serverom preko packages/sim) ──
│   │   │   │   ├── snake/         # PathBuffer, Snake, steering  ← identičan kod
│   │   │   │   ├── food/          # hrana, power-up logika
│   │   │   │   ├── world/         # World, sudari, spatial hash
│   │   │   │   └── effects/       # čestice (klijentski vizuel)
│   │   │   ├── net/               # NetworkClient, Prediction, Interpolation, Reconciler
│   │   │   ├── render/            # Pixi: stage slojevi, ribbon mesh, glow, shaders
│   │   │   ├── ui/                # HUD (DOM/PixiUI), meniji, settings
│   │   │   └── main.ts
│   │   └── vite.config.ts
│   ├── server/                    # Node.js + Colyseus + TypeScript
│   │   └── src/
│   │       ├── rooms/ArenaRoom.ts # tick 30Hz, authoritative sim
│   │       ├── sim/               # re-import packages/sim (ISTA logika kao klijent)
│   │       ├── bots/              # BotController na serveru
│   │       └── index.ts
│   └── tooling/                   # eslint, prettier, github actions
├── packages/
│   ├── sim/                       # ★ DELJENA SIMULACIJA (čist TS, zero deps)
│   │   └── src/                   # snake, food, world, hash, math — jedan izvor istine
│   ├── protocol/                  # Colyseus schema / flatbuffer definicije
│   └── config/                    # BALANCE.json (hot-reload balans brojki)
└── docs/
```

**Zašto deljeni `packages/sim`:** client-side prediction zahteva da klijent izvrši **identičnu** simulaciju kao server. Jedan kod = nema desinhronizacije. To je razlog zašto je prototip već podeljen na `core/entities/systems` bez DOM-a.

### B.2 Podaci između slojeva

```
Input (klijent) ──► [ Prediction: sim mog zmije ] ──► render ODMAH (0ms)
        │
        └──► UDP/WS ──► SERVER (authoritative, 30Hz)
                          │
                          ├─ validacija (max ω, max v, cooldown-i, cena mase)
                          ├─ sim svih zmija
                          └─ snapshot delta ──► klijent
                                                 │
                          [ Interpolation buffer 100ms ] ──► render tuđih zmija
                                                 │
                          [ Reconciliation ] ──► korekcija moje zmije (smooth decay)
```

---

## C. Umrežavanje (detaljno)

### C.1 Transport i serializacija
- **Colyseus** room-ovi preko WebSocket-a; state delta kompresija ugrađena.
- Kritično: **zmija se NE šalje telo** — pošto telo rekonstruišemo iz putanje, po zmiji ide samo:

```
SnakeSnapshot (≈24B):  x(f16) y(f16) heading(u16 ∕2π) speed(u8)
                       mass(u16) aliveFlags(u8) buffs(u8)
Food delta:            spawn/despawn event + pozicija (f16)
```
  Pri 60 zmija × 30Hz = **~50KB/s ukupno**. Telu od 240 segmenata nikad ne putuje mrežom.
- Input paket klijenta: `{seq, targetX, targetY (f16), flags(u8)}` — ~12B, šalje se na 30Hz (sampling) ili 60Hz (polling input).

### C.2 Client-side prediction (moja zmija)
1. Klijent čuva ulazni bafer `pendingInputs[]` i simulira odmah.
2. Server vraca `ack(seq) + authoritative state` za moju zmiju.
3. Klijent **resimulira** od `ack` stanja sa pending inputima (replay).
4. Razlika se ne primenjuje skokom već **exponential decay**: `renderPos += error × 0.1` po frejmu — igrač nikad ne vidi "teleport".

### C.3 Entity interpolation (tuđe zmije)
- Klijent renderuje tuđe zmije **~100ms u prošlosti** (2 server ticka) iz interpolacionog bafera.
- Između snapshotova: ekstrapolacija headinga (pravolinijski, ne ubrzano) — zmije se gotovo nikad ne telepertuju jer je kretanje glatko po prirodi (ograničen ω).
- Path-based telo pomaže: dovoljno je interpolovati **glavu**, telo sledi samo po sebi (uzorkovanje iz lokalno izgrađene putanje od primljenih head pozicija).

### C.4 Lag kompenzacija i autoritet
- Sudare **računa samo server** na svom tick-u (nema "ja sam ga dodirnuo na mom ekranu").
- Hitbox servera je malo **oprostiviji za žrtvu** (radius ×0.9) — kompenzacija prosečne latencije oba igrača (isti princip kao forgiving hitboxes u žanru).
- Anti-cheat validacija po inputu: `|Δheading| ≤ ω_max·Δt`, `v ≤ v_max`, cooldown-i server-side tajmeri.

### C.5 Skaliranje
- **Arena = 1 Colyseus room** (60 igrača + bot filler). Stateles room procesi → horizontalno skaliranje iza load balansera (Redis presence za matchmeking).
- **Interest management:** prostorni heš na serveru već postoji → svakom klijentu šalji samo entitete u AOI 1600px + ivice + leaderboard agregate.

---

## D. Optimizacije i performance budžet

### D.1 Sudari — spatial hashing (implementirano)
- Uniformna mreža ćelija 96–110px; ubacivanje po centru, upit po rasponu ćelija.
- Segmenti se ubacuju sa **stride 2** (preklapanje segmenta ≥ 2× spacing garantuje bez rupa).
- Kompleksnost: O(n) rebuild po tick-u, O(prosek) po upitu. 13 zmija × 240 seg = ~1500 upita/frame bez heša → sa hešem ~30–60 provera.
- Produkcija: ista struktura, quadtree **nije potreban** (uniformna distribucija — heš je brži i jednostavniji).

### D.2 Render — gde su milisekunde
| Tehnika | Implementacija |
|---|---|
| Glow bez `shadowBlur` | pre-renderovani radial-gradient sprite-ovi (keš po hue) + `globalCompositeOperation='lighter'` |
| Telo u 6 fill poziva | ribbon poligon (Path2D) umesto stotina kružića; nema per-segment draw call |
| Viewport culling | AABB po zmiji (računa se besplatno pri osvežavanju segmenata); hrana/čestice bounds check |
| LOD | zoom < 0.7 → preskoči spoljašnji glow prolaz; imena samo u vidnom polju |
| Parallax | pattern tiles (512px) — 3 draw call-a umens hiljada zvezda |
| Mreža | displacement keširan jednom po frejmu; vrhovi ≤ 1000; uzorci pre-filtrirani po vidnom polju |
| DPR cap 2 | `min(devicePixelRatio, 2)` |
| Post-FX u CSS | vinjeta + scanlines = 0ms canvas vremena (GPU kompozit) |

**Budžet (60 FPS = 16.6ms):** sim ≤ 3ms · render ≤ 9ms · DOM/JS gcd ≤ 2ms · rezerva 2.6ms.
Prototip meri ~2–4ms sim + ~6–8ms render na mid-range laptopu (13 zmija, ~800 hrane) — u budžetu.

### D.3 PixiJS verzija (produkcija)
- Zmija → `MeshRope` sa dinamičkim width atributom (jedan draw call po prolazu) + additive glow sloj.
- Reaktivna mreža → `Mesh` + vertex shader displacement (GPU, besplatno).
- Čestice → `ParticleContainer` (batched, 10k+ čestica).
- Filtri (bloom) → samo na "High" quality presetu; default je rucno art-directed glow (konzistentan izgled na svim mašinama).

### D.4 Test strategija (već implementirano u prototipu)
- `test/sim.test.mjs` — deterministička simulacija (seed RNG): 90s sa 12 botova, NaN guard, smrt/respawn, sudari. **22 asercije.**
- `test/dom-smoke.test.mjs` — pun game-loop sa DOM stub-ovima: 800+ frejmova kroz meni/igru/smrt/respawn (hvata runtime greške u render kodu pre pregledača).
- CI: ova dva testa + `node --check` na svim fajlovima + (produkcija) Playwright smoke.

---

## E. Roadmap prototip → produkcija

| Faza | Opis | Status |
|---|---|---|
| **P0 — Core sim** | kretanje, putanja, sudari, hrana, botovi | ✅ urađeno |
| **P1 — Game feel** | abilities, FX, audio, HUD, meni, smrt | ✅ urađeno |
| **P2 — Mreža** | Colyseus room, prediction, interpolacija | struktura spremna (Controller/hooks/sim split) |
| **P3 — PixiJS render** | MeshRope + shaderi + bloom preset | spec u §D.3 |
| **P4 — Meta** | nalozi, kozmetika, leaderboard, sezone | — |
