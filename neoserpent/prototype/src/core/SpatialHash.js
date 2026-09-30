// =============================================================================
// SpatialHash.js — uniformna prostorna mreža (spatial hashing)
//
// O(1) ubacivanje, O(prosek) upiti. Ključ je pakovan u jedan int32:
//   key = (cx & 0xffff) << 16 | (cy & 0xffff)
// što je bijekcija za koordinate ćelija u opsegu ±32768 — bez string ključeva,
// bez GC pritiska (nizovi se recikliraju kroz pool).
//
// Korišćenje:
//   hash.insert(x, y, radius, item)   — item mora imati {x, y, r}
//   hash.query(x, y, radius, outArr)  — outArr se puni kandidatima
// (provera stvarne udaljenosti je na pozivaocu — mi vraćamo po ćelijama)
// =============================================================================

export class SpatialHash {
  constructor(cellSize = 96) {
    this.cs = cellSize;
    this.map = new Map();
    this.pool = [];
  }

  _key(cx, cy) {
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }

  clear() {
    for (const arr of this.map.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.map.clear();
  }

  insert(x, y, r, item) {
    const k = this._key(Math.floor(x / this.cs), Math.floor(y / this.cs));
    let arr = this.map.get(k);
    if (!arr) {
      arr = this.pool.pop() || [];
      this.map.set(k, arr);
    }
    item.r = r; // radius keširan na item-u (pozivaoc ga i tako koristi)
    arr.push(item);
  }

  /// Vraća sve iteme čiji centar pada u ćelije koje pokriva krug (x,y,r).
  /// NB: pozivaoc treba da prosledi r uvećan za max radius item-a.
  query(x, y, r, out) {
    out.length = 0;
    const cs = this.cs;
    const cx0 = Math.floor((x - r) / cs), cx1 = Math.floor((x + r) / cs);
    const cy0 = Math.floor((y - r) / cs), cy1 = Math.floor((y + r) / cs);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const arr = this.map.get(this._key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}
