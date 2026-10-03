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
      neck: new THREE.CylinderGeometry(0.052, 0.062, 0.13, 14),
      ball: new THREE.SphereGeometry(1, 14, 10),
      joint: new THREE.SphereGeometry(1, 12, 8),
      ring: new THREE.RingGeometry(0.42, 0.52, 40),
    };
    S.ring.rotateX(-Math.PI / 2);
    S.nose.rotateZ(-Math.PI / 2);
    S.ear.rotateX(-Math.PI / 2);
    return S;
  }

  // Тело зависит от телосложения (ширина плеч, обхват). Профиль ватерполиста: широкие плечи и
  // широчайшие, узкая талия («V»), мощные бёдра от эггбитера.
  const GC = {};
  function bodyGeo(bw) {
    const key = bw.toFixed(2);
    if (GC[key]) return GC[key];
    const torso = lathe([[0.02, -0.665], [0.13, -0.65], [0.165, -0.6], [0.163, -0.53], [0.145, -0.46], [0.138, -0.41], [0.146, -0.34], [0.168, -0.26], [0.192, -0.18], [0.212, -0.1], [0.224, -0.045], [0.214, 0.005], [0.182, 0.045], [0.12, 0.08], [0.055, 0.1]], 24);
    torso.scale(0.6, 1, bw);
    // Плавки: облегающие, чуть выше пояса — поясная резинка и боковые полосы рисуются текстурой
    const suit = lathe([[0.02, -0.682], [0.135, -0.668], [0.172, -0.618], [0.171, -0.55], [0.152, -0.49], [0.147, -0.468]], 24);
    suit.scale(0.63, 1, bw * 1.025);
    const g = bw;
    // Мышцы читаются по профилю: дельта → бицепс/трицепс → локоть, предплечье сужается к запястью
    const upper = lathe([[0.04 * g, -0.3], [0.046 * g, -0.27], [0.057 * g, -0.19], [0.062 * g, -0.12], [0.06 * g, -0.06], [0.054 * g, -0.01], [0.04 * g, 0.02]], 14);
    const fore = lathe([[0.025 * g, -0.265], [0.029 * g, -0.22], [0.04 * g, -0.13], [0.048 * g, -0.06], [0.044 * g, -0.015], [0.036 * g, 0.012]], 14);
    const thigh = lathe([[0.056 * g, -0.46], [0.066 * g, -0.41], [0.087 * g, -0.28], [0.097 * g, -0.16], [0.095 * g, -0.06], [0.086 * g, 0.01]], 14);
    const shin = lathe([[0.032 * g, -0.44], [0.037 * g, -0.39], [0.05 * g, -0.27], [0.064 * g, -0.16], [0.058 * g, -0.06], [0.05 * g, 0.01]], 14);
    GC[key] = { torso, suit, upper, fore, thigh, shin };
    return GC[key];
  }

  // Общие материалы: кожа — по цвету, форма — по команде (меньше шейдеров и переключений на телефоне)
  const MC = {};
  function skinMat(hex) {
    const k = 'skin' + hex;
    return MC[k] || (MC[k] = WP.underwaterify(new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.22, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffe2cc) })));
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
      for (const x of [0, w * 0.5, w]) g.fillRect(x - 7, h * 0.16, 14, h * 0.84);
      g.fillStyle = dark; for (const x of [0, w * 0.5, w]) g.fillRect(x - 2, h * 0.16, 4, h * 0.84);
    });
    map.wrapS = THREE.RepeatWrapping;
    return (MC[k] = WP.underwaterify(new THREE.MeshPhysicalMaterial({ map, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25 })));
  }
  function plainMat(hex, rough) {
    const k = 'p' + hex + rough;
    return MC[k] || (MC[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
  }

  const SKINS = [0xf0c6a4, 0xdcaa82, 0xc08e66, 0x8a5a3a, 0xe8b894];

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
      add(body, G.torso, mSkin);
      add(body, G.suit, mSuit);
      const bw = this.bw;
      for (const zs of [-1, 1]) {
        add(body, s.ball, mSkin, 0.1, -0.09, zs * 0.075 * bw, 0.045, 0.058, 0.085);   // грудные
        add(body, s.ball, mSkin, 0, -0.015, zs * 0.2 * bw, 0.068, 0.074, 0.064);     // дельты
        add(body, s.ball, mSkin, -0.075, -0.2, zs * 0.1 * bw, 0.04, 0.12, 0.07);     // широчайшие
      }
      add(body, s.ball, mSkin, -0.02, 0.06, 0, 0.055, 0.035, 0.1 * bw);             // трапеция
      add(body, s.ball, mSkin, 0.072, -0.3, 0, 0.03, 0.12, 0.085 * bw);            // пресс
      const neck = new THREE.Group(); neck.position.y = 0.09; body.add(neck);
      add(neck, s.neck, mSkin, 0, 0.03, 0);
      const headG = new THREE.Group(); headG.position.y = 0.14; neck.add(headG);
      add(headG, s.head, mSkin, 0, 0, 0, 1.08, 1.14, 0.95);
      add(headG, s.jaw, mSkin, 0.03, -0.055, 0, 1.0, 0.85, 1.12);
      add(headG, s.nose, mSkin, 0.108, -0.005, 0);
      add(headG, s.ball, mSkin, 0.084, 0.04, 0, 0.026, 0.013, 0.074);             // надбровье
      for (const zs of [-1, 1]) {
        add(headG, s.ball, mDark, 0.092, 0.02, zs * 0.035, 0.008, 0.008, 0.012);   // глаза
        const b = add(headG, s.ball, mBrow, 0.098, 0.048, zs * 0.034, 0.006, 0.004, 0.02); // брови
        b.rotation.x = zs * 0.12;
      }
      add(headG, s.cap, mCap, -0.004, 0.012, 0, 1.1, 1.16, 0.99);
      for (const zs of [-1, 1]) {
        const e = add(headG, s.ear, mEar, -0.012, -0.012, zs * 0.094, 1.05, 1.0, 1.25);
        e.rotation.x = zs > 0 ? 0 : Math.PI;
      }
      const strap = add(headG, s.strap, mStrap, 0.02, -0.04, 0);
      strap.rotation.set(0, Math.PI / 2, Math.PI);
      const mkArm = (side) => {
        const sh = new THREE.Group(); sh.position.set(0, -0.02, side * 0.2 * bw); body.add(sh);
        add(sh, G.upper, mSkin);
        add(sh, s.ball, mSkin, 0.026 * bw, -0.15, 0, 0.034 * bw, 0.075, 0.038 * bw); // бицепс
        const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
        add(el, s.joint, mSkin, 0, 0, 0, 0.043 * bw, 0.043 * bw, 0.043 * bw);         // локоть без щели на сгибе
        add(el, G.fore, mSkin);
        const hand = new THREE.Group(); hand.position.y = -0.265; el.add(hand);
        add(hand, s.ball, mSkin, 0, -0.048, 0, 0.022, 0.056, 0.046);               // ладонь
        const fing = add(hand, s.ball, mSkin, 0.008, -0.122, 0, 0.015, 0.048, 0.041); // сомкнутые пальцы, чуть согнуты
        fing.rotation.z = 0.22;
        const th = add(hand, s.ball, mSkin, 0.02, -0.05, side * 0.04, 0.014, 0.034, 0.015); // большой палец
        th.rotation.x = -side * 0.5;
        return { sh, el, hand };
      };
      const mkLeg = (side) => {
        const hip = new THREE.Group(); hip.position.set(0, -0.6, side * 0.09 * bw); body.add(hip);
        add(hip, G.thigh, mSkin);
        const kn = new THREE.Group(); kn.position.y = -0.46; hip.add(kn);
        add(kn, s.joint, mSkin, 0, 0, 0, 0.06 * bw, 0.06 * bw, 0.06 * bw);            // колено
        add(kn, G.shin, mSkin);
        add(kn, s.ball, mSkin, -0.03 * bw, -0.14, 0, 0.036 * bw, 0.1, 0.042 * bw);    // икра
        const foot = new THREE.Group(); foot.position.y = -0.44; kn.add(foot);
        add(foot, s.ball, mSkin, 0.06, -0.022, 0, 0.115, 0.032, 0.047);             // стопа
        return { hip, kn, foot };
      };
      const aR = mkArm(1), aL = mkArm(-1), lR = mkLeg(1), lL = mkLeg(-1);
      this.rig = { root, body, neck, headG, aR, aL, lR, lL };
      this.world.scene.add(root);
      this.j = {
        y: 0.05, pitch: 0.2, roll: 0, yaw: 0,
        rs: 1.3, ra: 0.7, re: 0.7, ls: 1.3, la: 0.7, le: 0.7,
        hrs: 1.2, hra: 0.5, hrk: -1.4, hls: 1.2, hla: 0.5, hlk: -1.4,
      };
    }

    dispose() { if (this.rig) { this.world.scene.remove(this.rig.root); this.rig = null; } }

    maxSpeed() {
      // Кроль с поднятой головой у элиты ~2,0 м/с, с мячом ~1,7 м/с, эггбитер боком ~0,9 м/с
      // Скорость решает заметно: 60 → ~1,7 м/с, 95 → ~2,05 м/с
      let v = 1.15 + 0.95 * this.attrs.spd / 100;
      if (this.moveMode === 'sprint' && this.stamina > 0.12) v *= 1.12;
      if (this.moveMode === 'slow') v *= 0.5;
      if (this.hasBall) v *= this.holdMode === 'hold' ? 0.48 : 0.87;
      if (this.isGK) v *= 0.72;
      if (this.excluded) v *= 0.8;
      // Упёрся в заслон: почти стоит, пока не обойдёт заслоняющего
      if (this.screenT > 0) v *= 0.5;
      if (this.action && (this.action.type === 'windup' || this.action.type === 'release')) v *= 0.2;
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
      if (this.faceTo && (sp < 0.9 || (this.hasBall && this.holdMode === 'hold'))) wantH = Math.atan2(this.faceTo.z - this.z, this.faceTo.x - this.x);
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
      let f = 0.08, lat = 0.21 * this.bw * hh, y = by + 0.62 * hh;
      if (a && a.type === 'windup') {
        const k = Math.min(1, a.t / Math.min(a.dur, 0.45));
        if (style === 'side') { f = 0.0 - 0.15 * k; lat = (0.3 + 0.25 * k) * hh; y = by + (0.42 - 0.08 * k) * hh; }
        else if (style === 'back') { f = -0.1 * k; lat = (0.25 + 0.2 * k) * hh; y = by + 0.45 * hh; }
        else { const ez = k * k * (3 - 2 * k); f = 0.08 - 0.42 * ez; y = by + (0.62 + 0.02 * ez) * hh; }
      } else if (a && a.type === 'fake') {
        const q = Math.sin(Math.min(1, a.t / a.dur) * Math.PI);
        f = -0.3 + 0.42 * q; y = by + (0.64 - 0.04 * q) * hh;
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

      const T = {
        y: (0.03 + this.lift * 0.45 + bob) * (1 - K) + (-0.04) * K,
        pitch: (0.16 - this.lift * 0.1) * (1 - K) + 1.2 * K,
        roll: 0.03 * Math.sin(t * 1.3 + this.seed) * (1 - K), yaw: 0,
      };
      let swR = Math.PI - (ph % TAU); let swL = swR - Math.PI;
      // Эггбитер: предплечья загребают под самой поверхностью
      const tr = 1.02 + 0.28 * Math.sin(ph), tl = 1.02 + 0.28 * Math.sin(ph + Math.PI);
      const fix = (a, ref) => { while (a - ref > Math.PI) a -= TAU; while (a - ref < -Math.PI) a += TAU; return a; };
      swR = fix(swR, tr); swL = fix(swL, tl);
      const dribble = this.hasBall && this.holdMode === 'dribble';
      const armAb = dribble ? 0.42 : 0.2;
      T.rs = tr * (1 - K) + swR * K; T.ra = 0.72 * (1 - K) + armAb * K;
      T.re = (0.95 + 0.25 * Math.sin(ph + 1)) * (1 - K) + (Math.sin(swR) < 0 ? 1.2 : 0.25) * K;
      T.ls = tl * (1 - K) + swL * K; T.la = 0.72 * (1 - K) + armAb * K;
      T.le = (0.95 + 0.25 * Math.sin(ph + 1 + Math.PI)) * (1 - K) + (Math.sin(swL) < 0 ? 1.2 : 0.25) * K;
      const eg = Math.sin(ph * 1.6), eg2 = Math.sin(ph * 1.6 + Math.PI);
      T.hrs = (1.25 + 0.14 * eg) * (1 - K) + (0.3 * Math.sin(ph * 2.2)) * K;
      T.hls = (1.25 + 0.14 * eg2) * (1 - K) + (0.3 * Math.sin(ph * 2.2 + Math.PI)) * K;
      T.hra = 0.62 * (1 - K) + 0.1 * K; T.hla = 0.62 * (1 - K) + 0.1 * K;
      T.hrk = (-1.6 + 0.5 * Math.cos(ph * 1.6)) * (1 - K) + (-0.35 - 0.35 * Math.max(0, Math.sin(ph * 2.2))) * K;
      T.hlk = (-1.6 + 0.5 * Math.cos(ph * 1.6 + Math.PI)) * (1 - K) + (-0.35 - 0.35 * Math.max(0, Math.sin(ph * 2.2 + Math.PI))) * K;
      let gkIK = false, ikR = null, ikL = null;

      if (this.hasBall && this.holdMode === 'hold' && !act) { T.rs = 2.75; T.ra = 0.2; T.re = 0.5; }
      if (this.isGK && !this.hasBall && !act && K < 0.5) { T.rs = 2.05; T.ra = 0.8; T.re = 0.45; T.ls = 2.05; T.la = 0.8; T.le = 0.45; }
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
            } else { // сверху: мяч уходит далеко за голову, корпус разворачивается, вторая рука указывает на ворота
              const ez = kw * kw * (3 - 2 * kw);
              // Пока игрок держит бросок, он «качает» — мяч чуть ходит вперёд-назад
              const pump = act.ai ? 0 : Math.max(0, act.t - 0.45) > 0 ? 0.12 * Math.sin((act.t - 0.45) * 9) : 0;
              T.rs = 2.8 + 0.75 * ez + pump; T.ra = 0.28 - 0.12 * ez; T.re = 0.35 + 0.55 * ez; T.ls = 1.9 - 0.25 * ez; T.la = 0.45; T.le = 0.15;
              T.yaw = 0.85 * ez; T.pitch = -0.12 * ez; T.roll = -0.12 * ez;
            }
            break;
          case 'release':
            if (act.style === 'side') { T.rs = 1.6 - 0.2 * k; T.ra = 1.2 - 1.0 * Math.min(1, k * 1.6); T.re = 0.1; T.yaw = -0.5 * k; T.roll = 0.1; }
            else if (act.style === 'flick') { T.rs = 1.0 + 0.9 * Math.min(1, k * 2); T.ra = 0.3; T.re = 0.1; T.pitch = 0.45; }
            else if (act.style === 'back') { T.rs = 2.7 - 3.1 * Math.min(1, k * 1.6); T.ra = 0.9; T.re = 0.1; T.yaw = 0.7 * k; }
            else {
              // Хлёст: плечо, затем локоть, корпус проворачивается к воротам; рука проходит до конца, вниз и через тело
              const w = Math.min(1, k * 2.2), f2 = Math.max(0, (k - 0.35) / 0.65);
              T.rs = 3.55 - 2.45 * w - 0.4 * f2; T.ra = 0.18 + 0.35 * f2; T.re = 0.9 * (1 - Math.min(1, k * 4)); T.ls = 1.2; T.la = 0.7; T.le = 0.6;
              T.yaw = 0.85 - 1.4 * w; T.pitch = -0.1 + 0.5 * w; T.roll = 0.12 * w;
            }
            fast = true;
            break;
          case 'fake': { // кач: из замаха рука резко идёт вперёд, как на бросок, и останавливается
            const q = Math.sin(k * Math.PI);
            T.rs = 3.45 - 1.0 * q; T.ra = 0.22; T.re = 0.85 - 0.6 * q; T.ls = 1.8; T.la = 0.5; T.le = 0.2;
            T.yaw = 0.7 - 0.9 * q; T.pitch = -0.08 + 0.3 * q; fast = true;
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
      rig.neck.rotation.z = j.pitch * 0.85;
      if (ball) {
        const a = Math.atan2(ball.pos.z - this.z, ball.pos.x - this.x);
        const d = Math.max(-1.1, Math.min(1.1, angNorm(-(a - this.heading))));
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
