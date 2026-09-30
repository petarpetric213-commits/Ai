# 🐍 NEOSERPENT — Next-Gen Slither Arena

Kompletna specifikacija, arhitektura i **igriv prototip** moderne 2D/2.5D multiplayer igre u
stilu Slither.io — cyberpunk/neon vizual, spring-smooth animacije, sposobnosti i dinamična hrana.

```
neoserpent/
├── docs/
│   ├── 01-SPECIFIKACIJA.md        # game design spec (mehanike, balans, FX, UI/UX)
│   ├── 02-ARHITEKTURA.md          # struktura projekta, umrežavanje, optimizacije
│   └── 03-MATEMATIKA-I-ALGORITMI.md  # KOMPLETNA matematika kretanja zmije ★
├── prototype/                     # igriv prototip (Canvas 2D, zero-dependency)
│   ├── index.html
│   ├── style.css
│   └── src/…                      # vidi docs/02 §A
└── test/
    ├── sim.test.mjs               # headless sim testovi (22 asercije)
    └── dom-smoke.test.mjs         # pun game-loop smoke test sa DOM stub-ovima
```

## ▶️ Pokretanje prototipa

Bilo koji statički server (ES moduli zahtevaju http, ne file://):

```bash
cd neoserpent/prototype
python3 -m http.server 8080        # → http://localhost:8080
# ili: npx serve .
```

## 🎮 Kontrole

| Taster | Akcija |
|---|---|
| **Miš** | upravljanje zmijom |
| **LMB / SPACE** | boost (troši masu) |
| **SHIFT** | Dash skok (cooldown 5s) |
| **E** | Magnet štit (privlači hranu, 4s) |
| **Q** | EMP Blast (usporava protivnike u radijusu) |
| **M** | zvuk on/off |

Mobile: prst za upravljanje + on-screen dugmad (prikazuju se automatski na touch uređajima).

## ✨ Šta je implementirano (P0 + P1)

- **Path-following kretanje** sa Catmull-Rom splajn uzorkovanjem — telo nikad ne puca, savija se organski (docs/03)
- **Squash & stretch** glave, putovali "bulge" pulsevi niz telo pri boost-u, disanje tela
- **Neon ribbon render** (6 prolaza, fake 3D osvetljenje cevi, senke) — bez `shadowBlur`, 60 FPS
- **Smrt = kristalni shard-ovi + shockwave + screen shake (trauma model) + slow-mo**
- **Parallax ×3 + nebula + reaktivna mreža** koja talasa oko velikih zmija + lebdeća prašina
- **3 sposobnosti** (Dash / Magnet / EMP) sa cooldown UI-jem — koriste ih i botovi
- **Dinamična hrana:** lebdeći pellet-i, Mega-Orbovi koji beže, power-up kapsule (brzina/magnet/×2)
- **11 AI botova** (FEED/HUNT/FLEE mašina stanja, presretanje, bekstvo, upotreba sposobnosti)
- **HUD:** rang-lista, minimapa, kill feed, ability bar, buff indikatori · **proceduralni audio** (bez asset-a)
- Meni sa živim background-om, death screen sa statistikom, spectate kamera, respavn

## 🧪 Testovi

```bash
node neoserpent/test/sim.test.mjs       # matematika + 90s deterministička sim + sudari
node neoserpent/test/dom-smoke.test.mjs # 800+ frejmova punog game loopa (render uključen)
```

## 🗺️ Sledeći koraci (P2+)

Produkcione smernice su u `docs/02-ARHITEKTURA.md`: Colyseus autoritativni server,
client-side prediction (sim kod je već izdvojen DOM-free upravo zbog toga), entity
interpolation, PixiJS MeshRope render. Vidi i roadmap na kraju specifikacije.
