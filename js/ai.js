// Тактический ИИ: расстановки (3-3, «зонтик», 4-2), виды защиты (опека, прессинг, зона, M-зона),
// розыгрыш заслона, зонная защита в меньшинстве, решения игрока с мячом, вратарь.
// Позиции нумеруются как принято в водном поло: 1 — правый крайний, 2 — правый полусредний, 3 — разыгрывающий,
// 4 — левый полусредний, 5 — левый крайний, 6 — центровой (у ворот, на 2 м).
(function () {
  const R = WP.R;
  const AI = {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Позиции (dx — расстояние от линии ворот, r — вправо от атакующего)
  const F33 = [[2.4, 3.9], [5.1, 3.2], [6.9, 0], [5.1, -3.2], [2.4, -3.9], [2.35, 0]];
  const F42 = [[2.3, 1.75], [2.3, -1.75], [5.2, 4.2], [5.6, 1.45], [5.6, -1.45], [5.2, -4.2]];
  // «Зонтик» (дуга): полевые по дуге на 5–7 м, центровой — ручка зонтика; больше места для проходов и заслонов
  const FARC = [[3.1, 4.7], [5.7, 3.0], [7.0, 0], [5.7, -3.0], [3.1, -4.7], [2.3, 0.5]];
  // Большинство 3-3: три игрока на 2 м (две штанги и центр), три на 5 м
  const F33PP = [[2.2, 3.0], [5.3, 3.3], [6.3, 0], [5.3, -3.3], [2.2, -3.0], [2.2, 0]];
  AI.FORMS = {
    '33': { F: F33, names: ['wing', 'flat', 'point', 'flat', 'wing', 'hole'], pos: [1, 2, 3, 4, 5, 6] },
    arc: { F: FARC, names: ['wing', 'flat', 'point', 'flat', 'wing', 'hole'], pos: [1, 2, 3, 4, 5, 6] },
    '42e': { F: F42, names: ['post', 'post', 'wing', 'flat', 'flat', 'wing'], pos: [6, 6, 1, 2, 4, 5] },
    '42': { F: F42, names: ['post', 'post', 'wing', 'flat', 'flat', 'wing'], pos: [6, 6, 1, 2, 4, 5] },
    '33pp': { F: F33PP, names: ['post', 'flat', 'point', 'flat', 'post', 'hole'], pos: [1, 2, 3, 4, 5, 6] },
  };
  // Зона 6 на 6: двое прикрывают центрового, четверо — «коридоры» на 4–5 м
  const Z6 = [[1.6, 1.3], [1.6, -1.3], [3.7, 3.4], [3.7, -3.4], [4.8, 1.3], [4.8, -1.3]];
  const F5 = [[2.5, 3.7], [5.4, 2.3], [5.4, -2.3], [2.5, -3.7], [2.35, 0]];
  const F5PP = [[2.3, 1.8], [2.3, -1.8], [5.3, 3.6], [5.8, 0], [5.3, -3.6]];
  const F4 = [[3.0, 3.3], [5.6, 1.4], [5.6, -1.4], [3.0, -3.3]];
  const Z5 = [[1.7, 1.45], [1.7, -1.45], [3.9, 2.8], [3.9, -2.8], [5.6, 0]];
  const Z4 = [[1.8, 1.25], [1.8, -1.25], [4.3, 2.3], [4.3, -2.3]];
  const Z3 = [[1.9, 1.2], [1.9, -1.2], [4.4, 0]];

  // Параметры вратаря: скорость руки, выпада, ошибка прогноза
  WP.GKT = { hs0: 3.4, hs1: 2.2, ls0: 1.3, ls1: 1.0, err0: 0.1, lunge: 0.7, reach: 0.85 };

  AI.att = (team, dx, r) => ({ x: team.dir * (R.HALF_L - dx), z: r * team.dir });
  AI.lineD = (team, x) => (team.dir * R.HALF_L - x) * team.dir;
  AI.ownLineD = (team, x) => (x + team.dir * R.HALF_L) * team.dir;
  AI.goalDist = (team, x, z) => Math.hypot(team.dir * R.HALF_L - x, z);

  AI.nearestOpp = function (p, x, z, excludeGK) {
    let best = null, bd = 1e9;
    const px = x === undefined ? p.x : x, pz = z === undefined ? p.z : z;
    for (const o of p.team.opp.players) {
      if (!o.active || (excludeGK && o.isGK)) continue;
      const d = Math.hypot(o.x - px, o.z - pz);
      if (d < bd) { bd = d; best = o; }
    }
    return { p: best, d: bd };
  };

  AI.gkIdeal = function (team, bx, bz, possess) {
    const gx = -team.dir * R.HALF_L, dir = team.dir;
    const dxb = Math.max(0.6, (bx - gx) * dir);
    if (possess) return { x: gx + dir * Math.min(3, 1.2 + dxb * 0.08), z: clamp(bz * 0.15, -1.5, 1.5) };
    const out = Math.min(1.05, 0.35 + dxb * 0.065);
    const t = out / dxb;
    return { x: gx + dir * out, z: clamp(bz * t, -1.15, 1.15) };
  };

  // Ожидаемая результативность броска из точки
  AI.xg = function (match, p, x, z) {
    if (x === undefined) { x = p.x; z = p.z; }
    const team = p.team, opp = team.opp;
    const gx = team.dir * R.HALF_L;
    const dx = Math.abs(gx - x), d = Math.hypot(dx, z);
    if (dx < 0.4 || AI.lineD(team, x) < 0) return 0.01;
    const a1 = Math.atan2(R.GOAL_HALF_W - z, dx), a2 = Math.atan2(-R.GOAL_HALF_W - z, dx);
    const ang = Math.abs(a1 - a2);
    let q = Math.pow(Math.min(1, ang / 0.85), 0.6) * (d < 3 ? 0.5 : d < 5 ? 0.46 : d < 6.5 ? 0.42 : d < 8 ? 0.35 : d < 10 ? 0.22 : d < 12 ? 0.08 : 0.02);
    const sx = gx - x, sz = -z, L = Math.hypot(sx, sz);
    for (const o of opp.players) {
      if (!o.active || o.isGK) continue;
      const t = ((o.x - x) * sx + (o.z - z) * sz) / (L * L);
      if (t < 0.02 || t > 0.85) continue;
      const off = Math.hypot(o.x - (x + sx * t), o.z - (z + sz * t));
      const cover = Math.max(0, 1 - off / (0.45 + t * L * 0.22));
      q *= 1 - 0.4 * cover * (t * L < 2.5 ? 1 : 0.55);
    }
    const n = AI.nearestOpp(p, x, z, true);
    if (n.d < 1.1) q *= 0.66 + 0.3 * n.d;
    const gk = opp.gk;
    if (!gk || !gk.active) q = Math.min(0.95, q * 2.6);
    else {
      const ideal = AI.gkIdeal(opp, x, z);
      const off = Math.hypot(gk.x - ideal.x, gk.z - ideal.z);
      q *= 1 + Math.min(0.9, off * 0.7);
      if (gk.biteT > 0) q *= 1.6;
    }
    q *= 0.72 + 0.42 * (p.attrs.sht + p.attrs.acc) / 200;
    return clamp(q, 0, 0.92);
  };

  AI.passScore = function (match, from, to) {
    if (!to.active || to === from) return -9;
    const team = from.team, opp = team.opp;
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
    if (d < 1.4) return -9;
    if (to.isGK && AI.ownLineD(team, from.x) > 11) return -9;
    let risk = 0;
    for (const o of opp.players) {
      if (!o.active) continue;
      const t = clamp(((o.x - from.x) * dx + (o.z - from.z) * dz) / (d * d), 0, 1);
      const off = Math.hypot(o.x - (from.x + dx * t), o.z - (from.z + dz * t));
      const reach = (o.isGK ? 1.25 : 0.85) + t * d * 0.07;
      if (off < reach) risk = Math.max(risk, (1 - off / reach) * (t > 0.9 ? 0.75 : 1));
    }
    const open = AI.nearestOpp(to, undefined, undefined, true).d;
    let value = AI.xg(match, to) * 1.05 + 0.05 * clamp(open / 2, 0, 1);
    const fwd = (to.x - from.x) * team.dir;
    const counter = team.ai.phaseT < 6 && AI.lineD(team, from.x) > 9;
    value += Math.max(0, fwd) * (counter ? 0.03 : 0.006);
    if (to.slotName === 'hole' && !match.manUp(team)) value += 0.05;
    if (match.manUp(team) && to.slotName === 'post') value += 0.03;
    value -= d * 0.004;
    if (to.isGK) value -= 0.08;
    return value * (1 - risk * 0.9) - risk * 0.3;
  };

  function assignSlots(team, field, slots, names) {
    const free = slots.map((s, i) => i);
    const res = new Map();
    const pri = field.slice().sort((a, b) => (b.role === 'CF') - (a.role === 'CF') || (b.role === 'CB') - (a.role === 'CB') || b.attrs.str - a.attrs.str);
    for (const p of pri) {
      let best = -1, bd = 1e9;
      for (const i of free) {
        let d = Math.hypot(slots[i].x - p.x, slots[i].z - p.z);
        const nm = names[i];
        if (nm === 'hole' || nm === 'post') d += (p.role === 'CF' ? -8 : p.role === 'CB' ? -2 : 4) - (p.attrs.str - 85) * 0.05;
        if (nm === 'wing' && p.role === 'W') d -= 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { res.set(p, best); free.splice(free.indexOf(best), 1); }
    }
    return res;
  }

  AI.teamThink = function (match, team, dt) {
    const ball = match.ball;
    const ai = team.ai;
    ai.phaseT += dt;
    const passTeam = ball.state === 'free' && ball.flight && ball.flight.type === 'pass' ? ball.flight.team : null;
    const holderTeam = ball.holder ? ball.holder.team : null;
    let phase;
    if (match.state === 'dead' && match.restart) phase = match.restart.team === team ? 'attack' : 'defense';
    else if (holderTeam || passTeam) phase = (holderTeam || passTeam) === team ? 'attack' : 'defense';
    else phase = 'loose';
    if (phase !== ai.phase) {
      if (!(phase === 'loose' || (ai.phase === 'loose' && phase === ai.lastSolid))) ai.phaseT = 0;
      if (phase !== 'loose') ai.lastSolid = phase;
      ai.phase = phase; ai.dirty = true;
    }
    const field = team.players.filter(p => p.active && !p.isGK && !p.rolling);
    for (const p of team.players) if (p.excluded || p.rolling) AI.excludedMove(match, p);
    if (match.so || match.state === 'intro' || match.state === 'sprint') return;
    if (match.state === 'dead' && match.restart && match.restart.type === 'throwoff') return;
    if (match.state === 'penalty') return;
    if (phase === 'attack') AI.attackTargets(match, team, field);
    else if (phase === 'defense') AI.defenseTargets(match, team, field);
    else {
      if (ai.lastSolid === 'attack') AI.attackTargets(match, team, field); else AI.defenseTargets(match, team, field);
      AI.looseChase(match, team, field);
    }
  };

  AI.excludedMove = function (match, p) {
    const own = -p.team.dir * R.HALF_L;
    p.target = { x: own - p.team.dir * 1.0, z: -(R.HALF_W + 0.7) };
    p.moveMode = 'swim'; p.faceTo = null; p.liftTarget = 0;
  };

  AI.formationFor = function (match, team, n) {
    const oppN = match.activeField(team.opp);
    const tac = team.tac || {};
    if (n >= 6) {
      const id = oppN < n ? (tac.pp === '33' ? '33pp' : '42') : (tac.att === 'arc' ? 'arc' : tac.att === '42' ? '42e' : '33');
      const f = AI.FORMS[id];
      return { F: f.F, names: f.names, id };
    }
    if (n === 5) return oppN < 5 ? { F: F5PP, names: ['post', 'post', 'flat', 'point', 'flat'], id: '5pp' } : { F: F5, names: ['wing', 'flat', 'flat', 'wing', 'hole'], id: '5' };
    return { F: F4.slice(0, n), names: ['wing', 'flat', 'flat', 'wing'], id: '4-' + n };
  };

  AI.attackTargets = function (match, team, field) {
    const ai = team.ai, ball = match.ball;
    const fm = AI.formationFor(match, team, field.length);
    const slots = fm.F.map(s => AI.att(team, s[0], s[1]));
    if (ai.form !== fm.id || ai.dirty || field.some(p => p.slot < 0 || p.slot >= slots.length)) {
      const map = assignSlots(team, field, slots, fm.names);
      for (const p of field) { p.slot = map.has(p) ? map.get(p) : -1; p.slotName = p.slot >= 0 ? fm.names[p.slot] : ''; }
      ai.form = fm.id; ai.dirty = false;
    }
    const bl = AI.lineD(team, ball.pos.x);
    const counter = ai.phaseT < 7;
    const rs = match.state === 'dead' ? match.restart : null;
    // Контратака: два ближайших к воротам партнёра занимают коридоры (2 в 1)
    const car = ball.holder && ball.holder.team === team ? ball.holder : null;
    const lanes = new Map();
    if (counter && car && !rs && AI.lineD(team, car.x) > 4.5) {
      const side = car.z * team.dir > 0 ? -1 : 1;
      const runners = field.filter(p => p !== car).sort((a, b) => AI.lineD(team, a.x) - AI.lineD(team, b.x)).slice(0, 2);
      if (runners[0]) lanes.set(runners[0], AI.att(team, 2.7, side * 2.1));
      if (runners[1]) lanes.set(runners[1], AI.att(team, 4.8, -side * 3.2));
    }
    const motion = team.tac && team.tac.move === 'motion';
    AI.playStep(match, team, field, car, counter, !!rs);
    const play = ai.play;
    // Ротация позиций — только в стиле «движение»; в стиле «держать позиции» каждый стоит на своей точке
    if (motion && (fm.id === '33' || fm.id === 'arc') && !counter && !rs) {
      ai.rotT = (ai.rotT === undefined ? rnd(6, 10) : ai.rotT) - 0.15;
      if (ai.rotT <= 0) {
        ai.rotT = rnd(6, 11);
        const pairs = [[0, 1], [1, 2], [2, 3], [3, 4]];
        const [i1, i2] = pairs[(Math.random() * pairs.length) | 0];
        const a = field.find(p => p.slot === i1), b = field.find(p => p.slot === i2);
        if (a && b && !a.hasBall && !b.hasBall) { a.slot = i2; b.slot = i1; a.slotName = fm.names[i2]; b.slotName = fm.names[i1]; }
      }
    }
    for (const p of field) {
      if (lanes.has(p) && !(p.ctrl && p.input.active)) { p.target = lanes.get(p); p.moveMode = 'sprint'; p.faceTo = ball.pos; continue; }
      if (p.ctrl && p.input.active) continue;
      if (rs && rs.taker === p) { p.target = { x: rs.spot.x, z: rs.spot.z }; p.moveMode = 'sprint'; continue; }
      if (p.hasBall) continue;
      if (ball.flight && ball.flight.type === 'pass' && ball.flight.to === p && ball.state === 'free') {
        const f = ball.flight;
        p.target = f.landed ? { x: ball.pos.x, z: ball.pos.z } : { x: f.aim.x, z: f.aim.z };
        p.moveMode = 'sprint'; p.faceTo = ball.pos; continue;
      }
      if (p.slot < 0) continue;
      const s = slots[p.slot];
      let tx = s.x, tz = s.z;
      // Заслон: участники розыгрыша идут не на свои точки
      if (play && (p === play.screener || p === play.driver) && play.target.has(p)) {
        const g = play.target.get(p); tx = g.x; tz = g.z;
      }
      // Проходы к воротам — только в стиле «движение»
      else if (motion && (fm.id === '33' || fm.id === 'arc') && p.slotName !== 'hole') {
        p.driveT = (p.driveT || rnd(3, 8)) - 0.15;
        if (p.driveT < 0 && p.driveT > -2.2 && !counter) {
          const g = AI.att(team, 3.4, s.z * team.dir * 0.45);
          tx = g.x; tz = g.z;
        } else if (p.driveT <= -2.2) p.driveT = rnd(4, 9);
      }
      // Правило 2 метров: не заплывать за мяч в 2-метровую зону
      const minL = Math.min(2.2, Math.max(0.3, bl - 0.25));
      if (AI.lineD(team, tx) < minL) tx = team.dir * (R.HALF_L - minL);
      if (AI.lineD(team, tx) < 2.12 && bl > AI.lineD(team, tx)) tx = team.dir * (R.HALF_L - 2.2);
      p.target = { x: tx, z: tz };
      const far = Math.hypot(tx - p.x, tz - p.z);
      p.moveMode = (far > 3.5 && counter) || (play && ((p === play.driver && play.phase === 'drive') || (p === play.screener && play.phase === 'set'))) ? 'sprint' : 'swim';
      p.faceTo = ball.pos; p.liftTarget = 0.05;
    }
  };

  // ---------- Розыгрыш «заслон» (pick): заслоняющий встаёт корпусом у защитника партнёра, партнёр уходит к воротам ----------
  AI.startScreen = function (match, team, driverWish) {
    const ai = team.ai, ball = match.ball;
    const car = ball.holder && ball.holder.team === team ? ball.holder : null;
    if (!car || match.state !== 'live' || ai.play) return null;
    const field = team.players.filter(p => p.active && !p.isGK && !p.rolling && !p.excluded);
    if (field.length < 4) return null;
    // Проходящий: предпочтительно полусредний или разыгрывающий, у которого есть опекун
    let driver = driverWish && driverWish !== car && driverWish.active && !driverWish.isGK ? driverWish : null;
    if (!driver) {
      const cand = field.filter(p => p !== car && p.slotName !== 'hole' && p.slotName !== 'post');
      cand.sort((a, b) => (b.slotName === 'flat') - (a.slotName === 'flat') || AI.lineD(team, a.x) - AI.lineD(team, b.x));
      driver = cand[0];
    }
    if (!driver) return null;
    const def = team.opp.players.filter(o => o.active && !o.isGK).sort((a, b) => Math.hypot(a.x - driver.x, a.z - driver.z) - Math.hypot(b.x - driver.x, b.z - driver.z))[0];
    if (!def) return null;
    // Заслоняющий: ближайший к этому защитнику партнёр (часто центровой или соседний полусредний)
    const scr = field.filter(p => p !== car && p !== driver).sort((a, b) => Math.hypot(a.x - def.x, a.z - def.z) - Math.hypot(b.x - def.x, b.z - def.z))[0];
    if (!scr) return null;
    const side = Math.sign(driver.z * team.dir) || 1;
    ai.play = { type: 'screen', phase: 'set', t: 0, screener: scr, driver, def, side, carrier: car, target: new Map() };
    return ai.play;
  };

  AI.playStep = function (match, team, field, car, counter, dead) {
    const ai = team.ai, ball = match.ball;
    ai.playCD = (ai.playCD || rnd(6, 12)) - 0.15;
    // ИИ сам разыгрывает заслоны в позиционной атаке (у людей — по кнопке)
    if (!ai.play && !team.human && !counter && !dead && car && ai.playCD <= 0 && ai.phaseT > 7 && match.shotClock > 10 && Math.random() < (team.tac && team.tac.move === 'motion' ? 0.35 : 0.2)) {
      ai.playCD = rnd(14, 24);
      AI.startScreen(match, team);
    } else if (ai.playCD <= 0) ai.playCD = rnd(4, 8);
    const pl = ai.play;
    if (!pl) return;
    // После обычного фола розыгрыш не срывается: команда вводит мяч и продолжает
    if (dead) { if (!match.restart || match.restart.team !== team) ai.play = null; return; }
    const lost = !(ball.holder ? ball.holder.team === team : ball.flight && ball.flight.type === 'pass' && ball.flight.team === team);
    if (lost || !pl.screener.active || !pl.driver.active || !pl.def.active || (ball.flight && ball.flight.type === 'shot')) { ai.play = null; return; }
    pl.t += 0.15;
    const own = team.dir * R.HALF_L;
    const d = pl.def, S = pl.screener, D = pl.driver;
    if (pl.phase === 'set') {
      // Встать между защитником и воротами, плечом к нему (спиной к защитнику)
      const gx = own - d.x, gz = -d.z, gl = Math.hypot(gx, gz) || 1;
      pl.target.set(S, { x: d.x + gx / gl * 0.55, z: d.z + gz / gl * 0.55 });
      pl.target.set(D, { x: D.x, z: D.z });
      if (Math.hypot(S.x - d.x, S.z - d.z) < 0.8) {
        pl.phase = 'drive'; pl.t = 0;
        d.screenT = 1.0;
        match.onScreenSet(team, pl);
      } else if (pl.t > 4.5) ai.play = null;
    } else if (pl.phase === 'drive') {
      // Проходящий обходит заслон к воротам; заслоняющий через полсекунды откатывается к воротам (roll)
      pl.target.set(D, AI.att(team, 2.7, pl.side * 1.3));
      if (pl.t > 0.6) pl.target.set(S, AI.att(team, 2.5, -pl.side * 0.9));
      if (pl.t > 3.2) ai.play = null;
    }
  };

  // Кому отдать мяч в розыгрыше: открытому проходящему, иначе откатившемуся заслоняющему
  AI.playPassTarget = function (match, p) {
    const pl = p.team.ai.play;
    if (!pl || pl.phase !== 'drive' || pl.t < 0.25) return null;
    for (const t of [pl.driver, pl.screener]) {
      if (t === p || !t.active) continue;
      if (AI.nearestOpp(t, undefined, undefined, true).d > 1.05 && AI.passScore(match, p, t) > -0.5) return t;
    }
    return null;
  };

  AI.defenseTargets = function (match, team, field) {
    const ai = team.ai, ball = match.ball, opp = team.opp;
    ai.pressing = false;
    const attackers = opp.players.filter(p => p.active && !p.isGK);
    const ownX = -team.dir * R.HALF_L;
    const rs = match.state === 'dead' ? match.restart : null;
    const carrier = ball.holder && ball.holder.team === opp ? ball.holder : (rs && rs.taker && rs.team === opp ? rs.taker : null);
    if (field.length < attackers.length) {
      const Z = field.length >= 5 ? Z5 : field.length === 4 ? Z4 : Z3;
      const shift = clamp(ball.pos.z * 0.22, -1, 1);
      const slots = Z.slice(0, field.length).map(s => { const a = AI.att(opp, s[0], s[1]); a.z += shift; return a; });
      if (ai.zoneKey !== field.length || ai.dirty || field.some(p => p.zslot === undefined)) {
        const map = assignSlots(team, field, slots, slots.map(() => 'z'));
        for (const p of field) p.zslot = map.get(p);
        ai.zoneKey = field.length; ai.dirty = false;
      }
      for (const p of field) {
        if (p.ctrl && p.input.active) continue;
        const s = slots[p.zslot] || slots[0];
        let tx = s.x, tz = s.z;
        if (carrier) {
          const dc = Math.hypot(carrier.x - s.x, carrier.z - s.z);
          if (dc < 2.6) { tx = s.x + (carrier.x - s.x) * 0.45; tz = s.z + (carrier.z - s.z) * 0.45; }
          const shooting = carrier.action && carrier.action.type === 'windup';
          if ((shooting || AI.goalDist(opp, carrier.x, carrier.z) < 7.5) && Math.hypot(carrier.x - p.x, carrier.z - p.z) < 3.2) match.doBlock(p);
        }
        p.target = { x: tx, z: tz }; p.moveMode = Math.hypot(tx - p.x, tz - p.z) > 2.5 ? 'sprint' : 'swim';
        p.faceTo = ball.pos; p.mark = null; p.liftTarget = 0.3;
      }
      return;
    }
    const dt0 = team.tac ? team.tac.def : 'man';
    // Зона 6 на 6: каждый держит свой участок, к игроку с мячом выходит ближайший
    if (dt0 === 'zone' && field.length >= 6) {
      const shift = clamp(ball.pos.z * 0.25, -1.2, 1.2);
      const slots = Z6.map(s => { const a = AI.att(opp, s[0], s[1]); a.z += shift; return a; });
      if (ai.zoneKey !== 'z6' || ai.dirty || field.some(p => p.zslot === undefined || p.zslot >= 6)) {
        const map = assignSlots(team, field, slots, slots.map(() => 'z'));
        for (const p of field) p.zslot = map.get(p);
        ai.zoneKey = 'z6'; ai.dirty = false;
      }
      for (const p of field) {
        if (p.ctrl && p.input.active) continue;
        const s = slots[p.zslot] || slots[0];
        let tx = s.x, tz = s.z;
        if (carrier) {
          const dc = Math.hypot(carrier.x - s.x, carrier.z - s.z);
          if (dc < 3.2) { tx = s.x + (carrier.x - s.x) * 0.55; tz = s.z + (carrier.z - s.z) * 0.55; }
          const shooting = carrier.action && carrier.action.type === 'windup';
          if ((shooting || AI.goalDist(opp, carrier.x, carrier.z) < 7.5) && Math.hypot(carrier.x - p.x, carrier.z - p.z) < 3.2) match.doBlock(p);
        }
        if (p.screenT > 0) { tx = p.x; tz = p.z; }
        p.target = { x: tx, z: tz }; p.moveMode = Math.hypot(tx - p.x, tz - p.z) > 2.5 ? 'sprint' : 'swim';
        p.faceTo = ball.pos; p.mark = null; p.liftTarget = 0.3;
      }
      return;
    }
    ai.zoneKey = -1;
    // Прессинг: по выбору тактики или в концовке, когда команда проигрывает
    ai.pressing = dt0 === 'press' || (match.period === 4 && match.clock < 75 && team.score < opp.score);
    // M-зона: защитник разыгрывающего (дальнего по центру) отходит к центровому, остальные встают в «щели»
    const mdrop = dt0 === 'mdrop';
    let dropA = null;
    if (mdrop && !ai.pressing) dropA = attackers.filter(a => a !== carrier && Math.abs(a.z) < 2.6).sort((a, b) => AI.lineD(opp, b.x) - AI.lineD(opp, a.x))[0] || null;
    ai.markT = (ai.markT || 0) - 0.15;
    if (ai.markT <= 0 || ai.dirty || field.some(p => !p.mark || !p.mark.active || p.mark.team !== opp)) {
      ai.markT = 1.2; ai.dirty = false;
      const pairs = [];
      for (const d of field) for (const a of attackers) {
        let c = Math.hypot(d.x - a.x, d.z - a.z);
        if (d.mark === a) c -= 1.5;
        if (a.slotName === 'hole' && (d.role === 'CB' || d.role === 'CF')) c -= 2.5;
        pairs.push([c, d, a]);
      }
      pairs.sort((x, y) => x[0] - y[0]);
      const ud = new Set(), ua = new Set();
      for (const d of field) d.mark = null;
      for (const [, d, a] of pairs) { if (ud.has(d) || ua.has(a)) continue; d.mark = a; ud.add(d); ua.add(a); }
    }
    // Заслон у соперника: защитник заслоняющего может «переключиться» на проходящего
    const opl = opp.ai.play;
    if (opl && opl.phase === 'drive' && opl.switched === undefined) {
      const sd = field.find(d => d.mark === opl.screener);
      opl.switched = !!sd && Math.random() < 0.45 + (sd.attrs.def - 80) / 120;
      if (opl.switched) { sd.mark = opl.driver; opl.def.mark = opl.screener; }
    }
    const holeHelp = AI.att(opp, 3.3, 0);
    for (const d of field) {
      if (d.ctrl && d.input.active) continue;
      const a = d.mark;
      if (!a) { d.target = holeHelp; d.moveMode = 'swim'; continue; }
      const gx = ownX - a.x, gz = -a.z, gl = Math.hypot(gx, gz) || 1;
      const isCarrier = a === carrier;
      const nearGoal = AI.goalDist(opp, a.x, a.z) < 3.4;
      const dd = (isCarrier ? 0.78 : nearGoal ? 0.5 : 0.95) * (ai.pressing ? 0.7 : 1);
      let tx = a.x + gx / gl * dd, tz = a.z + gz / gl * dd;
      if (!isCarrier && !nearGoal && !ai.pressing) {
        const db = Math.hypot(a.x - ball.pos.x, a.z - ball.pos.z);
        const sag = clamp((db - 4) / 9, 0, 0.5) * ai.sag;
        tx += (holeHelp.x - tx) * sag; tz += (holeHelp.z - tz) * sag;
      }
      if (dropA && a === dropA) { const h = AI.att(opp, 3.6, clamp(ball.pos.z * 0.15, -0.8, 0.8)); tx = h.x + (a.x - h.x) * 0.25; tz = h.z + (a.z - h.z) * 0.25; }
      else if (mdrop && !isCarrier && !nearGoal) { tx += (holeHelp.x - tx) * 0.35; tz += (holeHelp.z - tz) * 0.35; }
      tx += a.vx * 0.3; tz += a.vz * 0.3;
      // Попал в заслон — застрял у заслоняющего
      if (d.screenT > 0) { tx = d.x; tz = d.z; }
      d.target = { x: tx, z: tz };
      const far = Math.hypot(tx - d.x, tz - d.z);
      d.moveMode = far > 2.2 ? 'sprint' : 'swim';
      d.faceTo = isCarrier ? a : ball.pos;
      d.liftTarget = isCarrier ? 0.35 : 0.1;
      if (isCarrier && carrier) {
        const gd = AI.goalDist(opp, carrier.x, carrier.z);
        const shooting = carrier.action && carrier.action.type === 'windup';
        if ((shooting && Math.random() < 0.9) || (gd < 8 && carrier.holdMode === 'hold' && Math.random() < 0.08)) match.doBlock(d);
      }
    }
  };

  AI.looseChase = function (match, team, field) {
    const ball = match.ball;
    let target = ball.pos;
    if (ball.pos.y > 0.3 && ball.state === 'free') {
      const vy = ball.vel.y, y = ball.pos.y - 0.07;
      const t = (vy + Math.sqrt(vy * vy + 2 * R.G * y)) / R.G;
      target = WP.predictBall(ball.pos, ball.vel, Math.min(1.5, t * 0.9));
    } else if (ball.state === 'free') {
      target = { x: ball.pos.x + ball.vel.x * 0.35, z: ball.pos.z + ball.vel.z * 0.35 };
    }
    const cand = field.concat(team.gk && team.gk.active && AI.ownLineD(team, target.x) < 4 ? [team.gk] : [])
      .map(p => [Math.hypot(p.x - target.x, p.z - target.z) / p.maxSpeed(), p]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(2, cand.length); i++) {
      const p = cand[i][1];
      if (p.ctrl && p.input.active) continue;
      p.target = { x: target.x, z: target.z }; p.moveMode = 'sprint'; p.faceTo = ball.pos;
    }
  };

  // Решение игрока с мячом
  AI.carrierThink = function (match, p, dt) {
    if (p.action) return;
    p.holdT = (p.holdT || 0) + dt;
    p.decideT -= dt;
    const team = p.team, ai = team.ai;
    const rs = match.state === 'dead' ? match.restart : null;
    if (rs && (!rs.ready || rs.taker !== p)) return;
    if (!rs) {
      const counter = ai.phaseT < 7 && AI.lineD(team, p.x) > 7.5;
      const ahead = AI.att(team, 5.5, clamp(p.z * team.dir * 0.5, -2.5, 2.5));
      const n = AI.nearestOpp(p, p.x + team.dir * 1.5, p.z, true);
      if (!p.isGK && counter && n.d > 1.8) { p.target = ahead; p.moveMode = 'sprint'; }
      else if (!p.isGK && p.slot >= 0) {
        const fm = AI.formationFor(match, team, match.activeField(team));
        const s = fm.F[p.slot] ? AI.att(team, fm.F[p.slot][0], fm.F[p.slot][1]) : ahead;
        p.target = Math.hypot(s.x - p.x, s.z - p.z) > 1.2 ? s : { x: p.x, z: p.z };
        p.moveMode = 'swim';
      } else if (p.isGK) {
        p.target = AI.gkIdeal(team, p.x, p.z, true); p.moveMode = 'slow';
      }
      p.faceTo = { x: team.dir * R.HALF_L, z: 0 };
    }
    const sc = match.shotClockLeft();
    const canShoot = !p.isGK && (!rs || rs.allowShot);
    // Контратака 2 в 1: защитник перекрыл путь — отдать открытому партнёру в коридоре
    if (!rs && !p.isGK && ai.phaseT < 7 && p.holdT > 0.2) {
      const block = AI.nearestOpp(p, p.x + team.dir * 1.8, p.z, true);
      if (block.d < 1.7) {
        let mate = null, bx = 0;
        for (const t of team.players) {
          if (t === p || !t.active || t.isGK) continue;
          if (AI.lineD(team, t.x) > AI.lineD(team, p.x) + 1) continue;
          const open = AI.nearestOpp(t, undefined, undefined, true).d, x = AI.xg(match, t);
          if (open > 1.5 && x > 0.28 && x > bx) { bx = x; mate = t; }
        }
        if (mate) { match.doPass(p, mate, { through: mate.vx * team.dir > 1.0 && AI.lineD(team, mate.x) > 3.5 }); return; }
      }
    }
    // Карьера игрока: партнёр слышит «Дай!» и отдаёт, если линия паса не перекрыта
    const cf = team.callFor;
    if (!rs && cf && match.t - cf.t < 1.6 && cf.p !== p && cf.p.active && !cf.p.excluded && p.holdT > 0.3) {
      const s = AI.passScore(match, p, cf.p);
      if (s > -0.6 || match.t - cf.t > 1.0) { team.callFor = null; match.doPass(p, cf.p); return; }
    }
    // Розыгрыш заслона: как только проходящий открылся — пас ему
    const pt = !rs && !p.isGK ? AI.playPassTarget(match, p) : null;
    if (pt && p.holdT > 0.2) { match.doPass(p, pt); return; }
    // Проходящий или откатившийся после заслона бросает сразу после приёма
    const pl = ai.play;
    if (canShoot && pl && (p === pl.driver || p === pl.screener) && pl.phase === 'drive' && p.holdT > 0.12) {
      const x0 = AI.xg(match, p);
      if (x0 > 0.12) { ai.play = null; AI.shoot(match, p); return; }
    }
    // Перепас: поймал мяч у ворот, а вратарь ещё не успел сместиться — бросок сразу, с короткого замаха
    const og = team.opp.gk;
    if (canShoot && !rs && !AI.quickOff && p.xpTry === undefined && p.holdT > 0.08 && p.gainHow === 'catch' && p.lastPassT === p.gainT && og && og.active && (og.unset || 0) > 0.65 && AI.goalDist(team, p.x, p.z) < 6.5) {
      p.xpTry = Math.random() < 0.25;
      if (p.xpTry && AI.xg(match, p) > 0.15) { AI.shoot(match, p, { quick: true }); return; }
    }
    // Время атаки на исходе — бросать
    if (canShoot && sc < 3.2 && p.holdT > 0.15 && AI.goalDist(team, p.x, p.z) < 13) { AI.shoot(match, p); return; }
    if (p.decideT > 0) return;
    p.decideT = ai.decision * rnd(0.5, 1.3);
    const xg = canShoot ? AI.xg(match, p) : 0;
    let best = null, bestS = -9;
    for (const t of team.players) { const s = AI.passScore(match, p, t) + rnd(-0.03, 0.03) * ai.noise; if (s > bestS) { bestS = s; best = t; } }
    const urg = 1 - clamp(sc / R.SHOT_CLOCK, 0, 1);
    let thr = 0.37 - urg * 0.32 + ai.patience;
    if (match.manUp(team)) thr += 0.03;
    // Ведущая команда в концовке тянет время атаки
    if (match.period === 4 && match.clock < 90 && team.score > team.opp.score && sc > 8) thr += 0.15;
    if (rs && rs.allowShot) thr -= 0.04;
    const minHold = rs ? 0.25 : p.isGK ? 0.9 : 0.35;
    if (p.holdT < minHold && sc > 3) return;
    if (canShoot && ((xg > thr && xg > bestS) || (sc < 2.3 && xg > 0.015))) { AI.shoot(match, p); return; }
    // Бросок из своей позиции: если рядом никого и до ворот не больше 8 м — бросать, а не гонять мяч
    if (canShoot && !rs && AI.nearestOpp(p, undefined, undefined, true).d > 2.0 && AI.goalDist(team, p.x, p.z) < 8 && xg > thr * 0.7 && Math.random() < 0.4) { AI.shoot(match, p); return; }
    if (rs) {
      if (best && bestS > -1) { match.doPass(p, best); return; }
      match.putInPlay(p); return;
    }
    if (best && bestS > -0.3 && (bestS > xg + 0.015 || p.holdT > 2.4) && (p.holdT > 0.9 || bestS > 0.2)) { match.doPass(p, best); return; }
    if (best && p.holdT > 3.2) { match.doPass(p, best); return; }
    if (canShoot && xg > 0.12 && Math.random() < 0.035 * ai.fakes) match.doFake(p);
  };

  AI.shoot = function (match, p, o) {
    const team = p.team, opp = team.opp, gk = opp.gk;
    const lineD = AI.lineD(team, p.x);
    const gkz = gk && gk.active ? gk.z : 0;
    let side = gkz > p.z * 0.12 ? -1 : 1;
    if (Math.random() < 0.22) side = -side;
    // После перепаса — в угол, из которого вратарь уплывает
    const quick = !!(o && o.quick);
    if (quick && gk && Math.abs(gk.vz) > 0.2) side = gk.vz > 0 ? -1 : 1;
    const zAim = side * rnd(1.0, 1.32);
    // Вратарь купился на кач и опускается — бросок в верхний угол
    let yAim = gk && gk.biteT > 0 ? rnd(0.66, 0.8) : Math.random() < 0.62 ? rnd(0.62, 0.8) : rnd(0.15, 0.32);
    const goalAng = Math.atan2(-p.z, team.dir * R.HALF_L - p.x);
    const facing = Math.abs(WP.angNorm(goalAng - p.heading));
    let type = 'power';
    const gkOut = gk && gk.active ? AI.ownLineD(opp, gk.x) : 0;
    if (facing > 1.9 && lineD < 4) type = 'turn';
    else if (lineD > 3.5 && lineD < 7.5 && Math.random() < 0.17) type = 'skip';
    else if (gkOut > 0.85 && lineD < 7 && Math.random() < 0.3) type = 'lob';
    const power = type === 'turn' ? rnd(0.5, 0.75) : rnd(0.72, 1.0);
    const dist = AI.goalDist(team, p.x, p.z);
    const key = 'shot:' + (dist < 4 ? '<4' : dist < 6 ? '4-6' : dist < 8 ? '6-8' : dist < 10 ? '8-10' : '10+') + (match.shotClock < 3 ? ':urg' : '');
    match.dbg[key] = (match.dbg[key] || 0) + 1;
    if (quick && type === 'power' && Math.random() < 0.55) yAim = rnd(0.62, 0.8);
    match.startShot(p, { type, zAim, yAim, power, ai: true, quick });
  };

  // Вратарь
  AI.gkUpdate = function (match, gk, dt) {
    const team = gk.team, ball = match.ball;
    // Перепас: мяч резко ушёл поперёк ворот — вратарю надо переплыть и снова выпрыгнуть из воды.
    // Пока он «не встал» (unset 0…1), реакция медленнее и до верхних углов не достать; за ~1 с приходит в себя
    {
      const gx = -team.dir * R.HALF_L, dxb = Math.max(0.6, (ball.pos.x - gx) * team.dir), ang = Math.atan2(ball.pos.z, dxb);
      const near = match.state === 'live' && !ball.holder ? clamp((10 - dxb) / 4, 0, 1) : 0; // считаем только мяч в полёте (пас, отскок)
      // Не больше 0,06 рад за шаг: быстрый пас — это ~0,03, а мгновенный перенос мяча (расстановка) не в счёт
      const jump = gk.gkAng === undefined ? 0 : Math.min(0.06, Math.abs(ang - gk.gkAng));
      gk.unset = clamp((gk.unset || 0) + jump * 1.8 * near - dt * (0.55 + 0.3 * gk.attrs.gk / 100), 0, 1);
      gk.gkAng = ang;
    }
    if (gk.biteT > 0) {
      gk.biteT -= dt;
      // Прыжок на кач: первые 0,3 с вратарь выпрыгивает, потом проседает в воду и не успевает подняться
      if (!gk.save) gk.liftTarget = gk.biteT > 0.95 ? 1.25 : 0.2;
    }
    if (gk.save || gk.hasBall || (gk.ctrl && gk.input.active)) return;
    if (match.state === 'penalty' || match.state === 'sprint' || match.state === 'intro') return;
    const poss = (ball.holder && ball.holder.team === team) || (ball.flight && ball.flight.type === 'pass' && ball.flight.team === team && ball.state === 'free');
    const rs = match.state === 'dead' ? match.restart : null;
    if (rs && rs.taker === gk) { gk.target = { x: rs.spot.x, z: rs.spot.z }; gk.moveMode = 'sprint'; return; }
    if (ball.state === 'free' && !ball.flight && AI.ownLineD(team, ball.pos.x) < 3.2 && Math.abs(ball.pos.z) < 3 && ball.vel.length() < 4) {
      gk.target = { x: ball.pos.x, z: ball.pos.z }; gk.moveMode = 'sprint'; return;
    }
    if (gk.biteT > 0) return;
    gk.target = AI.gkIdeal(team, ball.pos.x, ball.pos.z, poss); gk.faceTo = ball.pos; gk.moveMode = 'swim';
    const car = ball.holder;
    if (car && car.team !== team && AI.goalDist(car.team, car.x, car.z) < 10) gk.liftTarget = car.action && car.action.type === 'windup' ? 1.0 : 0.72;
    else gk.liftTarget = 0.42;
    // Смещаясь боком, высоко не выпрыгнешь
    gk.liftTarget *= 1 - 0.35 * (gk.unset || 0);
  };

  // Сейв: реакция, прогноз точки, выпад
  AI.gkSaveStart = function (match, gk, info) {
    const a = gk.attrs.gk * (gk.team.ai.gkMul || 1);
    const dir = gk.team.dir;
    gk.save = {
      t: 0,
      react: 0.12 + 0.12 * (1 - a / 100) + Math.random() * 0.06 + (info.screened ? 0.06 : 0) + (gk.biteT > 0 ? 0.35 : 0) + (info.penalty ? -0.02 : 0),
      pred: null, z0: gk.z, lob: info.kind === 'lob', maxY: info.kind === 'lob' ? 1.12 : 1.3, hs: WP.GKT.hs0 + WP.GKT.hs1 * a / 100, ls: WP.GKT.ls0 + WP.GKT.ls1 * a / 100, err: WP.GKT.err0 + 0.22 * (1 - a / 100) + (info.kind === 'skip' ? 0.07 : 0),
    };
    // Купился на кач: вратарь уже выпрыгнул и опускается — руки медленнее, до верхних углов не достать
    if (gk.biteT > 0) { gk.save.hs *= 0.7; gk.save.ls *= 0.7; }
    // Бросок сразу после перепаса: вратарь ещё плывёт за мячом и не успел выпрыгнуть
    const lag = info.penalty ? 0 : clamp(gk.unset || 0, 0, 1);
    if (lag > 0.05) {
      gk.save.react += 0.3 * lag;
      gk.save.ls *= 1 - 0.55 * lag; gk.save.hs *= 1 - 0.3 * lag;
      gk.save.err += 0.2 * lag;
      gk.save.maxY = Math.min(gk.save.maxY, 1.3 - 0.55 * lag);
    }
    gk.save.lag = lag;
    gk.gkHandActive = true;
    gk.gkHand.set(gk.x + dir * 0.12, 0.62 + gk.lift * 0.4, gk.z);
    // Бросок «от воды» видно по замаху — руку сразу опускает к воде
    if (info.kind === 'skip') gk.gkHand.y = Math.min(gk.gkHand.y, 0.62);
    // «Парашют» с близкой дистанции часто застаёт вратаря выпрыгнувшим навстречу; издалека он успевает понять
    const sd = info.shooter ? AI.goalDist(info.shooter.team, info.shooter.x, info.shooter.z) : 6;
    if (info.kind === 'lob' && sd < 9 && Math.random() < 0.6 - (a - 80) / 100) gk.save.react += 0.25;
    gk.save.far = sd;
    // Чтение броска: хороший вратарь заранее смещает руку в сторону угла, иногда ошибается
    if (info.aimZ !== undefined && gk.biteT <= 0 && lag < 0.3) {
      const sk = info.shooter ? (info.shooter.attrs.sht + info.shooter.attrs.acc) / 2 : 85;
      const pRead = clamp(0.25 + 0.45 * (a - 70) / 30 - (sk - 80) / 200 - (info.screened ? 0.15 : 0), 0.12, 0.72);
      const r = Math.random();
      let k = 0, tz = info.aimZ;
      if (r < pRead) { k = 0.45; gk.save.react -= 0.03; }
      else if (r < pRead + (1 - pRead) * 0.4) { k = 0.3; tz = -info.aimZ; gk.save.react += 0.03; }
      gk.gkHand.z += (tz - gk.z) * k;
      gk.gkHand.y += ((info.aimY !== undefined ? info.aimY : 0.6) - gk.gkHand.y) * k;
    }
    gk.action = { type: 'dive', t: 0, dur: 1.3 };
    // Купившийся на кач вратарь опускается в воду — выпрыгнуть заново он не успевает
    gk.liftTarget = gk.biteT > 0 ? 0.3 : 1.1;
    if (gk.biteT > 0) gk.save.maxY = Math.min(gk.save.maxY, 0.62);
    gk.target = { x: gk.x, z: gk.z }; gk.vx *= 0.3; gk.vz *= 0.3;
  };

  AI.gkSaveStep = function (match, gk, dt) {
    const s = gk.save; if (!s) return;
    const ball = match.ball, dir = gk.team.dir;
    s.t += dt;
    gk.target = { x: gk.x, z: gk.z };
    if (s.t < s.react) return;
    // «Парашют»: вратарь пятится к линии ворот и пересчитывает точку перехвата
    if (s.lob) {
      const lineX = -dir * R.HALF_L + dir * 0.3;
      // Чем дальше бросали, тем больше времени — вратарь спиной плывёт к линии до 1,4 м/с
      const back = s.far > 10 ? 1.4 : s.far > 7 ? 0.8 : 0.35;
      if ((gk.x - lineX) * dir > 0) gk.x -= dir * Math.min(back * dt, (gk.x - lineX) * dir);
      s.reT = (s.reT || 0) - dt;
      if (s.reT <= 0) { s.pred = null; s.reT = 0.12; }
    }
    if (!s.pred) {
      const planeX = gk.x + dir * 0.1;
      const p = ball.pos.clone(), v = ball.vel.clone();
      let found = null, sk = !!(ball.flight && ball.flight.kind === 'skip' && !ball.flight.skipped);
      for (let i = 0; i < 360; i++) {
        const h = 1 / 240, sp = v.length();
        v.x -= R.DRAG * sp * v.x * h; v.z -= R.DRAG * sp * v.z * h; v.y -= (R.DRAG * sp * v.y + R.G) * h;
        const px = p.x;
        p.addScaledVector(v, h);
        if (p.y < 0.07 && v.y < 0) { if (WP.waterBounce(v, sk)) { sk = false; p.y = 0.08; } else { p.y = 0.07; v.y = 0; v.multiplyScalar(0.45); } }
        if ((px - planeX) * dir > 0 && (p.x - planeX) * dir <= 0) { found = p.clone(); break; }
      }
      if (!found) found = p.clone();
      if (s.ez === undefined) { s.ez = (Math.random() - 0.5) * 2 * s.err; s.ey = (Math.random() - 0.5) * 1.6 * s.err; }
      found.z += s.ez; found.y += s.ey;
      s.pred = found;
    }
    const want = clamp(s.pred.z - gk.z, -1.0, 1.0) * 0.6;
    const step = clamp(want, -s.ls * dt, s.ls * dt);
    gk.z = clamp(gk.z + step, s.z0 - WP.GKT.lunge, s.z0 + WP.GKT.lunge);
    gk.gkLunge = clamp(gk.gkLunge + step * 6, -1, 1);
    const sh = new THREE.Vector3(gk.x + dir * 0.05, 0.03 + gk.lift * 0.45 + 0.04, gk.z);
    const tgt = s.pred.clone(); tgt.x = gk.x + dir * 0.18;
    const off = tgt.clone().sub(sh);
    if (off.length() > WP.GKT.reach) off.setLength(WP.GKT.reach);
    tgt.copy(sh).add(off); tgt.y = clamp(tgt.y, -0.05, s.maxY);
    const d = tgt.clone().sub(gk.gkHand);
    const spd = s.hs * (gk.gkHand.y < 0.2 ? 0.7 : gk.gkHand.y > 1.1 ? 0.6 : 1) * dt;
    if (d.length() > spd) d.setLength(spd);
    gk.gkHand.add(d);
    const passed = ball.state !== 'free' || (ball.pos.x - gk.x) * dir < -0.4 || s.t > (s.lob ? 3.4 : 1.3) || ball.inGoal;
    if (passed) AI.gkSaveEnd(gk);
  };

  AI.gkSaveEnd = function (gk) {
    gk.save = null; gk.gkHandActive = false;
    if (gk.action && gk.action.type === 'dive') gk.action = null;
    gk.gkLunge = 0;
  };

  // Коллайдеры вратаря для мяча
  AI.gkColliders = function (gk, out) {
    const dir = gk.team.dir;
    const by = 0.03 + gk.lift * 0.45;
    const wh = gk.world.waveHeight(gk.x, gk.z);
    out.push({ pos: new THREE.Vector3(gk.x, by + 0.21 + wh, gk.z), r: 0.13, owner: gk, kind: 'gk' });
    out.push({ pos: new THREE.Vector3(gk.x, by - 0.08 + wh, gk.z), r: 0.25, owner: gk, kind: 'gk' });
    out.push({ pos: new THREE.Vector3(gk.x, by - 0.4 + wh, gk.z), r: 0.2, owner: gk, kind: 'gk' });
    const hands = [];
    if (gk.gkHandActive) {
      hands.push(gk.gkHand.clone());
      const h2 = gk.gkHand.clone(); h2.y -= 0.1; h2.z += gk.gkHand.z > gk.z ? -0.2 : 0.2; hands.push(h2);
    } else {
      const restY = by + (gk.hasBall ? 0.2 : 0.55) + wh;
      hands.push(new THREE.Vector3(gk.x + dir * 0.12, restY, gk.z + 0.38), new THREE.Vector3(gk.x + dir * 0.12, restY, gk.z - 0.38));
    }
    for (const h of hands) {
      out.push({ pos: h, r: 0.12, owner: gk, kind: 'gk' });
      const sh = new THREE.Vector3(gk.x, by + wh, gk.z + (h.z > gk.z ? 0.2 : -0.2));
      out.push({ pos: sh.clone().lerp(h, 0.5), r: 0.085, owner: gk, kind: 'gk' });
    }
  };

  WP.AI = AI;
})();
