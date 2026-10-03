// Мяч: полёт с сопротивлением воздуха, рикошет от воды, плавучесть, штанги, перекладина, сетка.
(function () {
  const R = WP.R;
  const V = new THREE.Vector3();

  function ballTexture() {
    return WP.canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#f5cf1d'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1d3f9a'; g.lineWidth = 9;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = h / 2 + Math.sin(x / w * Math.PI * 4 + k * 2.1) * h * 0.32;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
  }

  // Подбор начальной скорости с учётом гравитации и сопротивления воздуха
  WP.solveThrow = function (from, to, speed, high) {
    const g = R.G;
    const aim = to.clone();
    const vel = new THREE.Vector3();
    for (let it = 0; it < 4; it++) {
      const dx = aim.x - from.x, dz = aim.z - from.z, dy = aim.y - from.y;
      const d = Math.hypot(dx, dz) || 1e-6;
      let v = speed;
      let disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
      while (disc < 0) { v *= 1.08; disc = v ** 4 - g * (g * d * d + 2 * dy * v * v); }
      const tanT = (v * v + (high ? 1 : -1) * Math.sqrt(disc)) / (g * d);
      const th = Math.atan(tanT);
      const vh = v * Math.cos(th);
      vel.set(dx / d * vh, v * Math.sin(th), dz / d * vh);
      const p = from.clone(), vv = vel.clone();
      const h = 1 / 240;
      let arrived = null;
      for (let i = 0; i < 1200; i++) {
        const sp = vv.length();
        vv.x -= R.DRAG * sp * vv.x * h; vv.y -= (R.DRAG * sp * vv.y + g) * h; vv.z -= R.DRAG * sp * vv.z * h;
        p.addScaledVector(vv, h);
        const along = ((p.x - from.x) * dx + (p.z - from.z) * dz) / d;
        if (along >= d || p.y < -0.5) { arrived = p.clone(); break; }
      }
      if (!arrived) break;
      const along = ((arrived.x - from.x) * dx + (arrived.z - from.z) * dz) / d;
      if (along < d * 0.98) { aim.y += (to.y - arrived.y) * 0.5 + 0.3; continue; }
      aim.x += to.x - arrived.x; aim.z += to.z - arrived.z; aim.y += to.y - arrived.y;
    }
    return vel;
  };

  // «Парашют»: задаём высоту верхней точки, горизонтальную скорость подбираем с учётом сопротивления
  WP.solveLob = function (from, to, apex) {
    const g = R.G, h = 1 / 240;
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1e-6;
    const vy = Math.sqrt(2 * g * Math.max(0.2, apex - from.y));
    let vh = d / (vy / g + Math.sqrt(2 * Math.max(0.05, apex - to.y) / g));
    const vel = new THREE.Vector3();
    for (let it = 0; it < 5; it++) {
      vel.set(dx / d * vh, vy, dz / d * vh);
      const p = from.clone(), v = vel.clone();
      for (let i = 0; i < 1200; i++) {
        const sp = v.length();
        v.x -= R.DRAG * sp * v.x * h; v.y -= (R.DRAG * sp * v.y + g) * h; v.z -= R.DRAG * sp * v.z * h;
        p.addScaledVector(v, h);
        if (v.y < 0 && p.y <= to.y) break;
      }
      const along = ((p.x - from.x) * dx + (p.z - from.z) * dz) / d;
      vh *= d / Math.max(0.1, along);
    }
    return vel;
  };

  WP.predictBall = function (pos, vel, t) {
    return new THREE.Vector3(pos.x + vel.x * t, Math.max(0.07, pos.y + vel.y * t - 0.5 * R.G * t * t), pos.z + vel.z * t);
  };

  class Ball {
    constructor(world) {
      this.world = world;
      // Мокрый мяч: лаковый блик поверх шершавой «грип»-поверхности
      const grip = WP.canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < 0.5 ? '#b0b0b0' : '#505050'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 0.9, 0, 6.3); g.fill(); }
      });
      grip.colorSpace = THREE.NoColorSpace;
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R.BALL_R, 32, 20), WP.underwaterify(new THREE.MeshPhysicalMaterial({ map: ballTexture(), bumpMap: grip, bumpScale: 0.6, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.1 }), 0.7));
      world.scene.add(this.mesh);
      this.pos = new THREE.Vector3(0, 0.07, 0);
      this.vel = new THREE.Vector3();
      this.holder = null;
      this.state = 'dead';
      this.lastTouch = null;
      this.flight = null;
      this.inGoal = 0;
      this.releaseT = 0;
      this.events = [];
    }

    place(x, z) {
      if (this.holder) this.holder.hasBall = false;
      this.holder = null; this.state = 'dead';
      this.pos.set(x, 0.07, z); this.vel.set(0, 0, 0); this.flight = null; this.inGoal = 0;
    }

    attach(p) {
      if (this.holder && this.holder !== p) this.holder.hasBall = false;
      this.holder = p; p.hasBall = true; this.state = 'held';
      this.vel.set(0, 0, 0); this.flight = null; this.inGoal = 0;
      this.lastTouch = p;
    }

    release(vel, flight) {
      const p = this.holder;
      if (p) { p.hasBall = false; this.lastTouch = p; }
      this.holder = null; this.state = 'free';
      this.vel.copy(vel); this.flight = flight || null; this.inGoal = 0;
    }

    step(dt, colliders) {
      const ev = this.events; ev.length = 0;
      if (this.state === 'held') { this.holder.ballHoldPos(this.pos); return ev; }
      if (this.state === 'dead') { this.pos.y = 0.07 + this.world.waveHeight(this.pos.x, this.pos.z); return ev; }
      const sub = 3, h = dt / sub;
      for (let s = 0; s < sub; s++) {
        this.integrate(h, ev);
        this.collideGoals(ev);
        if (colliders) for (const c of colliders) this.collideSphere(c, ev);
        if (this.checkBounds(ev)) break;
      }
      return ev;
    }

    integrate(h, ev) {
      const p = this.pos, v = this.vel;
      const floatY = 0.07 + this.world.waveHeight(p.x, p.z);
      if (p.y > floatY + 0.02 || v.y > 0.3) {
        const sp = v.length();
        v.x -= R.DRAG * sp * v.x * h; v.z -= R.DRAG * sp * v.z * h;
        v.y -= (R.DRAG * sp * v.y + R.G) * h;
        p.addScaledVector(v, h);
        if (p.y <= floatY && v.y < 0) {
          const vh = Math.hypot(v.x, v.z), vy = -v.y;
          if (vh > 7 && vy < vh * 0.42 && this.inGoal === 0) {
            v.y = vy * 0.48; v.x *= 0.8; v.z *= 0.8;
            v.x += (Math.random() - 0.5) * 0.6; v.z += (Math.random() - 0.5) * 0.6;
            p.y = floatY + 0.001;
            ev.push({ type: 'skip', speed: vh });
          } else {
            p.y = floatY;
            const hard = Math.min(1, (vy + vh * 0.2) / 10);
            v.y = 0; v.x *= 0.45; v.z *= 0.45;
            ev.push({ type: 'water', strength: hard });
          }
        }
      } else {
        p.y += (floatY - p.y) * Math.min(1, h * 12);
        v.y = 0;
        const damp = Math.exp(-2.2 * h);
        v.x *= damp; v.z *= damp;
        p.x += v.x * h; p.z += v.z * h;
      }
    }

    collideGoals(ev) {
      const p = this.pos, v = this.vel, r = R.BALL_R, pr = R.POST_R;
      for (const side of [-1, 1]) {
        const gx = side * R.HALF_L;
        if (Math.abs(p.x - gx) > 1.2) continue;
        for (const zs of [-1, 1]) {
          const pz = zs * (R.GOAL_HALF_W + pr);
          if (p.y > R.GOAL_H + pr + r || p.y < -0.9) continue;
          const dx = p.x - gx, dz = p.z - pz;
          const d = Math.hypot(dx, dz);
          if (d < r + pr) {
            const nx = dx / d, nz = dz / d;
            const vn = v.x * nx + v.z * nz;
            if (vn < 0) { v.x -= 1.6 * vn * nx; v.z -= 1.6 * vn * nz; ev.push({ type: 'post', speed: -vn, side }); }
            p.x = gx + nx * (r + pr + 0.001); p.z = pz + nz * (r + pr + 0.001);
          }
        }
        if (Math.abs(p.z) < R.GOAL_HALF_W + pr) {
          const by = R.GOAL_H + pr;
          const dx = p.x - gx, dy = p.y - by;
          const d = Math.hypot(dx, dy);
          if (d < r + pr) {
            const nx = dx / d, ny = dy / d;
            const vn = v.x * nx + v.y * ny;
            if (vn < 0) { v.x -= 1.55 * vn * nx; v.y -= 1.55 * vn * ny; ev.push({ type: 'bar', speed: -vn, side }); }
            p.x = gx + nx * (r + pr + 0.001); p.y = by + ny * (r + pr + 0.001);
          }
        }
        const depth = (p.x - gx) * side;
        const inside = Math.abs(p.z) < R.GOAL_HALF_W && p.y < R.GOAL_H;
        if (this.inGoal === 0 && inside && depth > r && depth < R.GOAL_DEPTH + 0.3) {
          this.inGoal = side;
          ev.push({ type: 'goal', side });
        }
        if (this.inGoal === side) {
          if (depth > R.GOAL_DEPTH - r) { p.x = gx + side * (R.GOAL_DEPTH - r); if (v.x * side > 0) { v.x *= -0.15; ev.push({ type: 'net' }); } v.z *= 0.5; v.y *= 0.5; }
          if (Math.abs(p.z) > R.GOAL_HALF_W - r) { p.z = Math.sign(p.z) * (R.GOAL_HALF_W - r); v.z *= -0.2; }
          if (p.y > R.GOAL_H - r) { p.y = R.GOAL_H - r; v.y = Math.min(0, v.y) * 0.2; }
          if (depth < r) { p.x = gx + side * r; v.x = Math.abs(v.x) * side * 0.1; }
        }
      }
    }

    // Сфера-коллайдер: {pos, r, owner, kind:'gk'|'block'|'body'}
    collideSphere(c, ev) {
      const p = this.pos, v = this.vel;
      const d = V.subVectors(p, c.pos);
      const dist = d.length(), min = c.r + R.BALL_R;
      if (dist >= min || dist < 1e-5) return;
      d.divideScalar(dist);
      const vn = v.dot(d);
      if (vn >= 0) return;
      const speed = v.length();
      ev.push({ type: 'hit', collider: c, speed, normal: d.clone() });
      const e = c.kind === 'gk' ? 0.32 : 0.28;
      v.addScaledVector(d, -(1 + e) * vn);
      v.multiplyScalar(c.kind === 'gk' ? 0.62 : 0.55);
      v.x += (Math.random() - 0.5) * 1.2; v.z += (Math.random() - 0.5) * 1.2;
      p.copy(c.pos).addScaledVector(d, min + 0.002);
    }

    checkBounds(ev) {
      const p = this.pos;
      if (this.inGoal) return false;
      if (Math.abs(p.z) > R.HALF_W + R.BALL_R) { ev.push({ type: 'out', where: 'side', x: p.x, z: p.z }); return true; }
      if (Math.abs(p.x) > R.HALF_L + R.BALL_R) {
        if (Math.abs(p.z) < R.GOAL_HALF_W && p.y < R.GOAL_H) return false;
        ev.push({ type: 'out', where: 'goalline', side: Math.sign(p.x), x: p.x, z: p.z });
        return true;
      }
      if (p.y > 16) this.vel.y = -Math.abs(this.vel.y) * 0.3;
      return false;
    }

    render(dt) {
      // В руке мяч рисуется прямо в ладони скелета; после броска за 0,1 с плавно уходит на расчётную траекторию
      const h = this.state === 'held' ? this.holder : null;
      const flick = h && h.action && h.action.opts && h.action.opts.style === 'flick';
      if (h && h.rig && h.rig.aR.hand && h.holdMode !== 'dribble' && !flick) {
        h.rig.aR.hand.getWorldPosition(this.mesh.position);
        this.mesh.position.y += 0.05;
        if (!this.handPos) this.handPos = new THREE.Vector3();
        this.handPos.copy(this.mesh.position); this.handT = 0.1;
      } else if (this.handT > 0 && !h) {
        this.handT -= dt;
        this.mesh.position.copy(this.pos).lerp(this.handPos, Math.max(0, this.handT / 0.1));
      } else { this.handT = 0; this.mesh.position.copy(this.pos); }
      const sp = this.state === 'held' ? 0 : this.vel.length();
      if (sp > 0.05 && dt > 0) {
        V.set(this.vel.z, 0, -this.vel.x).normalize();
        this.mesh.rotateOnWorldAxis(V, -sp * dt / R.BALL_R * 0.6);
      }
    }
  }

  WP.Ball = Ball;
})();
