// Обучение: пошаговые задания на воде — плавание, пасы, броски, кач, фол, заслон, отбор, «руки», тактика.
// Контроллер ставит нужную игровую ситуацию, следит за действиями игрока и засчитывает шаг.
WP.Tutorial = (function () {
  const AI = WP.AI;
  let m = null, H = null, A = null, idx = 0, st = null, active = false, touch = false, doneT = 0, badT = 0;
  let onExit = null, panel = null;

  // Подпись кнопки: на телефоне — экранная кнопка, на клавиатуре — текущая назначенная клавиша
  const key = (a, t) => (touch ? '<b>«' + t + '»</b>' : WP.Input.kbd(a));
  const STEPS = [
    { id: 'swim', side: 'att', title: 'Плавание', text: () => 'Плыви с мячом: ' + (touch ? 'левый стик' : WP.Input.moveKbd()) + '. Проплыви 6 метров.', need: 6 },
    { id: 'sprint', side: 'att', title: 'Рывок', text: () => 'Держи ' + key('sprint', 'Рывок') + ' и плыви — это быстрее, но тратит силы (полоска в карточке игрока).', need: 1.2 },
    { id: 'pass', side: 'att', title: 'Пас', text: () => (touch ? 'Тапни «Пас» — мяч уйдёт партнёру со стрелкой. Свайп вверх по кнопке — пас верхом, вниз — сильный.' : 'Нажми ' + key('pass', 'Пас') + ' — мяч уйдёт партнёру, на которого указывает стрелка. ' + key('lobpass', 'Пас') + ' — пас верхом.') + ' Направление стика выбирает, кому.', need: 1 },
    { id: 'hard', side: 'att', title: 'Резкий пас', text: () => 'Держи ' + key('pass', 'Пас') + ' и отпусти — чем дольше, тем быстрее мяч и труднее перехват. Белая отметка на шкале — предел приёма получателя.', need: 1 },
    { id: 'thru', side: 'att', dist: 9, title: 'Пас в разрез', text: () => touch ? 'Нажми ' + key('thru', 'Разрез') + ': мяч уйдёт в свободную воду перед партнёром, и он подхватит его на ходу к воротам. Быстрый игрок успевает раньше защитника.'
      : 'Нажми ' + key('thru', 'Разрез') + ' — мяч сразу уйдёт в свободную воду перед партнёром на ходу к воротам. Или держи ' + key('thru', 'Разрез') + ': кольцо на воде покажет, куда упадёт мяч (зелёное — партнёр успеет первым), ' + WP.Input.moveKbd() + ' выбирает партнёра, отпусти — пас. ' + key('sprint', 'Рывок') + ' в прицеле — верхом.', need: 1 },
    { id: 'shot', side: 'att', open: true, dist: 6.5, title: 'Бросок', text: () => 'Держи ' + key('shoot', 'Бросок') + ' — игрок замахивается, шкала показывает силу; отпусти. Стик вбок выбирает угол ворот. Сделай 2 броска или забей.', need: 2 },
    { id: 'pump', side: 'att', open: true, dist: 6.5, title: 'Кач', text: () => 'Нажми ' + key('fake', 'Кач') + ' — ложный замах всем корпусом. Если вратарь не прыгнул, качни ещё раз, но с паузой: ритмичный кач он читает. Прыгнул — сразу ' + key('shoot', 'Бросок') + ', мяч пойдёт в верхний угол.', need: 1 },
    { id: 'foul', side: 'att', guard: true, dist: 7, title: 'Заработать фол', text: () => 'Защитник вплотную. Нажми ' + key('foul', 'Фол') + ' — упрись в него и покажи судье захват. Получится не всегда: пробуй ещё.', need: 1 },
    { id: 'screen', side: 'att', dist: 7, title: 'Заслон', text: () => 'Нажми ' + key('play', 'Заслон') + ': партнёр встанет корпусом у защитника другого партнёра. Когда тот откроется («Заслон стоит»), отдай ему пас ' + key('pass', 'Пас') + '.', need: 1 },
    { id: 'steal', side: 'def', title: 'Отбор', text: () => 'Соперник держит мяч. Подплыви вплотную и жми ' + key('shoot', 'Отбор') + '. Надёжнее комбо ' + key('lob', 'Блок') + ' → ' + key('shoot', 'Отбор') + ' → ' + key('shoot', 'Отбор') + ' в ритме: чистый вынос без фола.', need: 1 },
    { id: 'hands', side: 'def', title: 'Руки вверх', text: () => 'Держи ' + key('foul', 'Руки') + ' 2 секунды: обе руки вверх — ты не держишь соперника, судья не даст фол. Но и отобрать мяч так нельзя.', need: 2 },
    { id: 'tac', side: 'att', title: 'Тактика и замены', text: () => (touch ? 'Нажми паузу (⏸) → «Тактика и замены»' : 'Нажми ' + WP.Input.kbd('tac')) + ': выбери расстановку (3-3, зонтик, 4-2), защиту и замени уставшего игрока. Потом «Готово».', need: 1 },
  ];

  function field(t) { return t.players.filter(p => p.active && !p.isGK); }
  function reset(p) {
    p.action = null; p.vx = p.vz = 0; p.excluded = false; p.rolling = false; p.rollTo = null; p.stunT = 0; p.screenT = 0;
    p.hands = false; p.catchCD = 0; p.stealCD = 0.6; p.drawCD = 0; p.wrestle = null; p.stamina = Math.max(p.stamina, 0.8);
  }

  // Поставить игровую ситуацию под текущий шаг
  function setup() {
    const s = STEPS[idx];
    m.state = 'live'; m.stateT = 0; m.restart = null; m.review = null; m.so = null;
    m.clock = m.periodLen; m.shotClock = 28; m.shotReset = null;
    m.ball.flight = null;
    for (const t of m.teams) { t.ai.play = null; t.ai.dirty = true; t.ai.phaseT = 12; t.ai.aggr = 0.12; for (const p of t.players) reset(p); }
    for (const t of m.teams) if (t.gk) { const gk = t.gk; if (gk.save) AI.gkSaveEnd(gk); gk.biteT = 0; gk.x = -t.dir * (WP.R.HALF_L - 0.7); gk.z = 0; }
    const att = s.side === 'att' ? H : A, def = att.opp;
    const fm = AI.FORMS['33'];
    const af = field(att), df = field(def);
    af.forEach((p, i) => { const f = fm.F[i % 6]; const q = AI.att(att, f[0], f[1]); p.x = q.x; p.z = q.z; p.slot = i % 6; p.slotName = fm.names[i % 6]; });
    df.forEach((d, i) => { const a = af[i % af.length]; const gx = att.dir * WP.R.HALF_L; const k = 0.95 / (Math.hypot(gx - a.x, a.z) || 1); d.x = a.x + (gx - a.x) * k; d.z = a.z - a.z * k; d.mark = a; });
    let car = af.find(p => p.slotName === 'point') || af[0];
    if (s.dist) { const q = AI.att(att, s.dist, 0.4); car.x = q.x; car.z = q.z; }
    if (s.open) for (const d of df) { const q = AI.att(att, 10 + Math.random() * 2, (Math.random() - 0.5) * 12); d.x = q.x; d.z = q.z; }
    if (s.guard) {
      for (const d of df) { const q = AI.att(att, 11, (Math.random() - 0.5) * 10); d.x = q.x; d.z = q.z; }
      const g = df[0]; const gx = att.dir * WP.R.HALF_L;
      const k = 0.75 / (Math.hypot(gx - car.x, car.z) || 1); g.x = car.x + (gx - car.x) * k; g.z = car.z - car.z * k;
    }
    car.heading = Math.atan2(-car.z, att.dir * WP.R.HALF_L - car.x);
    m.possession = att;
    m.ball.attach(car); car.holdMode = 'hold'; car.gainT = -9; car.holdT = 0; car.decideT = 3;
    if (s.side === 'att') m.setControl('p1', car);
    else {
      // Защитник игрока — прямо перед соперником с мячом, между ним и воротами
      const me = df.find(d => d.mark === car) || df[0];
      const gx = att.dir * WP.R.HALF_L, k = 1.0 / (Math.hypot(gx - car.x, car.z) || 1);
      me.x = car.x + (gx - car.x) * k; me.z = car.z - car.z * k;
      m.setControl('p1', me);
    }
    st = { dist: 0, t: 0, n: 0, last: null, sawTac: false, done: false };
    badT = 0;
    render();
  }

  function complete() {
    if (st.done) return;
    st.done = true; doneT = 1.3;
    WP.Audio.crowd('cheer');
    render(true);
  }

  function ev(kind, d) {
    if (!active || !st || st.done) return;
    const s = STEPS[idx];
    if (s.id === 'pass' && kind === 'pass') st.n++;
    if (s.id === 'hard' && kind === 'pass' && d.power >= 0.3) st.n++;
    if (s.id === 'thru' && kind === 'pass' && d.through) st.n++;
    if (s.id === 'shot' && (kind === 'shot' || kind === 'goal')) st.n += kind === 'goal' ? 2 : 1;
    if (s.id === 'pump' && kind === 'bite') st.n++;
    if (s.id === 'foul' && kind === 'foul') st.n++;
    if (s.id === 'screen' && kind === 'pass') { const pl = H.ai.play; if (pl && pl.phase === 'drive' && (d.to === pl.driver || d.to === pl.screener)) st.n++; }
    if (s.id === 'steal' && kind === 'steal') st.n++;
    if (st.n >= s.need) complete();
    else render();
  }

  function hook() {
    // after(args, result, wasCtrl): wasCtrl — управлял ли человек игроком до вызова (после паса управление переходит к получателю)
    const wrap = (name, after) => { const f = m[name].bind(m); m[name] = function () { const c = !!(arguments[0] && arguments[0].ctrl); const r = f.apply(null, arguments); try { after(arguments, r, c); } catch (e) { /* подсказка не критична */ } return r; }; };
    wrap('doPass', (a, r, c) => { if (c) ev('pass', { to: a[1], power: (a[2] && a[2].power) || 0, through: !!(a[2] && a[2].through) }); });
    wrap('releaseShot', (a, r, c) => { if (c) ev('shot'); });
    wrap('doFake', (a, r, c) => { if (c && A.gk && A.gk.lastBiteT === m.t) ev('bite'); });
    wrap('drawFoul', () => { if (m.state !== 'live' && m.restart && m.restart.team === H) ev('foul'); });
    wrap('catchBall', (a) => { if (a[0].team === H && (a[1] === 'steal' || a[1] === 'intercept') && STEPS[idx].side === 'def') ev('steal'); });
    const em = m.emit;
    m.emit = (k, d) => { em(k, d); if (k === 'goal' && d && d.team === H) ev('goal'); };
  }

  function render(ok) {
    if (!panel) return;
    const s = STEPS[idx];
    if (!s) {
      panel.innerHTML = '<div class="tut-top"><b>Обучение пройдено</b></div><h3>Готов к матчу!</h3><p>Всё управление — в меню «Управление». Удачи на воде!</p><div class="row-btns"><button class="btn primary" data-tut="exit">В меню</button></div>';
      return;
    }
    let prog = '';
    if (s.id === 'swim') prog = Math.min(6, st.dist).toFixed(1) + ' / 6 м';
    else if (s.id === 'sprint' || s.id === 'hands') prog = Math.min(s.need, st.t).toFixed(1) + ' / ' + s.need + ' с';
    else if (s.need > 1) prog = Math.min(s.need, st.n) + ' / ' + s.need;
    panel.innerHTML = '<div class="tut-top"><b>Обучение · ' + (idx + 1) + '/' + STEPS.length + '</b><button data-tut="skip">Пропустить</button><button data-tut="exit">Выйти</button></div>' +
      '<h3>' + (ok ? '✓ ' : '') + s.title + '</h3><p>' + (ok ? 'Отлично! Дальше…' : s.text()) + '</p>' +
      '<div class="tut-prog"><i style="width:' + Math.round(((idx + (ok ? 1 : 0)) / STEPS.length) * 100) + '%"></i></div>' + (prog && !ok ? '<small>' + prog + '</small>' : '');
    panel.classList.toggle('ok', !!ok);
  }

  function next() {
    idx++;
    if (idx >= STEPS.length) { st = { done: true }; render(); WP.Audio.cheer(true); return; }
    setup();
  }

  function start(match, opts) {
    m = match; H = m.teams[m.cfg.humanSide]; A = H.opp; idx = 0; active = true;
    touch = !!(opts && opts.touch); onExit = opts && opts.onExit;
    panel = document.getElementById('tut');
    panel.hidden = false;
    if (!panel.dataset.bound) {
      panel.dataset.bound = '1';
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tut]'); if (!b) return;
        if (b.dataset.tut === 'skip' && active && STEPS[idx]) next();
        if (b.dataset.tut === 'exit') { stop(); if (onExit) onExit(); }
      });
    }
    hook();
    setup();
  }

  function stop() { active = false; m = null; if (panel) { panel.hidden = true; panel.innerHTML = ''; } }

  // Каждый кадр: заморозить время, следить за заданием, при потере ситуации поставить её заново
  function update(dt, paused) {
    if (!active || !m || !STEPS[idx]) return;
    const s = STEPS[idx];
    if (s.id === 'tac') {
      const open = WP.UI.tacOpen;
      if (open) st.sawTac = true;
      else if (st.sawTac && !st.done) complete();
    }
    if (paused) return;
    if (m.state === 'live') { m.clock = m.periodLen; m.shotClock = 28; }
    if (st.done) { doneT -= dt; if (doneT <= 0) next(); return; }
    const want = s.side === 'att' ? H : A;
    const holder = m.ball.holder;
    const ok = (m.state === 'live' && (holder ? holder.team === want : m.possession === want)) || (m.state === 'dead' && m.restart && m.restart.team === want);
    badT = ok ? 0 : badT + dt;
    if (badT > (m.state === 'live' ? 1.4 : 2.2)) { setup(); return; }
    const p = m.controlled.p1, inp = m.inputs.p1;
    // Соперник с мячом в защитных шагах не спешит отдавать его — есть время на отбор
    if (s.side === 'def' && holder && holder.team === A) { holder.decideT = Math.max(holder.decideT, 0.6); holder.holdT = Math.min(holder.holdT || 0, 1); A.ai.phaseT = 12; }
    if (!p || !inp) return;
    if (s.id === 'swim') {
      if (st.last) st.dist += Math.hypot(p.x - st.last.x, p.z - st.last.z);
      st.last = { x: p.x, z: p.z };
      if (st.dist >= 6) complete(); else if (Math.random() < 0.1) render();
    } else if (s.id === 'sprint') {
      if (inp.sprint && inp.mag > 0.3) st.t += dt;
      if (st.t >= s.need) complete(); else if (Math.random() < 0.1) render();
    } else if (s.id === 'hands') {
      if (p.hands) st.t += dt;
      if (st.t >= s.need) complete(); else if (Math.random() < 0.1) render();
    }
  }

  return { start, stop, update, get active() { return active; } };
})();
