// Игрок: атрибуты, анатомическая модель, анимация (эггбитер, кроль с поднятой головой, стили бросков, борьба), движение в воде.
(function () {
  const DOWN = new THREE.Vector3(0, -1, 0);
  const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
  const TAU = Math.PI * 2;
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 16);

  // Общие детали
  let S = null;
  function shared() {
    if (S) return S;
    S = {
      head: new THREE.SphereGeometry(0.1, 22, 16),
      jaw: new THREE.SphereGeometry(0.06, 14, 10),
      nose: new THREE.ConeGeometry(0.014, 0.036, 8),
      cap: new THREE.SphereGeometry(0.106, 24, 12, 0, TAU, 0, Math.PI * 0.56),
      ear: new THREE.SphereGeometry(0.046, 18, 8, 0, TAU, 0, Math.PI * 0.5),
      strap: new THREE.TorusGeometry(0.078, 0.005, 6, 20, Math.PI),
      neck: new THREE.CylinderGeometry(0.066, 0.082, 0.14, 16),
      beard: new THREE.SphereGeometry(0.104, 20, 10, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.6, Math.PI * 0.33),
      ball: new THREE.SphereGeometry(1, 14, 10),
      joint: new THREE.SphereGeometry(1, 12, 8),
      ring: new THREE.RingGeometry(0.42, 0.52, 40),
    };
    S.ring.rotateX(-Math.PI / 2);
    S.nose.rotateZ(-Math.PI / 2);
    S.ear.rotateX(-Math.PI / 2);
    return S;
  }

  // Скульптурная поверхность: кольца по высоте ys, в каждом N точек по кругу; shape(y, a) → [x, z]
  // (a = 0 — вперёд, +x; a = π/2 — бок, +z). Шов сваривается, чтобы нормали были гладкими.
  function sculpt(ys, N, shape) {
    const pos = [], uv = [], idx = [], cols = N + 1, R = ys.length;
    for (let i = 0; i < R; i++) for (let j = 0; j <= N; j++) {
      const a = (j % N) / N * TAU, q = shape(ys[i], a);
      pos.push(q[0], ys[i], q[1]); uv.push(j / N, i / (R - 1));
    }
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    // Торцы: центр снизу и сверху
    const bot = pos.length / 3; pos.push(0, ys[0], 0); uv.push(0.5, 0);
    const top = pos.length / 3; pos.push(0, ys[R - 1], 0); uv.push(0.5, 1);
    for (let j = 0; j < N; j++) { idx.push(bot, j + 1, j); const t0 = (R - 1) * cols; idx.push(top, t0 + j, t0 + j + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Нормали должны смотреть наружу (в среднем от оси); иначе разворачиваем треугольники
    const nA = g.getAttribute('normal'), pA = g.getAttribute('position');
    let out = 0;
    for (let i = 0; i < pA.count; i++) out += nA.getX(i) * pA.getX(i) + nA.getZ(i) * pA.getZ(i);
    if (out < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    const n = g.getAttribute('normal');
    for (let i = 0; i < R; i++) {
      const a = i * cols, b = a + N;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), L = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / L, y / L, z / L); n.setXYZ(b, x / L, y / L, z / L);
    }
    return g;
  }
  // Кусочно-линейный профиль по точкам [y, v] (y по убыванию или возрастанию)
  function prof(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0]);
    return (y) => {
      if (y <= P[0][0]) return P[0][1];
      for (let i = 1; i < P.length; i++) if (y <= P[i][0]) { const k = (y - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); const e = k * k * (3 - 2 * k); return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * e; }
      return P[P.length - 1][1];
    };
  }
  const win = (y, a, b, e) => { e = e || 0.03; const l = Math.min(1, Math.max(0, (y - a) / e)), r = Math.min(1, Math.max(0, (b - y) / e)); return Math.min(l, r); };
  const range = (a, b, n) => { const r = []; for (let i = 0; i < n; i++) r.push(a + (b - a) * i / (n - 1)); return r; };

  // Торс ватерполиста: широкие плечи и широчайшие, грудные с ложбинкой, пресс, позвоночник и лопатки, узкая талия
  function torsoShape(bw) {
    const W = prof([[0.12, 0.056], [0.09, 0.09], [0.065, 0.148], [0.035, 0.198], [0.0, 0.226], [-0.04, 0.228], [-0.1, 0.212], [-0.17, 0.196], [-0.25, 0.172], [-0.34, 0.15], [-0.43, 0.137], [-0.5, 0.142], [-0.56, 0.152], [-0.62, 0.146], [-0.655, 0.115], [-0.68, 0.05]]);
    const F = prof([[0.12, 0.048], [0.09, 0.066], [0.05, 0.092], [0.0, 0.11], [-0.06, 0.128], [-0.11, 0.134], [-0.16, 0.122], [-0.22, 0.11], [-0.3, 0.106], [-0.4, 0.104], [-0.48, 0.102], [-0.56, 0.106], [-0.62, 0.098], [-0.655, 0.075], [-0.68, 0.03]]);
    const B = prof([[0.12, 0.046], [0.09, 0.068], [0.05, 0.096], [0.0, 0.11], [-0.07, 0.116], [-0.15, 0.11], [-0.25, 0.098], [-0.36, 0.088], [-0.45, 0.086], [-0.52, 0.098], [-0.58, 0.116], [-0.63, 0.108], [-0.655, 0.08], [-0.68, 0.03]]);
    return (y, a) => {
      const c = Math.cos(a), sn = Math.sin(a), n = 2.5;
      const w = W(y) * bw, d = c >= 0 ? F(y) : B(y);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * d, z = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * w;
      const lz = z / bw;
      let bump = 0;
      if (c > 0) {
        for (const zs of [-1, 1]) { const dz = (lz - zs * 0.09) / 0.072, dy = y + 0.085, sy = dy < 0 ? 0.03 : 0.065; bump += 0.025 * Math.exp(-dz * dz - (dy / sy) * (dy / sy)) * c; } // грудные
        bump -= 0.007 * Math.exp(-(lz / 0.013) * (lz / 0.013)) * win(y, -0.22, -0.02) * c;                   // грудина
        for (const yy of [-0.25, -0.315, -0.38]) for (const zs of [-1, 1]) { const dz = (lz - zs * 0.036) / 0.022, dy = (y - yy) / 0.023; bump += 0.0055 * Math.exp(-dz * dz - dy * dy) * c; } // пресс
        bump -= 0.004 * Math.exp(-(lz / 0.008) * (lz / 0.008)) * win(y, -0.43, -0.22) * c;                   // белая линия
      } else {
        bump -= 0.007 * Math.exp(-(lz / 0.014) * (lz / 0.014)) * win(y, -0.5, 0.02) * -c;                    // позвоночник
        for (const zs of [-1, 1]) { const dz = (lz - zs * 0.085) / 0.05, dy = (y + 0.07) / 0.06; bump += 0.009 * Math.exp(-dz * dz - dy * dy) * -c; } // лопатки
      }
      bump += 0.013 * Math.exp(-((y + 0.2) / 0.09) * ((y + 0.2) / 0.09)) * Math.max(0, Math.abs(sn) - 0.2) * (c < 0.3 ? 1 : 0.4); // широчайшие
      const L = Math.hypot(x, z) || 1;
      return [x + x / L * bump, z + z / L * bump];
    };
  }
  // Рука: дельта шапкой сверху, бицепс спереди, трицепс сзади; предплечье толще у локтя
  function upperShape(g) {
    const R = prof([[0.07, 0.014], [0.055, 0.056], [0.028, 0.078], [-0.015, 0.079], [-0.06, 0.068], [-0.11, 0.061], [-0.17, 0.058], [-0.23, 0.053], [-0.28, 0.047], [-0.315, 0.042]]);
    return (y, a) => {
      const c = Math.cos(a), sn = Math.sin(a);
      let r = R(y) * g;
      r += 0.018 * g * Math.exp(-((y + 0.165) / 0.06) * ((y + 0.165) / 0.06)) * Math.pow(Math.max(0, c), 1.5);   // бицепс
      r += 0.015 * g * Math.exp(-((y + 0.12) / 0.075) * ((y + 0.12) / 0.075)) * Math.pow(Math.max(0, -c), 1.2); // трицепс
      r += 0.012 * g * win(y, -0.09, 0.04, 0.04) * Math.abs(sn);                                                // дельта сбоку
      return [c * r, sn * r * 0.94];
    };
  }
  function foreShape(g) {
    const R = prof([[0.025, 0.024], [0.01, 0.044], [-0.03, 0.054], [-0.08, 0.051], [-0.14, 0.042], [-0.2, 0.034], [-0.25, 0.029], [-0.275, 0.027]]);
    return (y, a) => {
      const c = Math.cos(a), sn = Math.sin(a);
      let r = R(y) * g;
      r += 0.007 * g * Math.exp(-((y + 0.06) / 0.05) * ((y + 0.06) / 0.05)) * Math.max(0, c * 0.6 + sn * 0.8); // плечелучевая
      return [c * r * 0.92, sn * r];
    };
  }

  // Голова: череп, надбровные дуги, глазницы, нос, скулы, челюсть и подбородок (верх закрыт шапочкой)
  const sq = (v) => v * v;
  function headShape(off, beard) {
    const H = 0.118, B = 0.128;
    return (y, a) => {
      const c = Math.cos(a), sn = Math.sin(a);
      const t = y >= 0 ? y / H : y / B, k = Math.sqrt(Math.max(0, 1 - t * t));
      // Челюсть сужается к подбородку, лицо чуть длиннее затылка
      let dx = (c >= 0 ? 0.104 : 0.1) * k, dz = 0.092 * k;
      if (y < -0.02) { const j = Math.min(1, (-0.02 - y) / 0.1); dz *= 1 - 0.28 * j; dx *= c >= 0 ? 1 + 0.06 * j : 1 - 0.25 * j; }
      let x = c * dx, z = sn * dz;
      const lz = z, f = Math.max(0, c);
      let b = 0;
      if (f > 0) {
        b += 0.009 * Math.exp(-sq((y - 0.036) / 0.012)) * Math.exp(-sq(lz / 0.06)) * f;              // надбровье
        for (const zs of [-1, 1]) {
          b -= 0.009 * Math.exp(-sq((y - 0.014) / 0.014) - sq((lz - zs * 0.034) / 0.017)) * f;        // глазницы
          b += 0.007 * Math.exp(-sq((y + 0.006) / 0.016) - sq((lz - zs * 0.058) / 0.02)) * f;          // скулы
        }
        b += 0.024 * Math.exp(-sq((y + 0.022) / 0.024) - sq(lz / 0.011)) * f * Math.min(1, Math.max(0, (0.03 - y) / 0.02)); // нос
        b -= 0.003 * Math.exp(-sq((y + 0.064) / 0.008) - sq(lz / 0.026)) * f;                        // рот
        b += 0.007 * Math.exp(-sq((y + 0.1) / 0.016) - sq(lz / 0.03)) * f;                            // подбородок
      }
      b += off;
      // Борода: только низ лица и челюсть; остальное прячется внутрь головы
      if (beard) { const on = f > 0.05 || Math.abs(sn) > 0.75 ? Math.min(1, Math.max(0, (-0.03 - y) / 0.02)) : 0; if (on <= 0) b = -0.02; else b += 0.0035 * on; if (c > 0.6 && y > -0.075 && y < -0.055 && Math.abs(lz) < 0.022) b = -0.02; }
      const L = Math.hypot(x, z) || 1;
      return [x + x / L * b, z + z / L * b];
    };
  }
  let HEADS = null;
  function headGeo() {
    if (HEADS) return HEADS;
    // Шапочка: по форме головы чуть шире; спереди кончается над бровями, по бокам закрывает уши, сзади — до затылка
    const hs = headShape(0.006, false);
    const cap = sculpt(range(-0.085, 0.124, 50), 34, (y, a) => {
      a += Math.PI; // u = 0.5 — лоб (там надпись команды), u = 0 и 1 — затылок (номер)
      const c = Math.cos(a), edge = c > 0 ? 0.047 - 0.1 * (1 - c) * (1 - c) : -0.055 - 0.03 * -c;
      const q = hs(Math.min(y, 0.117), a);
      if (y < Math.max(-0.08, edge)) { const L = Math.hypot(q[0], q[1]) || 1; return [q[0] - q[0] / L * 0.03, q[1] - q[1] / L * 0.03]; }
      if (y > 0.117) { const k = Math.max(0, 1 - (y - 0.117) / 0.007); return [q[0] * k, q[1] * k]; }
      return q;
    });
    // Надпись и номер — на полосе лба/затылка
    const uv = cap.getAttribute('uv'), ps = cap.getAttribute('position');
    for (let i = 0; i < uv.count; i++) { uv.setY(i, Math.min(1, Math.max(0, (ps.getY(i) + 0.02) / 0.14))); uv.setX(i, 1 - uv.getX(i)); }
    HEADS = { head: sculpt(range(-0.128, 0.118, 26), 28, headShape(0, false)), beard: sculpt(range(-0.13, -0.02, 10), 28, headShape(0.002, true)), cap };
    return HEADS;
  }

  // Тело зависит от телосложения (ширина плеч, обхват): торс и руки лепятся один раз на каждый вариант
  const GC = {};
  function bodyGeo(bw) {
    const key = bw.toFixed(2);
    if (GC[key]) return GC[key];
    const torso = sculpt(range(-0.68, 0.12, 36), 32, torsoShape(bw));
    // Плавки: та же поверхность чуть шире, от паха до пояса; полосы по бокам — в текстуре (u = 0.25 и 0.75 — бока)
    const tsh = torsoShape(bw);
    const suit = sculpt(range(-0.685, -0.47, 9), 32, (y, a) => { const q = tsh(y, a), L = Math.hypot(q[0], q[1]) || 1; return [q[0] + q[0] / L * 0.004, q[1] + q[1] / L * 0.004]; });
    const g = bw;
    const upper = sculpt(range(-0.315, 0.065, 16), 14, upperShape(g));
    const fore = sculpt(range(-0.275, 0.025, 12), 12, foreShape(g));
    const thigh = lathe([[0.056 * g, -0.46], [0.066 * g, -0.41], [0.087 * g, -0.28], [0.097 * g, -0.16], [0.095 * g, -0.06], [0.086 * g, 0.01]], 14);
    const shin = lathe([[0.032 * g, -0.44], [0.037 * g, -0.39], [0.05 * g, -0.27], [0.064 * g, -0.16], [0.058 * g, -0.06], [0.05 * g, 0.01]], 14);
    GC[key] = { torso, suit, upper, fore, thigh, shin };
    return GC[key];
  }

  // Тело из Blender (js/body-model.js): общие массивы, карты нормалей и затенения; геометрия — под телосложение
  let BODY = null;
  function bodyData() {
    if (BODY) return BODY;
    const D = WP.BODY;
    const dec = (b64, T) => { const b = atob(b64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
    const tex = (url) => { const t = new THREE.TextureLoader().load(url); t.anisotropy = 4; return t; };
    BODY = { pos: dec(D.pos, Float32Array), nrm: dec(D.nrm, Int8Array), uv: dec(D.uv, Float32Array), idx: dec(D.idx, Uint16Array), ji: dec(D.ji, Uint8Array), jw: dec(D.jw, Uint8Array), normalMap: tex(D.normalMap), aoMap: tex(D.aoMap) };
    return BODY;
  }
  // Телосложение bw: торс шире, плечи и бёдра расходятся, руки и ноги толще вокруг своей оси (смешивание по весам костей)
  const BGC = {};
  function bodySkinGeo(bw) {
    const key = bw.toFixed(2);
    if (BGC[key]) return BGC[key];
    const B = bodyData(), D = WP.BODY, n = D.count, P = B.pos, out = new Float32Array(P.length);
    const k = bw - 1, ca = Math.cos(D.bind.arm), sa = Math.sin(D.bind.arm), cl = Math.cos(D.bind.leg), sl = Math.sin(D.bind.leg);
    // Для каждой кости: [вид, сторона]; вид 0 — торс, 1 — шея/голова, 2 — рука/нога (ось), 3 — кисть/стопа (сдвиг)
    const kinds = D.bones.map(name => {
      const s = name.endsWith('L') ? -1 : 1;
      if (name === 'body') return [0, 0];
      if (name === 'neck' || name === 'head') return [1, 0];
      if (/^(sh|el)/.test(name)) return [2, s, 0, -0.02, s * 0.22, 0, -ca, s * sa, s * 0.22 * k];
      if (/^(hip|kn)/.test(name)) return [2, s, 0, -0.6, s * 0.09, 0, -cl, s * sl, s * 0.09 * k];
      return [3, s, 0, 0, 0, 0, 0, 0, s * (name.startsWith('hand') ? 0.22 : 0.09) * k];
    });
    const T = [0, 0, 0];
    const tf = (K, x, y, z) => {
      switch (K[0]) {
        case 0: T[0] = x * (1 + 0.5 * k); T[1] = y; T[2] = z * bw; return;
        case 1: T[0] = x * (1 + 0.3 * k); T[1] = y; T[2] = z * (1 + 0.3 * k); return;
        case 2: {
          const rx = x - K[2], ry = y - K[3], rz = z - K[4], a = rx * K[5] + ry * K[6] + rz * K[7];
          const ax = K[5] * a, ay = K[6] * a, az = K[7] * a;
          T[0] = K[2] + ax + (rx - ax) * bw; T[1] = K[3] + ay + (ry - ay) * bw; T[2] = K[4] + K[8] + az + (rz - az) * bw; return;
        }
        default: T[0] = x; T[1] = y; T[2] = z + K[8];
      }
    };
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let q = 0; q < 4; q++) {
        const w = B.jw[i * 4 + q] / 255; if (!w) continue;
        tf(kinds[B.ji[i * 4 + q]], x, y, z); ox += T[0] * w; oy += T[1] * w; oz += T[2] * w;
      }
      out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(B.nrm, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(B.uv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(B.ji, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(B.jw, 4, true));
    g.setIndex(new THREE.BufferAttribute(B.idx, 1));
    for (const [st, c, m] of D.groups) g.addGroup(st, c, m);
    return (BGC[key] = g);
  }

  // Общие материалы: кожа — по цвету, форма — по команде (меньше шейдеров и переключений на телефоне)
  const MC = {};
  function skinMat(hex) {
    const k = 'skin' + hex;
    return MC[k] || (MC[k] = WP.underwaterify(new THREE.MeshPhysicalMaterial({ color: hex, map: skinTex(), roughness: 0.46, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.2, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffe2cc) })));
  }
  // Кожа тела из Blender: рельеф мышц — картой нормалей, впадины и складки — запечённым затенением
  function skinBodyMat(hex) {
    const k = 'skinB' + hex;
    if (MC[k]) return MC[k];
    const B = bodyData();
    return (MC[k] = WP.underwaterify(new THREE.MeshPhysicalMaterial({ color: hex, map: skinTex(), normalMap: B.normalMap, aoMap: B.aoMap, aoMapIntensity: 1.0, roughness: 0.46, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.2, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffe2cc) })));
  }
  // Кожа неоднородная: лёгкие пятна и поры, чтобы не выглядела пластиком (текстура общая, тон — цветом материала)
  let SKT = null;
  function skinTex() {
    if (SKT) return SKT;
    SKT = WP.canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 900; i++) {
        const v = 225 + Math.floor(rnd() * 30), r = 1 + rnd() * 5;
        g.fillStyle = 'rgba(' + v + ',' + (v - 6) + ',' + (v - 10) + ',0.35)';
        g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, TAU); g.fill();
      }
    });
    SKT.wrapS = SKT.wrapT = THREE.RepeatWrapping; SKT.repeat.set(3, 3);
    return SKT;
  }
  function suitMat(team) {
    const k = 'suit' + team.code + team.suitHex + team.numHex;
    if (MC[k]) return MC[k];
    // Текстура плавок: тёмная поясная резинка сверху и контрастные полосы по бокам (u=0 и u=0.5 — бока у LatheGeometry)
    const map = WP.canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = team.suitHex; g.fillRect(0, 0, w, h);
      const dark = new THREE.Color(team.suitHex).multiplyScalar(0.55).getStyle();
      g.fillStyle = dark; g.fillRect(0, 0, w, h * 0.16);
      g.fillStyle = team.numHex === '#ffffff' ? '#ffffff' : '#f3f5f7';
      for (const x of [w * 0.25, w * 0.75]) g.fillRect(x - 7, h * 0.16, 14, h * 0.84);
      g.fillStyle = dark; for (const x of [w * 0.25, w * 0.75]) g.fillRect(x - 2, h * 0.16, 4, h * 0.84);
    });
    map.wrapS = THREE.RepeatWrapping;
    return (MC[k] = WP.underwaterify(new THREE.MeshPhysicalMaterial({ map, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25 })));
  }
  function plainMat(hex, rough) {
    const k = 'p' + hex + rough;
    return MC[k] || (MC[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
  }

  const SKINS = [0xf1c7a6, 0xe2b48e, 0xd2a07a, 0xbf8b63, 0xa7744e, 0x8a5a3a, 0x6c4430];
  const HAIR = [0x1c1410, 0x2b1d14, 0x3a2a1c, 0x14100c];

  function capTexture(num, capHex, numHex, code) {
    return WP.canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = capHex; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
      for (const x of [w * 0.5, 0, w]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, h * 0.86, w, h * 0.14);
      g.fillStyle = numHex; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 54px "Fira Sans Extra Condensed", "Arial Narrow", sans-serif';
      const s = String(num);
      g.fillText(s, 0, h * 0.58); g.fillText(s, w, h * 0.58);
      g.font = '700 19px "Fira Sans Extra Condensed", "Arial Narrow", sans-serif';
      g.fillText(code, w * 0.5, h * 0.42);
    });
  }
  // Жёсткий наушник: пластик с отверстиями и номером
  function earTexture(capHex, numHex, num) {
    return WP.canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = capHex; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let r = 0; r < 3; r++) for (let a = 0; a < 8; a++) {
        const ang = a / 8 * TAU, rad = 10 + r * 11;
        g.beginPath(); g.arc(w / 2 + Math.cos(ang) * rad, h * 0.25 + Math.sin(ang) * rad * 0.35, 2.4, 0, TAU); g.fill();
      }
      g.fillStyle = numHex; g.font = '800 40px "Fira Sans Extra Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), w / 2, h * 0.72);
    });
  }

  // Кач как в трейлере Water Polo Revolution: мяч высоко над головой на почти прямой руке → чуть назад →
  // рука выстреливает вперёд-вверх, как на бросок, и замирает перед самым выпуском → возврат наверх
  const PUMP = {
    ready: { rs: 3.0, ra: 0.3, re: 0.35, yaw: 0.3, pitch: -0.08 },
    cock: { rs: 3.4, ra: 0.3, re: 0.55, yaw: 0.5, pitch: -0.14 },
    fwd: { rs: 2.2, ra: 0.15, re: 0.12, yaw: -0.45, pitch: 0.28 },
    shot: { rs: 3.45, ra: 0.3, re: 0.62, yaw: 0.6, pitch: -0.15 }, // замах на бросок: чуть глубже, чем в каче
    // Маленький кач наверху: рука почти не уходит назад, короткий кивок предплечьем вперёд
    scock: { rs: 3.12, ra: 0.3, re: 0.45, yaw: 0.4, pitch: -0.1 },
    sfwd: { rs: 2.72, ra: 0.24, re: 0.15, yaw: 0.05, pitch: 0.06 },
  };
  const eio = (u) => u * u * (3 - 2 * u), eout = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
  // Фазы кача; small — маленький кач наверху. drive — насколько сейчас работают ноги и корпус (0…1, пик на выбросе)
  function pumpPhase(k, small) {
    const C = small ? PUMP.scock : PUMP.cock, F = small ? PUMP.sfwd : PUMP.fwd, sc = small ? 0.5 : 1;
    const drive = Math.sin(Math.PI * Math.max(0, Math.min(1, (k - 0.12) / 0.5)));
    if (k < 0.18) return { a: PUMP.ready, b: C, u: eio(k / 0.18), f: -0.4 * sc * eio(k / 0.18), drive };
    if (k < 0.42) { const u = eout((k - 0.18) / 0.24); return { a: C, b: F, u, f: (-0.4 + 1.4 * u) * sc, drive }; }
    if (k < 0.56) return { a: F, b: F, u: 0, f: sc, drive };
    const u = eio((k - 0.56) / 0.44); return { a: F, b: PUMP.ready, u, f: (1 - u) * sc, drive };
  }

  function angNorm(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  WP.angNorm = angNorm;

  class Player {
    constructor(world, team, info, attrs, skipRig) {
      this.world = world; this.team = team;
      this.info = info;
      this.num = info[0]; this.name = info[1]; this.role = info[2]; this.star = !!info[3]; this.full = info[4] || info[1];
      this.cid = info[7] || null; this.played = false;
      this.isGK = this.role === 'GK';
      this.attrs = WP.fixAttrs(attrs);
      // Рост и телосложение
      const hr = WP.hash(team.code + this.name + 'h'), hb = WP.hash(team.code + this.name + 'b');
      const HB = { GK: [1.03, 0.05, 1.0, 0.05], CF: [1.0, 0.05, 1.1, 0.06], CB: [1.0, 0.05, 1.06, 0.06], W: [0.95, 0.06, 0.94, 0.05], D: [0.97, 0.06, 0.98, 0.06] }[this.role] || [0.98, 0.05, 1, 0.05];
      this.h = info[5] ? info[5] / 186 : HB[0] + hr * HB[1];
      this.bw = Math.round((HB[2] + hb * HB[3] + (info[5] ? Math.max(0, info[5] - 195) * 0.006 : 0)) * 50) / 50;
      this.heightCm = Math.round(186 * this.h);
      this.x = 0; this.z = 0; this.vx = 0; this.vz = 0; this.heading = 0;
      this.lift = 0; this.liftTarget = 0;
      this.stamina = 1;
      this.fouls = 0;
      this.stats = { goals: 0, assists: 0, shots: 0, saves: 0, steals: 0, excl: 0 };
      this.excluded = false; this.exclTimer = 0; this.outForGame = false; this.reentryOK = false; this.hardTime = false;
      this.hasBall = false; this.holdMode = 'hold';
      this.action = null;
      this.target = { x: 0, z: 0 }; this.moveMode = 'swim'; this.faceTo = null;
      this.ctrl = null;
      this.input = { x: 0, z: 0, sprint: false, active: false };
      this.phase = Math.random() * 6; this.swimK = 0; this.strokeCount = 0; this.seed = Math.random() * 10;
      this.stealCD = 0; this.decideT = 0.6; this.catchCD = 0; this.holdT = 0; this.stunT = 0;
      this.gkHand = new THREE.Vector3(); this.gkHandActive = false; this.gkLunge = 0; this.save = null; this.biteT = 0;
      this.slot = -1; this.slotName = ''; this.mark = null; this.wrestle = null;
      this.j = null; this.rig = null;
      if (!skipRig) this.buildRig();
    }

    get label() { return this.num + ' · ' + this.name.toUpperCase(); }
    get active() { return !this.excluded && !this.outForGame; }
    get speed() { return Math.hypot(this.vx, this.vz); }

    buildRig() {
      const s = shared(), G = bodyGeo(this.bw);
      const team = this.team;
      const capHex = this.isGK ? '#d7262e' : team.capHex;
      const numHex = this.isGK ? '#ffffff' : team.numHex;
      const skin = SKINS[Math.floor(WP.hash(this.name + 'skin') * SKINS.length)];
      const mSkin = skinMat(skin);
      const mSuit = suitMat(team);
      // Шапочка и наушники несут номер — у каждого свои
      const mCap = new THREE.MeshStandardMaterial({ map: capTexture(this.num, capHex, numHex, team.code), roughness: 0.62 });
      const mEar = new THREE.MeshPhysicalMaterial({ map: earTexture(capHex, numHex, this.num), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
      const mStrap = plainMat(new THREE.Color(capHex).multiplyScalar(0.7).getHex(), 0.6);
      const mDark = plainMat(0x2a1c14, 0.6);
      const mBrow = plainMat(new THREE.Color(skin).multiplyScalar(0.35).getHex(), 0.8);
      const add = (parent, geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); if (sx) m.scale.set(sx, sy, sz); parent.add(m); return m; };

      const root = new THREE.Group();
      const body = new THREE.Group(); body.scale.setScalar(this.h); root.add(body);
      // Тело из Blender — одна кожа на костях рига; без него — прежние вылепленные части
      const sk = !!WP.BODY;
      const bw = this.bw;
      if (!sk) {
        add(body, G.torso, mSkin);
        add(body, G.suit, mSuit);
        // Мышцы вылеплены прямо в торсе; трапеция — мягкий скат от шеи к плечам
        add(body, s.ball, mSkin, -0.012, 0.062, 0, 0.05, 0.03, 0.105 * bw);
      }
      const neck = new THREE.Group(); neck.position.y = 0.09; body.add(neck);
      if (!sk) add(neck, s.neck, mSkin, 0, 0.03, 0);
      const headG = new THREE.Group(); headG.position.y = 0.14; headG.scale.setScalar(0.93); neck.add(headG); // голова чуть меньше — плечи кажутся мощнее
      const HG = headGeo();
      add(headG, HG.head, mSkin);
      // Борода или щетина — у части игроков
      const hb = WP.hash(this.name + 'beard');
      if (hb < 0.4) add(headG, HG.beard, plainMat(new THREE.Color(skin).lerp(new THREE.Color(HAIR[Math.floor(hb * 10) % HAIR.length]), hb < 0.2 ? 0.8 : 0.5).getHex(), 0.95));
      for (const zs of [-1, 1]) {
        add(headG, s.ball, mDark, 0.088, 0.014, zs * 0.034, 0.008, 0.009, 0.011);   // глаза в глазницах
        const b = add(headG, s.ball, mBrow, 0.106, 0.036, zs * 0.034, 0.006, 0.004, 0.02); // брови по надбровью
        b.rotation.x = zs * 0.12;
      }
      add(headG, HG.cap, mCap);
      for (const zs of [-1, 1]) {
        const e = add(headG, s.ear, mEar, -0.012, -0.012, zs * 0.094, 1.05, 1.0, 1.25);
        e.rotation.x = zs > 0 ? 0 : Math.PI;
      }
      const strap = add(headG, s.strap, mStrap, 0.02, -0.04, 0);
      strap.rotation.set(0, Math.PI / 2, Math.PI);
      const mkArm = (side) => {
        const sh = new THREE.Group(); sh.position.set(0, -0.02, side * 0.22 * bw); body.add(sh);
        const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
        const hand = new THREE.Group(); hand.position.y = -0.265; el.add(hand);
        if (sk) return { sh, el, hand };
        add(sh, G.upper, mSkin);
        add(el, s.joint, mSkin, 0, 0, 0, 0.04 * bw, 0.04 * bw, 0.04 * bw);            // локоть без щели на сгибе
        add(el, G.fore, mSkin);
        add(hand, s.ball, mSkin, 0, -0.055, 0, 0.027, 0.066, 0.055);               // ладонь — у ватерполистов крупная
        const fing = add(hand, s.ball, mSkin, 0.01, -0.142, 0, 0.018, 0.058, 0.05); // сомкнутые пальцы, чуть согнуты
        fing.rotation.z = 0.22;
        const th = add(hand, s.ball, mSkin, 0.02, -0.05, side * 0.04, 0.014, 0.034, 0.015); // большой палец
        th.rotation.x = -side * 0.5;
        return { sh, el, hand };
      };
      const mkLeg = (side) => {
        const hip = new THREE.Group(); hip.position.set(0, -0.6, side * 0.09 * bw); body.add(hip);
        const kn = new THREE.Group(); kn.position.y = -0.46; hip.add(kn);
        const foot = new THREE.Group(); foot.position.y = -0.44; kn.add(foot);
        if (sk) return { hip, kn, foot };
        add(hip, G.thigh, mSkin);
        add(kn, s.joint, mSkin, 0, 0, 0, 0.06 * bw, 0.06 * bw, 0.06 * bw);            // колено
        add(kn, G.shin, mSkin);
        add(kn, s.ball, mSkin, -0.03 * bw, -0.14, 0, 0.036 * bw, 0.1, 0.042 * bw);    // икра
        add(foot, s.ball, mSkin, 0.06, -0.022, 0, 0.115, 0.032, 0.047);             // стопа
        return { hip, kn, foot };
      };
      const aR = mkArm(1), aL = mkArm(-1), lR = mkLeg(1), lL = mkLeg(-1);
      this.rig = { root, body, neck, headG, aR, aL, lR, lL };
      if (sk) this.skinBody(skinBodyMat(skin), mSuit);
      this.world.scene.add(root);
      this.j = {
        y: 0.05, pitch: 0.2, roll: 0, yaw: 0,
        rs: 1.3, ra: 0.7, re: 0.7, ls: 1.3, la: 0.7, le: 0.7,
        hrs: 1.2, hra: 0.5, hrk: -1.4, hls: 1.2, hla: 0.5, hlk: -1.4,
      };
    }

    // Кожа из Blender на узлах рига: риг ставится в позу привязки (руки и ноги разведены, суставы прямые),
    // запоминаются обратные матрицы — дальше кожа просто следует за узлами при любой анимации
    skinBody(mSkin, mSuit) {
      const r = this.rig, D = WP.BODY;
      const map = { body: r.body, neck: r.neck, head: r.headG, shR: r.aR.sh, elR: r.aR.el, handR: r.aR.hand, shL: r.aL.sh, elL: r.aL.el, handL: r.aL.hand, hipR: r.lR.hip, knR: r.lR.kn, footR: r.lR.foot, hipL: r.lL.hip, knL: r.lL.kn, footL: r.lL.foot };
      r.body.rotation.set(0, 0, 0); r.body.position.y = 0; r.neck.rotation.set(0, 0, 0);
      this.setArm(r.aR, 0, D.bind.arm, 0, 1); this.setArm(r.aL, 0, D.bind.arm, 0, -1);
      this.setLeg(r.lR, 0, D.bind.leg, 0, 1); this.setLeg(r.lL, 0, D.bind.leg, 0, -1);
      r.lR.foot.rotation.z = 0; r.lL.foot.rotation.z = 0;
      const mesh = new THREE.SkinnedMesh(bodySkinGeo(this.bw), [mSkin, mSuit]);
      r.body.add(mesh);
      r.root.updateMatrixWorld(true);
      mesh.bind(new THREE.Skeleton(D.bones.map(n => map[n])), mesh.matrixWorld);
      mesh.frustumCulled = false; // руки уходят далеко от позы привязки
      r.skin = mesh;
    }

    dispose() { if (this.rig) { this.world.scene.remove(this.rig.root); this.rig = null; } }

    maxSpeed() {
      // Кроль с поднятой головой у элиты ~2,0 м/с, с мячом ~1,7 м/с, эггбитер боком ~0,9 м/с
      // Скорость решает заметно: 60 → ~1,7 м/с, 95 → ~2,05 м/с
      let v = 1.15 + 0.95 * this.attrs.spd / 100;
      if (this.moveMode === 'sprint' && this.stamina > 0.12) v *= this.team.ai.phase === 'attack' && this.team.ai.phaseT < 4 && !this.hasBall ? 1.17 : 1.12;
      if (this.moveMode === 'slow') v *= 0.5;
      if (this.hasBall) v *= this.holdMode === 'hold' ? 0.48 : 0.87;
      if (this.isGK) v *= 0.72;
      if (this.excluded) v *= 0.8;
      // Упёрся в заслон: почти стоит, пока не обойдёт заслоняющего
      if (this.screenT > 0) v *= 0.5;
      if (this.action && (this.action.type === 'windup' || this.action.type === 'release')) v *= 0.2;
      if (this.action && this.action.type === 'pass') v *= 0.6;
      if (this.action && this.action.type === 'block') v *= 0.45;
      if (this.action && (this.action.type === 'drawfoul' || this.action.type === 'fake')) v *= 0.4;
      if (this.stunT > 0) v *= 0.4;
      v *= 0.8 + 0.2 * this.stamina;
      return v;
    }

    move(dt, bounds) {
      let dx, dz, want;
      const vmax = this.maxSpeed();
      if (this.ctrl && this.input.active && !this.excluded) {
        dx = this.input.x; dz = this.input.z;
        const m = Math.hypot(dx, dz);
        want = Math.min(1, m) * vmax;
        if (m > 0.001) { dx /= m; dz /= m; }
        this.moveMode = this.input.sprint ? 'sprint' : 'swim';
      } else {
        dx = this.target.x - this.x; dz = this.target.z - this.z;
        const d = Math.hypot(dx, dz);
        want = Math.min(vmax, d * 1.9);
        if (d < 0.06) want = 0;
        if (d > 0.001) { dx /= d; dz /= d; }
      }
      const tvx = dx * want, tvz = dz * want;
      const ax = tvx - this.vx, az = tvz - this.vz;
      const am = Math.hypot(ax, az);
      // Управляемый человеком игрок откликается резче
      const hum = this.ctrl && this.input.active ? 1.6 : 1;
      const acc = (want > this.speed ? 3.0 : 4.5) * hum * (0.8 + 0.4 * this.attrs.spd / 100) * dt;
      if (am > acc) { this.vx += ax / am * acc; this.vz += az / am * acc; } else { this.vx = tvx; this.vz = tvz; }
      this.x += this.vx * dt; this.z += this.vz * dt;
      const b = bounds;
      if (this.x < b.x0) { this.x = b.x0; this.vx = Math.max(0, this.vx); }
      if (this.x > b.x1) { this.x = b.x1; this.vx = Math.min(0, this.vx); }
      if (this.z < b.z0) { this.z = b.z0; this.vz = Math.max(0, this.vz); }
      if (this.z > b.z1) { this.z = b.z1; this.vz = Math.min(0, this.vz); }
      const sp = this.speed;
      let wantH = null;
      // С мячом не «смотрит» на точку у себя в руке (это сам мяч) — иначе игрок крутился на месте
      let ft = this.faceTo;
      if (ft && this.hasBall && Math.hypot(ft.x - this.x, ft.z - this.z) < 1.2) ft = null;
      if (ft && (sp < 0.9 || (this.hasBall && this.holdMode === 'hold'))) wantH = Math.atan2(ft.z - this.z, ft.x - this.x);
      else if (sp > 0.25) wantH = Math.atan2(this.vz, this.vx);
      if (wantH !== null) {
        const d = angNorm(wantH - this.heading);
        const rate = (this.hasBall ? 3.8 : 5.5) * hum * dt;
        this.heading = angNorm(this.heading + Math.max(-rate, Math.min(rate, d)));
      }
      // Выносливость: 50 → обычный расход сил, 90 → на треть медленнее
      const drain = 1.45 - 0.9 * (this.attrs.sta === undefined ? 75 : this.attrs.sta) / 100;
      if (this.moveMode === 'sprint' && sp > 1.4) this.stamina -= 0.03 * drain * dt;
      else if (sp > 1.3) this.stamina -= 0.005 * drain * dt;
      else this.stamina += 0.022 * dt;
      this.stamina = Math.max(0, Math.min(1, this.stamina));
      if (this.hasBall) {
        if (this.holdMode === 'hold' && sp > 0.95 && !this.action) this.holdMode = 'dribble';
        else if (this.holdMode === 'dribble' && sp < 0.6 && !(this.action && this.action.opts && this.action.opts.style === 'flick')) this.holdMode = 'hold';
      }
      const up = this.liftTarget > this.lift;
      this.lift += (this.liftTarget - this.lift) * Math.min(1, dt * (up ? (this.action && this.action.type === 'windup' ? 11 : 7) : 3));
      if (this.stealCD > 0) this.stealCD -= dt;
      if (this.stunT > 0) this.stunT -= dt;
      if (this.screenT > 0) this.screenT -= dt;
      if (this.catchCD > 0) this.catchCD -= dt;
    }

    bodyY() { return 0.03 + this.lift * 0.45 + this.world.waveHeight(this.x, this.z); }

    ballHoldPos(out) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      const a = this.action;
      const style = a && a.opts ? a.opts.style : null;
      if ((this.holdMode === 'dribble' && !a) || (a && a.type === 'windup' && style === 'flick')) {
        const d = 0.5 * this.h;
        out.set(this.x + c * d, 0.075 + this.world.waveHeight(this.x + c * d, this.z + s * d) + (a ? Math.min(0.15, a.t * 0.8) : 0), this.z + s * d);
        return out;
      }
      // Кисть правой руки считается аналитически, чтобы логика не зависела от рендера
      const by = this.bodyY(), hh = this.h;
      let f = 0.08, lat = 0.225 * this.bw * hh, y = by + 0.62 * hh;
      if (a && a.type === 'windup') {
        const k = Math.min(1, a.t / Math.min(a.dur, 0.45));
        if (style === 'side') { f = 0.0 - 0.15 * k; lat = (0.3 + 0.25 * k) * hh; y = by + (0.42 - 0.08 * k) * hh; }
        else if (style === 'back') { f = -0.1 * k; lat = (0.25 + 0.2 * k) * hh; y = by + 0.45 * hh; }
        else { const ez = k * k * (3 - 2 * k); f = 0.08 - 0.42 * ez; y = by + (0.62 + 0.02 * ez) * hh; }
      } else if (a && a.type === 'fake') {
        const q = pumpPhase(Math.min(1, a.t / a.dur), a.small).f;
        f = -0.12 + 0.45 * q; lat = (0.215 - 0.05 * Math.max(0, q)) * this.bw * hh; y = by + (0.8 - 0.06 * Math.max(0, q)) * hh;
      }
      out.set(this.x + c * f - s * lat, y, this.z + s * f + c * lat);
      return out;
    }

    setArm(a, sw, ab, el, side) {
      V1.set(Math.sin(sw) * Math.cos(ab), -Math.cos(sw) * Math.cos(ab), side * Math.sin(ab)).normalize();
      a.sh.quaternion.setFromUnitVectors(DOWN, V1);
      a.el.rotation.z = el;
    }
    setLeg(l, sw, ab, kn, side) {
      V1.set(Math.sin(sw) * Math.cos(ab), -Math.cos(sw) * Math.cos(ab), side * Math.sin(ab)).normalize();
      l.hip.quaternion.setFromUnitVectors(DOWN, V1);
      l.kn.rotation.z = kn;
      l.foot.rotation.z = -0.9 - kn * 0.2;
    }
    // Рука к точке в мире (плечо смотрит на цель, локоть сгибается, если цель ближе вытянутой руки)
    ikArm(arm, target) {
      V1.copy(target);
      this.rig.body.worldToLocal(V1);
      V1.sub(arm.sh.position);
      const L = V1.length();
      V1.normalize();
      const bend = Math.max(0, Math.min(1.4, (0.66 - L) / 0.66 * 2.4));
      V2.set(V1.x, V1.y, V1.z);
      V1.applyAxisAngle(V2.set(-V1.z, 0, V1.x).normalize(), -bend * 0.45);
      arm.sh.quaternion.setFromUnitVectors(DOWN, V1.normalize());
      arm.el.rotation.z = bend;
    }

    animate(dt, t, ball) {
      if (!this.rig) return;
      const j = this.j, rig = this.rig;
      const sp = this.speed;
      const act = this.action;
      const style = act && act.opts ? act.opts.style : null;
      const W = this.wrestle;
      let swimK = Math.max(0, Math.min(1, (sp - 0.6) / 0.7));
      if (this.isGK && !this.excluded) swimK *= sp > 1.3 ? 0.8 : 0.2;
      if (this.hasBall && this.holdMode === 'hold') swimK = 0;
      if (act && act.type !== 'steal' && style !== 'flick') swimK = 0;
      if (W) swimK = 0;
      this.swimK += (swimK - this.swimK) * Math.min(1, dt * 6);
      const K = this.swimK;
      const rate = (1 - K) * (W ? 2.2 : 1.7) + K * (0.55 + sp * 0.32);
      const prevPh = this.phase;
      this.phase += rate * dt * TAU;
      const ph = this.phase;
      const bob = 0.02 * Math.sin(ph) * (1 - K);

      // Кроль ватерполиста: голова над водой, плечи высоко, корпус перекатывается с боку на бок на каждом гребке
      const T = {
        y: (0.03 + this.lift * (this.isGK ? 0.45 : 0.37) + bob) * (1 - K) + 0.0 * K,
        pitch: (0.16 - this.lift * 0.1) * (1 - K) + 1.05 * K,
        roll: 0.03 * Math.sin(t * 1.3 + this.seed) * (1 - K) + 0.26 * Math.sin(ph) * K, yaw: 0,
      };
      let swR = Math.PI - (ph % TAU); let swL = swR - Math.PI;
      // Эггбитер: предплечья загребают под самой поверхностью
      const tr = 1.02 + 0.28 * Math.sin(ph), tl = 1.02 + 0.28 * Math.sin(ph + Math.PI);
      const fix = (a, ref) => { while (a - ref > Math.PI) a -= TAU; while (a - ref < -Math.PI) a += TAU; return a; };
      swR = fix(swR, tr); swL = fix(swL, tl);
      const dribble = this.hasBall && this.holdMode === 'dribble';
      const armAb = dribble ? 0.42 : 0.2;
      // Над водой — высокий локоть и рука в сторону (короткий «рубленый» пронос), под водой — гребок согнутой рукой
      const recR = Math.max(0, -Math.sin(swR)), recL = Math.max(0, -Math.sin(swL));
      T.rs = tr * (1 - K) + swR * K; T.ra = 0.72 * (1 - K) + (dribble ? armAb : 0.14 + 0.46 * recR) * K;
      T.re = (0.95 + 0.25 * Math.sin(ph + 1)) * (1 - K) + (0.5 + 1.15 * recR) * K;
      T.ls = tl * (1 - K) + swL * K; T.la = 0.72 * (1 - K) + (dribble ? armAb : 0.14 + 0.46 * recL) * K;
      T.le = (0.95 + 0.25 * Math.sin(ph + 1 + Math.PI)) * (1 - K) + (0.5 + 1.15 * recL) * K;
      const eg = Math.sin(ph * 1.6), eg2 = Math.sin(ph * 1.6 + Math.PI);
      T.hrs = (1.25 + 0.14 * eg) * (1 - K) + (0.1 + 0.42 * Math.sin(ph * 2.2)) * K;
      T.hls = (1.25 + 0.14 * eg2) * (1 - K) + (0.1 + 0.42 * Math.sin(ph * 2.2 + Math.PI)) * K;
      T.hra = 0.62 * (1 - K) + 0.1 * K; T.hla = 0.62 * (1 - K) + 0.1 * K;
      T.hrk = (-1.6 + 0.5 * Math.cos(ph * 1.6)) * (1 - K) + (-0.2 - 0.55 * Math.max(0, Math.sin(ph * 2.2 + 0.6))) * K;
      T.hlk = (-1.6 + 0.5 * Math.cos(ph * 1.6 + Math.PI)) * (1 - K) + (-0.2 - 0.55 * Math.max(0, Math.sin(ph * 2.2 + Math.PI + 0.6))) * K;
      let gkIK = false, ikR = null, ikL = null;

      // С мячом у ворот — «на изготовке», как в трансляциях: мяч высоко сбоку от головы на ладони, локоть согнут, корпус чуть развёрнут
      if (this.hasBall && this.holdMode === 'hold' && !act) {
        const gd = Math.abs(this.team.dir * WP.R.HALF_L - this.x);
        if (!this.isGK && gd < 10) Object.assign(T, PUMP.ready); else { T.rs = 2.75; T.ra = 0.2; T.re = 0.5; }
      }
      if (this.isGK && !this.hasBall && !act && K < 0.5) { T.rs = 1.85; T.ra = 1.0; T.re = 0.5; T.ls = 1.85; T.la = 1.0; T.le = 0.5; } // руки широко, ладони у воды
      let fast = false;
      if (act) {
        const k = Math.min(1, act.t / act.dur);
        const kw = Math.min(1, act.t / 0.45);
        switch (act.type) {
          case 'windup':
            if (style === 'side') { // сбоку, от плеча
              T.rs = 1.75 + 0.35 * kw; T.ra = 1.2; T.re = 0.7 * kw; T.ls = 1.6; T.la = 0.5; T.le = 0.4; T.yaw = 0.8 * kw; T.roll = -0.18 * kw;
            } else if (style === 'flick') { // «из воды»: толчок снизу без подъёма мяча
              T.rs = 1.3 - 0.3 * kw; T.ra = 0.35; T.re = 0.9; T.ls = 1.4; T.la = 0.6; T.le = 0.5; T.pitch = 0.5;
            } else if (style === 'back') { // разворот центрового
              T.rs = 2.3 + 0.4 * kw; T.ra = 0.9; T.re = 0.4; T.yaw = -0.6 * kw; T.ls = 1.5; T.la = 0.7;
            } else { // сверху — как в жизни и как в каче: с изготовки мяч уходит назад-вверх, корпус заворачивается, вторая рука на ворота
              const ez = kw * kw * (3 - 2 * kw), A = PUMP.ready, B = PUMP.shot;
              // Пока игрок держит бросок, он «качает» — мяч чуть ходит вперёд-назад
              const pump = act.ai ? 0 : Math.max(0, act.t - 0.45) > 0 ? 0.1 * Math.sin((act.t - 0.45) * 9) : 0;
              T.rs = A.rs + (B.rs - A.rs) * ez + pump; T.ra = A.ra + (B.ra - A.ra) * ez; T.re = A.re + (B.re - A.re) * ez;
              T.yaw = A.yaw + (B.yaw - A.yaw) * ez; T.pitch = A.pitch + (B.pitch - A.pitch) * ez; T.roll = -0.12 * ez;
              T.ls = 1.9 - 0.25 * ez; T.la = 0.45; T.le = 0.15;
            }
            break;
          case 'release':
            if (act.style === 'side') { T.rs = 1.6 - 0.2 * k; T.ra = 1.2 - 1.0 * Math.min(1, k * 1.6); T.re = 0.1; T.yaw = -0.5 * k; T.roll = 0.1; }
            else if (act.style === 'flick') { T.rs = 1.0 + 0.9 * Math.min(1, k * 2); T.ra = 0.3; T.re = 0.1; T.pitch = 0.45; }
            else if (act.style === 'back') { T.rs = 2.7 - 3.1 * Math.min(1, k * 1.6); T.ra = 0.9; T.re = 0.1; T.yaw = 0.7 * k; }
            else {
              // Хлёст: плечо, затем локоть, корпус проворачивается к воротам; рука проходит до конца, вниз и через тело
              // До выпуска — тот же выброс, что в каче (поэтому кач и похож на бросок), дальше рука проходит вниз и через тело
              const w = eout(Math.min(1, k / 0.4)), f2 = Math.max(0, (k - 0.35) / 0.65), sk = act.kind === 'skip', B = PUMP.shot, F = PUMP.fwd;
              T.rs = B.rs + (F.rs - B.rs) * w - (sk ? 1.5 : 1.1) * f2; T.ra = B.ra + (F.ra - B.ra) * w + 0.3 * f2; T.re = B.re + (F.re - B.re) * w + 0.23 * f2;
              T.yaw = B.yaw + (F.yaw - B.yaw) * w - 0.3 * f2; T.pitch = B.pitch + (F.pitch - B.pitch) * w + (sk ? 0.42 : 0.17) * f2; T.roll = 0.12 * w;
              T.ls = 1.2; T.la = 0.7; T.le = 0.6;
            }
            fast = true;
            break;
          case 'pass': { // пас: рука от изготовки выбрасывается вперёд к партнёру и замирает, корпус смотрит на него
            const w = eout(Math.min(1, k / 0.45)), r = Math.max(-1.1, Math.min(1.1, act.rel || 0));
            const A = PUMP.ready, endRs = act.lob ? 2.45 : 2.0;
            T.rs = A.rs + (endRs - A.rs) * w; T.ra = A.ra + (0.12 - A.ra) * w; T.re = A.re + (0.06 - A.re) * w;
            T.yaw = A.yaw + (-r * 0.75 - A.yaw) * w; T.pitch = A.pitch + ((act.lob ? 0.05 : 0.16) - A.pitch) * w; T.roll = 0.05 * w;
            T.ls = 1.25; T.la = 0.75; T.le = 0.55;
            fast = true;
            break;
          }
          case 'fake': { // кач всем телом (как учат тренеры): ноги выталкивают корпус вверх, корпус и плечо идут вперёд, голова кивает на ворота
            const ph = pumpPhase(k, act.small), big = act.small ? 0.45 : 1;
            for (const key in PUMP.ready) T[key] = ph.a[key] + (ph.b[key] - ph.a[key]) * ph.u;
            T.y += 0.075 * big * ph.drive;                       // толчок ногами — корпус выше из воды
            T.hrs += 0.3 * big * ph.drive; T.hls += 0.3 * big * ph.drive * 0.8;
            T.hrk -= 0.5 * big * ph.drive; T.hlk -= 0.45 * big * ph.drive;
            act.nod = 0.32 * big * ph.drive;                     // кивок головой вперёд на выбросе
            // Свободная рука гребёт под водой и держит равновесие
            T.ls = 1.15 + 0.1 * Math.sin(t * 9); T.la = 0.8; T.le = 0.55;
            fast = true;
            break;
          }
          case 'drawfoul': // упирается в защитника спиной, мяч поднят над водой — показывает судье захват
            T.rs = 3.0; T.ra = 0.35; T.re = 0.25; T.ls = 2.4 + 0.3 * Math.sin(k * Math.PI * 2); T.la = 0.9; T.le = 0.5;
            T.pitch = -0.28; T.roll = 0.1 * Math.sin(k * Math.PI * 3); fast = true;
            break;
          case 'block':
            if (this.isGK) { T.rs = 2.85; T.ra = 0.55; T.re = 0.1; T.ls = 2.85; T.la = 0.55; T.le = 0.1; }
            else { T.rs = 3.05; T.ra = 0.14; T.re = 0.05; }
            fast = true;
            break;
          case 'steal':
            T.rs = 1.55; T.ra = 0.12; T.re = 0.15; T.pitch = 0.55 + 0.3 * Math.sin(k * Math.PI); fast = true;
            break;
          case 'catch':
            T.rs = 2.9; T.ra = 0.25; T.re = 0.3; fast = true;
            break;
          case 'celebrate':
            T.rs = 2.95 + 0.2 * Math.sin(t * 9); T.ra = 0.35; T.re = 0.2;
            T.ls = 2.95 + 0.2 * Math.sin(t * 9 + 1.5); T.la = 0.35; T.le = 0.2;
            break;
          case 'dive':
            gkIK = true; fast = true;
            break;
        }
      }
      // «Руки»: обе руки вверх, ладони на виду у судьи
      if (this.hands && !this.hasBall && !this.isGK) { T.rs = 3.0; T.ra = 0.28; T.re = 0.08; T.ls = 3.0; T.la = 0.28; T.le = 0.08; T.pitch = 0.05; fast = true; }
      if (this.gkHandActive) gkIK = true;
      // Борьба у ворот: защитник держит центрового за плечо и под водой за плавки, центровой упирается рукой
      if (W && !act && !this.hasBall) {
        const p = W.p;
        const pby = p.bodyY();
        if (W.role === 'def') {
          T.pitch = 0.42; T.y = 0.05 + this.lift * 0.45;
          ikR = V2.set(p.x + (this.x - p.x) * 0.25, pby + 0.02 * p.h, p.z + (this.z - p.z) * 0.25).clone();
          ikL = new THREE.Vector3(p.x + (this.x - p.x) * 0.3, pby - 0.55 * p.h, p.z + (this.z - p.z) * 0.3);
        } else {
          T.pitch = -0.08; T.rs = 2.9; T.ra = 0.2; T.re = 0.3;
          ikL = new THREE.Vector3(p.x + (this.x - p.x) * 0.2, pby - 0.12 * p.h, p.z + (this.z - p.z) * 0.2);
        }
      }

      if (this.poseOverride) { Object.assign(T, this.poseOverride); fast = true; }
      const sK = Math.min(1, dt * (fast ? 30 : 14));
      for (const key in T) {
        if (j[key] === undefined) continue;
        j[key] += (T[key] - j[key]) * sK;
      }
      // Волна покачивает тело
      const wh = this.world.waveHeight(this.x, this.z);
      const gx = (this.world.waveHeight(this.x + 0.35, this.z) - this.world.waveHeight(this.x - 0.35, this.z)) / 0.7;
      const gz = (this.world.waveHeight(this.x, this.z + 0.35) - this.world.waveHeight(this.x, this.z - 0.35)) / 0.7;
      const c = Math.cos(this.heading), sn = Math.sin(this.heading);
      const gF = gx * c + gz * sn, gR = -gx * sn + gz * c;
      const root = rig.root;
      let ox = 0, oz = 0;
      if (W) { // толкотня
        const a = 0.035 * Math.sin(t * 6.3 + this.seed), b = 0.025 * Math.sin(t * 4.1 + this.seed * 2);
        ox = -sn * a + c * b; oz = c * a + sn * b;
      }
      root.position.set(this.x + ox, wh, this.z + oz);
      root.rotation.y = -this.heading;
      rig.body.position.y = j.y - wh * 0.4;
      let roll = j.roll + gR * 0.6;
      if (this.isGK) {
        if (this.gkHandActive) {
          const lat = -(this.gkHand.x - this.x) * sn + (this.gkHand.z - this.z) * c;
          roll += Math.max(-0.95, Math.min(0.95, lat * 1.1));
        }
      }
      rig.body.rotation.order = 'YXZ';
      rig.body.rotation.set(roll, j.yaw, -(j.pitch - gF * 0.6));
      rig.neck.rotation.z = j.pitch * (0.85 + 0.12 * this.swimK) + (act && act.type === 'fake' ? act.nod || 0 : 0); // в кроле голова над водой; в каче — кивок
      if (ball) {
        // С мячом смотрит вперёд (на ворота/партнёра), без мяча — следит за мячом
        const a = this.hasBall ? this.heading : Math.atan2(ball.pos.z - this.z, ball.pos.x - this.x);
        const d = Math.max(-1.1, Math.min(1.1, angNorm(-(a - this.heading)))) - (this.hasBall ? j.yaw * 0.8 : 0);
        rig.neck.rotation.y += (d * 0.8 - rig.neck.rotation.y) * Math.min(1, dt * 5);
      }
      this.setArm(rig.aR, j.rs, j.ra, j.re, 1);
      this.setArm(rig.aL, j.ls, j.la, j.le, -1);
      this.setLeg(rig.lR, j.hrs, j.hra, j.hrk, 1);
      this.setLeg(rig.lL, j.hls, j.hla, j.hlk, -1);
      if (gkIK || ikR || ikL) root.updateMatrixWorld(true);
      if (gkIK) {
        const hand = this.gkHand;
        this.ikArm(rig.aR, V2.set(hand.x - sn * 0.06, hand.y, hand.z + c * 0.06));
        this.ikArm(rig.aL, V2.set(hand.x + sn * 0.06, hand.y - 0.05, hand.z - c * 0.06));
        // Выпрыгивание: ноги работают, брызги
        if (Math.random() < dt * 14) this.world.splash(this.x, 0.1, this.z, 2, 0.9);
      }
      if (ikR) this.ikArm(rig.aR, ikR);
      if (ikL) this.ikArm(rig.aL, ikL);

      // Гребок: брызги, рябь, пена
      if (K > 0.6 && sp > 1.0) {
        const a = Math.floor(prevPh / Math.PI), b = Math.floor(ph / Math.PI);
        if (a !== b) {
          this.strokeCount++;
          const side = (b % 2 ? 1 : -1) * 0.22;
          const hx = this.x + c * 0.6 - sn * side, hz = this.z + sn * 0.6 + c * side;
          this.world.splash(hx, 0.05, hz, sp > 1.7 ? 5 : 2, 0.55, { x: c * 0.4, z: sn * 0.4 });
          if (this.strokeCount % 3 === 0) this.world.addRipple(hx, hz, 0.012 * sp);
        }
        this.world.foam(this.x + c * 0.45, this.z + sn * 0.45, 0.26, 0.09 * sp * dt * 30);
        this.world.foam(this.x - c * 1.35 * this.h, this.z - sn * 1.35 * this.h, 0.32, 0.11 * sp * dt * 30);
        if (Math.random() < dt * 10) this.world.splash(this.x - c * 1.4, 0.03, this.z - sn * 1.4, 1, 0.35);
      } else if (!this.excluded) {
        this.world.foam(this.x, this.z, 0.45, (W ? 0.07 : 0.02) * dt * 30);
      }
      if (W && Math.random() < dt * 2.5) this.world.splash(this.x, 0.08, this.z, 2, 0.6);
    }
  }

  WP.Player = Player;
  WP.ringGeo = () => shared().ring;
})();
