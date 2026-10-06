// Матч: состояние игры, часы, судейство по правилам World Aquatics, статистика, серия пенальти.
(function () {
  const R = WP.R, AI = WP.AI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ≈ N(0, 1)
  // Пас в разрез: короче этого нажатие — тап (пас сразу), дольше — прицел
  const THRU_TAP = 0.18;
  const THRU_OPEN = 0x3ddc84, THRU_HOT = 0xff9f1c; // кольцо: партнёр успевает первым / мяч спорный
  const TE = { x: 0, z: 0, d: 0, margin: 0, lane: 0, vg: 0, s: 0, ok: false, open: false }; // черновик оценки без выделения памяти

  const AI_LEVELS = [
    { decision: 0.85, noise: 2.0, patience: 0.03, errMul: 1.25, aggr: 0.45, shift: -8, gkMul: 0.93, sag: 0.7, fakes: 0.5 },
    { decision: 0.6, noise: 1.0, patience: 0.0, errMul: 1.0, aggr: 0.6, shift: 0, gkMul: 1.0, sag: 1.0, fakes: 1.0 },
    { decision: 0.45, noise: 0.6, patience: -0.01, errMul: 0.9, aggr: 0.7, shift: 5, gkMul: 1.04, sag: 1.1, fakes: 1.3 },
  ];

  class Team {
    constructor(match, def, side, level) {
      this.match = match; this.def = def; this.side = side;
      this.code = def.code; this.name = def.name;
      this.dir = side === 0 ? 1 : -1;
      this.capHex = side === 0 ? '#f3f5f7' : '#1f4fd1';
      this.numHex = side === 0 ? '#13264a' : '#ffffff';
      this.suitHex = def.color;
      this.score = 0; this.timeouts = R.TIMEOUTS; this.challenges = 1;
      this.human = null;
      this.aiAcc = Math.random() * 0.15;
      const L = AI_LEVELS[level];
      this.ai = { phase: 'loose', phaseT: 0, lastSolid: 'defense', dirty: true, decision: L.decision, noise: L.noise, patience: L.patience, errMul: L.errMul, aggr: L.aggr, gkMul: L.gkMul, sag: L.sag, fakes: L.fakes };
      // Тактика: у ИИ зависит от стиля команды, у человека выбирается в меню «Тактика и замены»
      const st = def.style || {}, hv = WP.hash(def.code + 'tac');
      this.tac = {
        att: st.pas ? 'arc' : hv < 0.18 ? '42' : hv < 0.5 ? 'arc' : '33',
        pp: hv > 0.8 ? '33' : '42',
        def: st.def ? 'mdrop' : hv > 0.86 ? 'zone' : 'man',
        move: 'hold', autoSubs: true,
      };
      this.stats = { shots: 0, onTarget: 0, saves: 0, exclEarned: 0, exclCommitted: 0, ppGoals: 0, ppAtt: 0, penEarned: 0, penGoals: 0, steals: 0, blocks: 0, fouls: 0, turnovers: 0, counterGoals: 0 };
      // В карьере атрибуты и стартовая семёрка приходят готовыми (info[6], def.starters)
      const roster = def.players.map(info => {
        const attrs = info[6] ? Object.assign({}, info[6]) : WP.makeAttrs(def, info, def.career ? 0 : L.shift);
        return { info, attrs, ovr: (attrs.spd + attrs.sht + attrs.acc + attrs.pas + attrs.def + attrs.str) / 6 };
      });
      let gks = roster.filter(r => r.info[2] === 'GK');
      const field = roster.filter(r => r.info[2] !== 'GK').sort((a, b) => b.ovr - a.ovr);
      let start = [];
      if (def.starters && def.starters.length) {
        const sgk = gks.find(r => def.starters.includes(r.info[0]));
        if (sgk) gks = [sgk].concat(gks.filter(r => r !== sgk));
        start = field.filter(r => def.starters.includes(r.info[0])).slice(0, 6);
      }
      if (!start.length) {
        const cf = field.find(r => r.info[2] === 'CF'); if (cf) start.push(cf);
        const cb = field.find(r => r.info[2] === 'CB' && !start.includes(r)); if (cb) start.push(cb);
      }
      for (const r of field) { if (start.length >= 6) break; if (!start.includes(r)) start.push(r); }
      start.sort((a, b) => a.info[0] - b.info[0]);
      this.players = [];
      this.bench = [];
      const world = match.world;
      this.players.push(new WP.Player(world, this, gks[0].info, gks[0].attrs));
      for (const r of start) this.players.push(new WP.Player(world, this, r.info, r.attrs));
      for (const r of roster) if (r !== gks[0] && !start.includes(r)) this.bench.push(new WP.Player(world, this, r.info, r.attrs, true));
      this.outList = [];
      for (const p of this.players) p.played = true;
    }
    get gk() { return this.players.find(p => p.isGK); }
    get roster() { return this.players.concat(this.bench, this.outList); }
  }

  class Match {
    constructor(world, cfg) {
      this.world = world; this.cfg = cfg;
      this.periodLen = cfg.periodMin * 60;
      if (!world.ball) world.ball = new WP.Ball(world);
      this.ball = world.ball;
      const lvHome = cfg.mode === '1p' && cfg.humanSide === 1 ? cfg.difficulty : 1;
      const lvAway = cfg.mode === '1p' && cfg.humanSide === 0 ? cfg.difficulty : 1;
      this.teams = [new Team(this, cfg.home, 0, lvHome), new Team(this, cfg.away, 1, lvAway)];
      this.teams[0].opp = this.teams[1]; this.teams[1].opp = this.teams[0];
      if (cfg.mode === '1p') this.teams[cfg.humanSide].human = 'p1';
      if (cfg.mode === '1p' && cfg.tac) Object.assign(this.teams[cfg.humanSide].tac, cfg.tac);
      if (cfg.mode === '2p') { this.teams[0].human = 'p1'; this.teams[1].human = 'p2'; }
      // Онлайн: хозяин управляет домашней командой, команда гостя получает ввод по сети как второй игрок
      if (cfg.net && cfg.net.role === 'host') this.teams[1].human = 'p2';
      this.period = 1; this.clock = this.periodLen;
      this.shotClock = R.SHOT_CLOCK;
      this.possession = null;
      this.state = 'intro'; this.stateT = 0; this.t = 0;
      this.restart = null; this.shotReset = null; this.pendingEnd = 0;
      this.controlled = { p1: null, p2: null };
      this.inputs = { p1: null, p2: null };
      this.refAcc = 0; this.so = null; this.signals = []; this.dbg = {}; this.lastGoalT = -99;
      this.log = [];
      this.emit = () => {};
      this.rings = {};
      for (const [id, col] of [['p1', 0xffc23a], ['p2', 0x3dd6f5]]) {
        const m = new THREE.Mesh(WP.ringGeo(), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
        m.renderOrder = 3; m.visible = false; world.scene.add(world.overlay(m)); this.rings[id] = m;
      }
      this.teams.forEach((t, i) => world.setBench(i, t.capHex, t.bench.length));
      this.combo = { p1: { stage: 0, t: 0 }, p2: { stage: 0, t: 0 } };
      this.passCharge = { p1: null, p2: null };
      this.markers = {};
      for (const [id, col] of [['p1', 0xffc23a], ['p2', 0x3dd6f5]]) {
        const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92, depthTest: false });
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 14), mat);
        arrow.rotation.x = Math.PI; arrow.renderOrder = 6; arrow.visible = false; world.scene.add(world.overlay(arrow));
        const ret = new THREE.Group();
        ret.add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 8, 32), mat));
        ret.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat));
        ret.children.forEach(c => { c.renderOrder = 6; });
        ret.visible = false; world.scene.add(world.overlay(ret));
        this.markers[id] = { arrow, ret };
      }
      // Прицел паса в разрез: кольцо на воде в точке приёма, дорожка от партнёра, шарик над кольцом — пас верхом
      this.thruAim = { p1: null, p2: null };
      this.thruMk = {};
      for (const id of ['p1', 'p2']) {
        const mat = new THREE.MeshBasicMaterial({ color: THRU_OPEN, transparent: true, opacity: 0.9, depthWrite: false });
        const fill = new THREE.MeshBasicMaterial({ color: THRU_OPEN, transparent: true, opacity: 0.25, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.45, 40).rotateX(-Math.PI / 2), mat);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32).rotateX(-Math.PI / 2), fill);
        const run = new THREE.Mesh(new THREE.BoxGeometry(1, 0.012, 0.07), fill);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat);
        const g = new THREE.Group();
        for (const c of [disc, run, ring, dot]) { c.renderOrder = 3; g.add(c); }
        g.visible = false; world.scene.add(world.overlay(g));
        this.thruMk[id] = { g, ring, disc, run, dot, mat, fill };
      }
      this.colliders = [];
      this.setupSprint(true);
      this.state = 'intro';
    }

    begin() { if (this.state === 'intro') { this.state = 'sprint'; this.stateT = 0; } }

    dispose() {
      for (const t of this.teams) for (const p of t.players) if (p.rig) p.dispose();
      for (const k in this.rings) this.world.scene.remove(this.rings[k]);
      for (const k in this.markers) { this.world.scene.remove(this.markers[k].arrow); this.world.scene.remove(this.markers[k].ret); }
      for (const k in this.thruMk) {
        const tm = this.thruMk[k];
        this.world.scene.remove(tm.g);
        tm.g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        tm.mat.dispose(); tm.fill.dispose();
      }
      this.ball.place(0, 0);
    }

    // ---------- утилиты ----------
    all() { return this.teams[0].players.concat(this.teams[1].players); }
    activeField(team) { let n = 0; for (const p of team.players) if (p.active && !p.isGK) n++; return n; }
    manUp(team) { return this.activeField(team) > this.activeField(team.opp); }
    shotClockLeft() { return this.shotClock; }
    periodName() { return this.so ? 'Серия пенальти' : this.period + '-й период'; }

    say(text, kind) {
      const entry = { t: this.clockLabel(), per: this.period, text, kind: kind || 'info' };
      this.log.push(entry); if (this.log.length > 80) this.log.shift();
      this.emit('log', entry);
    }
    announce(title, sub, tone) { this.emit('banner', { title, sub: sub || '', tone: tone || 'neutral' }); }
    clockLabel() {
      const c = Math.max(0, this.clock);
      if (c < 60) return c.toFixed(1);
      const m = Math.floor(c / 60), s = Math.floor(c % 60);
      return m + ':' + String(s).padStart(2, '0');
    }
    pname(p) { return p.name + ' (' + p.team.code + ', №' + p.num + ')'; }

    setControl(id, p) {
      if (this.cfg.pc && p && p.cid !== this.cfg.pc.pid && p.team.human === id) return;
      const cur = this.controlled[id];
      if (cur === p) return;
      if (cur) { cur.ctrl = null; cur.input.active = false; }
      this.controlled[id] = p;
      if (p) p.ctrl = id;
    }
    nearestTo(team, x, z, pred) {
      let best = null, bd = 1e9;
      for (const p of team.players) {
        if (!p.active || (pred && !pred(p))) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    boundsFor(p) {
      if (p.excluded || p.rolling) return { x0: -14.1, x1: 14.1, z0: -11.1, z1: 9.8 };
      const b = { x0: -R.HALF_L + 0.12, x1: R.HALF_L - 0.12, z0: -R.HALF_W + 0.2, z1: R.HALF_W - 0.2 };
      if (p.isGK) { if (p.team.dir > 0) b.x1 = -0.05; else b.x0 = 0.05; }
      if (this.state === 'dead' && this.restart && this.restart.type === 'throwoff' && this.restart.taker !== p) {
        if (p.team.dir > 0) b.x1 = Math.min(b.x1, -0.4); else b.x0 = Math.max(b.x0, 0.4);
      }
      return b;
    }

    // ---------- постановки ----------
    setupSprint(first) {
      this.state = 'sprint'; this.stateT = 0;
      this.ball.place(0, 0);
      this.possession = null; this.shotReset = null; this.restart = null; this.pendingEnd = 0;
      this.shotClock = R.SHOT_CLOCK;
      const zs = [-2.3, 2.3, -4.2, 4.2, -6.2, 6.2];
      for (const t of this.teams) {
        const gx = -t.dir * (R.HALF_L - 0.25);
        let i = 0;
        const field = t.players.filter(p => !p.isGK).sort((a, b) => b.attrs.spd - a.attrs.spd);
        t.sprinter = field[0];
        for (const p of t.players) {
          p.excluded = false; p.reentryOK = false; p.hardTime = false; p.action = null; p.hasBall = false; p.save = null; p.gkHandActive = false;
          p.vx = p.vz = 0; p.heading = t.dir > 0 ? 0 : Math.PI;
          if (p.isGK) { p.x = gx; p.z = 0; }
        }
        for (const p of field) { p.x = gx; p.z = zs[i++] || 0; }
        for (const p of t.players) p.target = { x: p.x, z: p.z };
        t.ai.phase = 'loose'; t.ai.lastSolid = 'defense'; t.ai.dirty = true; t.ai.phaseT = 0;
        if (t.human) this.setControl(t.human, t.sprinter);
      }
      this.emit('sprint', { period: this.period, first });
    }

    setupThrowOff(team) {
      this.state = 'dead'; this.stateT = 0;
      const taker = team.players.filter(p => p.active && !p.isGK).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
      const spots = [[1.4, 3.2], [1.4, -3.2], [3.6, 6], [3.6, -6], [5, 0], [2.4, 0]];
      for (const t of this.teams) {
        let i = 0;
        for (const p of t.players) {
          if (!p.active) continue;
          p.action = null;
          if (p.isGK) { p.target = { x: -t.dir * (R.HALF_L - 0.6), z: 0 }; continue; }
          if (p === taker) { p.target = { x: 0, z: 0 }; continue; }
          const s = spots[i++ % spots.length];
          p.target = { x: -t.dir * s[0], z: s[1] };
          p.moveMode = 'sprint'; p.faceTo = { x: 0, z: 0 };
        }
      }
      this.ball.place(0, 0);
      this.possession = team; this.shotClock = R.SHOT_CLOCK; this.shotReset = null;
      this.restart = { type: 'throwoff', team, taker, spot: { x: 0, z: 0 }, allowShot: false, t: 0, ready: false, minSetup: 2.4, maxSetup: 4.5, readyT: 0 };
      if (team.human) this.setControl(team.human, taker);
    }

    // ---------- свисток и возобновления ----------
    signal(type, data) { this.signals.push(Object.assign({ type }, data || {})); }

    stopPlay(kind) {
      WP.Audio.whistle(kind || 'short');
      for (const p of this.all()) {
        if (p.action && (p.action.type === 'windup' || p.action.type === 'dive' || p.action.type === 'steal')) p.action = null;
        if (p.save) AI.gkSaveEnd(p);
      }
      this.ball.flight = null;
    }

    setRestart(type, team, spot, taker, opts) {
      opts = opts || {};
      if (this.clock <= 0 && !this.so) { this.endPeriod(); return; }
      if (AI.lineD(team, spot.x) < 2) spot.x = team.dir * (R.HALF_L - 2);
      spot.x = clamp(spot.x, -R.HALF_L + 0.3, R.HALF_L - 0.3);
      spot.z = clamp(spot.z, -R.HALF_W + 0.35, R.HALF_W - 0.35);
      if (!taker || !taker.active) taker = this.nearestTo(team, spot.x, spot.z, p => !p.isGK || type === 'goal' || AI.ownLineD(team, spot.x) < 5);
      this.state = 'dead'; this.stateT = 0;
      const allowShot = type === 'free' && AI.lineD(team, spot.x) > R.LINE_6 - 0.01 && !opts.noShot;
      this.restart = { type, team, spot, taker, allowShot, t: 0, ready: false, readyT: 0, minSetup: opts.minSetup || (type === 'free' ? 0.35 : 1.1), maxSetup: opts.maxSetup || 2.6 };
      if (this.ball.holder && this.ball.holder !== taker) { this.ball.holder.hasBall = false; this.ball.holder = null; this.ball.state = 'dead'; }
      if (this.ball.holder !== taker) this.ball.place(spot.x, spot.z);
      else this.ball.state = 'held';
      this.possession = team;
      if (!opts.noSignal) {
        if (type === 'corner') this.signal('corner', { spot });
        else if (type === 'goal') this.signal('goalthrow', { spot, goalX: -team.dir * R.HALF_L });
        else this.signal('free', { spot, dir: team.dir });
      }
      if (team.human) this.setControl(team.human, taker);
      if (team.opp.human) {
        const d = this.nearestTo(team.opp, spot.x, spot.z, p => !p.isGK);
        if (d) this.setControl(team.opp.human, d);
      }
    }

    putLive() {
      if (this.state !== 'dead' && this.state !== 'penalty') return;
      this.state = 'live'; this.stateT = 0;
      this.restart = null;
    }
    putInPlay() { this.putLive(); }

    callFoul(team, spot, taker, text) {
      this.stopPlay('short');
      team.opp.stats.fouls++;
      this.setRestart('free', team, { x: spot.x, z: spot.z }, taker);
      if (text && this.restart) this.announce(text, 'Свободный бросок · ' + team.name + (this.restart.allowShot ? ' · можно бросать сразу' : ''), 'neutral');
    }

    turnover(toTeam, spot, reason, sub) {
      this.dbg[reason] = (this.dbg[reason] || 0) + 1;
      this.stopPlay('short');
      toTeam.opp.stats.turnovers++;
      this.shotClock = R.SHOT_CLOCK; this.shotReset = null;
      this.setRestart('free', toTeam, { x: spot.x, z: spot.z }, null);
      this.announce(reason, sub || 'Мяч у команды ' + toTeam.name, 'neutral');
    }

    callExclusion(off, fouled, spot, reason, brutal) {
      const t = off.team, ft = t.opp;
      this.dbg['excl:' + reason] = (this.dbg['excl:' + reason] || 0) + 1;
      this.stopPlay('long');
      if (off.hasBall) { off.hasBall = false; this.ball.holder = null; }
      off.excluded = true; off.exclTimer = brutal ? R.BRUTALITY : R.EXCLUSION; off.reentryOK = false; off.hardTime = !!brutal;
      off.fouls++; off.stats.excl++;
      off.action = null;
      t.stats.exclCommitted++; ft.stats.exclEarned++; ft.stats.ppAtt++;
      if (off.ctrl) { const id = off.ctrl; this.setControl(id, this.nearestTo(t, this.ball.pos.x, this.ball.pos.z, p => !p.isGK && p !== off)); }
      if (brutal || off.fouls >= R.PERSONAL_MAX) off.outForGame = true;
      const hadBall = this.possession === ft;
      this.shotClock = hadBall ? Math.max(this.shotClock, R.SHOT_RESET) : R.SHOT_CLOCK;
      this.shotReset = null;
      t.ai.dirty = true; ft.ai.dirty = true;
      if (brutal) {
        this.announce('ГРУБОСТЬ', off.name + ' удалён до конца матча · 4 мин в меньшинстве · пенальти', 'red');
        this.say('Грубость! ' + this.pname(off) + ' удалён до конца матча. ' + t.name + ' 4 минуты в меньшинстве, плюс пенальти.', 'red');
        this.callPenalty(null, fouled, true);
        return;
      }
      this.announce('УДАЛЕНИЕ · 15 с', '№' + off.num + ' ' + off.name + ' (' + t.code + ') · ' + reason, 'red');
      this.say('Удаление: ' + this.pname(off) + ' — ' + reason + '. У команды ' + ft.name + ' большинство.', 'red');
      if (off.fouls >= R.PERSONAL_MAX) this.say(off.name + ' получает третье персональное замечание и покидает игру до конца матча. Выйдет замена.', 'red');
      this.signal('excl', { spot, player: off, zone: { x: -t.dir * (R.HALF_L + 1), z: -(R.HALF_W + 0.7) } });
      this.noteCall({ type: 'excl', against: t, off, fouled, spot: { x: spot.x, z: spot.z }, wasOut: off.outForGame && off.fouls >= R.PERSONAL_MAX, correct: Math.random() < 0.78 });
      this.emit('card', { kind: 'excl', player: off, team: t, reason });
      WP.Audio.crowd(t === this.teams[0] ? 'boo' : 'cheer');
      this.setRestart('free', ft, { x: spot.x, z: spot.z }, fouled && fouled.active ? fouled : null, { minSetup: 1.0, noSignal: true });
    }

    callPenalty(off, fouled, already) {
      const ft = fouled ? fouled.team : off.team.opp, t = ft.opp;
      if (!already) {
        this.stopPlay('long');
        if (off) {
          off.fouls++; off.action = null;
          t.stats.fouls++;
          if (off.fouls >= R.PERSONAL_MAX) {
            off.outForGame = true; off.excluded = true; off.exclTimer = R.EXCLUSION;
            this.say(off.name + ' — третье персональное замечание, уходит до конца матча.', 'red');
          }
        }
        this.announce('ПЕНАЛЬТИ', off ? 'Фол ' + off.name + ' (' + t.code + ') в 6-метровой зоне' : '', 'red');
        this.say('Пенальти! ' + (off ? 'Фол ' + this.pname(off) + ' помешал верному голу.' : ''), 'red');
        this.signal('penalty', { spot: AI.att(ft, R.LINE_5, 0) });
        if (off) this.noteCall({ type: 'pen', against: t, off, fouled, spot: fouled ? { x: fouled.x, z: fouled.z } : AI.att(ft, 4, 0), wasOut: off.outForGame, correct: Math.random() < 0.8 });
        if (off) this.emit('card', { kind: 'pen', player: off, team: t });
        WP.Audio.crowd(t === this.teams[0] ? 'boo' : 'cheer');
      }
      ft.stats.penEarned++;
      let shooter;
      if (ft.human && fouled && fouled.active && !fouled.isGK) shooter = fouled;
      else shooter = ft.players.filter(p => p.active && !p.isGK).sort((a, b) => (b.attrs.sht + b.attrs.acc) - (a.attrs.sht + a.attrs.acc))[0];
      this.startPenalty(ft, shooter, false);
    }

    startPenalty(ft, shooter, so) {
      const t = ft.opp;
      if (this.ball.holder) { this.ball.holder.hasBall = false; this.ball.holder = null; }
      const spot = AI.att(ft, R.LINE_5, 0);
      this.ball.place(spot.x, 0);
      this.state = 'penalty'; this.stateT = 0;
      this.restart = { type: 'penalty', team: ft, taker: shooter, spot, t: 0, ready: false, readyT: 0, allowShot: true, so: !!so, shotAt: rnd(0.55, 1.1) };
      this.possession = ft;
      const gk = t.gk;
      const spots = [[7, 3.5], [7, -3.5], [8.5, 6.5], [8.5, -6.5], [9.5, 1.2], [9.5, -1.2], [11, 4], [11, -4], [11, -1], [11, 1]];
      let i = 0;
      for (const p of this.all()) {
        p.action = null;
        if (!p.active) continue;
        if (p === shooter) { p.target = { x: spot.x, z: 0 }; p.moveMode = 'sprint'; continue; }
        if (p === gk) { p.target = { x: -t.dir * (R.HALF_L - 0.25), z: 0 }; p.moveMode = 'sprint'; continue; }
        if (so) { p.target = { x: (i % 2 ? -1 : 1) * (1 + (i >> 1) * 1.1), z: 8.6 - (i % 3) * 0.3 }; p.moveMode = 'swim'; i++; continue; }
        const s = spots[i++ % spots.length];
        p.target = AI.att(ft, s[0], s[1]); p.moveMode = 'sprint';
      }
      if (ft.human) this.setControl(ft.human, shooter);
    }

    // ---------- действия ----------
    // Резкий пас: быстрее и по прямой, перехватить труднее, но и принять тяжелее
    passSpeed(p, to, power) {
      const s = clamp(6.2 + Math.hypot(to.x - p.x, to.z - p.z) * 0.55, 7.5, 15);
      return power > 0 ? Math.max(s, 9.5) * (1 + power * 0.9) * (0.9 + 0.2 * p.attrs.sht / 100) : s;
    }
    // Какой скорости мяч получатель ещё уверенно принимает (зависит от «Паса»)
    handleSpeed(p) { return 12.5 + (p.attrs.pas - 60) * 0.15; }
    // Сила зарядки, после которой пас этому получателю становится рискованным
    passRisk(p, to) {
      const b = this.passSpeed(p, to, 0.0001) / 1.00009;
      return clamp((this.handleSpeed(to) / b - 1) / 0.9, 0, 1);
    }

    // Пас в разрез: куда уйдёт мяч — в свободную воду перед партнёром, на его ходу к воротам
    // out — необязательный объект для результата (прицел зовёт каждый кадр и не выделяет память)
    throughSpot(p, to, out) {
      const o = out || {}, dir = to.team.dir;
      let dx = dir * R.HALF_L - to.x, dz = -to.z, l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // Уже плывёт к воротам — мяч кладётся по его ходу, а не строго на центр ворот
      const sp = Math.hypot(to.vx, to.vz);
      if (sp > 0.5 && to.vx * dx + to.vz * dz > 0.4 * sp) {
        const k = Math.min(1, sp / 1.6) * 0.5;
        dx += (to.vx / sp - dx) * k; dz += (to.vz / sp - dz) * k;
        l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      }
      const lead = 1.6 + 1.4 * to.attrs.spd / 100;
      let x = to.x + dx * lead;
      // не ближе 2,3 м к линии ворот (правило 2 метров) и в пределах поля
      const lim = dir * (R.HALF_L - 2.3);
      if ((x - lim) * dir > 0) x = lim;
      o.x = x; o.z = clamp(to.z + dz * lead * 0.8, -R.HALF_W + 1, R.HALF_W - 1);
      return o;
    }
    thruOk(p, t) { return !!t && t !== p && t.team === p.team && t.active && !t.isGK && !t.excluded && !t.rolling; }
    // Оценка разреза одному партнёру: точка, свободен ли коридор (~0,9 м), кто раньше доплывёт до точки
    evalThrough(p, t, lob, o) {
      this.throughSpot(p, t, o);
      const team = p.team, dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
      const myL = AI.lineD(team, p.x), spL = AI.lineD(team, o.x);
      o.d = d; o.ok = false; o.open = false;
      if (d < 2 || d > 14 || spL > myL + 1.5) return o;
      // Получатель: ход к воротам и время до точки (после паса он уходит рывком; с места ещё надо разогнаться)
      const gx = team.dir * R.HALF_L - t.x, gz = -t.z;
      o.vg = (t.vx * gx + t.vz * gz) / (Math.hypot(gx, gz) || 1);
      const rx = o.x - t.x, rz = o.z - t.z, rl = Math.hypot(rx, rz) || 1;
      const vmax = Math.max(0.6, t.maxSpeed() * (t.moveMode === 'sprint' ? 1 : 1.1));
      const tr = rl / vmax + 0.3 * (1 - clamp((t.vx * rx + t.vz * rz) / (rl * vmax), 0, 1));
      let tdef = 9, lane = 9;
      for (const q of team.opp.players) {
        if (!q.active) continue;
        const ox = q.x - p.x, oz = q.z - p.z, k = clamp((ox * dx + oz * dz) / (d * d), 0, 1);
        // Первый метр мяч идёт выше рук опекуна; верхом — опасен только тот, кто у самой точки
        if (k * d > 1.0 && (!lob || k > 0.85)) { const off = Math.hypot(ox - dx * k, oz - dz * k) - (q.isGK ? 0.35 : 0); if (off < lane) lane = off; }
        const tq = Math.hypot(q.x - o.x, q.z - o.z) / Math.max(0.5, q.maxSpeed()) + 0.25; // + реакция на пас
        if (tq < tdef) tdef = tq;
      }
      o.margin = tdef - tr; o.lane = lane;
      o.open = o.margin > 0.1 && lane > 0.9;
      o.s = clamp(o.margin, -1.5, 1.5) * 1.2 + (lane > 0.9 ? 0.4 : (lane - 0.9) * 1.5) + clamp(o.vg, 0, 2) * 0.35 + (myL - spL) * 0.08 - d * 0.03;
      o.ok = true;
      return o;
    }
    // Оценка адресата с учётом направления (inp.mag > 0.3): кто не в той стороне — отсекается (-1e9)
    thruScore(p, t, inp, lob) {
      if (!this.thruOk(p, t)) return -1e9;
      let c = 0;
      if (inp && inp.mag > 0.3) {
        const dx = t.x - p.x, dz = t.z - p.z;
        c = (dx * inp.x + dz * inp.z) / ((Math.hypot(dx, dz) || 1) * inp.mag);
        if (c < 0.3) return -1e9;
      }
      const e = this.evalThrough(p, t, !!lob, TE);
      return e.ok ? e.s + c * 2 : -1e9;
    }
    // Лучший адресат разреза (оценка лучшего — в this.thruBestS)
    pickThrough(p, inp, lob) {
      let best = null, bs = -1e8;
      for (const t of p.team.players) { const s = this.thruScore(p, t, inp, lob); if (s > bs) { bs = s; best = t; } }
      this.thruBestS = bs;
      return best;
    }
    // Прицел (держат клавишу разреза): адресат меняется направлением, если новый заметно лучше
    // и остаётся лучшим 0,12 с — без дрожания между двумя похожими партнёрами
    aimThrough(p, inp, ta) {
      const dirOn = inp.mag > 0.3;
      if (!this.thruOk(p, ta.to) || !this.evalThrough(p, ta.to, ta.lob, TE).ok) { ta.to = this.pickThrough(p, dirOn ? inp : null, ta.lob); ta.cand = null; }
      else if (dirOn) {
        const cs = this.thruScore(p, ta.to, inp, ta.lob), c = this.pickThrough(p, inp, ta.lob);
        if (!c || c === ta.to || this.thruBestS < cs + 0.25) ta.cand = null;
        else if (c !== ta.cand) { ta.cand = c; ta.candT = this.t; }
        else if (this.t - ta.candT > 0.12) { ta.to = c; ta.cand = null; }
      }
      ta.vis = true; ta.ok = false; ta.open = false;
      if (ta.to) this.evalThrough(p, ta.to, ta.lob, ta);
      // Подсказка: кому уйдёт мяч — только при смене адресата или вида паса
      const k = ta.to ? (ta.lob ? 2 : 0) + (ta.open ? 1 : 0) : -1;
      if (ta.to !== ta.shown || k !== ta.shownK || this.t - ta.emitT > 0.9) {
        ta.shown = ta.to; ta.shownK = k; ta.emitT = this.t;
        this.emit('passinfo', { aim: true, to: ta.to, lob: ta.lob, open: ta.open });
      }
    }
    thruAiming(id) { const a = this.thruAim && this.thruAim[id]; return a && a.vis && !a.rel ? a : null; }
    // ИИ в позиционной атаке иногда отдаёт в разрез партнёру, который открыто уходит к воротам
    aiThrough(h, dt) {
      const ai = h.team.ai;
      if (this.state !== 'live' || this.cfg.tutorial || h.isGK || h.action || ai.phaseT < 7 || (h.holdT || 0) < 0.4 || this.shotClock < 4) return false;
      ai.thruT = (ai.thruT || 0) + dt;
      if (ai.thruT < 0.3) return false;
      ai.thruT = 0;
      const to = this.pickThrough(h, null, false);
      if (!to || Math.random() > 0.3) return false;
      const e = this.evalThrough(h, to, false, TE);
      if (!e.open || e.margin < 0.35 || e.vg < 1.0 || AI.xg(this, to, e.x, e.z) < 0.25 || AI.xg(this, h) > 0.3) return false;
      this.doPass(h, to, { through: true });
      return true;
    }

    doPass(p, to, opts) {
      if (!p.hasBall || !to) return;
      const power = (opts && opts.power) || 0;
      const lob = !!(opts && opts.lob), through = !!(opts && opts.through);
      const rs = this.state === 'dead' ? this.restart : null;
      if (rs && (!rs.ready || rs.taker !== p)) return;
      if (this.state !== 'live' && !rs) return;
      const from = p.ballHoldPos(new THREE.Vector3());
      if (p.holdMode === 'dribble') from.y = 0.45;
      const spot = through ? this.throughSpot(p, to) : null;
      const d = spot ? Math.hypot(spot.x - p.x, spot.z - p.z) : Math.hypot(to.x - p.x, to.z - p.z);
      const wet = through || (!power && !lob && !p.isGK && to.slotName === 'hole' && AI.lineD(to.team, to.x) < 3.6 && d < 9 && Math.random() < 0.75);
      let speed = through ? clamp(6.5 + d * 0.32, 7.5, 11) * (lob ? 0.85 : 1) : wet ? clamp(6 + d * 0.3, 7, 9.5) : this.passSpeed(p, to, power) * (lob ? 0.82 : 1);
      const T = d / speed;
      const lead = 0.85 * T;
      const aim = spot ? new THREE.Vector3(spot.x, 0.07, spot.z) : new THREE.Vector3(to.x + to.vx * lead, wet ? 0.07 : 0.95 + to.lift * 0.2, to.z + to.vz * lead);
      if (wet && !through) { const ux = (p.x - aim.x) / (d || 1), uz = (p.z - aim.z) / (d || 1); aim.x += ux * 0.45; aim.z += uz * 0.45; }
      const sig = (0.04 + (1 - p.attrs.pas / 100) * 0.55 + d * 0.012) * (p.team.ai.errMul || 1) * (1 + power * 0.35);
      aim.x += gauss() * sig; aim.z += gauss() * sig;
      // Пас верхом — всегда навесом над руками защитников
      let high = lob || (d > 11 && !power && !through);
      if (!high && !power && !through) {
        for (const o of p.team.opp.players) {
          if (!o.active) continue;
          const t = clamp(((o.x - p.x) * (to.x - p.x) + (o.z - p.z) * (to.z - p.z)) / (d * d), 0, 1);
          if (t > 0.15 && t < 0.85 && Math.hypot(o.x - (p.x + (to.x - p.x) * t), o.z - (p.z + (to.z - p.z) * t)) < 0.8) { high = !wet && d > 4; if (high) speed *= 0.85; break; }
        }
      }
      const vel = WP.solveThrow(from, aim, speed, high);
      this.ball.pos.copy(from);
      const kmh = Math.round(vel.length() * 3.6);
      this.ball.release(vel, { type: 'pass', from: p, to, team: p.team, t: this.t, wet, power, kmh, lob, through, aim: { x: aim.x, z: aim.z } });
      this.ball.releaseT = this.t;
      p.action = { type: 'release', t: 0, dur: 0.22 };
      p.pumpN = 0;
      if (p.ctrl) this.emit('passinfo', { kmh, power, to, kind: through ? (lob ? 'Пас в разрез верхом' : 'Пас в разрез') : lob ? 'Пас верхом' : power >= 0.6 ? 'Сильный пас' : power > 0 ? 'Резкий пас' : 'Пас' });
      // Партнёр сразу уходит на ход к точке паса
      if (through) { to.target = { x: spot.x, z: spot.z }; to.moveMode = 'sprint'; }
      p.holdMode = 'hold';
      if (rs) this.putLive();
      if (p.team.human && this.controlled[p.team.human] === p) this.setControl(p.team.human, to);
      to.input.active = false;
    }

    startShot(p, opts) {
      if (!p.hasBall || (p.action && p.action.type !== 'catch')) return false;
      const rs = (this.state === 'dead' || this.state === 'penalty') ? this.restart : null;
      if (rs) { if (!rs.ready || rs.taker !== p || !rs.allowShot) return false; }
      else if (this.state !== 'live') return false;
      // Стиль замаха: сверху, сбоку от плеча, «из воды» с ходу, разворотом у центрового
      let style = opts.style;
      if (!style) {
        if (opts.type === 'turn') style = 'back';
        else if (opts.type === 'lob' || opts.type === 'skip' || (rs && rs.type === 'penalty')) style = 'over';
        else if (p.holdMode === 'dribble' && p.speed > 0.8) style = 'flick';
        else {
          const c = Math.cos(p.heading), s = Math.sin(p.heading);
          const front = p.team.opp.players.some(o => o.active && !o.isGK && Math.hypot(o.x - p.x, o.z - p.z) < 1.4 && ((o.x - p.x) * c + (o.z - p.z) * s) > 0.3);
          style = front && Math.random() < 0.5 ? 'side' : 'over';
        }
      }
      opts.style = style;
      let dur = 99;
      if (opts.ai) dur = style === 'flick' ? rnd(0.12, 0.18) : rnd(0.3, 0.46) * (style === 'back' ? 0.55 : opts.type === 'lob' ? 0.8 : style === 'side' ? 0.85 : 1) * (opts.quick ? 0.6 : 1);
      p.action = { type: 'windup', t: 0, dur, ai: !!opts.ai, opts, t0: this.t };
      if (style !== 'flick') {
        p.holdMode = 'hold';
        // Выпрыгивание из воды перед броском: брызги, волна, пена
        p.liftTarget = opts.type === 'skip' ? 0.9 : style === 'over' ? 1.15 : 0.8;
        this.world.splash(p.x, 0.1, p.z, 10, 0.9);
        this.world.addRipple(p.x, p.z, 0.045);
        this.world.foam(p.x, p.z, 0.7, 0.8);
      }
      const gk = p.team.opp.gk;
      if (gk && gk.active) gk.liftTarget = 1.0;
      return true;
    }

    releaseShot(p, a, humanAim) {
      if (!p.hasBall) { p.action = null; return; }
      const team = p.team, opp = team.opp, gx = team.dir * R.HALF_L;
      const opts = Object.assign({}, a.opts);
      if (humanAim) Object.assign(opts, humanAim);
      const rs = (this.state === 'dead' || this.state === 'penalty') ? this.restart : null;
      const style = opts.style || 'over';
      const from = p.ballHoldPos(new THREE.Vector3());
      if (style === 'over') from.y = Math.max(from.y, 0.8);
      else from.y = Math.max(from.y, style === 'flick' ? 0.15 : 0.45);
      const dist = AI.goalDist(team, p.x, p.z);
      const pressure = clamp(1.25 - AI.nearestOpp(p, undefined, undefined, true).d, 0, 1);
      const power = opts.power;
      let sig = 0.12 + (1 - p.attrs.acc / 100) * 0.5 + power * power * 0.22 + pressure * 0.3 + (1 - p.stamina) * 0.12;
      if (opts.type === 'turn') sig += 0.12;
      if (style === 'flick') sig += 0.05;
      if (style === 'side') sig += 0.03;
      if (opts.type === 'lob') sig *= 0.7;
      if (opts.type === 'skip') sig *= 0.85;
      // С дальней дистанции точность падает сильнее (раньше ошибка переставала расти после 12 м)
      sig *= clamp(dist / 6, 0.75, opts.type === 'lob' ? 3.4 : 2.6) * (team.ai.errMul || 1);
      if (p.ctrl) sig *= 0.92;
      if (p.pumpN > 2) sig *= 1 + 0.12 * (p.pumpN - 2);
      const z = opts.zAim + gauss() * sig, y = clamp(opts.yAim + gauss() * sig * 0.7, -0.05, 1.3);
      // Сила броска: 60 → ~77 км/ч на полной силе, 95 → ~91 км/ч
      const shp = 0.62 + 0.48 * p.attrs.sht / 100;
      let vel;
      if (opts.type === 'lob') {
        vel = WP.solveLob(from, new THREE.Vector3(gx - team.dir * 0.1, clamp(y + 0.05, 0.72, 0.82), z * 0.92), 2.5 + dist * 0.12);
      } else if (opts.type === 'skip') {
        const sp = this.skipPlan(from, team, z * 0.95);
        vel = WP.solveThrow(from, new THREE.Vector3(sp.x + team.dir * rnd(-0.12, 0.12), 0.0, sp.z), (13 + 9 * power) * shp, false);
      } else {
        const sm = opts.type === 'turn' ? 0.72 : style === 'flick' ? 0.74 : style === 'side' ? 0.94 : 1;
        vel = WP.solveThrow(from, new THREE.Vector3(gx + team.dir * 0.2, y, z), (12.5 + 11 * power) * shp * sm, false);
      }
      const onTarget = this.predictOnTarget(from, vel, team, opts.type === 'skip');
      let screened = false;
      const sx = gx - p.x, sz = -p.z, L = Math.hypot(sx, sz);
      for (const o of this.all()) {
        if (o === p || !o.active || o.isGK) continue;
        const t = ((o.x - p.x) * sx + (o.z - p.z) * sz) / (L * L);
        if (t > 0.3 && t < 0.9 && Math.hypot(o.x - (p.x + sx * t), o.z - (p.z + sz * t)) < 0.55) { screened = true; break; }
      }
      this.ball.pos.copy(from);
      const kmh = Math.round(vel.length() * 3.6);
      const assist = p.lastPassFrom && this.t - p.lastPassT < 7 && p.lastPassFrom.team === team ? p.lastPassFrom : null;
      this.ball.release(vel, { type: 'shot', from: p, team, t: this.t, kind: opts.type, style, kmh, onTarget, assist, penalty: !!(rs && rs.type === 'penalty') });
      this.ball.releaseT = this.t;
      p.action = { type: 'release', t: 0, dur: style === 'over' ? 0.42 : 0.3, style, kind: opts.type };
      p.pumpN = 0;
      const gk0 = opp.gk, lagNow = gk0 && gk0.active && !(rs && rs.type === 'penalty') ? (gk0.unset || 0) : 0;
      this.emit('shotspeed', { kmh, p, tag: lagNow > 0.45 ? 'с ходу — вратарь не успел' : opts.type === 'skip' ? 'от воды' : '' });
      p.holdMode = 'hold';
      if (style === 'flick') this.world.splash(from.x, 0.08, from.z, 8, 0.8, vel.clone().normalize());
      team.stats.shots++; p.stats.shots++;
      if (onTarget) team.stats.onTarget++;
      if (rs) { const wasPen = rs.type === 'penalty'; this.putLive(); if (wasPen && this.so) this.so.shotT = this.t; }
      const gk = opp.gk;
      if (gk && gk.active) AI.gkSaveStart(this, gk, { screened, kind: opts.type, penalty: rs && rs.type === 'penalty', aimZ: z, aimY: opts.type === 'skip' ? 0.2 : y, shooter: p });
      WP.Audio.whoosh();
    }

    // Бросок «от воды»: куда мяч ударится о воду. Точка лежит на прямой от руки к выбранному углу ворот (после отскока мяч
    // летит туда же), и так далеко от ворот, чтобы мяч входил в воду полого (не круче ~1:2,4) и чётко отскакивал вверх
    skipPlan(from, team, z) {
      const gx = team.dir * R.HALF_L, dist = Math.abs(gx - from.x);
      const back = clamp(dist - Math.max(0.3, from.y) / 0.42, 0.5, 2.6);
      const bx = gx - team.dir * back, k = (bx - from.x) / ((gx - from.x) || 1e-6);
      return { x: bx, z: from.z + (z - from.z) * k, back };
    }

    predictOnTarget(from, vel, team, sk) {
      const gx = team.dir * R.HALF_L;
      const p = from.clone(), v = vel.clone();
      for (let i = 0; i < 600; i++) {
        const h = 1 / 240, sp = v.length();
        v.x -= R.DRAG * sp * v.x * h; v.z -= R.DRAG * sp * v.z * h; v.y -= (R.DRAG * sp * v.y + R.G) * h;
        p.addScaledVector(v, h);
        if (p.y < 0.07 && v.y < 0) { if (WP.waterBounce(v, sk)) { sk = false; p.y = 0.08; } else return false; }
        if ((p.x - gx) * team.dir >= 0) return Math.abs(p.z) < R.GOAL_HALF_W && p.y < R.GOAL_H;
      }
      return false;
    }

    // Кач (pump fake): игрок выпрыгивает за счёт ног, корпус и плечо уходят в замах и резко останавливаются.
    // Ритмичный кач опытный вратарь «считает» (раз-два — прыжок), кач с паузой сбивает его; держаться высоко можно 2–3 с.
    doFake(p) {
      if (!p.hasBall) return;
      const gap = this.t - (p.lastFakeT === undefined ? -9 : p.lastFakeT);
      if (gap > 1.6) { p.pumpN = 0; p.pumpGap = 0; }
      const rhythmic = p.pumpN >= 1 && p.pumpGap > 0 && Math.abs(gap - p.pumpGap) < 0.12;
      const pause = p.pumpN >= 1 && p.pumpGap > 0 && gap - p.pumpGap > 0.25;
      p.pumpGap = p.pumpN >= 1 ? gap : 0;
      p.pumpN = (p.pumpN || 0) + 1;
      p.action = { type: 'fake', t: 0, dur: 0.42 };
      p.holdMode = 'hold';
      p.lastFakeT = this.t;
      // Ноги устают: после третьего кача игрок проседает
      p.liftTarget = p.pumpN <= 2 ? 1.12 : p.pumpN === 3 ? 0.9 : 0.65;
      if (p.ctrl && p.pumpN === 3) this.emit('passinfo', { msg: 'Ноги устают — бросай или отдай пас' });
      const rs = this.state === 'dead' ? this.restart : null;
      if (rs && rs.allowShot) rs.allowShot = false;
      const gk = p.team.opp.gk;
      if (gk && gk.active && AI.goalDist(p.team, p.x, p.z) < 9.5 && !gk.save) {
        // Насколько убедителен кач: вратарь, бросковые качества, высота выпрыгивания, ритм, усталость
        const recent = this.t - (gk.lastBiteT || -9) < 2.5;
        let pb = 0.17 + 0.45 * (1 - gk.attrs.gk / 100) + (p.attrs.acc - 80) / 400 + (p.attrs.sht - 80) / 500;
        pb *= clamp(p.lift / 1.05, 0.55, 1);
        if (rhythmic) pb *= 0.3;
        if (pause) pb *= 1.25;
        pb *= Math.pow(0.8, Math.max(0, p.pumpN - 1));
        if (recent) pb *= 0.4;
        if (p.ctrl && rhythmic && Math.random() < 0.5) this.emit('passinfo', { msg: 'Вратарь читает ритм — качни с паузой' });
        if (Math.random() < pb) {
          gk.biteT = 1.25; gk.lastBiteT = this.t;
          if (p.ctrl) this.emit('passinfo', { msg: 'Вратарь прыгнул — бросай в верхний угол!' });
          gk.action = { type: 'block', t: 0, dur: 0.55 };
          gk.liftTarget = 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          gk.target = { x: gk.x, z: clamp(gk.z + side * 0.5, -1.3, 1.3) };
        }
      }
      for (const o of p.team.opp.players) if (o.active && !o.isGK && Math.hypot(o.x - p.x, o.z - p.z) < 2 && Math.random() < 0.5) this.doBlock(o);
    }

    // Атакующий «зарабатывает» обычный фол: упирается в защитника и поднимает мяч, показывая судье захват
    drawFoul(p, id) {
      if ((p.drawCD || 0) > this.t) return;
      p.drawCD = this.t + 1.2;
      p.action = { type: 'drawfoul', t: 0, dur: 0.45 };
      p.holdMode = 'hold';
      let d = null, dd = 9;
      for (const o of p.team.opp.players) { if (!o.active || o.isGK) continue; const x = Math.hypot(o.x - p.x, o.z - p.z); if (x < dd) { dd = x; d = o; } }
      const msg = (m) => this.emit('passinfo', { msg: m });
      if (!d || dd > 1.15) { msg('Рядом нет защитника — фол не заработать'); return; }
      const at = p.team;
      if (d.hands) {
        if (Math.random() < 0.3) { this.turnover(d.team, { x: p.x, z: p.z }, 'ФОЛ В НАПАДЕНИИ', 'Защитник держал руки на виду — судья увидел симуляцию'); return; }
        msg('Защитник держит руки вверх — судья не свистит'); return;
      }
      const gvx = at.dir * R.HALF_L - p.x, gvz = -p.z, gl = Math.hypot(gvx, gvz) || 1;
      const behind = ((d.x - p.x) * gvx + (d.z - p.z) * gvz) / (gl * dd) < -0.3;
      const lineD = AI.lineD(at, p.x);
      let pF = clamp(0.5 + (p.attrs.str - d.attrs.str) / 250 + (1.15 - dd) * 0.3 + (d.ctrl ? -0.08 : 0), 0.2, 0.8);
      const r = Math.random();
      if (r < pF) {
        // Захват сзади в зоне 6 м — уже удаление
        if (behind && lineD < R.LINE_6 && Math.random() < 0.3) { this.callExclusion(d, p, { x: p.x, z: p.z }, 'захват сзади'); return; }
        this.say(p.name + ' зарабатывает фол.', 'info');
        this.callFoul(at, { x: p.x, z: p.z }, p, 'ОБЫЧНЫЙ ФОЛ');
        return;
      }
      if (r < pF + 0.1) { this.turnover(d.team, { x: p.x, z: p.z }, 'ФОЛ В НАПАДЕНИИ', p.name + ' оттолкнулся от защитника'); return; }
      msg('Судья не увидел фола — играем');
    }

    doBlock(p) {
      if (p.hasBall) return;
      if (!p.action) p.action = { type: 'block', t: 0, dur: 0.75 };
      else if (p.action.type === 'block') p.action.dur = Math.max(p.action.dur, p.action.t + 0.4);
      p.liftTarget = Math.max(p.liftTarget, 0.8);
    }

    // Попытка отбора: исход зависит от положения защитника
    tryStealBy(def) {
      if (def.stealCD > 0 || def.excluded) return;
      def.stealCD = 0.85;
      if (!def.action) def.action = { type: 'steal', t: 0, dur: 0.35 };
      const c = this.ball.holder;
      if (!c || c.team === def.team || this.state !== 'live') return;
      const dist = Math.hypot(c.x - def.x, c.z - def.z);
      if (dist > 1.25) return;
      const at = c.team;
      const gvx = at.dir * R.HALF_L - c.x, gvz = -c.z, gl = Math.hypot(gvx, gvz) || 1;
      const behind = ((def.x - c.x) * gvx + (def.z - c.z) * gvz) / (gl * dist) < -0.3;
      const lineD = AI.lineD(at, c.x);
      const exposed = c.holdMode === 'hold' || (c.action && c.action.type === 'windup');
      const shooting = c.action && c.action.type === 'windup';
      let pSteal = (exposed ? 0.14 : 0.1) + (def.attrs.def - c.attrs.pas) / 200 - (c.attrs.str - 80) / 400;
      if (behind) pSteal *= 0.45;
      if (this.shielded(c, def)) pSteal *= 0.55;
      if (def.ctrl) pSteal *= 1.35;
      if (c.isGK) pSteal *= 0.5;
      const r = Math.random();
      if (r < pSteal) {
        c.hasBall = false; this.ball.holder = null;
        if (Math.random() < 0.5) this.catchBall(def, 'steal');
        else {
          const kx = (def.x - c.x) * 0.3 + rnd(-0.6, 0.6), kz = (def.z - c.z) * 0.3 + rnd(-0.6, 0.6);
          this.ball.pos.set(c.x + Math.cos(c.heading) * 0.4, 0.4, c.z + Math.sin(c.heading) * 0.4);
          this.ball.release(new THREE.Vector3(kx * 2, 0.8, kz * 2), null);
          this.ball.releaseT = this.t; this.ball.lastTouch = def;
        }
        def.team.stats.steals++; def.stats.steals++;
        this.say(def.name + ' выбивает мяч у ' + c.name + '.', 'info');
        return;
      }
      if (r < pSteal + 0.012 && !behind) {
        this.say('Мяч под водой — потеря команды ' + c.team.name + '.', 'info');
        this.turnover(def.team, { x: c.x, z: c.z }, 'МЯЧ ПОД ВОДОЙ', c.name + ' утопил мяч под давлением');
        return;
      }
      if (behind && lineD < R.LINE_6 && Math.abs(c.z) < 4.5 && (shooting || exposed) && Math.random() < (shooting ? 0.45 : 0.15)) { this.callPenalty(def, c); return; }
      if (behind && Math.random() < 0.35) { this.callExclusion(def, c, { x: c.x, z: c.z }, 'фол сзади'); return; }
      if (shooting && Math.random() < 0.7) return; // преимущество: бросок продолжается
      this.callFoul(at, { x: c.x, z: c.z }, c, 'ОБЫЧНЫЙ ФОЛ');
    }

    // ---------- видеочеллендж (правила 2025): один на матч, при отмене решения сохраняется ----------
    noteCall(c) {
      if (this.so) return;
      c.t = this.t; this.lastCall = c;
      const team = c.against;
      if (team.human) this.emit('varhint', { team });
      else if (team.challenges > 0 && Math.random() < 0.12) this.aiChallengeAt = this.t + 1.4;
    }

    canChallenge(team) {
      const c = this.lastCall;
      return !!c && !this.so && !this.review && team.challenges > 0 && c.against === team && !c.reviewed &&
        this.t - c.t < 7 && ['dead', 'penalty', 'goal'].includes(this.state);
    }

    requestChallenge(team) {
      if (!this.canChallenge(team)) return false;
      const c = this.lastCall; c.reviewed = true;
      this.review = { team, call: c };
      WP.Audio.whistle('long');
      this.announce('ВИДЕОЧЕЛЛЕНДЖ', team.name + ' оспаривает решение · судьи смотрят повтор', 'neutral');
      this.say(team.name + ' берёт видеочеллендж.', 'info');
      this.emit('var', { phase: 'start', t: c.t, side: c.type === 'goal' ? c.team.dir : c.against.opp.dir });
      return true;
    }

    resolveChallenge() {
      const r = this.review; if (!r) return;
      this.review = null;
      const c = r.call, team = r.team;
      if (c.correct) {
        team.challenges--;
        this.announce('РЕШЕНИЕ ОСТАВЛЕНО', team.name + ' теряет челлендж', 'neutral');
        this.say('Видеопросмотр: решение судей в силе.', 'info');
        this.emit('var', { phase: 'end' });
        return;
      }
      this.announce('РЕШЕНИЕ ОТМЕНЕНО', 'Челлендж остаётся у команды ' + team.name, 'goal');
      WP.Audio.crowd(team === this.teams[0] ? 'cheer' : 'boo');
      const t = c.against;
      if (c.type === 'excl') {
        const off = c.off;
        off.fouls = Math.max(0, off.fouls - 1); off.stats.excl = Math.max(0, off.stats.excl - 1);
        t.stats.exclCommitted--; t.opp.stats.exclEarned--; t.opp.stats.ppAtt--;
        if (t.players.includes(off)) { off.excluded = false; off.exclTimer = 0; off.hardTime = false; if (c.wasOut) off.outForGame = false; }
        this.say('Удаление ' + off.name + ' отменено: фол был в нападении.', 'info');
        this.shotClock = R.SHOT_CLOCK;
        this.setRestart('free', t, { x: c.spot.x, z: c.spot.z }, null);
      } else if (c.type === 'pen') {
        const off = c.off;
        off.fouls = Math.max(0, off.fouls - 1); t.stats.fouls--; t.opp.stats.penEarned--;
        if (t.players.includes(off) && c.wasOut) { off.outForGame = false; off.excluded = false; }
        this.say('Пенальти отменено — обычный фол, свободный бросок.', 'info');
        this.setRestart('free', t.opp, { x: c.spot.x, z: c.spot.z }, c.fouled && c.fouled.active ? c.fouled : null, { noShot: true });
      } else if (c.type === 'goal') {
        const st = c.team;
        st.score--; if (c.scorer) c.scorer.stats.goals--;
        if (c.pp) st.stats.ppGoals--; if (c.pen) st.stats.penGoals--;
        this.say('Гол ' + (c.scorer ? c.scorer.name : '') + ' отменён: фол в нападении перед броском.', 'info');
        const gk = t.gk;
        this.shotClock = R.SHOT_CLOCK;
        this.setRestart('goal', t, { x: -t.dir * (R.HALF_L - 1.0), z: 0 }, gk && gk.active ? gk : null, { minSetup: 1.2 });
        if (this.restart) this.restart.allowShot = false;
      }
      team.ai.dirty = true; t.ai.dirty = true;
      this.emit('var', { phase: 'end' });
    }

    // ---------- замены по ходу игры через зону возвращения ----------
    rollingSubs(dt) {
      this.rollAcc = (this.rollAcc || 0) + dt;
      if (this.rollAcc < 1) return;
      this.rollAcc = 0;
      if (this.state !== 'live' || this.so) return;
      for (const t of this.teams) {
        if (t.players.some(p => p.rolling) || this.possession !== t || (t.human && t.tac.autoSubs === false)) continue;
        const fresh = t.bench.some(b => !b.isGK && !b.outForGame && b.stamina > 0.85);
        if (!fresh) continue;
        const tired = t.players.filter(p => p.active && !p.isGK && !p.hasBall && !p.ctrl && p.stamina < 0.42).sort((a, b) => a.stamina - b.stamina)[0];
        if (!tired) continue;
        tired.rolling = true;
        this.say(t.name + ': №' + tired.num + ' ' + tired.name + ' уплывает на замену.', 'info');
      }
    }

    // С какой стороны защитник: мяч в правой руке, корпус прикрывает его слева
    shielded(c, d) {
      const rx = -Math.sin(c.heading), rz = Math.cos(c.heading);
      return ((d.x - c.x) * rx + (d.z - c.z) * rz) < -0.2 && c.holdMode === 'hold';
    }

    // Защитник ИИ пытается чисто забрать мяч; промах — секундная заминка, атакующий уходит
    aiStrip(def, c, front, dribbling) {
      def.stealCD = 1.1;
      def.action = { type: 'steal', t: 0, dur: 0.35 };
      const exposed = c.holdMode === 'hold' || (c.action && c.action.type === 'windup');
      let p = dribbling ? (front ? 0.34 : 0.2) : exposed ? 0.28 : 0.16;
      p += (def.attrs.def - c.attrs.pas) / 250 - (c.attrs.str - 80) / 500;
      if (this.shielded(c, def)) p *= 0.5;
      p *= 0.6 + 0.9 * Math.pow(clamp((def.team.ai.aggr - 0.45) / 0.25, 0, 1.2), 1.5); // уровень ИИ: любитель слабее, мировой класс злее
      p = clamp(p, 0.06, 0.7);
      const hum = !!c.team.human;
      if (Math.random() < p) {
        c.action = null;
        if (Math.random() < 0.6) this.catchBall(def, 'steal');
        else {
          c.hasBall = false; this.ball.holder = null;
          const kx = (def.x - c.x) * 0.3 + rnd(-0.6, 0.6), kz = (def.z - c.z) * 0.3 + rnd(-0.6, 0.6);
          this.ball.pos.set(c.x + Math.cos(c.heading) * 0.4, 0.3, c.z + Math.sin(c.heading) * 0.4);
          this.ball.release(new THREE.Vector3(kx * 2, 0.6, kz * 2), null);
          this.ball.releaseT = this.t; this.ball.lastTouch = def;
        }
        def.team.stats.steals++; def.stats.steals++;
        if (hum) this.announce('ЧИСТЫЙ ВЫНОС', def.name + ' забирает мяч у ' + c.name, 'red');
        this.say(def.name + ' чисто выбивает мяч у ' + c.name + '.', 'info');
      } else {
        def.stunT = 0.45;
        if (hum && c.ctrl && Math.random() < 0.3) this.emit('passinfo', { msg: front && dribbling ? 'Защитник в лоб — обведи его или отдай пас' : 'Ушёл от отбора' });
      }
    }

    cleanStrip(def, id) {
      const c = this.ball.holder;
      def.action = { type: 'steal', t: 0, dur: 0.35 };
      const fail = (msg) => { def.stunT = 0.5; this.emit('combo', { id, stage: 0, fail: true, msg }); };
      if (!c || c.team === def.team || this.state !== 'live') return fail('Мяча рядом нет');
      const dist = Math.hypot(c.x - def.x, c.z - def.z);
      if (dist > 1.45) return fail('Далеко: подплыви ближе');
      const gvx = c.team.dir * R.HALF_L - c.x, gvz = -c.z, gl = Math.hypot(gvx, gvz) || 1;
      const behind = ((def.x - c.x) * gvx + (def.z - c.z) * gvz) / (gl * dist) < -0.3;
      if (behind) { this.emit('combo', { id, stage: 0, fail: true, msg: 'Сзади чисто не сыграть' }); def.stealCD = 0; this.tryStealBy(def); return; }
      const exposed = c.holdMode === 'hold' || (c.action && c.action.type === 'windup');
      let pS = (exposed ? 0.88 : 0.45) + (def.attrs.def - c.attrs.pas) / 200;
      if (c.action && c.action.type === 'windup') pS += 0.06;
      if (this.shielded(c, def)) pS -= 0.3;
      pS = clamp(pS, 0.25, 0.95);
      if (Math.random() < pS) {
        c.action = null;
        this.catchBall(def, 'steal');
        def.team.stats.steals++; def.stats.steals++;
        this.announce('ЧИСТЫЙ ВЫНОС', def.name + ' забирает мяч у ' + c.name + ' без фола', 'goal');
        this.say(def.name + ' чисто выбивает мяч у ' + c.name + ' — фола нет.', 'save');
        WP.Audio.crowd('cheer');
        this.emit('combo', { id, stage: 3, ok: true });
      } else fail(this.shielded(c, def) ? 'Соперник закрыл мяч корпусом' : 'Соперник убрал мяч');
    }

    catchBall(p, how) {
      const b = this.ball, f = b.flight;
      if (f && f.type === 'shot' && p.isGK && p.team !== f.team && f.onTarget && !f.saveCounted && !this.so) this.countSave(p, f);
      if (f && f.type === 'pass' && f.team === p.team && f.from !== p) { p.lastPassFrom = f.from; p.lastPassT = this.t; }
      p.gainT = this.t; p.gainHow = how; p.xpTry = undefined;
      b.attach(p);
      p.holdT = 0; p.decideT = p.team.ai.decision * rnd(0.4, 0.9);
      p.holdMode = p.speed > 0.95 ? 'dribble' : 'hold';
      if (!p.action || p.action.type === 'block' || p.action.type === 'steal' || p.action.type === 'dive') p.action = { type: 'catch', t: 0, dur: 0.15 };
      if (p.save) AI.gkSaveEnd(p);
      WP.Audio.slap();
      this.gainPossession(p, how);
      const hum = p.team.opp.human;
      if (hum && how === 'catch' && !p.isGK && WP.Input.opts.autoSwitch) {
        const cur = this.controlled[hum];
        if (!cur || Math.hypot(cur.x - p.x, cur.z - p.z) > 4.5) { const d = this.nearestTo(p.team.opp, p.x, p.z, q => !q.isGK); if (d) this.setControl(hum, d); }
      }
    }

    countSave(gk, f) {
      f.saveCounted = true;
      gk.stats.saves++; gk.team.stats.saves++;
      const lines = ['Сейв! ' + gk.name + ' забирает бросок ' + f.from.name + ' (' + f.kmh + ' км/ч).', gk.name + ' отражает удар ' + f.from.name + '.', 'Отличная реакция ' + gk.name + '!'];
      this.say(lines[(Math.random() * lines.length) | 0], 'save');
    }

    gainPossession(p, how) {
      const team = p.team, prev = this.possession;
      if (this.state === 'live') {
        if (this.shotReset) { this.shotClock = this.shotReset.team === team ? R.SHOT_RESET : R.SHOT_CLOCK; this.shotReset = null; }
        else if (team !== prev) this.shotClock = R.SHOT_CLOCK;
      }
      if (team !== prev) {
        if (prev) team.ai.phaseT = 0;
        for (const q of team.players) if (q.excluded && !q.outForGame && !q.hardTime) q.reentryOK = true;
        if (how === 'intercept') { this.say(p.name + ' перехватывает передачу.', 'info'); team.stats.steals++; p.stats.steals++; }
        this.dbg['poss:' + (how || 'loose') + (p.isGK ? ':gk' : '')] = (this.dbg['poss:' + (how || 'loose') + (p.isGK ? ':gk' : '')] || 0) + 1;
        if (prev && team.opp.human) {
          const d = this.nearestTo(team.opp, p.x, p.z, q => !q.isGK);
          if (d) this.setControl(team.opp.human, d);
        }
      }
      this.possession = team;
      if (team.human) this.setControl(team.human, p);
    }

    // ---------- игроки-люди ----------
    pickReceiver(p, inp) {
      let best = null, bs = -1e9;
      for (const t of p.team.players) {
        if (t === p || !t.active) continue;
        const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
        if (d < 1) continue;
        let s = AI.passScore(this, p, t);
        const pl = p.team.ai.play;
        if (pl && pl.phase === 'drive' && (t === pl.driver || t === pl.screener)) s += t === pl.driver ? 0.6 : 0.3;
        if (inp.mag > 0.3) {
          const c = (dx * inp.x + dz * inp.z) / (d * inp.mag);
          if (c < 0.3) continue;
          s = c * 2 - d * 0.03 + s * 0.4;
        }
        if (t.isGK && inp.mag <= 0.3) s -= 0.3;
        if (s > bs) { bs = s; best = t; }
      }
      return best;
    }

    // Высота броска: после кача, пока вратарь опускается, — в верхний угол
    humanHeight(p) {
      const gk = p.team.opp.gk;
      return gk && gk.biteT > 0 ? rnd(0.68, 0.8) : rnd(0.6, 0.78);
    }

    humanAim(p, inp) {
      const gk = p.team.opp.gk;
      if (inp && Math.abs(inp.z) > 0.35 * Math.max(0.3, inp.mag)) return Math.sign(inp.z) * 1.18 * R.GOAL_HALF_W / 1.5;
      const gkz = gk && gk.active ? gk.z : 0;
      return (gkz > p.z * 0.12 ? -1 : 1) * 1.15 * R.GOAL_HALF_W / 1.5;
    }

    applyHumans(dt) {
      for (const t of this.teams) for (const q of t.players) q.hands = false;
      for (const id of ['p1', 'p2']) {
        const team = this.teams.find(t => t.human === id);
        const inp = this.inputs[id];
        if (!team || !inp) continue;
        const ball = this.ball;
        if (this.cfg.pc) {
          // Карьера игрока: управляешь только своим пловцом; на скамейке — зритель
          const me = team.players.find(q => q.cid === this.cfg.pc.pid && q.active);
          if (!me) { const cur = this.controlled[id]; if (cur) { cur.ctrl = null; cur.input.active = false; this.controlled[id] = null; } continue; }
          if (this.controlled[id] !== me) this.setControl(id, me);
        } else {
          let c = this.controlled[id];
          if (ball.holder && ball.holder.team === team && ball.holder !== c) this.setControl(id, ball.holder);
          c = this.controlled[id];
          if (!c || !c.active || c.team !== team) this.setControl(id, this.nearestTo(team, ball.pos.x, ball.pos.z, q => !q.isGK && !q.rolling));
        }
        const p = this.controlled[id];
        if (!p || !p.active) continue;
        const rs = (this.state === 'dead' || this.state === 'penalty') ? this.restart : null;
        let scripted = ['sprint', 'goal', 'break', 'final', 'timeout', 'intro', 'penalty'].includes(this.state);
        if (rs && rs.taker === p && !rs.ready) scripted = true;
        const penShooter = this.state === 'penalty' && rs && rs.ready && rs.taker === p;
        const receiving = ball.state === 'free' && ball.flight && ball.flight.type === 'pass' && ball.flight.to === p && inp.mag < 0.5;
        p.input.x = inp.x; p.input.z = inp.z; p.input.sprint = inp.sprint;
        // С мячом и без стика: у ворот разворачивается к воротам, дальше — держит направление
        if (p.hasBall && inp.mag < 0.12) p.faceTo = AI.goalDist(team, p.x, p.z) < 12 ? { x: team.dir * R.HALF_L, z: 0 } : null;
        // Без нажатий защитник сам держит позицию (помощник), как только тронул стик — управляешь ты
        // Помощник в защите можно выключить в «Настройке управления» — тогда без нажатий игрок стоит на месте
        const idle = (inp.assist !== undefined ? inp.assist : WP.Input.opts.assist) && !p.hasBall && inp.mag < 0.12 && !(p.action && p.action.type === 'steal');
        p.input.active = !scripted && !receiving && !(p.isGK && !p.hasBall) && !idle;
        if (inp.challenge) this.requestChallenge(team);
        if (inp.play) this.callScreen(team, !p.hasBall && this.cfg.pc ? p : null);
        if (inp.sub && !this.cfg.pc) this.quickSub(team);
        if (scripted && !penShooter) { if (inp.timeout && rs && rs.team === team) this.callTimeout(team); continue; }
        if (p.hasBall) {
          const canAct = this.state === 'live' || (rs && rs.ready && rs.taker === p);
          // Первые 0,35 с после отбора или приёма броски не срабатывают: нажатия комбо не должны превращаться в бросок
          const fresh = this.t - (p.gainT === undefined ? -9 : p.gainT) < (p.gainHow === 'catch' ? 0.1 : 0.35);
          // Буфер: бросок, нажатый во время кача или приёма, срабатывает сразу после них
          if (inp.shootP && p.action && ['fake', 'catch', 'drawfoul', 'release'].includes(p.action.type)) p.shootBuf = this.t;
          const buffered = p.shootBuf && this.t - p.shootBuf < 0.45 && inp.shootD;
          // Пас в разрез (клавиатура, геймпад): тап — сразу лучшему, держать — прицел (кольцо на воде), отпустить — пас.
          // Тач шлёт разрез уже по отпусканию кнопки (thruD = false) — он идёт старым путём ниже.
          const noPen = !(rs && rs.type === 'penalty');
          let ta = this.thruAim[id];
          if (ta && (ta.p !== p || this.t - ta.seen > 0.05 || !noPen || (p.action && p.action.type !== 'catch'))) ta = this.thruAim[id] = null;
          if (!ta && inp.thru && inp.thruD && canAct && noPen && (!p.action || p.action.type === 'catch')) {
            ta = this.thruAim[id] = { p, t: this.t, seen: this.t, rel: 0, to: null, cand: null, candT: 0, x: 0, z: 0, ok: false, open: false, vis: false, lob: false, sh0: !!inp.sprintK, shPrev: !!inp.sprintK, lobKey: false, shown: null, shownK: -2, emitT: -9 };
          }
          if (ta) {
            ta.seen = this.t;
            if (!ta.rel) {
              // Рывок в прицеле переключает «верхом / по воде»; зажатый ещё до прицела (плыл рывком) — просто рывок
              const sk = !!inp.sprintK;
              if (!sk) ta.sh0 = false;
              if (sk && !ta.shPrev) ta.lob = !ta.lob;
              ta.shPrev = sk;
              if (sk && !ta.sh0) p.input.sprint = false;
              if (inp.lobpass) { ta.rel = this.t; ta.lobKey = true; } // пас верхом в прицеле — сразу разрез верхом
              else if (!inp.thruD) ta.rel = this.t;
              else if (this.t - ta.t >= THRU_TAP) this.aimThrough(p, inp, ta);
            }
            if (ta.rel) {
              if (this.t - ta.rel > 0.45) this.thruAim[id] = null; // так и не дождались конца приёма мяча
              else if (canAct && !p.action) {
                const tap = ta.rel - ta.t < THRU_TAP;
                const lob = ta.lobKey || (!tap && ta.lob);
                const to = !tap && ta.ok && this.thruOk(p, ta.to) ? ta.to : this.pickThrough(p, inp, lob);
                this.thruAim[id] = null;
                if (to) { this.doPass(p, to, { through: true, lob }); continue; }
                this.emit('passinfo', { msg: 'Некому отдать в разрез — нет партнёра на ходу к воротам' });
              }
            }
          }
          if (canAct && !p.action) {
            if (inp.pass && !(rs && rs.type === 'penalty')) this.passCharge[id] = { t: this.t };
            if (fresh) { /* ждём */ }
            else if (inp.shootP || buffered) { p.shootBuf = 0; if (this.startShot(p, { type: 'power' })) p.action.key = 'shoot'; }
            else if (inp.skipP) { if (this.startShot(p, { type: 'skip' })) p.action.key = 'skip'; }
            else if (inp.lob) { this.startShot(p, { type: 'lob', ai: true, zAim: this.humanAim(p, inp) * 0.9, yAim: 0.78, power: 0.6 }); }
            else if (inp.fake && !(rs && rs.type === 'penalty')) this.doFake(p);
            else if (inp.foul && this.state === 'live') this.drawFoul(p, id);
            else if (inp.thru && !inp.thruD && !(rs && rs.type === 'penalty')) { const to = this.pickThrough(p, inp, !!inp.thruUp); if (to) { this.doPass(p, to, { through: true, lob: !!inp.thruUp }); continue; } else this.emit('passinfo', { msg: 'Некому отдать в разрез — нет партнёра на ходу к воротам' }); }
            else if (inp.lobpass && !(rs && rs.type === 'penalty')) { const to = this.pickReceiver(p, inp); if (to) { this.doPass(p, to, { lob: true }); continue; } }
          }
          // Пас по отпусканию J: короткое нажатие — обычный, удержание — резкий
          const pch = this.passCharge[id];
          if (pch && !inp.passD) {
            this.passCharge[id] = null;
            const held = this.t - pch.t;
            const to = this.pickReceiver(p, inp);
            // Жесты как в FC Mobile: свайп вверх по кнопке — пас верхом, вниз — сильный пас
            const o = inp.passGest === 'up' ? { lob: true } : inp.passGest === 'down' ? { power: 0.75 } : { power: held < 0.16 ? 0 : clamp((held - 0.16) / 0.55, 0, 1) };
            if (to && !p.action) { this.doPass(p, to, o); continue; }
          }
          const a = p.action;
          if (a && a.type === 'windup' && !a.ai) {
            const held = a.key === 'skip' ? inp.skipD : inp.shootD;
            if (!held && !a.letGo) { a.letGo = true; a.power = clamp((a.t - 0.05) / 0.65, WP.Input.opts.autoPower ? 0.85 : 0.3, 1); }
            // Свайп по кнопке броска: вверх — парашют, вниз — с отскоком
            if (!held && inp.shootGest && !a.gest) a.gest = inp.shootGest;
            // Полный замах занимает не меньше 0,24 с, даже если кнопку просто тапнули; бросок с ходу после паса — 0,15 с
            const quick = p.gainHow === 'catch' && a.t0 !== undefined && a.t0 - p.gainT < 0.6;
            if (a.letGo && a.t >= (quick ? 0.15 : 0.24)) {
              const type = a.gest === 'up' ? 'lob' : a.gest === 'down' ? 'skip' : a.opts.type;
              this.releaseShot(p, a, { type, power: type === 'lob' ? 0.6 : a.power, zAim: this.humanAim(p, inp) * (type === 'lob' ? 0.9 : 1), yAim: type === 'skip' ? 0 : type === 'lob' ? 0.78 : this.humanHeight(p) });
            }
          }
          if (rs && rs.ready && rs.taker === p && inp.mag > 0.35 && rs.type !== 'throwoff' && rs.type !== 'penalty' && !p.action) {
            rs.moveT = (rs.moveT || 0) + dt;
            if (rs.moveT > 0.25) this.putLive();
          }
          if (inp.timeout) this.callTimeout(team);
        } else {
          // Комбо «чистый вынос»: L → K → K, второй удар через 0,1–0,4 с после первого
          const cb = this.combo[id];
          if (cb.stage && this.t - cb.t > (cb.stage === 1 ? 0.6 : 0.45)) { const was = cb.stage; cb.stage = 0; this.emit('combo', { id, stage: 0, fail: was === 2, msg: was === 2 ? 'Второй удар опоздал' : '' }); }
          this.passCharge[id] = null; this.thruAim[id] = null;
          // «Руки»: защитник показывает судье, что не держит соперника, — фола не будет, но и отбора тоже
          if (inp.foulD && this.state === 'live' && !p.isGK) { p.hands = true; this.doBlock(p); cb.stage = 0; }
          if (inp.pass && this.cfg.pc) {
            // «Дай пас!»: партнёр с мячом ищет тебя
            const h = ball.holder;
            if (h && h.team === team && h !== p) { team.callFor = { p, t: this.t }; this.emit('callball', { p }); }
          } else if (inp.pass) {
            const others = team.players.filter(q => q.active && !q.isGK && q !== p)
              .sort((a, b) => Math.hypot(a.x - ball.pos.x, a.z - ball.pos.z) - Math.hypot(b.x - ball.pos.x, b.z - ball.pos.z));
            if (others[0]) { this.setControl(id, others[0]); cb.stage = 0; }
          }
          if (p.hands) { /* с поднятыми руками не отбирают */ }
          else if (inp.lob) { this.doBlock(p); cb.stage = 1; cb.t = this.t; this.emit('combo', { id, stage: 1 }); }
          else if (inp.shootP && this.state === 'live') {
            if (cb.stage === 1) { cb.stage = 2; cb.t = this.t; if (!p.action || p.action.type === 'block') p.action = { type: 'steal', t: 0, dur: 0.2 }; this.emit('combo', { id, stage: 2 }); }
            else if (cb.stage === 2) {
              const gap = this.t - cb.t; cb.stage = 0;
              if (gap >= 0.1 && gap <= 0.4) this.cleanStrip(p, id);
              else this.emit('combo', { id, stage: 0, fail: true, msg: 'Слишком быстро — нужен ритм' });
            } else this.tryStealBy(p);
          }
          if (inp.timeout && rs && rs.team === team) this.callTimeout(team);
        }
      }
    }

    callTimeout(team) {
      if (team.timeouts <= 0 || this.so) return false;
      const b = this.ball;
      const inPoss = (b.holder && b.holder.team === team) || (this.state === 'dead' && this.restart && this.restart.team === team && this.restart.type !== 'throwoff');
      if (!inPoss || (this.state !== 'live' && this.state !== 'dead')) return false;
      team.timeouts--;
      this.stopPlay('double');
      this.signal('timeout', { spot: { x: 0, z: 0 } });
      this.state = 'timeout'; this.stateT = 0; this.timeoutTeam = team;
      this.timeoutShot = this.shotClock;
      this.announce('ТАЙМ-АУТ', team.name + ' · осталось ' + team.timeouts, 'neutral');
      this.say(team.name + ' берёт тайм-аут.', 'info');
      if (b.holder) { b.holder.hasBall = false; b.holder = null; b.state = 'dead'; }
      for (const t of this.teams) {
        let i = 0;
        for (const p of t.players) if (p.active && !p.isGK) { p.target = { x: -t.dir * (3 + (i % 3) * 1.4), z: -R.HALF_W + 1.2 + Math.floor(i / 3) * 1.2 }; p.moveMode = 'swim'; p.action = null; i++; }
        this.autoSubs(t, 0.7);
      }
      this.emit('timeout', { team });
      return true;
    }

    endTimeout() {
      if (this.state !== 'timeout') return;
      const team = this.timeoutTeam;
      this.state = 'dead';
      this.setRestart('free', team, { x: -team.dir * 0.5, z: 0 }, null, { minSetup: 1.4, maxSetup: 3.0, noShot: true });
      this.shotClock = this.timeoutShot;
      WP.Audio.whistle('short');
      this.emit('timeoutEnd', {});
    }

    autoSubs(team, thr, max) {
      if (!team.bench.length || (team.human && team.tac.autoSubs === false)) return;
      let n = 0;
      const tired = team.players.filter(p => p.active && !p.isGK && !p.hasBall && p.stamina <= thr && !(this.isMe(p) && p.stamina > 0.2)).sort((a, b) => a.stamina - b.stamina);
      for (const p of tired) {
        if (n >= (max || 2)) break;
        const cand = team.bench.filter(b => !b.isGK && !b.outForGame && b.stamina > 0.85)
          .sort((a, b) => (b.role === p.role) - (a.role === p.role) || b.stamina - a.stamina)[0];
        if (!cand) continue;
        this.swap(team, p, cand); n++;
        this.say('Замена в команде ' + team.name + ': №' + cand.num + ' ' + cand.name + ' вместо №' + p.num + ' ' + p.name + '.', 'info');
      }
    }

    isMe(p) { return !!(this.cfg.pc && p && p.cid === this.cfg.pc.pid); }

    // ---------- розыгрыш «заслон» ----------
    callScreen(team, driverWish) {
      if (this.state !== 'live') return false;
      const pl = AI.startScreen(this, team, driverWish);
      if (!pl) { if (team.human) this.emit('passinfo', { msg: 'Заслон можно разыграть, когда мяч у своей команды' }); return false; }
      if (team.human) this.emit('passinfo', { msg: 'Заслон: №' + pl.screener.num + ' ' + pl.screener.name + ' ставит заслон для №' + pl.driver.num + ' ' + pl.driver.name });
      return true;
    }
    onScreenSet(team, pl) {
      const d = pl.def, S = pl.screener;
      // Защитник цепляет заслоняющего — удаление; заслоняющий толкается — фол в нападении
      const r = Math.random();
      if (r < 0.07 && !d.hands) { this.callExclusion(d, S, { x: S.x, z: S.z }, 'захват на заслоне'); team.ai.play = null; return; }
      if (r < 0.12) { team.ai.play = null; this.turnover(d.team, { x: S.x, z: S.z }, 'ФОЛ В НАПАДЕНИИ', S.name + ' толкнул защитника на заслоне'); return; }
      if (team.human) this.emit('passinfo', { msg: this.isMe(pl.driver) ? 'Заслон стоит — уходи к воротам!' : 'Заслон стоит! №' + pl.driver.num + ' открывается — пас (J)' });
    }

    // ---------- замены ----------
    // В остановке игры меняем сразу, по ходу — игрок плывёт в зону возвращения и меняется там
    requestSub(team, out, inn) {
      if (!out || !inn || !team.players.includes(out) || !team.bench.includes(inn) || inn.outForGame) return 'Эту замену сделать нельзя';
      if (out.excluded) return 'Удалённого игрока заменить нельзя, пока он в зоне удаления';
      if (out.isGK !== inn.isGK) return out.isGK ? 'Вратаря меняют только на вратаря' : 'Полевого меняют на полевого';
      if (out.hasBall) return 'Игрок с мячом не может уйти на замену';
      const stopped = this.state !== 'live';
      if (stopped) {
        this.swap(team, out, inn);
        if (this.restart && this.restart.taker === out) this.restart.taker = inn;
        this.say('Замена в команде ' + team.name + ': №' + inn.num + ' ' + inn.name + ' вместо №' + out.num + ' ' + out.name + '.', 'info');
        return 'Замена: №' + inn.num + ' ' + inn.name + ' вместо №' + out.num + ' ' + out.name;
      }
      if (out.isGK) return 'Вратаря меняют в остановке игры';
      if (out.ctrl && !this.cfg.pc) { const id = out.ctrl; const o = this.nearestTo(team, out.x, out.z, q => !q.isGK && q !== out); if (o) this.setControl(id, o); }
      out.rolling = true; out.rollTo = inn;
      return '№' + out.num + ' ' + out.name + ' плывёт в зону замены, выйдет №' + inn.num + ' ' + inn.name;
    }
    quickSub(team) {
      const out = team.players.filter(p => p.active && !p.isGK && !p.hasBall && !p.rolling && !this.isMe(p)).sort((a, b) => a.stamina - b.stamina)[0];
      if (!out) return;
      const inn = team.bench.filter(b => !b.isGK && !b.outForGame).sort((a, b) => (b.role === out.role) - (a.role === out.role) || b.stamina - a.stamina)[0];
      if (!inn) { this.emit('passinfo', { msg: 'На скамейке нет свежих игроков' }); return; }
      if (inn.stamina < out.stamina + 0.05) { this.emit('passinfo', { msg: 'Самый уставший — №' + out.num + ' ' + out.name + ', но на скамейке не свежее' }); return; }
      this.emit('passinfo', { msg: this.requestSub(team, out, inn) });
    }

    swap(team, out, inn) {
      out.dispose(); inn.buildRig();
      inn.x = out.x; inn.z = out.z; inn.vx = out.vx; inn.vz = out.vz; inn.heading = out.heading;
      inn.target = out.target; inn.slot = out.slot; inn.slotName = out.slotName; inn.mark = out.mark;
      inn.excluded = false; inn.rolling = false; inn.action = null; inn.lift = out.lift; inn.played = true;
      const i = team.players.indexOf(out);
      team.players[i] = inn;
      team.bench.splice(team.bench.indexOf(inn), 1);
      if (out.outForGame) team.outList.push(out); else team.bench.push(out);
      for (const q of team.opp.players) if (q.mark === out) q.mark = inn;
      if (out.ctrl) { const id = out.ctrl; out.ctrl = null; this.controlled[id] = null; this.setControl(id, inn); }
      if (this.isMe(inn)) { this.ffOn = false; this.emit('subin', { p: inn }); }
      team.ai.dirty = true;
      this.world.setBench(team.side, team.capHex, team.bench.filter(b => !b.outForGame).length);
    }

    // ---------- главный шаг ----------
    step(dt) {
      this.t += dt; this.stateT += dt;
      this.applyHumans(dt);
      for (const team of this.teams) {
        team.aiAcc += dt;
        if (team.aiAcc > 0.15) { AI.teamThink(this, team, team.aiAcc); team.aiAcc = 0; }
        for (const b of team.bench) b.stamina = Math.min(1, b.stamina + 0.02 * dt);
      }
      const h = this.ball.holder;
      if (h && !this.isHumanActing(h) && (this.state === 'live' || this.state === 'dead') && !this.aiThrough(h, dt)) AI.carrierThink(this, h, dt);
      for (const team of this.teams) {
        const gk = team.gk;
        if (gk && gk.active) { AI.gkUpdate(this, gk, dt); AI.gkSaveStep(this, gk, dt); }
      }
      for (const p of this.all()) this.updateAction(p, dt);
      if (this.state !== 'sprint' && this.state !== 'intro') for (const p of this.all()) p.move(dt, this.boundsFor(p));
      this.separate();
      switch (this.state) {
        case 'live': this.stepLive(dt); break;
        case 'dead': this.stepDead(dt); break;
        case 'sprint': this.stepSprint(); break;
        case 'penalty': this.stepPenalty(dt); break;
        case 'goal': {
          // Мяч долетает до сетки уже после гола — сетка должна прогнуться
          for (const e of this.ball.step(dt, null)) if (e.type === 'net') this.handleBallEvent(e);
          if (this.stateT > 3.2) { if (this.so) this.nextKick(); else if (this.clock <= 0) this.endPeriod(); else this.setupThrowOff(this.goalConceded); }
          break;
        }
        case 'timeout':
          if ((this.cfg.mode === 'demo' && this.stateT > 5) || this.stateT > 60) this.endTimeout();
          break;
      }
      this.updateExclusions(dt);
      this.rollingSubs(dt);
      if (this.aiChallengeAt && this.t >= this.aiChallengeAt) {
        this.aiChallengeAt = 0;
        const c = this.lastCall;
        if (c && !c.against.human) this.requestChallenge(c.against);
      }
    }

    isHumanActing(p) { return !!p.team.human && this.controlled[p.team.human] === p; }

    updateAction(p, dt) {
      const a = p.action; if (!a) return;
      a.t += dt;
      if (a.type === 'windup') {
        if (!p.hasBall) { p.action = null; return; }
        if (a.ai && a.t >= a.dur) this.releaseShot(p, a);
        else if (!a.ai && a.t > 1.6) this.releaseShot(p, a, { type: a.opts.type, power: 1, zAim: this.humanAim(p, this.inputs[p.ctrl]), yAim: 0.7 });
        return;
      }
      if (a.t >= a.dur) { if (a.type === 'release') p.liftTarget = 0.1; p.action = null; }
    }

    separate() {
      const ps = this.all().filter(p => p.active);
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const min = 0.56;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2, ux = dx / d, uz = dz / d;
          // Сильный игрок сдвигает слабого, а не наоборот
          const sa = a.attrs.str, sb = b.attrs.str;
          const wa = (a.isGK ? 0.3 : 1) * 2 * sb / (sa + sb), wb = (b.isGK ? 0.3 : 1) * 2 * sa / (sa + sb);
          a.x -= ux * push * wa; a.z -= uz * push * wa; b.x += ux * push * wb; b.z += uz * push * wb;
        }
      }
    }

    stepSprint() {
      for (const p of this.all()) { p.target = { x: p.x, z: p.z }; p.vx = p.vz = 0; p.faceTo = { x: 0, z: p.z * 0.3 }; }
      if (this.stateT > 2.6) {
        this.state = 'live'; this.stateT = 0;
        WP.Audio.whistle('short'); this.signal('start', { spot: { x: 0, z: 0 } });
        this.ball.place(0, 0); this.ball.state = 'free'; this.ball.vel.set(0, 0, 0); this.ball.lastTouch = null;
        this.announce('СПРИНТ', this.periodName(), 'neutral');
        for (const t of this.teams) {
          t.ai.phase = 'loose'; t.ai.phaseT = 0;
          for (const p of t.players) p.moveMode = 'sprint';
          if (t.sprinter) t.sprinter.target = { x: 0, z: 0 };
        }
      }
    }

    stepDead(dt) {
      const rs = this.restart;
      if (!rs) { this.state = 'live'; return; }
      rs.t += dt;
      this.ball.step(dt, null);
      let taker = rs.taker;
      if (!taker || !taker.active) taker = rs.taker = this.nearestTo(rs.team, rs.spot.x, rs.spot.z);
      if (!taker) return;
      if (!rs.ready) {
        taker.target = { x: rs.spot.x, z: rs.spot.z }; taker.moveMode = 'sprint';
        const d = Math.hypot(taker.x - rs.spot.x, taker.z - rs.spot.z);
        if ((d < 0.4 || rs.t > rs.maxSetup) && rs.t >= rs.minSetup) {
          if (d >= 0.4) { taker.x = rs.spot.x; taker.z = rs.spot.z; }
          if (rs.type === 'throwoff') {
            for (const p of this.all()) if (p !== taker && p.active) { if (p.team.dir > 0) p.x = Math.min(p.x, -0.5); else p.x = Math.max(p.x, 0.5); }
            WP.Audio.whistle('short'); this.signal('start', { spot: { x: 0, z: 0 } });
          }
          if (this.ball.holder !== taker) this.ball.attach(taker);
          taker.holdMode = 'hold'; taker.holdT = 0; taker.decideT = rs.type === 'free' ? rnd(0.2, 0.55) : rnd(0.5, 1.0);
          taker.vx *= 0.2; taker.vz *= 0.2; taker.action = null;
          taker.faceTo = { x: rs.team.dir * R.HALF_L, z: 0 };
          rs.ready = true; rs.readyT = 0;
          if (rs.team.human) this.setControl(rs.team.human, taker);
          // ИИ берёт тайм-аут в концовке
          const t = rs.team;
          if (!t.human && this.period === 4 && this.clock < 55 && Math.abs(t.score - t.opp.score) <= 1 && t.timeouts > 0 && rs.type !== 'throwoff' && Math.random() < 0.5 && !this.so) {
            this.callTimeout(t); return;
          }
        }
      } else {
        rs.readyT += dt;
        const human = this.isHumanActing(taker);
        if (human && rs.readyT > 3.5 && !rs.warned) {
          rs.warned = true;
          this.announce('ВВЕДИТЕ МЯЧ', rs.type === 'throwoff' || rs.type === 'goal' || rs.type === 'corner' ? 'J — пас партнёру' : 'J — пас · поплыть с мячом · K — бросок, если за 6 м', 'neutral');
        }
        // Человек не вводит мяч 6 с — за него пасует ИИ (в онлайне соперник мог отвлечься)
        if (human && rs.readyT > 6 && rs.type !== 'penalty') {
          const to = this.pickReceiver(taker, { mag: 0 }); if (to) this.doPass(taker, to);
        } else if (rs.readyT > 9 && this.cfg.mode !== 'demo') {
          this.turnover(rs.team.opp, { x: taker.x, z: taker.z }, 'ЗАДЕРЖКА', 'Мяч не введён в игру вовремя');
        } else if (rs.readyT > 5 && !human) {
          if (rs.type === 'throwoff') { const to = this.pickReceiver(taker, { mag: 0 }); if (to) this.doPass(taker, to); }
          else this.putLive();
        }
      }
    }

    stepPenalty(dt) {
      const rs = this.restart;
      rs.t += dt;
      this.ball.step(dt, null);
      const shooter = rs.taker, gk = rs.team.opp.gk;
      if (!rs.ready) {
        if (rs.t > 1.8) {
          shooter.x = rs.spot.x; shooter.z = 0; shooter.vx = shooter.vz = 0;
          shooter.heading = rs.team.dir > 0 ? 0 : Math.PI;
          if (gk) { gk.x = -gk.team.dir * (R.HALF_L - 0.25); gk.z = 0; gk.vx = gk.vz = 0; gk.liftTarget = 1; gk.heading = gk.team.dir > 0 ? 0 : Math.PI; }
          this.ball.attach(shooter);
          shooter.holdMode = 'hold';
          rs.ready = true; rs.readyT = 0;
          WP.Audio.whistle('short'); this.signal('penalty', { spot: rs.spot });
          if (rs.team.human) this.setControl(rs.team.human, shooter);
        }
        return;
      }
      rs.readyT += dt;
      shooter.target = { x: shooter.x, z: shooter.z }; shooter.faceTo = { x: rs.team.dir * R.HALF_L, z: 0 };
      if (gk) { gk.target = { x: gk.x, z: gk.z }; gk.faceTo = shooter; }
      const human = this.isHumanActing(shooter);
      if (!shooter.action && ((!human && rs.readyT > rs.shotAt) || rs.readyT > 4)) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.startShot(shooter, { type: Math.random() < 0.12 ? 'skip' : 'power', ai: true, zAim: side * rnd(1.0, 1.3) * R.GOAL_HALF_W / 1.5, yAim: Math.random() < 0.6 ? rnd(0.6, 0.82) : rnd(0.12, 0.3), power: rnd(0.8, 1) });
      }
    }

    stepLive(dt) {
      const ball = this.ball;
      this.clock -= dt;
      if (this.possession && !this.shotReset && !this.so) this.shotClock -= dt;
      const cols = this.colliders; cols.length = 0;
      if (ball.state === 'free') {
        for (const t of this.teams) { const gk = t.gk; if (gk && gk.active && !(ball.lastTouch === gk && this.t - ball.releaseT < 0.3)) AI.gkColliders(gk, cols); }
        const f = ball.flight;
        for (const p of this.all()) {
          if (!p.active || p.isGK) continue;
          if (f && (f.from === p || f.to === p)) continue;
          if (ball.lastTouch === p && this.t - ball.releaseT < 0.3) continue;
          if (Math.hypot(p.x - ball.pos.x, p.z - ball.pos.z) > 2.5) continue;
          const by = p.bodyY();
          cols.push({ pos: new THREE.Vector3(p.x, by + 0.21, p.z), r: 0.12, owner: p, kind: 'body' });
          if (p.action && p.action.type === 'block' && p.action.t > 0.15) {
            const c = Math.cos(p.heading), s = Math.sin(p.heading);
            cols.push({ pos: new THREE.Vector3(p.x - s * 0.2 + c * 0.06, by + 0.7, p.z + c * 0.2 + s * 0.06), r: 0.11, owner: p, kind: 'block' });
          }
        }
      }
      const evs = ball.step(dt, cols);
      for (const e of evs) { this.handleBallEvent(e); if (this.state !== 'live') return; }
      if (ball.flight && ball.flight.type === 'pass' && this.t - ball.flight.t > (ball.flight.through ? 3.4 : 2.2)) ball.flight = null;
      if (ball.state === 'free') this.checkCatches();
      if (this.state !== 'live') return;
      // Серия пенальти: исход попытки
      if (this.so) {
        if (this.so.shotT && (ball.holder || this.t - this.so.shotT > 3.2 || (ball.state === 'free' && ball.vel.length() < 0.6 && this.t - this.so.shotT > 1.2))) this.recordKick(false);
        return;
      }
      // Время атаки
      if (this.shotClock <= 0 && this.possession && !this.shotReset) {
        const f = ball.flight;
        if (!(ball.state === 'free' && f && f.type === 'shot')) {
          WP.Audio.horn();
          const h = ball.holder;
          const why = 'sc:' + (h ? (h.isGK ? 'gk' : 'fp d' + Math.round(AI.goalDist(h.team, h.x, h.z)) + ' act:' + (h.action ? h.action.type : '-')) : ball.state + ':' + (f ? f.type : 'none'));
          this.dbg[why] = (this.dbg[why] || 0) + 1;
          const spot = ball.holder ? { x: ball.holder.x, z: ball.holder.z } : { x: ball.pos.x, z: ball.pos.z };
          const to = this.possession.opp;
          this.say('Истекли 28 секунд атаки у команды ' + this.possession.name + '.', 'info');
          this.turnover(to, spot, 'ВРЕМЯ АТАКИ ИСТЕКЛО', 'Мяч переходит к команде ' + to.name);
          return;
        }
      }
      // Конец периода (бросок, выпущенный до сирены, засчитывается)
      if (this.clock <= 0) {
        this.clock = 0;
        const f = ball.flight;
        if (ball.state === 'free' && f && f.type === 'shot' && !this.pendingEnd) this.pendingEnd = this.t;
        if (!this.pendingEnd || this.t - this.pendingEnd > 2.2) { this.endPeriod(); return; }
      }
      this.refAcc += dt;
      if (this.refAcc >= 0.1) { this.referee(this.refAcc); this.refAcc = 0; }
    }

    handleBallEvent(e) {
      const ball = this.ball, f = ball.flight;
      switch (e.type) {
        case 'goal': {
          const team = this.teams.find(t => t.dir === e.side);
          if (this.so) { this.recordKick(team === this.so.shooterTeam); return; }
          this.onGoal(team, f && f.type === 'shot' && f.team === team ? f.from : (ball.lastTouch && ball.lastTouch.team === team ? ball.lastTouch : null), f);
          return;
        }
        case 'post': case 'bar':
          WP.Audio.clang();
          this.world.splash(ball.pos.x, ball.pos.y, ball.pos.z, 4, 0.6);
          if (f && f.type === 'shot') { f.touched = true; this.shotReset = { team: f.team }; WP.Audio.crowd('ooh'); this.say((e.type === 'post' ? 'Штанга! ' : 'Перекладина! ') + f.from.name + ' не забивает.', 'info'); }
          return;
        case 'water': {
          const s = e.strength;
          if (f && f.type === 'pass') { if (f.wet && !f.landed) f.landed = true; else ball.flight = null; }
          this.world.splash(ball.pos.x, 0.05, ball.pos.z, Math.round(4 + s * 18), 0.4 + s * 1.2);
          this.world.addRipple(ball.pos.x, ball.pos.z, 0.02 + s * 0.06);
          this.world.foam(ball.pos.x, ball.pos.z, 0.3 + s * 0.5, 0.4 + s * 0.6);
          if (s > 0.15) WP.Audio.splash(s);
          return;
        }
        case 'skip':
          WP.Audio.slap();
          this.world.splash(ball.pos.x, 0.05, ball.pos.z, 18, 1.25, ball.vel.clone().normalize());
          this.world.addRipple(ball.pos.x, ball.pos.z, 0.05);
          this.world.foam(ball.pos.x, ball.pos.z, 0.6, 0.9);
          WP.Audio.splash(0.7);
          return;
        case 'net': WP.Audio.net(); if (this.world.netHit) this.world.netHit(e.side, e.z, e.y, e.speed); return;
        case 'hit': {
          const c = e.collider;
          WP.Audio.slap();
          if (c.kind === 'gk') {
            const gk = c.owner;
            if (f && f.type === 'shot' && f.team !== gk.team) {
              f.touched = true; this.shotReset = { team: f.team };
              if (f.onTarget && !f.saveCounted && !this.so) this.countSave(gk, f);
              this.world.splash(ball.pos.x, ball.pos.y, ball.pos.z, 8, 1);
              this.world.foam(gk.x, gk.z, 0.8, 0.8);
              WP.Audio.crowd('ooh');
            } else if (f && f.type === 'pass') ball.flight = null;
            ball.lastTouch = gk;
          } else if (c.kind === 'block') {
            const p = c.owner;
            if (f && f.type === 'shot') { p.team.stats.blocks++; this.say(p.name + ' блокирует бросок ' + f.from.name + '.', 'info'); }
            ball.lastTouch = p; ball.flight = null;
          } else {
            ball.lastTouch = c.owner;
            if (f && f.type === 'pass') ball.flight = null;
          }
          return;
        }
        case 'out': {
          if (this.so) { this.recordKick(false); return; }
          const last = ball.lastTouch;
          if (e.where === 'side') {
            const team = last ? last.team.opp : (this.possession ? this.possession.opp : this.teams[0]);
            this.stopPlay('short');
            if (team !== this.possession) this.shotClock = R.SHOT_CLOCK;
            this.shotReset = null;
            this.setRestart('free', team, { x: e.x, z: Math.sign(e.z) * (R.HALF_W - 0.4) }, null);
            this.announce('АУТ', 'Свободный бросок · ' + team.name, 'neutral');
          } else {
            const defTeam = this.teams.find(t => -t.dir === e.side);
            const attTeam = defTeam.opp;
            this.stopPlay('short');
            if (last && last.team === defTeam) {
              this.shotClock = Math.max(this.shotReset ? 0 : this.shotClock, R.SHOT_RESET);
              this.shotReset = null;
              const zside = e.z >= 0 ? 1 : -1;
              this.setRestart('corner', attTeam, { x: attTeam.dir * (R.HALF_L - 2), z: zside * (R.HALF_W - 0.4) }, null, { minSetup: 1.2 });
              if (this.restart) this.restart.allowShot = false;
              this.announce('УГЛОВОЙ', attTeam.name + ' · бросок с 2-метровой отметки', 'neutral');
              this.say('Угловой для команды ' + attTeam.name + '.', 'info');
            } else {
              this.shotClock = R.SHOT_CLOCK; this.shotReset = null;
              const gk = defTeam.gk;
              this.setRestart('goal', defTeam, { x: -defTeam.dir * (R.HALF_L - 1.0), z: clamp(e.z * 0.3, -1.5, 1.5) }, gk && gk.active ? gk : null, { minSetup: 1.2 });
              if (this.restart) this.restart.allowShot = false;
              this.announce('ВРАТАРСКИЙ БРОСОК', defTeam.name, 'neutral');
            }
          }
          return;
        }
      }
    }

    checkCatches() {
      const b = this.ball, f = b.flight;
      const sp = b.vel.length();
      const cands = [];
      for (const p of this.all()) {
        if (!p.active || p.catchCD > 0) continue;
        if (b.lastTouch === p && this.t - b.releaseT < 0.35) continue;
        const dh = Math.hypot(p.x - b.pos.x, p.z - b.pos.z);
        const isShot = f && f.type === 'shot' && !f.touched;
        if (p.isGK) {
          const inFront = (b.pos.x - p.x) * p.team.dir > -0.15 || b.pos.y < 0.3;
          const lobIn = isShot && f.kind === 'lob' && sp > 6;
          if (inFront && !lobIn && dh < 0.75 && b.pos.y < 0.9 + p.lift * 0.3 && (sp < 9.5 || !isShot) && AI.ownLineD(p.team, b.pos.x) < 7) cands.push([dh, p]);
          continue;
        }
        if (isShot && sp > 6) continue;
        const enemyPass = f && f.type === 'pass' && f.team !== p.team;
        const reachY = (enemyPass ? 0.9 : 1.1) + p.lift * 0.3;
        const rr = enemyPass ? 0.6 : b.pos.y < 0.3 ? 0.62 : 0.82;
        if (dh < rr && b.pos.y < reachY) cands.push([dh, p]);
      }
      if (!cands.length) return;
      cands.sort((a, c) => a[0] - c[0]);
      for (const [, p] of cands) {
        // Центровой: борьба за позицию при передаче
        if (f && f.type === 'pass' && f.to === p && !f.duelDone && p.slotName === 'hole' && AI.lineD(p.team, p.x) < 3.6) {
          f.duelDone = true;
          const d = AI.nearestOpp(p, undefined, undefined, true);
          if (d.p && d.d < 1.05 && this.cfDuel(p, d.p)) return;
        }
        let pc;
        if (b.pos.y < 0.32 && sp < 3.5) pc = 0.96;
        else if (f && f.type === 'pass' && f.team === p.team) {
          // Приём: чем выше «Пас» у получателя, тем более сильный мяч он удержит
          const handle = this.handleSpeed(p);
          pc = clamp((f.to === p ? 0.97 : 0.84) + (p.attrs.pas - 80) / 400 - Math.max(0, sp - handle) * 0.11, 0.12, 0.99);
          if (Math.random() >= pc && sp > handle) {
            this.say(p.name + ' не удержал слишком сильный пас (' + Math.round(sp * 3.6) + ' км/ч).', 'info');
            this.emit('passinfo', { fumble: true, p, kmh: Math.round(sp * 3.6) });
            p.catchCD = 0.6; b.vel.multiplyScalar(0.3); b.vel.x += rnd(-1.5, 1.5); b.vel.z += rnd(-1.5, 1.5); b.vel.y = Math.abs(b.vel.y) * 0.3 + 1; b.lastTouch = p; b.flight = null;
            return;
          }
        }
        else if (p.isGK) pc = sp < 6 ? 0.95 : 0.7;
        else if (f && f.type === 'pass') pc = (0.05 + p.attrs.def / 800) * (1 - clamp(sp / 14, 0, 0.85)) * (1 - (f.power || 0) * 0.5);
        else pc = sp < 6 ? 0.85 : 0.5;
        if (Math.random() < pc) {
          this.catchBall(p, f && f.type === 'pass' && f.team !== p.team ? 'intercept' : 'catch');
          return;
        }
        p.catchCD = 0.6;
        const deflect = f && f.type === 'pass' && f.team !== p.team ? Math.random() < 0.3 : true;
        if (sp > 3 && deflect) { b.vel.multiplyScalar(0.35); b.vel.x += rnd(-1, 1); b.vel.z += rnd(-1, 1); b.lastTouch = p; if (f && f.type === 'pass') b.flight = null; return; }
      }
    }

    // Борьба у ворот при передаче на центрового
    cfDuel(cf, def) {
      if (def.hands) return false;
      const s = (cf.attrs.str - def.attrs.str) / 100;
      const humanDef = def.ctrl && def.action && (def.action.type === 'steal' || def.action.type === 'block');
      const aggr = def.team.ai.aggr;
      const pEx = clamp(0.18 + s * 0.5 + (aggr - 0.6) * 0.3 - (humanDef ? 0.08 : 0), 0.05, 0.42);
      const pOrd = 0.22;
      const pSteal = clamp(0.13 - s * 0.35 + (def.attrs.def - 80) / 300 + (humanDef ? 0.15 : 0), 0.04, 0.45);
      const pPen = 0.025, pOff = 0.07;
      const r = Math.random();
      let acc = 0;
      if (r < (acc += pEx)) {
        if (Math.random() < 0.015) this.callExclusion(def, cf, { x: cf.x, z: cf.z }, 'грубость', true);
        else this.callExclusion(def, cf, { x: cf.x, z: cf.z }, 'захват центрового');
        return true;
      }
      if (r < (acc += pPen)) { this.callPenalty(def, cf); return true; }
      if (r < (acc += pOrd)) { this.catchBall(cf, 'catch'); this.callFoul(cf.team, { x: cf.x, z: cf.z }, cf, 'ФОЛ НА ЦЕНТРОВОМ'); return true; }
      if (r < (acc += pSteal)) { this.catchBall(def, 'intercept'); return true; }
      if (r < (acc += pOff)) {
        this.say('Фол в нападении: ' + cf.name + ' оттолкнулся от защитника.', 'info');
        this.turnover(def.team, { x: cf.x, z: cf.z }, 'ФОЛ В НАПАДЕНИИ', cf.name + ' оттолкнул защитника');
        return true;
      }
      return false;
    }

    referee(dt) {
      const ball = this.ball;
      const c = ball.holder;
      const pt = this.possession;
      // 1. Отборы и фолы защитников ИИ против игрока с мячом
      if (c && !c.isGK) {
        for (const d of c.team.opp.players) {
          if (!d.active || d.isGK || this.isHumanActing(d)) continue;
          const dist = Math.hypot(d.x - c.x, d.z - c.z);
          if (dist > 1.2) continue;
          const exposed = c.holdMode === 'hold' || (c.action && c.action.type === 'windup');
          const lineD = AI.lineD(c.team, c.x);
          const gvx = c.team.dir * R.HALF_L - c.x, gvz = -c.z, gl = Math.hypot(gvx, gvz) || 1;
          const behind = ((d.x - c.x) * gvx + (d.z - c.z) * gvz) / (gl * dist) < -0.3;
          // Чистый вынос защитником ИИ: спереди или сбоку. Ведение — мяч перед головой, его легко выбить тому, кто в лоб
          if (!behind && dist < 1.15 && !(d.stealCD > 0) && !d.action && !(d.stunT > 0)) {
            const sp = Math.hypot(c.vx, c.vz);
            const mvx = sp > 0.3 ? c.vx / sp : Math.cos(c.heading), mvz = sp > 0.3 ? c.vz / sp : Math.sin(c.heading);
            const front = ((d.x - c.x) * mvx + (d.z - c.z) * mvz) / dist > 0.35;
            const dribbling = c.holdMode === 'dribble' || sp > 0.8;
            // Часто — только когда ведущий плывёт прямо на защитника; просто стоять рядом с мячом почти безопасно
            const into = dribbling && front && sp > 0.7;
            // Против ведущего-человека в полную силу; ИИ-атакующие и так не лезут напролом — им редко
            const vsHuman = !!(c.ctrl && c.team.human);
            const lv = d.team.ai.aggr / 0.6, rateS = (into ? 1.0 : dribbling ? 0.12 : exposed ? 0.08 : 0.04) * lv * lv * (d.team.ai.pressing ? 1.3 : 1) * (vsHuman ? 1 : 0.12);
            if (Math.random() < 1 - Math.exp(-rateS * dt)) { this.aiStrip(d, c, front, dribbling); if (this.state !== 'live' || this.ball.holder !== c) return; continue; }
          }
          if (dist > 1.0) continue;
          let rate = d.team.ai.aggr * (exposed ? (lineD < 8 ? 0.26 : 0.1) : 0.07) * (behind ? 0.4 : 1) * (d.team.ai.pressing ? 1.7 : 1);
          if (lineD > R.LINE_6 && lineD < 9 && exposed) rate *= 0.6;
          if (Math.random() < 1 - Math.exp(-rate * dt)) { this.tryStealBy(d); if (this.state !== 'live') return; }
        }
      }
      // 2. Центровой без мяча: захват
      if (pt && c && c.team === pt) {
        for (const a of pt.players) {
          if (!a.active || a.hasBall || a.isGK) continue;
          if (AI.lineD(pt, a.x) > 3.6 || Math.abs(a.z) > 3) continue;
          const n = AI.nearestOpp(a, undefined, undefined, true);
          if (n.d < 0.7 && !n.p.hands && Math.random() < 1 - Math.exp(-0.016 * n.p.team.ai.aggr * dt)) {
            this.callExclusion(n.p, a, { x: a.x, z: a.z }, 'захват игрока без мяча'); return;
          }
        }
      }
      // 3. Контратака: помеха сзади
      if (pt) {
        for (const a of pt.players) {
          if (!a.active || a.isGK) continue;
          if (a.vx * pt.dir < 1.35) continue;
          for (const d of pt.opp.players) {
            if (!d.active || d.isGK || d.hands) continue;
            const dd = Math.hypot(d.x - a.x, d.z - a.z);
            if (dd > 0.95) continue;
            if ((d.x - a.x) * pt.dir > -0.15) continue;
            const lineD = AI.lineD(pt, a.x);
            const alone = pt.opp.players.every(o => !o.active || o.isGK || o === d || AI.lineD(pt, o.x) > lineD);
            // Тактический фол: остановить выход один на один до 6 метров (удаление лучше гола)
            if (a.hasBall && alone && lineD >= R.LINE_6 && lineD < 12 && !this.isHumanActing(d) && Math.random() < 1 - Math.exp(-1.4 * dt)) {
              this.callExclusion(d, a, { x: a.x, z: a.z }, 'тактический фол при выходе один на один'); return;
            }
            if (dd > 0.6) continue;
            if (a.hasBall && alone && lineD < R.LINE_6 && Math.random() < 1 - Math.exp(-0.9 * dt)) { this.callPenalty(d, a); return; }
            if (Math.random() < 1 - Math.exp(-0.022 * d.team.ai.aggr * dt)) { this.callExclusion(d, a, { x: a.x, z: a.z }, 'помеха в контратаке'); return; }
          }
        }
      }
      // 4. Правило 2 метров
      if (pt && ((c && c.team === pt) || (ball.flight && ball.flight.type === 'pass' && ball.flight.team === pt))) {
        const bl = AI.lineD(pt, ball.pos.x);
        for (const a of pt.players) {
          if (!a.active || a.hasBall || a.isGK) { a.offT = 0; continue; }
          const l = AI.lineD(pt, a.x);
          if (l < R.LINE_2 && l < bl - 0.15) a.offT = (a.offT || 0) + dt; else a.offT = 0;
          if (a.offT > 0.45) {
            a.offT = 0;
            const dteam = pt.opp;
            this.say('Нарушение правила 2 метров: ' + this.pname(a) + '.', 'info');
            this.stopPlay('short');
            this.shotClock = R.SHOT_CLOCK;
            this.setRestart('free', dteam, { x: a.x, z: a.z }, dteam.gk && dteam.gk.active ? dteam.gk : null);
            this.announce('ВНЕ ИГРЫ · 2 МЕТРА', '№' + a.num + ' ' + a.name + ' впереди мяча в 2-метровой зоне', 'neutral');
            return;
          }
        }
      }
    }

    onGoal(team, scorer, f) {
      this.state = 'goal'; this.stateT = 0;
      team.score++;
      const pp = this.activeField(team) > this.activeField(team.opp) && team.opp.players.some(p => p.excluded && !p.outForGame);
      if (pp) team.stats.ppGoals++;
      if (f && f.penalty) team.stats.penGoals++;
      if (f && f.saveCounted) { const gk = team.opp.gk; if (gk) { gk.stats.saves--; team.opp.stats.saves--; } }
      if (scorer) { scorer.stats.goals++; scorer.action = { type: 'celebrate', t: 0, dur: 2.6 }; }
      if (f && f.assist && f.assist !== scorer && f.assist.team === team) f.assist.stats.assists = (f.assist.stats.assists || 0) + 1;
      if (team.ai.phaseT < 6 && !pp && f && f.type === 'shot' && !f.penalty) team.stats.counterGoals++;
      WP.Audio.whistle('double'); WP.Audio.cheer(team === this.teams[0]); this.world.cheer(true);
      this.signal('goal', { spot: { x: team.dir * R.HALF_L, z: 0 } });
      this.lastGoalT = this.t;
      const score = this.teams[0].score + ':' + this.teams[1].score;
      const kinds = { skip: 'с отскоком от воды', lob: 'парашютом', turn: 'разворотом', power: '' };
      const how = f && f.type === 'shot' ? [kinds[f.kind] || '', f.kmh ? f.kmh + ' км/ч' : ''].filter(Boolean).join(', ') : '';
      const who = scorer ? scorer.name + ' (№' + scorer.num + ')' : 'Автогол';
      this.announce('ГОЛ! ' + team.code + ' · ' + score, who + (how ? ' · ' + how : '') + (pp ? ' · в большинстве' : f && f.penalty ? ' · пенальти' : ''), 'goal');
      this.say('ГОЛ! ' + who + ' — ' + team.name + (how ? ', ' + how : '') + (pp ? ', реализовано большинство' : '') + '. Счёт ' + this.teams[0].code + ' ' + score + ' ' + this.teams[1].code + '.', 'goal');
      for (const p of this.all()) {
        if (p.save) AI.gkSaveEnd(p);
        if (p.excluded && !p.outForGame && !p.hardTime) { p.excluded = false; p.exclTimer = 0; p.reentryOK = false; }
      }
      this.shotReset = null;
      this.goalConceded = team.opp;
      this.noteCall({ type: 'goal', against: team.opp, team, scorer, pp, pen: !!(f && f.penalty), correct: Math.random() < 0.95 });
      this.emit('goal', { team, scorer });
      if (scorer) this.emit('card', { kind: 'goal', player: scorer, team, extra: [how, pp ? 'в большинстве' : f && f.penalty ? 'с пенальти' : ''].filter(Boolean).join(' · ') });
      if (this.clock > 0) for (const t of this.teams) this.autoSubs(t, 0.5, 1);
    }

    updateExclusions(dt) {
      for (const team of this.teams) {
        for (const p of team.players.slice()) {
          if (p.rolling) {
            const zone = { x: -team.dir * (R.HALF_L + 1.0), z: -(R.HALF_W + 0.7) };
            if (!p.active) { p.rolling = false; continue; }
            if (Math.hypot(p.x - zone.x, p.z - zone.z) < 1.1) {
              const want = p.rollTo && team.bench.includes(p.rollTo) && !p.rollTo.outForGame ? p.rollTo : null;
              const cand = want || team.bench.filter(b => !b.isGK && !b.outForGame && b.stamina > 0.8).sort((a, b) => (b.role === p.role) - (a.role === p.role) || b.stamina - a.stamina)[0];
              p.rolling = false; p.rollTo = null;
              if (cand) { this.swap(team, p, cand); this.say('Замена в команде ' + team.name + ': №' + cand.num + ' ' + cand.name + ' вместо №' + p.num + ' ' + p.name + '.', 'info'); }
            }
            continue;
          }
          if (!p.excluded) continue;
          const zone = { x: -team.dir * (R.HALF_L + 1.0), z: -(R.HALF_W + 0.7) };
          const at = Math.hypot(p.x - zone.x, p.z - zone.z) < 1.0;
          if (p.outForGame) {
            if (at || this.state === 'break') this.substituteOut(team, p);
            continue;
          }
          if (this.state === 'live') p.exclTimer -= dt;
          if (this.state === 'live' && at && (p.exclTimer <= 0 || (p.reentryOK && !p.hardTime))) {
            p.excluded = false; p.hardTime = false; p.reentryOK = false; p.exclTimer = 0;
            p.z = -R.HALF_W + 0.35; p.x = -team.dir * (R.HALF_L - 0.3);
            team.ai.dirty = true; team.opp.ai.dirty = true;
            this.emit('reentry', { p });
          }
        }
      }
    }

    substituteOut(team, out) {
      let cand = team.bench.filter(b => !b.outForGame && b.isGK === out.isGK).sort((a, b) => (b.role === out.role) - (a.role === out.role) || b.stamina - a.stamina)[0];
      // Второго вратаря нет — в ворота встаёт полевой игрок в красной шапочке (как разрешают правила)
      if (!cand && out.isGK) {
        cand = team.bench.filter(b => !b.outForGame).sort((a, b) => b.attrs.str + b.heightCm - a.attrs.str - a.heightCm)[0];
        if (cand) { cand.role = 'GK'; cand.isGK = true; cand.attrs.gk = Math.round(45 + cand.attrs.def * 0.2); this.say(cand.name + ' встаёт в ворота вместо вратаря.', 'info'); }
      }
      if (!cand) {
        // Замены нет — команда доигрывает в меньшинстве
        out.dispose(); team.players.splice(team.players.indexOf(out), 1); team.outList.push(out);
        this.say(team.name + ': замены нет, команда доигрывает вшестером.', 'red');
        team.ai.dirty = true; return;
      }
      const timer = out.exclTimer, hard = out.hardTime;
      this.swap(team, out, cand);
      cand.excluded = true; cand.exclTimer = Math.max(0, timer); cand.hardTime = hard; cand.reentryOK = false;
      this.say('На замену выходит №' + cand.num + ' ' + cand.name + ' (' + team.code + ').', 'info');
    }

    endPeriod() {
      WP.Audio.horn();
      this.pendingEnd = 0;
      for (const p of this.all()) { p.action = null; if (p.save) AI.gkSaveEnd(p); }
      if (this.ball.holder) { this.ball.holder.hasBall = false; this.ball.holder = null; }
      this.ball.state = 'dead'; this.ball.flight = null;
      this.restart = null;
      const [a, b] = this.teams;
      if (this.period < R.PERIODS) {
        this.state = 'break'; this.stateT = 0;
        this.announce('КОНЕЦ ' + this.period + '-ГО ПЕРИОДА', a.code + ' ' + a.score + ':' + b.score + ' ' + b.code, 'neutral');
        this.say('Конец ' + this.period + '-го периода. ' + a.code + ' ' + a.score + ':' + b.score + ' ' + b.code + '.', 'info');
        this.emit('break', { period: this.period });
      } else if (a.score === b.score && this.cfg.shootout) {
        this.announce('НИЧЬЯ', 'Серия пенальти', 'neutral');
        this.say('Основное время закончилось вничью — серия пенальти.', 'info');
        this.state = 'break'; this.stateT = 0; this.soPending = true;
        this.emit('break', { period: this.period, shootout: true });
      } else this.finish();
    }

    nextPeriod() {
      if (this.state !== 'break') return;
      if (this.soPending) { this.soPending = false; this.startShootout(); return; }
      this.period++;
      if (this.period === 3) for (const t of this.teams) t.dir = -t.dir;
      this.clock = this.periodLen;
      if (this.cfg.pc && this.cfg.pc.enter && this.period === this.cfg.pc.enter) {
        const t = this.teams.find(x => x.bench.some(p => p.cid === this.cfg.pc.pid));
        const me = t && t.bench.find(p => p.cid === this.cfg.pc.pid);
        if (me) {
          const pool = t.players.filter(p => p.active && p.isGK === me.isGK);
          const out = pool.filter(p => p.role === me.role).sort((a, b) => a.stamina - b.stamina)[0] || pool.sort((a, b) => a.stamina - b.stamina)[0];
          if (out) { this.swap(t, out, me); this.say(me.name + ' выходит на замену вместо ' + out.name + '.', 'info'); }
        }
      }
      for (const t of this.teams) {
        for (const p of t.roster) p.stamina = Math.min(1, p.stamina + (this.period === 3 ? 0.45 : 0.3));
        for (const p of t.players.slice()) if (p.excluded && !p.outForGame) { p.excluded = false; p.hardTime = false; }
        this.autoSubs(t, 0.8, 3);
      }
      this.setupSprint(false);
    }

    finish() {
      this.state = 'final'; this.stateT = 0;
      const [a, b] = this.teams;
      const soTxt = this.so ? ' (пен. ' + this.soScore() + ')' : '';
      this.announce('ФИНАЛЬНЫЙ СВИСТОК', a.code + ' ' + a.score + ':' + b.score + ' ' + b.code + soTxt, 'neutral');
      this.say('Матч окончен: ' + a.name + ' ' + a.score + ':' + b.score + ' ' + b.name + soTxt + '.', 'info');
      this.emit('final', {});
    }

    // ---------- серия пенальти ----------
    startShootout() {
      const order = this.teams.map(t => t.players.concat(t.bench).filter(p => !p.isGK && !p.outForGame).sort((x, y) => (y.attrs.sht + y.attrs.acc) - (x.attrs.sht + x.attrs.acc)));
      this.so = { kicks: [[], []], order, idx: [0, 0], turn: 0, shotT: 0, shooterTeam: null };
      for (const p of this.all()) { p.excluded = false; p.hardTime = false; }
      this.nextKick();
    }

    nextKick() {
      const so = this.so;
      if (this.soFinished()) { this.finish(); return; }
      const t = this.teams[so.turn];
      so.shooterTeam = t;
      t.dir = 1; t.opp.dir = -1;
      const list = so.order[so.turn].filter(p => t.players.includes(p));
      const shooter = list[so.idx[so.turn] % Math.max(1, list.length)] || t.players.find(p => !p.isGK && p.active);
      so.idx[so.turn]++;
      so.shotT = 0;
      this.startPenalty(t, shooter, true);
      this.emit('shootout', { so });
    }

    recordKick(goal) {
      const so = this.so;
      if (!so || !so.shotT) return;
      so.kicks[so.turn].push(goal);
      so.shotT = 0;
      const t = this.teams[so.turn];
      this.state = 'goal';
      if (goal) { this.stateT = 0; WP.Audio.whistle('double'); WP.Audio.cheer(true); this.world.cheer(true); this.announce('ГОЛ', t.code + ' · серия ' + this.soScore(), 'goal'); }
      else { this.stateT = 1.2; WP.Audio.whistle('short'); this.announce('МИМО', t.code + ' · серия ' + this.soScore(), 'neutral'); }
      this.say('Серия пенальти: ' + t.name + (goal ? ' забивает' : ' не забивает') + '. ' + this.soScore() + '.', goal ? 'goal' : 'info');
      so.turn = 1 - so.turn;
      this.emit('shootout', { so });
    }

    soScore() { const s = this.so; return s.kicks[0].filter(Boolean).length + ':' + s.kicks[1].filter(Boolean).length; }

    soFinished() {
      const s = this.so, a = s.kicks[0], b = s.kicks[1];
      const ga = a.filter(Boolean).length, gb = b.filter(Boolean).length;
      if (a.length <= 5 && b.length <= 5) {
        if (ga + (5 - a.length) < gb || gb + (5 - b.length) < ga) return true;
        if (a.length === 5 && b.length === 5) return ga !== gb;
        return false;
      }
      return a.length === b.length && ga !== gb;
    }

    // ---------- визуал ----------
    // Борьба у ворот: центровой и его защитник держат друг друга
    computeWrestle() {
      for (const p of this.all()) p.wrestle = null;
      const pt = this.possession;
      if (!pt || (this.state !== 'live' && this.state !== 'dead')) return;
      for (const a of pt.players) {
        if (!a.active || a.isGK || a.hasBall || a.action) continue;
        if (AI.lineD(pt, a.x) > 3.6 || Math.abs(a.z) > 3) continue;
        const n = AI.nearestOpp(a, undefined, undefined, true);
        if (!n.p || n.d > 0.9 || n.p.wrestle || n.p.hasBall || n.p.action || n.p.hands) continue;
        a.wrestle = { p: n.p, role: 'att' }; n.p.wrestle = { p: a, role: 'def' };
      }
    }

    syncVisuals(dt) {
      const ball = this.ball;
      if (dt > 0) this.computeWrestle();
      for (const p of this.all()) if (p.rig) p.animate(dt, this.t, ball);
      ball.render(dt);
      for (const id of ['p1', 'p2']) {
        const p = this.controlled[id], ring = this.rings[id];
        if (p && p.rig && p.active && this.state !== 'final') { ring.visible = true; ring.position.set(p.x, 0.05 + this.world.waveHeight(p.x, p.z), p.z); ring.scale.setScalar(1 + 0.06 * Math.sin(this.t * 6)); }
        else ring.visible = false;
      }
      for (const id of ['p1', 'p2']) {
        const mk = this.markers[id], p = this.controlled[id], inp = this.inputs[id], tm = this.thruMk[id];
        mk.arrow.visible = false; mk.ret.visible = false; tm.g.visible = false;
        if (!p || !inp || !p.hasBall || this.state === 'final' || this.state === 'break' || this.state === 'goal') continue;
        const rs = this.restart;
        const canAct = this.state === 'live' || (rs && rs.ready && rs.taker === p);
        const aim = this.thruAiming(id);
        if (aim && aim.p === p) {
          // Прицел разреза: стрелка над адресатом, кольцо в точке приёма (зелёное — успевает первым, оранжевое — спорно)
          const to = aim.to;
          if (to && to.rig) {
            const col = aim.open ? THRU_OPEN : THRU_HOT, wy = this.world.waveHeight(aim.x, aim.z);
            tm.mat.color.setHex(col); tm.fill.color.setHex(col);
            tm.ring.position.set(aim.x, 0.06 + wy, aim.z); tm.disc.position.copy(tm.ring.position);
            tm.ring.scale.setScalar((aim.lob ? 1.2 : 1) + 0.07 * Math.sin(this.t * 8)); tm.disc.scale.copy(tm.ring.scale);
            tm.dot.visible = aim.lob;
            if (aim.lob) tm.dot.position.set(aim.x, 0.65 + wy + 0.08 * Math.sin(this.t * 5), aim.z);
            const dx = aim.x - to.x, dz = aim.z - to.z, len = Math.hypot(dx, dz), l = len - 0.45;
            tm.run.visible = l > 0.25;
            if (tm.run.visible) {
              const mx = to.x + dx / len * l * 0.5, mz = to.z + dz / len * l * 0.5;
              tm.run.position.set(mx, 0.08 + this.world.waveHeight(mx, mz), mz);
              tm.run.scale.x = l; tm.run.rotation.y = -Math.atan2(dz, dx);
            }
            tm.g.visible = true;
            mk.arrow.visible = true; mk.arrow.position.set(to.x, to.bodyY() + 0.62 * to.h + 0.1 * Math.sin(this.t * 7), to.z);
          }
        } else if (canAct && !p.action && !(rs && rs.type === 'penalty')) {
          const to = this.pickReceiver(p, inp);
          if (to && to.rig) { mk.arrow.visible = true; mk.arrow.position.set(to.x, to.bodyY() + 0.62 * to.h + 0.1 * Math.sin(this.t * 7), to.z); }
        }
        const a = p.action;
        if (a && a.type === 'windup' && !a.ai) {
          const gx = p.team.dir * R.HALF_L, z = this.humanAim(p, inp);
          if (a.opts.type === 'skip') { const sp = this.skipPlan(p.ballHoldPos(new THREE.Vector3()), p.team, z * 0.95); mk.ret.position.set(sp.x, 0.08 + this.world.waveHeight(sp.x, sp.z), sp.z); mk.ret.rotation.set(-Math.PI / 2, 0, 0); }
          else { mk.ret.position.set(gx - p.team.dir * 0.05, 0.7, z); mk.ret.rotation.set(0, Math.PI / 2, 0); }
          const pw = clamp((a.t - 0.05) / 0.65, 0.3, 1);
          mk.ret.scale.setScalar(1.3 - pw * 0.5); mk.ret.visible = true;
        }
      }
      const sh = [];
      for (const p of this.all()) if (p.rig && p.active) sh.push([p.x, p.z, 0.5]);
      sh.push([ball.pos.x, ball.pos.z, 0.2 + ball.pos.y * 0.05]);
      this.world.setShadows(sh.slice(0, 16));
      for (const sg of this.signals) this.world.refGesture(sg);
      this.signals.length = 0;
      this.world.updateRefs(dt, ball.pos.x);
      // Судьи у линии ворот: флаг поднят, когда удалённый может возвращаться
      const flags = [null, null];
      for (const t of this.teams) if (t.players.some(p => p.excluded && !p.outForGame && (p.exclTimer <= 0 || (p.reentryOK && !p.hardTime)))) flags[-t.dir > 0 ? 1 : 0] = t.capHex;
      this.world.updateJudges(dt, flags);
      // Трибуны хлопают в такт, когда хозяева атакуют в напряжённой концовке
      const home = this.teams[0], h = ball.holder;
      WP.Audio.clapping(this.state === 'live' && !!h && h.team === home && AI.lineD(home, h.x) < 12 && (this.period >= 3 || Math.abs(home.score - home.opp.score) <= 1));
      const [a, b] = this.teams;
      const shot = this.possession && !this.so && this.state !== 'break' && this.state !== 'final' && this.shotClock < this.clock + 0.5 ? String(Math.max(0, Math.ceil(this.shotClock))) : '';
      this.world.updateBoards({ hc: a.code, ac: b.code, hs: a.score, as: b.score, per: this.so ? 'ПЕН' : 'P' + this.period, clock: this.clockLabel(), shot });
      WP.Audio.tension(ball.holder && AI.goalDist(ball.holder.team, ball.holder.x, ball.holder.z) < 7 ? 1 : 0);
    }
  }

  WP.Match = Match;
})();
