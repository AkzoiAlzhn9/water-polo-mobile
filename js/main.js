// Запуск: сцена, демо-матч под меню, игровой цикл с фиксированным шагом физики 1/120 с.
(function () {
  const STEP = 1 / 120;
  const V = new THREE.Vector3();
  const FOCUS = new THREE.Vector3();
  const CAMS = ['tv', 'high', 'end', 'close'];
  const CAM_NAMES = { tv: 'Общий план', high: 'Сверху', end: 'Из-за ворот', close: 'Ближе' };
  let world, match, paused = false, acc = 0, last = performance.now(), timeScale = 1, isDemo = true, lastCfg = null, camIdx = 0;
  // Камера: выбор запоминается; на телефоне по умолчанию «Ближе» — на маленьком экране игроки иначе слишком мелкие
  try { const c = localStorage.getItem('polo25_cam'); camIdx = c !== null ? Math.max(0, +c) : (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 3 : 0); } catch (e) { camIdx = 0; }

  // ---------- Повтор гола: запись поз скелетов 30 раз в секунду и замедленное воспроизведение ----------
  const QA = new THREE.Quaternion(), QB = new THREE.Quaternion();
  const Replay = {
    buf: [], lastT: -1, active: false, pending: null, frames: null, t: 0, speed: 0.45, angle: 0, prevCam: 'tv',
    reset() { this.buf.length = 0; this.lastT = -1; this.active = false; this.pending = null; },
    capture(m) {
      if (this.active || m.t - this.lastT < 1 / 30) return;
      this.lastT = m.t;
      const rigs = [], d = [];
      const q = (qq) => d.push(qq.x, qq.y, qq.z, qq.w);
      for (const p of m.all()) {
        const r = p.rig; if (!r) continue;
        rigs.push(r);
        d.push(r.root.position.x, r.root.position.y, r.root.position.z, r.root.rotation.y, r.body.position.y);
        q(r.body.quaternion); q(r.neck.quaternion);
        for (const a of [r.aR, r.aL]) { q(a.sh.quaternion); d.push(a.el.rotation.z); }
        for (const l of [r.lR, r.lL]) { q(l.hip.quaternion); d.push(l.kn.rotation.z); }
      }
      const b = m.ball.mesh; d.push(b.position.x, b.position.y, b.position.z); q(b.quaternion);
      this.buf.push({ t: m.t, rigs, d: Float32Array.from(d) });
      while (this.buf.length && m.t - this.buf[0].t > 7) this.buf.shift();
    },
    apply(fa, fb, k) {
      const same = fb && fb.rigs.length === fa.rigs.length && fa.rigs.every((r, i) => r === fb.rigs[i]);
      const A = fa.d, B = same ? fb.d : fa.d;
      const L = (i) => A[i] + (B[i] - A[i]) * k;
      const Q = (target, i) => { QA.set(A[i], A[i + 1], A[i + 2], A[i + 3]); QB.set(B[i], B[i + 1], B[i + 2], B[i + 3]); target.slerpQuaternions(QA, QB, k); };
      let o = 0;
      for (const r of fa.rigs) {
        r.root.position.set(L(o), L(o + 1), L(o + 2));
        r.root.rotation.y = A[o + 3] + WP.angNorm(B[o + 3] - A[o + 3]) * k;
        r.body.position.y = L(o + 4); o += 5;
        Q(r.body.quaternion, o); o += 4; Q(r.neck.quaternion, o); o += 4;
        for (const a of [r.aR, r.aL]) { Q(a.sh.quaternion, o); o += 4; a.el.rotation.z = L(o); o++; }
        for (const l of [r.lR, r.lL]) { Q(l.hip.quaternion, o); o += 4; l.kn.rotation.z = L(o); o++; }
      }
      const bm = match.ball.mesh;
      bm.position.set(L(o), L(o + 1), L(o + 2)); Q(bm.quaternion, o + 3);
      return bm.position;
    },
    start() {
      const p = this.pending; this.pending = null;
      const ok = this.startAt(p.goalT, p.side, 'ПОВТОР', null);
      if (!ok && this.restoreCam) { world.setCamMode(this.restoreCam); this.restoreCam = null; }
    },
    startAt(t0, sideIn, label, onEnd) {
      const fr = this.buf.filter(f => f.t >= t0 - 3.6 && f.t <= t0 + 0.7);
      if (fr.length < 20) return false;
      const p = { side: sideIn };
      this.onEnd = onEnd;
      this.frames = fr; this.t = fr[0].t; this.active = true;
      this.angle = (this.angle + 1) % 2;
      const side = p.side, bz = fr[Math.floor(fr.length * 0.3)].d;
      world.replayPos = this.angle === 0
        ? new THREE.Vector3(side * (WP.R.HALF_L + 6.5), 4.3, 3.2)
        : new THREE.Vector3(side * (WP.R.HALF_L - 5.5), 1.3, 7.5);
      this.prevCam = this.restoreCam || world.camMode;
      this.restoreCam = null;
      world.setCamMode('replay');
      world.camPos.copy(world.replayPos);
      for (const k in match.rings) match.rings[k].visible = false;
      for (const k in match.thruMk) match.thruMk[k].g.visible = false;
      for (const k in match.markers) match.markers[k].arrow.visible = match.markers[k].ret.visible = false;
      WP.UI.replay(true, label);
      return true;
    },
    stop() {
      this.active = false; this.frames = null;
      world.setCamMode(this.prevCam);
      WP.UI.replay(false);
      acc = 0;
      const cb = this.onEnd; this.onEnd = null;
      if (cb) cb();
    },
    update(dt) {
      this.t += dt * this.speed;
      const fr = this.frames;
      if (this.t >= fr[fr.length - 1].t) { this.stop(); return null; }
      let i = 0;
      while (i < fr.length - 2 && fr[i + 1].t <= this.t) i++;
      const k = Math.max(0, Math.min(1, (this.t - fr[i].t) / (fr[i + 1].t - fr[i].t || 1)));
      return this.apply(fr[i], fr[i + 1], k);
    },
  };
  function hookReplay(m) {
    Replay.reset();
    const uiEmit = m.emit;
    m.emit = (kind, data) => {
      uiEmit(kind, data);
      if (isDemo || m.cfg.tutorial || m.cfg.net) return;
      if (kind === 'goal' && !m.so) {
        Replay.pending = { at: m.t + 1.5, goalT: m.t, side: data.team.dir };
        // Режиссура: сначала крупный план забившего
        if (data.scorer && data.scorer.rig) {
          Replay.restoreCam = world.camMode === 'focus' ? Replay.restoreCam : world.camMode;
          world.focusPlayer = data.scorer; world.focusSide = data.team.dir;
          world.setCamMode('focus');
        }
      }
      if (kind === 'var' && data.phase === 'start') {
        Replay.pending = null;
        if (world.camMode === 'focus') { world.setCamMode(Replay.restoreCam || CAMS[camIdx]); Replay.restoreCam = null; }
        const ok = Replay.startAt(data.t, data.side, 'VAR · ПРОВЕРКА', () => m.resolveChallenge());
        if (!ok) setTimeout(() => m.resolveChallenge(), 1500);
      }
    };
  }

  let tapped = false;
  window.addEventListener('pointerdown', () => { tapped = true; });

  function boot() {
    try {
      world = new WP.World(document.getElementById('stage'));
    } catch (e) {
      document.getElementById('menu').innerHTML = '<div class="menu-panel"><h1 class="title">WATER POLO<span>MOBILE</span></h1><p class="lede">Не удалось запустить WebGL. Откройте страницу в свежем Chrome, Safari или Firefox с включённым аппаратным ускорением.</p></div>';
      return;
    }
    WP.UI.init({ start, pause: togglePause, cam: cycleCam, mute: toggleMute, restart, menu: startDemo, demoNext: startDemo, career: openCareer, careerReturn: backToCareer, tutorial: startTutorial, gfx: setGfx, online: () => WP.Net.openLobby() });
    WP.Net.bindUi();
    WP.Net.start();
    WP.Net.setHooks({ start, beforeJoin: () => { if (match && !isDemo && !(match.cfg.net)) startDemo(); }, notice: (text) => { if (match && match.cfg.net) match.emit('banner', { title: 'ОНЛАЙН', sub: text, tone: 'neutral' }); }, left: (text) => { if (match && match.cfg.net) { if (WP.Net.role === 'host') match.teams[1].human = null; match.emit('banner', { title: 'ОНЛАЙН', sub: text, tone: 'red' }); if (WP.Net.role === 'guest') setTimeout(startDemo, 3500); } } });
    setGfx(WP.UI.gfx);
    WP.Career.setHooks({ play: (cfg) => start(cfg), menu: () => WP.UI.showMenu(true) });
    WP.UI.setMuteIcon(WP.Audio.muted);
    startDemo();
    requestAnimationFrame(loop);
  }

  // ---------- обучение ----------
  function startTutorial() {
    const t1 = WP.TEAMS.find(t => t.code === 'AS1') || WP.TEAMS[0], t2 = WP.TEAMS.find(t => t.code === 'AS2') || WP.TEAMS[1];
    start({ home: t1, away: t2, mode: '1p', humanSide: 0, periodMin: 8, difficulty: 0, shootout: false, tutorial: true });
    document.getElementById('lineup').hidden = true;
    match.begin();
    WP.Tutorial.start(match, { touch: !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches), onExit: startDemo });
  }

  // ---------- качество графики: «авто» подстраивает разрешение под частоту кадров ----------
  let gfxMode = 'auto', pr = 1, prMax = 1, fpsAvg = 60, fpsT = 0;
  function setGfx(mode) {
    gfxMode = mode || 'auto';
    prMax = Math.min(window.devicePixelRatio || 1, 2);
    pr = gfxMode === 'low' ? Math.min(prMax, 0.85) : prMax;
    if (world) world.setQuality(pr, gfxMode === 'low');
  }
  function autoQuality(dt) {
    if (gfxMode !== 'auto' || dt > 0.2 || document.hidden) return;
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
    fpsT += dt;
    if (fpsT < 2.5) return;
    let np = pr;
    if (fpsAvg < 42 && pr > 0.7) np = Math.max(0.7, pr - 0.25);
    else if (fpsAvg > 57 && pr < prMax) np = Math.min(prMax, pr + 0.25);
    if (np !== pr) { pr = np; world.setQuality(pr, pr < 1); fpsT = 0; } else fpsT = 1.5;
  }

  function startDemo() {
    if (WP.Tutorial.active) WP.Tutorial.stop();
    if (WP.Net.role) WP.Net.leave();
    WP.Net.setStatus('menu');
    if (match) match.dispose();
    const a = Math.floor(Math.random() * 7);
    let b; do { b = Math.floor(Math.random() * 9); } while (b === a);
    match = new WP.Match(world, { home: WP.TEAMS[a], away: WP.TEAMS[b], mode: 'demo', humanSide: 0, periodMin: 8, difficulty: 1, shootout: true });
    isDemo = true; paused = false;
    WP.UI.bind(match, true);
    hookReplay(match);
    WP.UI.showMenu(true);
    world.setCamMode('orbit');
    match.begin();
  }

  function start(cfg) {
    if (WP.Tutorial.active) WP.Tutorial.stop();
    lastCfg = cfg;
    if (document.activeElement) document.activeElement.blur();
    if (match) match.dispose();
    match = new WP.Match(world, cfg);
    isDemo = false; paused = false; acc = 0;
    WP.UI.showMenu(false);
    WP.UI.bind(match, false);
    hookReplay(match);
    world.setCamMode(CAMS[camIdx]);
    if (!cfg.net) WP.Net.setStatus('solo');
    // Онлайн: без представления составов, хозяин сразу начинает, гость только рисует снимки
    if (cfg.net) {
      if (cfg.net.role === 'host') { WP.Net.attachHost(match); match.begin(); }
      else WP.Net.attachGuest(match);
      match.emit('banner', { title: 'ОНЛАЙН-МАТЧ', sub: match.teams[0].name + ' — ' + match.teams[1].name, tone: 'goal' });
      return;
    }
    WP.UI.showLineup(match);
  }

  function restart() { if (lastCfg) start(lastCfg); }

  // ---------- карьера ----------
  function openCareer() {
    if (!isDemo) startDemo();
    WP.UI.showMenu(false);
    document.getElementById('hud').hidden = true;
    document.body.classList.remove('playing');
    WP.Career.open();
  }
  function backToCareer(simRest) {
    const m = match;
    if (m && m.cfg.career) WP.Career.finishMatch(m, { simRest: !!simRest });
    paused = false; WP.UI.showPause(false);
    Replay.reset();
    openCareer();
  }

  function togglePause() {
    if (isDemo || !match || match.state === 'final') return;
    paused = !paused;
    WP.UI.showPause(paused);
  }

  function cycleCam() {
    if (isDemo) return;
    camIdx = (camIdx + 1) % CAMS.length;
    try { localStorage.setItem('polo25_cam', camIdx); } catch (e) { /* без хранилища */ }
    world.setCamMode(CAMS[camIdx]);
    if (match) match.emit('banner', { title: 'Камера: ' + CAM_NAMES[CAMS[camIdx]], sub: '', tone: '' });
  }

  function toggleMute() { WP.Audio.init(); WP.Audio.setMuted(!WP.Audio.muted); WP.UI.setMuteIcon(WP.Audio.muted); }

  function toWorld(inp) {
    world.camera.getWorldDirection(V);
    let fx = V.x, fz = V.z;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const rx = -fz, rz = fx;
    return {
      x: rx * inp.ax + fx * inp.ay, z: rz * inp.ax + fz * inp.ay, mag: inp.mag, sprint: inp.sprint, sprintK: inp.sprintK,
      pass: inp.pass, passD: inp.passD, shootP: inp.shootP, shootD: inp.shootD, lob: inp.lob, skipP: inp.skipP, skipD: inp.skipD, timeout: inp.timeout, fake: inp.fake, fakeD: inp.fakeD, foul: inp.foul, foulD: inp.foulD, play: inp.play, sub: inp.sub, thru: inp.thru, thruD: inp.thruD, thruUp: inp.thruUp, lobpass: inp.lobpass, passGest: inp.passGest, shootGest: inp.shootGest, challenge: inp.challenge,
    };
  }
  function clearEdges(i) { if (i) { i.pass = i.shootP = i.lob = i.skipP = i.timeout = i.fake = i.foul = i.play = i.sub = i.thru = i.lobpass = i.challenge = false; i.passGest = i.shootGest = null; } }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    frame(dt);
  }

  function frame(dt) {
    const inp = WP.Input.poll(match ? match.cfg.mode : '1p');
    if (inp.anyKey) WP.Audio.init();
    if (Replay.active) {
      if (inp.anyKey || tapped) Replay.stop();
      tapped = false;
      if (Replay.active) {
        world.update(dt * Replay.speed);
        const bp = Replay.update(dt);
        if (bp) world.updateCamera(dt, bp, {});
        WP.UI.update(match, 0, world.camera);
        world.render();
        return;
      }
    }
    tapped = false;
    if (inp.pause) { if (WP.UI.helpOpen) WP.UI.closeHelp(); else if (WP.UI.ctlOpen) WP.UI.showCtl(false); else if (WP.UI.tacOpen) WP.UI.showTactics(false); else togglePause(); }
    if (inp.p1 && inp.p1.tac && match && !isDemo && match.state !== 'final') { if (!paused) togglePause(); WP.UI.showTactics(true); }
    if (inp.cam) cycleCam();
    if (inp.mute) toggleMute();
    autoQuality(dt);
    WP.Tutorial.update(dt, paused);
    const net = match && match.cfg.net;
    // Гость онлайн-матча ничего не считает: применяем снимки хозяина и отправляем свой ввод
    if (net && net.role === 'guest') WP.Net.guestFrame(match, paused ? null : toWorld(inp.p1));
    // Онлайн-матч не останавливается на паузе: соперник продолжает играть
    else if (match && (!paused || net) && !(net && WP.Net.hostWaiting())) {
      match.inputs.p1 = isDemo || paused ? null : toWorld(inp.p1);
      match.inputs.p2 = net ? WP.Net.hostInput(match) : !isDemo && inp.p2 ? toWorld(inp.p2) : null;
      acc += dt * (match.ffOn ? 10 : timeScale);
      let n = 0;
      while (acc >= STEP && n < 60) {
        match.step(STEP); acc -= STEP; n++;
        clearEdges(match.inputs.p1); clearEdges(match.inputs.p2);
      }
      if (n >= 60) acc = 0;
      if (net) WP.Net.hostFrame(match);
    }
    const vdt = paused && !net ? 0 : dt * Math.min(match && match.ffOn ? 10 : timeScale, 4);
    world.update(vdt);
    if (match) {
      match.syncVisuals(vdt);
      if (!paused && !net) Replay.capture(match);
      if (Replay.pending && match.ffOn) Replay.pending = null;
      if (Replay.pending && match.t >= Replay.pending.at) Replay.start();
      const b = match.ball.pos;
      FOCUS.set(Math.max(-11, Math.min(11, b.x)), 0, Math.max(-8, Math.min(8, b.z)));
      const ht = match.teams.find(t => t.human === 'p1');
      // Пенальти с участием человека: камера из-за спины бьющего, лицом к воротам (лево/право на экране = в воротах)
      const rsP = match.restart;
      if (match.state === 'penalty' && rsP && rsP.ready && (rsP.team.human || rsP.team.opp.human)) world.penCam = { gx: rsP.team.dir * WP.R.HALF_L, dir: rsP.team.dir, until: match.t + 1.8 };
      else if (world.penCam && (match.t > world.penCam.until || match.t < world.penCam.until - 3)) world.penCam = null;
      world.updateCamera(dt, FOCUS, { dir: ht ? ht.dir : 1 });
    }
    const cv = world.canvas;
    world.camera.userData.w = cv.clientWidth; world.camera.userData.h = cv.clientHeight;
    WP.UI.update(match, dt, world.camera);
    world.render();
  }

  WP.debug = {
    speed(s) { timeScale = s; },
    // Камера для осмотра моделей: cam(игрок, угол, расстояние, высота, высота взгляда); cam() — вернуть обычную
    cam(p, ang, dist, h, lookY) {
      if (!p) { world.camOverride = null; return; }
      const a = p.heading + (ang || 0), d = dist || 2.6;
      world.camOverride = { pos: new THREE.Vector3(p.x + Math.cos(a) * d, h || 1.1, p.z + Math.sin(a) * d), look: new THREE.Vector3(p.x, lookY || 0.6, p.z) };
    },
    get match() { return match; },
    get world() { return world; },
    sim(seconds) { for (let i = 0; i < seconds * 120; i++) match.step(STEP); },
    frames(n, dt) { for (let i = 0; i < n; i++) frame(dt || 1 / 60); },
    get replay() { return Replay; },
    // Стенд: n бросков с дистанции dist (м), смещение z, тип броска → исходы
    shots(n, dist, zOff, kind) {
      const m = match, res = { goal: 0, save: 0, miss: 0, onT: 0 };
      const att = m.teams[0], def = m.teams[1];
      for (let i = 0; i < n; i++) {
        m.state = 'live'; m.restart = null; m.so = null; m.clock = 400; m.shotClock = 20; m.possession = att; m.shotReset = null;
        att.dir = 1; def.dir = -1;
        for (const p of m.all()) { p.x = -9 + Math.random() * 2; p.z = (Math.random() - 0.5) * 16; p.vx = p.vz = 0; p.action = null; p.excluded = false; p.outForGame = false; p.hasBall = false; p.save = null; p.gkHandActive = false; p.stealCD = 5; p.catchCD = 0; }
        const gk = def.gk; gk.x = WP.R.HALF_L - 0.7; gk.z = zOff * 0.1; gk.lift = 0.7; gk.biteT = 0; gk.liftTarget = 0.7; gk.unset = 0; gk.gkAng = undefined;
        const s = att.players.find(p => !p.isGK); s.x = WP.R.HALF_L - dist; s.z = zOff; s.heading = Math.atan2(-zOff, dist); s.lift = 0.2;
        m.ball.attach(s); s.holdMode = 'hold'; s.decideT = 99;
        const side = Math.random() < 0.5 ? -1 : 1;
        m.startShot(s, { type: kind || 'power', ai: true, zAim: side * (1.0 + Math.random() * 0.32) * WP.R.GOAL_HALF_W / 1.5, yAim: Math.random() < 0.62 ? 0.62 + Math.random() * 0.18 : 0.15 + Math.random() * 0.17, power: 0.72 + Math.random() * 0.28 });
        let f = null;
        for (let k = 0; k < 480; k++) {
          m.step(STEP);
          if (!f && m.ball.flight && m.ball.flight.type === 'shot') f = m.ball.flight;
          if (m.state !== 'live' || m.ball.holder === gk || (f && m.ball.state === 'free' && m.t - m.ball.releaseT > 2.2)) break;
        }
        if (f && f.onTarget) res.onT++;
        if (m.state === 'goal') { res.goal++; att.score--; }
        else if (f && (f.touched || m.ball.holder === gk || m.ball.lastTouch === gk)) res.save++;
        else res.miss++;
      }
      return res;
    },
    // Стенд перепаса: резкий пас поперёк ворот на дистанции dist и бросок через wait с после приёма → исходы
    xpass(n, dist, wait, kind) {
      const m = match, res = { goal: 0, save: 0, miss: 0, lag: 0 };
      const att = m.teams[0], def = m.teams[1];
      for (let i = 0; i < n; i++) {
        m.state = 'live'; m.restart = null; m.so = null; m.clock = 400; m.shotClock = 20; m.possession = att; m.shotReset = null;
        att.dir = 1; def.dir = -1;
        for (const p of m.all()) { p.x = -9 + Math.random() * 2; p.z = (Math.random() - 0.5) * 16; p.vx = p.vz = 0; p.action = null; p.excluded = false; p.outForGame = false; p.hasBall = false; p.save = null; p.gkHandActive = false; p.stealCD = 5; p.catchCD = 0; p.decideT = 99; }
        const fs = att.players.filter(p => !p.isGK), a = fs[0], b = fs[1], side = Math.random() < 0.5 ? -1 : 1;
        a.x = WP.R.HALF_L - dist; a.z = 2.4 * side; b.x = WP.R.HALF_L - dist; b.z = -2.4 * side;
        a.heading = Math.atan2(-a.z, dist); b.heading = Math.atan2(-b.z, dist);
        const gk = def.gk, gi = WP.AI.gkIdeal(def, a.x, a.z, false);
        gk.x = gi.x; gk.z = gi.z; gk.lift = 0.72; gk.biteT = 0; gk.unset = 0; gk.gkAng = undefined;
        m.ball.attach(a); a.holdMode = 'hold';
        for (let k = 0; k < 60; k++) { m.step(STEP); att.ai.phaseT = 99; }
        gk.unset = 0; b.xpTry = false;
        m.doPass(a, b, { power: 0.75 });
        let caught = -1, shot = false, f = null, lag = 0;
        for (let k = 0; k < 900; k++) {
          m.step(STEP);
          b.decideT = 99; a.decideT = 99; att.ai.phaseT = 99; b.xpTry = false;
          if (caught < 0 && m.ball.holder === b) caught = m.t;
          if (caught >= 0 && !shot && m.t - caught >= wait && (!b.action || b.action.type === 'catch')) {
            b.action = null; shot = true;
            const sd = gk.vz > 0.2 ? -1 : gk.vz < -0.2 ? 1 : (gk.z > b.z * 0.12 ? -1 : 1);
            m.startShot(b, { type: kind || 'power', ai: true, quick: wait < 0.3, zAim: sd * (1.0 + Math.random() * 0.32) * WP.R.GOAL_HALF_W / 1.5, yAim: Math.random() < 0.62 ? 0.62 + Math.random() * 0.18 : 0.15 + Math.random() * 0.17, power: 0.72 + Math.random() * 0.28 });
          }
          if (!f && m.ball.flight && m.ball.flight.type === 'shot') { f = m.ball.flight; lag += gk.save ? gk.save.lag || 0 : 0; }
          if (caught < 0 && m.ball.holder && m.ball.holder !== a) break;
          if (m.state !== 'live' || m.ball.holder === gk || (f && m.ball.state === 'free' && m.t - m.ball.releaseT > 2.2)) break;
        }
        res.lag += lag;
        if (m.state === 'goal') { res.goal++; att.score--; }
        else if (f && (f.touched || m.ball.holder === gk || m.ball.lastTouch === gk)) res.save++;
        else res.miss++;
      }
      res.lag = +(res.lag / n).toFixed(2);
      return res;
    },
  };
  boot();
})();
