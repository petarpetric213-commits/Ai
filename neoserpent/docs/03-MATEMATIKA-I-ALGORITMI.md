# NEOSERPENT — Matematika i algoritmi kretanja zmije

> Kompletna derivacija "glatkog zmijanja": zašto path-following pobeđuje lance
> opruga, kako se uzorkuju segmenti, squash & stretch, sudari, smrt-FX i kamera.
> Sve formule su implementirane u `prototype/src/` (reference na fajlove uz svaki odeljak).

**Sadržaj:**
1. [Model kretanja glave (steering)](#1)
2. [Putanja: ring-buffer na fiksnom razmaku](#2)
3. [Uzorkovanje segmenata: Catmull-Rom splajn](#3)
4. [Alternativa: Verlet/PBD lanac (zašto nije primarni)](#4)
5. [Profil širine: taper, pulsevi, squash & stretch](#5)
6. [Render: ribbon poligon + neon prolazi](#6)
7. [Sudari: spatial hashing + kapsule](#7)
8. [Efekti: kristali, shockwave, screen shake, slow-mo](#8)
9. [Kamera](#9)
10. [Složenost i budžet](#10)

---

<a name="1"></a>
## 1. Model kretanja glave (steering)

Zmija **nema** slobodnu brzinu u 2D — ima **pravac** (heading θ) i **intenzitet** (speed v). Ovo je ono što daje "slither" osećaj: zmija uvek klizi napred, igrač samo upravlja skretanjem.

**Željeni ugao** ka cilju (kursor/dodir):

```
θ_target = atan2(t_y − y, t_x − x)
```

**Ograničena ugaona brzina** (zmija ne može da se "okrene u mestu"):

```
Δ = wrapToPi(θ_target − θ)          // najkraća ugaona razlika, opseg (−π, π]
θ ← θ + clamp(Δ, −ω·dt, +ω·dt)
```

gde je `wrapToPi(d) = ((d + π) mod 2π) − π` (u praksi dvostruka if-korekcija — jeftinije od modula).

**ω zavisi od veličine** — velike zmije su tromije (prirodni balans: velika = jača ali ranjivija na manevar):

```
ω = ω₀ · (w₀ / w)^κ        ω₀ = 4.6 rad/s,  w₀ = 15px,  κ = 0.35
```

Množioci stanja: boost `×(1 − 0.25·b)` · dash `×0.32` · EMP debaf `×0.5`.

**Brzina** je zbir faktora sa **glatkim prelazima** (nema skokova — svaki skok bi se video kao "trzanje"):

```
v = v₀ · (1 + (k_boost − 1) · b) · s_speedBuff · s_emp · (1 + dash(t))
b   = eksponencijalni prilaz 0→1,  b ← b + (b_target − b)(1 − e^(−10·dt))     [smoothDamp]
dash(t) = (V_dash · (t/T_dash)²,  t ∈ [0, T_dash])     // kvadratni opadajući impuls
```

**Integracija pozicije** (semi-implicit Euler — dovoljno tačan na 60Hz za kinematiku):

```
x ← x + cos(θ)·v·dt
y ← y + sin(θ)·v·dt
```

*Implementacija: `Snake.update()` u `entities/Snake.js`.*

---

<a name="2"></a>
## 2. Putanja: ring-buffer na fiksnom razmaku (ključna ideja)

> **Problem:** n segmenata mora da prati glavu (a) bez razdvajanja, (b) bez preklapanja,
> (c) glatko, (d) deterministički (za mrežu), (e) bez akumulacije greške.

**Rešenje:** segmenti ne "prate" glavu direktno — oni uzorkuju **istoriju glave**.

### 2.1 Struktura

Iza glave ostaje **putanja** — niz tačaka `P₀…Pₙ` gde je `P₀` najnovija, i gde je **razmak između susednih tačaka konstantan** `Δ = 4px`. Putanja živi u prstenu (ring buffer):

```
xs, ys : Float32Array[cap]    (cap = 2600 → 10.4km istorije)
head   : index najnovije tačke
count  : broj validnih tačaka
P(i) = xs[(head − i + cap) mod cap]      // i-ta tačka iza glave
```

**Nulta alokacija, nula GC pritiska** — ključno za 60 FPS sa 13 zmija.

### 2.2 Dodavanje tačaka (tačan razmak!)

Pri svakom update-u, dok je rastojanje glava→P₀ veće od Δ, ubacujemo tačke **na tačno Δ razmaku duž pravca ka glavi**:

```
d = |head − P₀|
while d ≥ Δ:                      // dash pri 700px/s → ~3 tačke po frejmu; petlja je sigurna
    P₀' = P₀ + normalize(head − P₀) · Δ
    push(P₀')                     // postaje novo P₀
    d = |head − P₀'|
```

Zašto ovo nije "chord-cut" problem na oštrim zavojima: Δ = 4px je **3–4× manje** od prečnika segmenta (12–34px) — greška hordice je `Δ²/(8R)` ≤ 0.02px na zavoju prečnika 100px. Nevidljivo.

### 2.3 Lukovna dužina

Rastojanje od **tekuće pozicije glave** do P₀ nazivamo `d₀ ∈ [0, Δ)`:
```
d₀ = |head − P₀|
```
Tada tačka na **lukovnoj dužini s od glave** ima koordinate:
- `s ≤ d₀` → interpolacija glava→P₀,
- `s > d₀` → indeks u putanji `u = (s − d₀)/Δ` (jer je razmak tačaka fiksan, indeks = lukovna dužina / Δ — **nema potrebe za kumulativnim sumama**).

*Implementacija: `core/PathBuffer.js`. Kapacitet sam sebi "seče" rep: prsten prepisuje najstarije kad se napuni (max telo = 240 seg × 16px = 3.8km < 10.4km).*

### 2.4 Zašto ovo pobeđuje (dizajnerski argument)

| Kriterijum | Path-following | Verlet lanac (§4) |
|---|---|---|
| Razdvajanje segmenata | **nemoguće** (geometry) | moguće pri velikom v·dt |
| Akumulacija greške | **nema** | postoji (constraint iteracije) |
| "Elastičan" osećaj | nema (putanja je kruta) | ima (može biti i vrlina) |
| Determinizam / mreža | **savršen** — telo se rekonstruiše iz (x,y,θ,v) | težak (redosled constraint-a) |
| Cena po frejmu | O(n) uzorkovanje | O(n·iteracije) |
| Slither.io origanl | **koristi ovo** | — |

---

<a name="3"></a>
## 3. Uzorkovanje segmenata: Catmull-Rom splajn

Segment `i` (i = 0 je vrat, rastuće ka repu) se uzorkuje na:

```
sᵢ = (i + 1) · δ_seg        δ_seg = clamp(w · 0.52, 5.5, 16)  [px]
```

Broj segmenata iz mase: `n = min(240, 13 + ⌊mass/3⌋)` (raste/opada max 3 po frejmu → gladak rast).

### 3.1 Linearno vs. splajn

Linearna interpolacija između tačaka putanje na Δ=4px je vizuelno glatka, ali na **velikim zoom-out-ovima** (kamera 0.45×) prelomi postaju vidljivi. Zato uzorkujemo kroz **uniformni centrirani Catmull-Rom**:

Za `u = (s − d₀)/Δ`, neka su `i = ⌊u⌋`, `t = u − i` i tačke `p₋₁, p₀, p₁, p₂` (klempovane na krajeve):

```
CR(t) = ½ · [ 2p₀
            + (−p₋₁ + p₁) t
            + (2p₋₁ − 5p₀ + 4p₁ − p₂) t²
            + (−p₋₁ + 3p₀ − 3p₁ + p₂) t³ ]
```

**Svojstva koja koristimo:**
- prolazi **kroz** tačke (za razliku od B-splajna) — putanja je poštovana tačno,
- C¹ kontinuitet → tangente se ne lome → normale za ribbon su glatke,
- lokalna podrška (4 tačke) → O(1) po uzorku,
- uniformna parametrizacija po indeksu je **aproksimativno** lukovna (tačke su ekvidistantne) — greška < 1% na našim krivinama.

### 3.2 Granični slučajevi (bug-ovi koje sam našao i pokrio testovima)

1. **`d₀ = 0`** (glava tačno na najnovijoj tački): prva grana mora koristiti lerp sa `t=0` **samo za `s ≤ 0`**, a za `s > 0` odmah ići na splajn — u suprotnom ceo prvi segment "sedne" na glavu. *(Ovo je bio prvi bug koji je test `sample(10) → x=90` uhvatio.)*
2. **`s` van istorije** (telо tek raste): klemp na poslednju tačku — rep se "razmotava" prirodno kako glava dodaje putanju.
3. **Teleport/normiranje dash-a**: dash impuls 560px/s na 60Hz = 9.3px/frame < 3×Δ → petlja ubacivanja dodaje 2–3 tačke, nema rupa.

```js
// PathBuffer.sample(s, hx, hy, out) — pseudokod
if (count == 0)        return head
if (s <= d0)           return lerp(head, P0, s/d0)      // ispred P₀
u = (s − d0)/Δ; i = ⌊u⌋; t = u − i
if (i >= count−1)      return P(count−1)                 // iza kraja istorije
return CatmullRom(P(i−1 ∨ 0), P(i), P(i+1), P(i+2 ∧ count−1), t)
```

---

<a name="4"></a>
## 4. Alternativa: Verlet / PBD lanac (i kada ga koristiti)

Za kompletnost — "spring physics" pristup koji je tražen kao opcija, sa kompletnom matematikom:

### 4.1 Pozicijska Verlet integracija

Svaki segment `i` čuva trenutnu i prethodnu poziciju (brzost implicitna):

```
xᵢ(t+dt) = xᵢ + (xᵢ − xᵢ_prev)·d + aᵢ·dt²        d ≈ 0.985 (prigušenje)
```

### 4.2 Distance constraint (PBD)

Nakon integracije, `k` iteracija (tipično 3–5) restaura dužinu veze između suseda:

```
za svako i:  n = (xᵢ − xᵢ₋₁)/|xᵢ − xᵢ₋₁|
             C = |xᵢ − xᵢ₋₁| − L
             xᵢ     −= n · C · ½ · λ        (λ = stiffness ∈ [0.5, 1])
             xᵢ₋₁   += n · C · ½ · λ
```

Glava (segment 0) je **pinned** — pomeri je steering, constraint-i vuku ostatak. Rep je slobodan kraj.

### 4.3 Zašto NIJE primarni metod u ovoj igri

1. **Rastezanje pri boost-u:** pri `v·dt = 10px` i `L = 8px`, jedan frejm razvuče lanac pre nego što ga iteracije vrate → vidljivo "gumeno" telo. Rešenje je više iteracija → skuplje.
2. **Determinizam za mrežu:** redosled constraint-a utiče na rezultat; floating-point redosled mora biti identičan klijent/server → krhkа replikacija.
3. **Preklapanje na oštrim zavojima** (rep "seče" kratak luk) — treba dodatan self-collision solver.

### 4.4 Gde ga ipak koristimo (hibrid — preporuka za produkciju)

- **Mega-orb i power-up "trzanje"** — opruge za snack efekte.
- **Trail/scarf dekoracije** (kozmetika koja visi o zmiju).
- **Smrt FX** — shard-ovi koriste Verlet sa gravity-om kada pravimo "kristalni pljusak".

> **Zaključak:** kostur = path-following (tačnost, mreža, perf) · "juice" sloj = opruge (gde elastičnost *jeste* poenta). Prototip implementira prvi, Effects sistem je strukturno spreman za drugi.

---

<a name="5"></a>
## 5. Profil širine: taper, pulsevi, squash & stretch

Širina segmenta `wᵢ` je **kompozicija modula** (svaki je matematički nezavisan → lako se balansira):

```
wᵢ = W · taper(i) · pulse(sᵢ) · breathe(i, t) · narrow_boost
```

gde je `W = 13 + min(21, mass/55)` osnovna širina.

**(a) Konus repa** — kvadratni ease unazad kroz poslednjih 10 segmenata (quadratic = glatko spajanje sa telom):

```
taper(i) = 1 − 0.68 · (1 − fromEnd/10)²      za fromEnd < 10, inače 1
```

**(b) Putovali pulsevi (boost "bulge")** — pri boost-u svakih 0.45s nastane talas na `s=0` koji putuje niz telo brzinom 300px/s; doprinos svakom segmentu je **Gaussian** po lukovnoj razlici:

```
pulse(sᵢ) = Π 1 + 0.34 · exp(−((sᵢ − p.s)/26)²)      σ = 26px ≈ 2 segmenta
```

Gaussian (umesto kosinusa) nema derivaciju na ivicama → nivo "skokova". Talas se briše kad `p.s > totalLen`.

**(c) Disanje** — sub-perceptualni život tela:

```
breathe(i, t) = 1 + 0.03 · sin(2.2t + 0.4i + id)     // fazni pomak po dužini → "talas" disanja
```

**(d) Squash & stretch (očuvanje zapremine):**

Telo pri ubrzanju **suzava** (konzervativno 10% pri punom boost-u):
```
narrow_boost = 1 − 0.10 · b
```
Glava se izdužuje po pravcu kretanja, a bočno se sabija **inverzno korenom** (približno očuvanje površine elipse):

```
sx = clamp(1 + 0.22·(v/v₀ − 1), 0.85, 1.4)      // elongacija
sy = clamp(1/√sx, 0.8, 1.15)                    // spljoštenje
render: ellipse(rx = r·1.18·sx, ry = r·0.98·sy, rotiran za θ)
```

*Implementacija: `Snake.updateSegWidths()`, `Renderer._drawHead()`.*

---

<a name="6"></a>
## 6. Render: ribbon poligon + neon prolazi

### 6.1 Ribbon (traka promenljive širine)

Canvas ne ume stroke promenljive širine → gradimo **outline poligon**:

```
tangenta:  τᵢ = normalize(pᵢ₊₁ − pᵢ₋₁)          (centralna razlika, krajevi klemp)
normala:   νᵢ = (−τᵢ.y, τᵢ.x)
levo:  Lᵢ = pᵢ + νᵢ · wᵢ·scale
desno: Rᵢ = pᵢ − νᵢ · wᵢ·scale
Path2D = [L₀ … Lₙ, Rₙ … R₀] + closePath        → jedan fill poziv po prolazu!
```

### 6.2 Četiri prolaza = neon

| # | scale | boja | blend | uloga |
|---|---|---|---|---|
| 1 | ×2.7 | `hsla(h,100%,60%, .05+.05·pulse+.09·b)` | lighter | spoljašnji halo |
| 2 | ×1.62 | `hsla(h,100%,62%, (.15+.12b)·pulse)` | lighter | unutrašnji glow |
| 3 | ×1.0 | `hsl(h, 60%, 30%)` + stroke 1.4px | source-over | telo ("cev") |
| 4 | ×0.38 / ×0.15 | `hsla(h,100%,82..95%, …)` | lighter | svetla kičma |

**Puls brzine:** učestalost svetline tela raste sa brzinom — `f = 2.6 + 6·b Hz` — mozak čita "brže = intenzivnije" bez ijednog broja na ekranu.

### 6.3 Fake 3D cev (2.5D trik)

Prolaz #4 se ne centruje na `pᵢ` nego se **pomera ka fiksnom izvoru svetla** `L = normalize(−0.62, −0.78)` — svetla pruga klizi po "gornjoj levoj" strani cevi:

```
w_left  = w·scale + shift·w·(νᵢ·L)/2        shift ∈ {0.7, 0.75}
w_right = w·scale − shift·w·(νᵢ·L)/2        (clamp na ≥ 0.4 — sprecava self-intersection)
```

Rezultat: tela izgledaju voluminozno (cilindrično osvetljenje) bez ijednog shader-a. Uz to ide i **senka**: isti polyline pomeren (0.55w, 0.77w) naniže, stroke width 1.9w, alpha 0.28 — zmije "lebde" iznad mreže → dubina.

### 6.4 Glow bez `shadowBlur`

`shadowBlur` košta ~1ms po pozivu (rasterizacija blur-a po draw call-u). Umesto toga: **jedan offscreen 64px sprite** radial gradijenta po hue (keš 10° granulacije), crtan `drawImage`-om sa `lighter`. 900 hrane = 900 drawImage ≈ 0.8ms, umati 900×shadowBlur ≈ 900ms. *(Brojke za M1 laptop, Chrome.)*

---

<a name="7"></a>
## 7. Sudari: spatial hashing + kružno-kapsularni test

### 7.1 Heš

Uniformna mreža, ćelija `C = 96px` (~2× prečnika segmenta):

```
key(cx, cy) = (cx & 0xFFFF) << 16 | (cy & 0xFFFF)     // int32, bijekcija na ±32k ćelija
insert: item → ćelija po centru (jedna ćelija po item-u)
query(x, y, r): sve ćelije u rasponu ⌊(x±r)/C⌋ → item-e
```

Napredna optimizacija: stride-2 ubacivanje segmenata. Pošto se susedni segmenti preklapaju
(`δ_seg = 0.52w < w`), svaki drugi segment pokriva lanac bez rupa → 2× manje item-a.

### 7.2 Test sudara

Glava (krug `r_h`) protiv segmenta (krug `r_s`): **kvadratno rastojanje** (bez sqrt):

```
hit ⇔ (hx−sx)² + (hy−sy)² < (0.9·r_h + r_s)²
```

`0.9` je **forgiveness faktor** za žrtvu (serverski autoritet u produkciji). Glava–glava: `(r_h1 + r_h2)·0.82`.

Složenost po tick-u: rebuild O(n) + upiti O(broj zmija × kandidati) ≈ 13 × 5 provera umesto 13 × 2900 parova.

### 7.3 AI probe (isti heš, druga svrha)

Bot "gleda unapred" kroz 3 tačke na centralnici (60/130/210px) — upit po hešu; prvi pogodak = pretnja. Strana bekstva se bira vektorskim proizvodom:

```
cross = τx·(Δy/d) − τy·(Δx/d)     →  beži na suprotnu stranu od pretnje
```

---

<a name="8"></a>
## 8. Efekti smrti: matematika "signature momenta"

### 8.1 Kristalisani shard-ovi (Verlet sa damping-om)

Svaki drugi segment žrtve rađa 2 shard-a:

```
v₀ = radialni(60..380 px/s) · 0.7 + v_head · 0.4     // nasleđuje moment ubijene zmije
v(t+dt) = v · e^(−1.5·dt)                            // eksponencijalni drag (svemirski osećaj)
rot += ω·dt,  ω ∈ [−7, 7] rad/s
alpha = (life/ttl)^1.4,  size = size₀ · alpha + 1     // romb se topi ka svetlosti
```

### 8.2 Shockwave (easeOutCubic — brzo pa usporava, kao udarni talas):

```
r(t) = R_max · (1 − (1 − t/T)³)
alpha = (1 − t/T)²
lineWidth = 2 + 14(1 − t/T)
```

### 8.3 Screen shake — trauma model (Squirrel Eiserloh):

```
trauma += 0.75 · falloff(dist/kamera)        falloff = max(0, 1 − d/1400)
trauma opada: trauma ← max(0, trauma − 1.5·dt)
offset = trauma² · (30·sin(93.7t)·cos(47.3t), 26·sin(81.1t+1.7)·cos(53.9t))
```

`trauma²` znači: mali događaji jedva drhte, veliki LOME — i prelaz je gladak. Dve near-inkomensurabilne frekvencije daju organski (ne-periodični) osećaj — čisti sinus bi zvučao kao mašina.

### 8.4 Slow-motion:

```
timeScale ← 0.35 (na smrt blizu kamere)
timeScale ← timeScale + (1 − timeScale)·(1 − e^(−2.4·dt_real))    // oporavak bez skoka
```

Vreme **sveta** se skalira (dt), UI i kamera koriste realno vreme → slow-mo ne "lepi" kameru.

---

<a name="9"></a>
## 9. Kamera

```
target = head + v · 0.15                // look-ahead — kamera "gleda kuda ideš"
pos    ← pos + (target − pos)(1 − e^(−6.5·dt))          // kritički prigušeno praćenje
zoom   = clamp(1.10 − 0.34·log₁₀(mass/30), 0.45, 1.10)  // logaritamski — rane nagrade, kasna finoća
zoom   ← smoothDamp(zoom, target, 2.2)
```

Logaritamska kriva znači: sa 30→100 mase zoom skoči znatno (nagrađuje rani rast), sa 1000→2000 jedva (ne kažnjava kasnu igru sitnicom). `dt` u prigušenjima je **realno** vreme → kamera je stabilna i u slow-mo-u.

---

<a name="10"></a>
## 10. Složenost i budžet po frejmu (mereno na prototipu)

| Faza | Operacija | Kompleksnost | Mereno |
|---|---|---|---|
| sim | steering + integracija | O(zmije) | < 0.1ms |
| sim | pushPathPoints + sample segmenata | O(Σ segmenata) ≈ 1500 | ~0.6ms |
| sim | heš rebuild (stride 2) | O(Σ segmenata/2) | ~0.2ms |
| sim | sudari + jelo | O(zmije × kandidati) | ~0.3ms |
| sim | AI (12 botova, think 4–7Hz) | amortizovano | ~0.3ms |
| render | pozadina + mreža (keš displacement) | O(vrbovi × uzorci) | ~1.5ms |
| render | zmije (6 fill × 13) + glave | O(vidljivi seg.) | ~4ms |
| render | hrana (view-culled) + čestice | O(vidljivo) | ~1.5ms |
| **UKUPNO** | | | **~8–9ms / 60FPS ✓** |

**Zlatna pravila koja su ovde uspešno primenjena:**
1. Fiksan razmak putanje → indeks = lukovna dužina (nema pretrage, nema kumulativa).
2. Ring buffer + Float32Array → nula GC-a u hot path-u.
3. Glow = pre-rendered sprite + additive blending (nikad shadowBlur).
4. Jedan Path2D fill po prolazu umesto draw call po segmentu.
5. Sve prolaznosti (širine, sjaj, shake) su **nastavljive funkcije** — ništa ne "skače".
