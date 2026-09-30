# NEOSERPENT — Specifikacija igre (GDD)

> **Žanr:** Arena multiplayer (.io) — 2D/2.5D, top-down
> **Referenca:** Slither.io, ali "next-gen": neon-cyberpunk vizual, sposobnosti, dinamična hrana
> **Platforme:** Web (desktop + mobile), WebGL izvoz
> **Verzija dokumenta:** 1.0 · Status: implementiran prototip (offline, sa botovima)

---

## 1. Vizija i dizajnerski stubovi

**Fantazija igrača:** *"Upravljam svetlećom energetskom zmijom koja klizi kroz cyber-arena brzinom misli — svaki manevar je glatke, svaki kill je vatromet."*

| Stub | Opis | Kako se meri |
|---|---|---|
| **Fluidnost iznad svega** | 60 FPS, input→piksel bez osetljivog laga, nikakvo razdvajanje segmenata | frame time P95 < 12ms (60 FPS), input latency < 50ms |
| **"Juice"** | Svaka akcija ima povratnu informaciju: svetlo, zvuk, shake, slow-mo | nijedan događaj bez FX-a |
| **Lako naučiti, duboko za majstora** | Jedan miš za kretanje; 3 sposobnosti prave prostor za outplay | session dužina, kill/dužina raste sa iskustvom |
| **Čitljivost u haosu** | Vizuelna hijerarhija: igrač > pretnja > hrana > dekor | 0 "umro sam a nisam video od čega" trenutaka |

---

## 2. Core petlja (loop)

```
spawn → skupljanje mase (pellets/mega/power-ups)
      → rast dužine i širine → veći profil rizika
      → lov: seči manje zmije telom → one ispuštaju masu → pokupi je
      → smrt: telo se raspada u svetlosne kristale + drop-orbove
      → respawn sa zadržanim "score" i meta-napretkom
```

**Pravila preživljavanja (ista kao Slither, plus):**
- Tvoja glava u tuđe telo → umireš.
- Tuđa glava u tvoje telo → ubio si ga (telom).
- Glava–glava → oboje ginu.
- Energetski zid arene → smrt.
- Veća masa = veće telo (lakše se sečeš, teže manevrišeš): `width = 13 + min(21, mass/55)`.

---

## 3. Kontrole

| Akcija | Desktop | Mobile |
|---|---|---|
| Kretanje | miš (zmija prati kursor) | prst (zmija prati dodir) |
| **Boost** | LMB drži / SPACE | BOOST dugme |
| **Dash Shift** | SHIFT | DASH dugme |
| **Magnet štit** | E | MAG dugme |
| **EMP Blast** | Q | EMP dugme |
| Zvuk on/off | M | — |

---

## 4. Sposobnosti (Abilities) — balans tabela

Dizajnersko pravilo: **svaka sposobnost je i odbrana i oružje**, sa jasnim counter-play-om (protivnik vidi telegrafiran efekat).

| Sposobnost | Efekat | Cena | Cooldown | Counter-play |
|---|---|---|---|---|
| **Boost** | ×1.9 brzina; pulsevi idu niz telo; ispušta pellet-e za sobom | 5 mase/s (min 15) | — (kontinuiran) | namami protivnika da boost-uje u tvoje telo |
| **Dash Shift** | impuls +560 px/s (0.26s), turn rate ×0.32 (rizik!), afterimage trag | 2 mase | 5s | dash je pravolinijski — seči ugao |
| **Magnet Shield** | privlači hranu u radijusu 300px kroz 4s; heksa-štit vizuel | — | 13s | protivniku magnet pokazuje gde si |
| **EMP Blast** | talas 340px: protivnici ×0.42 brzina, ×0.5 skretanje, 2.4s | — | 15s | čuj/zeleni bljesak pre talasa — izađi iz kruga |

**Spawn zaštita:** 2.6s nepovredivost (blink vizuel); prekida se boost-om ili napadom.

---

## 5. Hrana i ekonomija mase

| Tip | Vrednost | Ponašanje | Vizuel |
|---|---|---|---|
| **Pellet** | +1 masa, +10 poena | lebdi, luta amplitudom ~14px/s | mali glow, hue po regionu |
| **Drop orb** (posle smrti/boost-a) | +1..+6 | statična, nestaje posle 28s | hue boje žrtve |
| **Mega-Orb** | **+8 mase** (×3–8) | **beži** od zmija u 190px radijusu (130px/s max) | belo-plava, rotirajući iskričasti krst |
| **Power kapsula** | +50 poena + efekat | statična, 22s lifetime, blink pred nestanak | heksa kapsula + glif |

**Power-up tipovi:** `BRZINA` (+35% 6s, amber) · `MAGNET` (auto-magnet 8s, violet) · `×2 POENI` (10s, lime).

**Ekonomija:** 55% mase žrtve se vraća u svet kao drop-orbovi → kill se **isplati** ali treba pokupiti (rizik na lokaciji smrti). Boost je investicija: trošiš masu da zauzmeš poziciju.

---

## 6. AI botovi (prototip / server-side filler)

Mašina stanja: `FEED → HUNT → FLEE → (granica)`. Ličnost po botu: `aggression` (0.15–0.95), `skill` (0.35–1.0).

- **FEED:** bira hranu po `score = value² / (140 + dist)`; koristi magnet kad je ≥5 hrane u 320px.
- **HUNT:** presretanje `target = prey.pos + prey.vel × (0.45..0.8)` — seče putanju ispred manje zmije.
- **FLEE:** probe 3 tačke ispred glave (60/130/210px) kroz segmentni heš; bekstvo normalom od pretnje, biranjem strane po vektorkom proizvodu; dash ako je pretnja < 95px.
- **EMP:** koristi kada je glava protivnika < 260px i protivnik boost-uje ili je veći.
- Respavn 3.2s sa novim imenom/bojom.

---

## 7. Vizuelni stil i FX (specifikacija)

**Umetnički pravac:** tamni svemir (#04050d) + neon paleta (cyan 190°, magenta 320°, lime 96°, amber 38°, violet 262°). Svetlost = moć. 

### 7.1 Zmija
- **Telo:** tamna "cev" (satenski ton, L≈30%) + neon kontura + **svetla kičma pomerena ka izvoru svetla** (fake 3D cylinder shading) + aditivni glow u 2 prolaza.
- **Squash & stretch:** glava se izdužuje sa brzinom (`sx = 1 + 0.22·(v/v₀−1)`, `sy = 1/√sx`); telo se sužava 10% pri boost-u.
- **Pulsevi:** pri boost-u "bulge" talas (gauss σ=26px, amplituda +34%) putuje niz telo — telo izgleda živo.
- **Breathing:** širina diše ±3% sinusoidno, fazno pojasno duž tela.
- **EMP debaf:** telo treperi (±2.2px jitter) i plavi.

### 7.2 Smrt (signature moment)
1. Telo se raspada u **kristalisane svetlosne čestice** — rotirajući rombovi sa glow-om (nasleđuju 40% brzine glave).
2. **Shockwave** prsten (easeOutCubic, r = 150 + width×6).
3. **Screen shake** (trauma model, jačina po blizini kamere) + **slow-mo 0.35×** 0.5s.
4. Drop-orbovi ostaju na mestu.

### 7.3 Okruženje
- **Parallax ×3** sloja zvezda (faktori 0.12/0.3/0.55) + 2 nebula oblaka + 90 lebdećih čestica prašine.
- **Reaktivna mreža:** vrhovi se pomeraju odbijanjem od segmenata velikih zmija (masa > 70), falloff `f²×26px` u 150px radijusu — mreža "talasa" dok zmije prolaze.
- **Granica:** dvostruki glow prsten + rotirajući dashed prsten; spoljašnjost zatamnjena.
- **Post-FX (CSS, besplatni):** vinjeta + scanline overlay.

---

## 8. UI/UX ekrani

| Ekran | Sadržaj |
|---|---|
| **Meni** (živi background — botovi igraju iza blur-a) | logo, input imena, PLAY, grid kontrola, savet |
| **HUD** | MASA/POENI/UBISTVA + boost bar · rang-lista top 7 · ability bar (3 ikone + radial cooldown + ready-flash) · aktivni buffovi · kill feed (⚡) · minimapa (zmije, mega, power, viewport) · FPS |
| **Smrt** | uzrok ("eliminisao te je X" / zid), statistika runs (maks masa, poeni, ubistva, vreme), RESPAWN [SPACE] — kamera spectator prati ubicu |

**Smernice:** monospace brojevi (treenutno čitanje), paneli `rgba(6,9,20,0.62)` + 1px neon border, nikad preko 20% ekrana, igrač uvek istaknute boje.

---

## 9. Audio (proceduralni, bez asset-a)

Blip po vrsti hrane (pentatonika random) · boost = looped bandpass šum · dash = noise sweep 1800→260Hz · EMP = sub-drop 120→38Hz + zap · smrt = noise burst + sawtooth drop · kill = dvotonski reward. Sve sintetizovano Web Audio-om (0 asset-a, ~6KB koda).

---

## 10. Skor i meta (faza 2)

- **Score** = kumulativni poeni (hrana + kill bonus `mass×4`). ×2 power-up duplira.
- Meta: kozmetika (pattern tela, trail, boje), sezone, leaderboard. **Nikakav pay-to-win** — samo kozmetika.

---

## 11. Balans brojki (iz koda, `BAL`)

```
baseSpeed 168 px/s · boost ×1.9 · boostDrain 5/s · minBoostMass 15
width = 13 + min(21, mass/55) · segSpacing = clamp(width×0.52, 5.5, 16)
targetSegCount = min(240, 13 + mass/3)
turn ω = 4.6 · (15/width)^0.35 rad/s (boost ×0.75, dash ×0.32, EMP ×0.5)
arena R = 3800 · botova 11 · hrane ~620 pellets + 18 mega + 5 power
kamera zoom = clamp(1.10 − 0.34·log10(mass/30), 0.45, 1.10)
```
