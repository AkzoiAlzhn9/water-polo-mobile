// Интерфейс: меню, табло, баннеры, лента событий, радар, оверлеи.
WP.UI = (function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const R = WP.R;
  const V = new THREE.Vector3();
  const store = {
    get(k, d) { try { const v = localStorage.getItem('polo25_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('polo25_' + k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } },
  };
  const cfg = {
    home: store.get('home', 0), away: store.get('away', 1),
    mode: store.get('mode', '1p'), side: store.get('side', 0),
    len: store.get('len', 4), diff: store.get('diff', 1), tie: store.get('tie', 1), gfx: store.get('gfx', 'auto'),
  };
  if (!WP.TEAMS[cfg.home]) cfg.home = 0;
  if (!WP.TEAMS[cfg.away] || cfg.away === cfg.home) cfg.away = cfg.home === 1 ? 0 : 1;
  let cb = {};
  let match = null, demo = true;
  let bannerT = 0, textAcc = 0, radarAcc = 0;
  const labelEls = [];
  let isTouch = false;

  function init(callbacks) {
    cb = callbacks;
    isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    document.querySelectorAll('.team-pick').forEach((el) => {
      const side = +el.dataset.side;
      el.querySelectorAll('.picker button').forEach((b) => b.addEventListener('click', () => {
        const key = side === 0 ? 'home' : 'away', other = side === 0 ? 'away' : 'home';
        const n = WP.TEAMS.length, d = +b.dataset.d;
        let v = (cfg[key] + d + n) % n;
        if (v === cfg[other]) v = (v + d + n) % n;
        cfg[key] = v; store.set(key, v); renderPicks();
      }));
    });
    bindSeg('optMode', 'mode', (v) => v);
    bindSeg('optSide', 'side', (v) => +v);
    bindSeg('optLen', 'len', (v) => +v);
    bindSeg('optDiff', 'diff', (v) => +v);
    bindSeg('optTie', 'tie', (v) => +v);
    bindSeg('optGfx', 'gfx', (v) => v);
    $('optGfx').addEventListener('click', () => { if (cb.gfx) cb.gfx(cfg.gfx); });
    renderPicks(); renderSegs();
    $('btnStart').addEventListener('click', () => {
      WP.Audio.init();
      cb.start({
        home: WP.TEAMS[cfg.home], away: WP.TEAMS[cfg.away], mode: cfg.mode, humanSide: cfg.side,
        periodMin: cfg.len, difficulty: cfg.diff, shootout: !!cfg.tie,
      });
    });
    $('btnCareer').addEventListener('click', () => { WP.Audio.init(); cb.career(); });
    $('btnTut').addEventListener('click', () => { WP.Audio.init(); cb.tutorial(); });
    $('btnOnline').addEventListener('click', () => { WP.Audio.init(); cb.online(); });
    $('btnRules').addEventListener('click', () => openHelp('rules'));
    $('btnCtl').addEventListener('click', () => openHelp('ctl'));
    $('helpClose').addEventListener('click', closeHelp);
    $('help').addEventListener('click', (e) => { if (e.target === $('help')) closeHelp(); });
    $('helpTabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => openHelp(b.dataset.v)));
    $('btnPause').addEventListener('click', () => cb.pause());
    $('btnCam').addEventListener('click', () => cb.cam());
    $('btnMute').addEventListener('click', () => cb.mute());
    $('btnFF').addEventListener('click', () => { if (match) match.ffOn = !match.ffOn; });
    $('btnVar').addEventListener('click', () => { const t = match && match.teams.find(x => x.human === 'p1'); if (t) match.requestChallenge(t); });
    $('pResume').addEventListener('click', () => cb.pause());
    $('pTac').addEventListener('click', () => showTactics(true));
    $('pCtl').addEventListener('click', () => showCtl(true));
    $('btnCtlSet').addEventListener('click', () => showCtl(true));
    $('helpBody').addEventListener('click', (e) => { if (e.target.closest('[data-open="ctlset"]')) { closeHelp(); showCtl(true); } });
    $('csDone').addEventListener('click', () => showCtl(false));
    $('csTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; csTab = b.dataset.v; csWait = null; csMsg = ''; WP.Input.cancelCapture(); renderCtl(); });
    $('csBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cs]'); if (!b) return;
      const I = WP.Input, k = b.dataset.cs;
      if (k === 'key') {
        const a = b.dataset.a, slot = +b.dataset.slot;
        csWait = { a, slot }; csMsg = ''; renderCtl();
        I.capture((code) => {
          csWait = null;
          if (code === 'Escape') csMsg = '';
          else if (code === 'Backspace' || code === 'Delete') { I.unbind(a, slot); csMsg = ''; }
          else csMsg = I.bind(a, slot, code);
          renderCtl();
        });
        return;
      }
      if (k === 'reset') { I.resetKeys(); csMsg = 'Стандартные клавиши восстановлены'; renderCtl(); return; }
      if (k === 'opt') { I.setOpt(b.dataset.k, !I.opts[b.dataset.k]); renderCtl(); return; }
      if (k === 'size') { I.setOpt('touchSize', b.dataset.v); renderCtl(); }
    });
    $('toTac').addEventListener('click', () => showTactics(true));
    $('brkTac').addEventListener('click', () => showTactics(true));
    $('tacDone').addEventListener('click', () => showTactics(false));
    $('tac').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b || b.disabled) return;
      const team = tacTeam(); if (!team) return;
      const k = b.dataset.t, v = b.dataset.v;
      if (k === 'team') { tacSide = +v; subSel = null; tacMsg = ''; renderTactics(); return; }
      if (k === 'out') { subSel = subSel === v ? null : v; tacMsg = ''; renderTactics(); return; }
      if (k === 'in') {
        const out = team.players.find(p => String(p.num) === subSel), inn = team.bench.find(p => String(p.num) === v);
        tacMsg = out ? match.requestSub(team, out, inn) : 'Сначала выбери, кого заменить (слева — игроки на воде)';
        subSel = null; renderTactics(); return;
      }
      if (k === 'auto') team.tac.autoSubs = !team.tac.autoSubs;
      else { team.tac[k] = v; team.ai.dirty = true; team.ai.play = null; }
      if (match.cfg.career && !match.cfg.pc) WP.Career.saveTac(team.tac);
      renderTactics();
    });
    $('pHelp').addEventListener('click', () => openHelp('rules'));
    $('pRestart').addEventListener('click', () => cb.restart());
    $('pMenu').addEventListener('click', () => { if (match && match.cfg.career) cb.careerReturn(true); else cb.menu(); });
    $('brkMenu').addEventListener('click', () => { if (match && match.cfg.career) cb.careerReturn(true); else cb.menu(); });
    $('brkNext').addEventListener('click', () => {
      $('brk').hidden = true;
      if (match.state === 'final') { if (match.cfg.career) cb.careerReturn(false); else if (match.cfg.net) cb.menu(); else cb.restart(); } else if (!match.cfg.net) match.nextPeriod();
    });
    $('toGo').addEventListener('click', () => match.endTimeout());
    $('luGo').addEventListener('click', () => {
      WP.Audio.init(); $('lineup').hidden = true; match.begin();
      if (isTouch) goLandscape();
    });
    $('luHelp').addEventListener('click', () => openHelp('ctl'));
    WP.Input.bindTouch($('touch'));
    for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'lb'; d.hidden = true; $('labels').appendChild(d); labelEls.push(d); }
  }

  function bindSeg(id, key, conv) {
    $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      cfg[key] = conv(b.dataset.v); store.set(key, cfg[key]); renderSegs();
    }));
  }
  function renderSegs() {
    const m = { optMode: 'mode', optSide: 'side', optLen: 'len', optDiff: 'diff', optTie: 'tie', optGfx: 'gfx' };
    for (const id in m) $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(String(b.dataset.v) === String(cfg[m[id]]))));
    $('rowSide').hidden = cfg.mode !== '1p';
    $('rowDiff').hidden = cfg.mode !== '1p';
    $('btnStart').textContent = cfg.mode === 'demo' ? 'Смотреть матч' : 'На воду';
  }
  function renderPicks() {
    document.querySelectorAll('.team-pick').forEach((el) => {
      const t = WP.TEAMS[+el.dataset.side === 0 ? cfg.home : cfg.away];
      el.querySelector('.tp-name b').textContent = t.code;
      el.querySelector('.tp-flag').innerHTML = WP.flag(t.code);
      el.querySelector('.tp-name small').textContent = t.name;
      el.querySelector('.tp-bar i').style.width = Math.round((t.rating - 65) / 30 * 100) + '%';
      const stars = t.players.filter(p => p[3]).map(p => p[1]).slice(0, 3).join(', ');
      el.querySelector('.tp-meta').textContent = 'Рейтинг ' + t.rating + ' · ' + stars + '. ' + t.note + '.';
    });
  }

  function openHelp(tab) {
    $('help').hidden = false;
    $('helpBody').innerHTML = tab === 'ctl' ? '<div class="row-btns" style="margin:0 0 10px"><button class="btn primary" data-open="ctlset">Настроить управление</button></div>' + WP.controlsHtml() : WP.RULES_HTML;
    $('helpTitle').textContent = tab === 'ctl' ? 'Управление' : 'Правила водного поло';
    $('helpTabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === tab)));
  }
  function closeHelp() { $('help').hidden = true; }

  // На телефоне пробуем развернуть игру на весь экран и закрепить горизонтальную ориентацию
  function goLandscape() {
    try {
      const el = document.documentElement;
      const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* нет поддержки */ } };
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(lock);
      else lock();
    } catch (e) { /* браузер не даёт — останется подсказка повернуть телефон */ }
  }

  function showMenu(on) {
    if (on) document.body.classList.remove('playing');
    $('menu').hidden = !on;
    $('hud').hidden = on;
    $('touch').hidden = on || !isTouch;
    for (const id of ['pause', 'brk', 'to', 'lineup', 'tac']) $(id).hidden = true;
  }

  function bind(m, isDemo) {
    match = m; demo = isDemo;
    $('feed').innerHTML = '';
    $('banner').className = '';
    m.emit = (kind, data) => onEvent(kind, data);
    $('tvcard').className = '';
    $('combo').className = ''; $('speed').className = ''; pcardKey = '';
    flagKey = '';
    $('touch').hidden = isDemo || !isTouch || m.cfg.mode === 'demo';
    document.body.classList.toggle('playing', !isDemo && m.cfg.mode !== 'demo');
    touchMode = '';
  }

  function showLineup(m) {
    const [a, b] = m.teams;
    $('luTitle').textContent = a.name + ' — ' + b.name;
    const me = m.cfg.pc ? m.teams.flatMap(t => t.roster).find(p => m.isMe(p)) : null;
    const hum = me ? 'Ты — №' + me.num + ' ' + me.full + ' («' + me.team.name + '»). ' + (m.cfg.pc.enter ? 'Начинаешь на скамейке, выход в ' + m.cfg.pc.enter + '-м периоде — можно перемотать. ' : 'Ты в стартовой семёрке. ') + (m.cfg.pc.obj ? 'Задача тренера: ' + m.cfg.pc.obj + '. ' : '') :
      m.cfg.mode === '1p' ? 'Вы играете за команду ' + m.teams[m.cfg.humanSide].name + '. ' : m.cfg.mode === '2p' ? 'Игрок 1 — ' + a.name + ', игрок 2 — ' + b.name + '. ' : '';
    $('luSub').textContent = hum + '4 периода по ' + m.cfg.periodMin + ' мин чистого времени. Стартовые семёрки:';
    const col = (t, cls) => '<div><h3>' + WP.flag(t.code) + '<span class="capdot ' + cls + '"></span>' + t.code + ' · ' + t.name + '</h3><ol>' +
      t.players.map(p => '<li><b>' + p.num + '</b><span>' + p.full + (p.star ? ' ★' : '') + (m.isMe(p) ? ' <em class="me">ТЫ</em>' : '') + '</span><i>' + WP.ROLE_NAMES[p.role] + ' · ' + p.heightCm + ' см · <strong>' + WP.ovr(p.role, p.attrs) + '</strong></i></li>').join('') +
      '</ol><p class="muted small">Запасные: ' + t.bench.map(p => p.num + ' ' + p.name + (m.isMe(p) ? ' (ТЫ)' : '')).join(', ') + '</p></div>';
    $('luBody').innerHTML = col(a, 'home') + col(b, 'away');
    $('lineup').hidden = false;
  }

  let cardTimer = null, flagKey = '';
  function showCard(d) {
    const el = $('tvcard'), p = d.player, t = d.team;
    el.querySelector('.tc-flag').innerHTML = WP.flag(t.code);
    const dots = (n) => '<b>' + '●'.repeat(Math.min(3, n)) + '○'.repeat(Math.max(0, 3 - n)) + '</b>';
    let tag, meta;
    if (d.kind === 'goal') {
      tag = 'ГОЛ'; const g = p.stats.goals;
      meta = t.name + ' · ' + g + '-й гол в матче' + (d.extra ? ' · ' + d.extra : '');
    } else if (d.kind === 'pen') {
      tag = 'ПЕНАЛЬТИ'; meta = t.name + ' · персональные замечания ' + dots(p.fouls);
    } else {
      tag = 'УДАЛЕНИЕ · ' + (p.hardTime ? '4 МИН' : '15 С'); meta = t.name + ' · ' + (d.reason || '') + ' · замечания ' + dots(p.fouls);
    }
    el.querySelector('.tc-tag').textContent = tag;
    el.querySelector('.tc-name').textContent = '№' + p.num + ' ' + p.full.toUpperCase();
    el.querySelector('.tc-meta').innerHTML = meta;
    el.className = 'show ' + (d.kind === 'goal' ? 'goal' : '');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => { el.className = el.className.replace('show', ''); }, d.kind === 'goal' ? 4200 : 3600);
  }

  function replay(on, label) {
    $('replay').hidden = !on;
    if (label) $('rpLabel').textContent = label;
    $('feed').style.visibility = on ? 'hidden' : '';
    $('radar').style.visibility = on ? 'hidden' : '';
    $('hint').style.visibility = on ? 'hidden' : '';
  }

  let comboTimer = null, speedTimer = null;
  function showCombo(d) {
    const el = $('combo');
    el.querySelectorAll('.ck').forEach(c => c.classList.toggle('on', +c.dataset.i <= d.stage));
    el.querySelector('em').textContent = d.ok ? 'без фола!' : (d.msg || '');
    el.className = 'show' + (d.ok ? ' ok' : d.fail ? ' fail' : '');
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => { el.className = ''; }, d.stage > 0 && !d.ok ? 900 : 1600);
  }

  function onEvent(kind, d) {
    if (kind === 'card') { showCard(d); return; }
    if (kind === 'combo') { if (!demo) showCombo(d); return; }
    if (kind === 'passinfo') {
      if (demo) return;
      const el = $('speed');
      if (d.msg) {
        el.textContent = d.msg; el.className = 'show';
        clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, 1600);
        return;
      }
      // Прицел паса в разрез: кому уйдёт мяч и успевает ли он первым
      if (d.aim) {
        el.innerHTML = d.to ? 'Разрез' + (d.lob ? ' верхом' : '') + ' → <b>' + esc(d.to.name) + '</b> · ' + (d.open ? 'успевает' : 'спорно') : 'Некому отдать в разрез';
        el.className = 'show ' + (d.to && d.open ? 'ok' : 'warn');
        clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, 1100);
        return;
      }
      el.innerHTML = d.fumble ? 'Пас не принят · <b>' + d.kmh + '</b> км/ч · ' + d.p.name + ' не удержал' : (d.kind || (d.power > 0 ? 'Резкий пас' : 'Пас')) + ' · <b>' + d.kmh + '</b> км/ч → ' + d.to.name;
      el.className = 'show' + (d.fumble ? ' bad' : '');
      clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, d.fumble ? 2600 : 1400);
      return;
    }
    if (kind === 'callball') {
      if (demo) return;
      const el = $('speed');
      el.innerHTML = '«Дай!» — ' + d.p.name + ' просит мяч';
      el.className = 'show';
      clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, 1000);
      return;
    }
    if (kind === 'subin') {
      if (demo) return;
      const el = $('speed');
      el.innerHTML = 'Твой выход! · №' + d.p.num + ' ' + d.p.name;
      el.className = 'show';
      clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, 3000);
      return;
    }
    if (kind === 'shotspeed') {
      const el = $('speed');
      el.innerHTML = 'Бросок · <b>' + d.kmh + '</b> км/ч · ' + d.p.name;
      el.className = 'show';
      clearTimeout(speedTimer); speedTimer = setTimeout(() => { el.className = ''; }, 2600);
      return;
    }
    if (kind === 'banner') {
      const el = $('banner');
      el.querySelector('.b-title').textContent = d.title;
      el.querySelector('.b-sub').textContent = d.sub;
      el.className = 'show ' + (d.tone || '');
      bannerT = d.tone === 'goal' ? 3.2 : 2.4;
    } else if (kind === 'log') {
      return;
      const f = $('feed');
      const ln = document.createElement('div');
      ln.className = 'ln ' + d.kind;
      const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = (match.so ? 'ПЕН' : 'P' + d.per) + ' ' + d.t;
      ln.appendChild(tm); ln.appendChild(document.createTextNode(d.text));
      f.appendChild(ln);
      while (f.children.length > 4) f.removeChild(f.firstChild);
    } else if (kind === 'break') {
      const m = match;
      if (demo || m.cfg.mode === 'demo') { setTimeout(() => { if (match === m && m.state === 'break') m.nextPeriod(); }, 3500); return; }
      if (m.ffOn && !d.shootout) { setTimeout(() => { if (match === m && m.state === 'break') m.nextPeriod(); }, 400); return; }
      // Онлайн: следующий период начинает хозяин автоматически через 6 секунд
      if (m.cfg.net && m.cfg.net.role === 'host') setTimeout(() => { if (match === m && m.state === 'break') { $('brk').hidden = true; m.nextPeriod(); } }, 6000);
      setTimeout(() => { if (match === m) showBreak(d); }, 1200);
    } else if (kind === 'final') {
      const m = match;
      if (demo) { setTimeout(() => { if (match === m && cb.demoNext) cb.demoNext(); }, 5000); return; }
      setTimeout(() => { if (match === m) showBreak({ final: true }); }, 1500);
    } else if (kind === 'timeout') {
      if (demo || match.cfg.mode === 'demo') return;
      $('toTitle').textContent = 'Тайм-аут · ' + d.team.name;
      $('toSub').textContent = 'Минута на установку. Счёт ' + match.teams[0].code + ' ' + match.teams[0].score + ':' + match.teams[1].score + ' ' + match.teams[1].code + ', ' + match.periodName() + ', ' + match.clockLabel() + '.';
      $('toStats').innerHTML = statsTable(match);
      $('to').hidden = false;
    } else if (kind === 'timeoutEnd') {
      $('to').hidden = true;
    }
  }

  function pct(a, b) { return a + '/' + b; }
  function statsTable(m) {
    const [a, b] = m.teams;
    const row = (label, x, y) => '<tr><td>' + x + '</td><td>' + label + '</td><td>' + y + '</td></tr>';
    return '<tr><th>' + a.code + '</th><th></th><th>' + b.code + '</th></tr>' +
      row('Голы', a.score, b.score) +
      row('Броски (в створ)', a.stats.shots + ' (' + a.stats.onTarget + ')', b.stats.shots + ' (' + b.stats.onTarget + ')') +
      row('Сейвы вратаря', a.stats.saves, b.stats.saves) +
      row('Удаления заработано', a.stats.exclEarned, b.stats.exclEarned) +
      row('Реализация большинства', pct(a.stats.ppGoals, a.stats.ppAtt), pct(b.stats.ppGoals, b.stats.ppAtt)) +
      row('Пенальти', pct(a.stats.penGoals, a.stats.penEarned), pct(b.stats.penGoals, b.stats.penEarned)) +
      row('Отборы и перехваты', a.stats.steals, b.stats.steals) +
      row('Блоки', a.stats.blocks, b.stats.blocks) +
      row('Тайм-ауты в запасе', a.timeouts, b.timeouts);
  }
  function scorers(t) {
    const list = t.roster.filter(p => p.stats.goals > 0).sort((x, y) => y.stats.goals - x.stats.goals).map(p => p.name + ' ' + p.stats.goals);
    const gk = t.roster.filter(p => p.isGK && p.stats.saves > 0).map(p => p.name + ': ' + p.stats.saves + ' сейв.');
    return '<div><b>' + t.code + ':</b> ' + (list.join(', ') || 'без голов') + (gk.length ? '<br><span class="muted">' + gk.join(', ') + '</span>' : '') + '</div>';
  }

  // Оценка игрока за матч (та же шкала, что и в карьере)
  function rating(m, p) {
    const s = p.stats, t = p.team;
    const won = t.score > t.opp.score, lost = t.score < t.opp.score;
    return Math.max(3, Math.min(10, 6 + s.goals * 0.7 + (s.assists || 0) * 0.45 + s.saves * 0.12 + (s.steals || 0) * 0.3 - s.excl * 0.35 + (s.shots - s.goals > 4 ? -0.3 : 0) + (won ? 0.4 : lost ? -0.3 : 0)));
  }
  function playerTable(m, t, mvp) {
    const list = t.roster.filter(p => p.played).sort((x, y) => (y.isGK - x.isGK) || rating(m, y) - rating(m, x));
    return '<div><h4>' + WP.flag(t.code) + ' ' + t.code + '</h4><table class="ptab"><tr><th>№</th><th>Игрок</th><th title="Голы">Г</th><th title="Голевые передачи">П</th><th title="Броски">Бр</th><th title="Отборы / сейвы">От</th><th title="Удаления">Уд</th><th>Оц</th></tr>' +
      list.map(p => '<tr class="' + (p === mvp ? 'mvp' : '') + '"><td>' + p.num + '</td><td class="nm">' + p.name + (p === mvp ? ' ★' : '') + '</td><td>' + p.stats.goals + '</td><td>' + (p.stats.assists || 0) + '</td><td>' + p.stats.shots + '</td><td>' + (p.isGK ? p.stats.saves : p.stats.steals) + '</td><td>' + p.stats.excl + '</td><td><b>' + rating(m, p).toFixed(1) + '</b></td></tr>').join('') + '</table></div>';
  }

  function showBreak(d) {
    const m = match; if (!m) return;
    const [a, b] = m.teams;
    const fin = d.final || m.state === 'final';
    $('brkTitle').textContent = fin ? 'Финальный свисток' : d.shootout ? 'Ничья — серия пенальти' : m.period === 2 ? 'Большой перерыв' : 'Конец ' + m.period + '-го периода';
    const so = m.so ? '<small>пен. ' + m.soScore() + '</small>' : '';
    $('brkScore').innerHTML = '<small>' + a.code + '</small>' + a.score + ':' + b.score + '<small>' + b.code + '</small>' + so;
    $('brkStats').innerHTML = statsTable(m);
    if (fin) {
      const all = a.roster.concat(b.roster).filter(p => p.played);
      const mvp = all.sort((x, y) => rating(m, y) - rating(m, x))[0];
      $('brkScorers').innerHTML = (mvp ? '<p class="mvp-line">Лучший игрок матча: <b>№' + mvp.num + ' ' + mvp.full + '</b> (' + mvp.team.name + ') · оценка ' + rating(m, mvp).toFixed(1) + '</p>' : '') +
        '<div class="ptabs">' + playerTable(m, a, mvp) + playerTable(m, b, mvp) + '</div>';
    } else $('brkScorers').innerHTML = scorers(a) + scorers(b);
    $('brkNext').textContent = fin ? (m.cfg.career ? 'В карьеру' : m.cfg.net ? 'В меню' : 'Реванш') : d.shootout ? 'К серии пенальти' : (m.period + 1) + '-й период';
    // В онлайн-матче перерыв идёт сам: кнопка «следующий период» не нужна
    $('brkNext').hidden = !fin && !!m.cfg.net;
    if (!fin && m.cfg.net) $('brkTitle').textContent += ' · продолжение через 6 с';
    $('brkMenu').textContent = m.cfg.career ? 'Досимулировать' : m.cfg.net ? 'Выйти из матча' : 'В меню';
    $('brkMenu').hidden = fin && !!m.cfg.career;
    $('brk').hidden = false;
  }

  // ---------- Настройка управления ----------
  let csTab = 'keys', csWait = null, csMsg = '';
  const onOff = (k, on, title, desc) => '<button class="cs-opt" data-cs="opt" data-k="' + k + '" aria-pressed="' + !!on + '"><span class="cs-sw"><i></i></span><span><b>' + title + '</b><small>' + desc + '</small></span></button>';
  function renderCtl() {
    const I = WP.Input, o = I.opts;
    $('csTabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === csTab)));
    let h = '';
    if (csTab === 'keys') {
      h = '<p class="small muted">Нажми на клавишу и затем новую. <kbd>Backspace</kbd> — очистить, <kbd>Esc</kbd> — отмена. Закреплены: <kbd>Esc</kbd>/<kbd>P</kbd> пауза, <kbd>Tab</kbd> камера, <kbd>M</kbd> звук.</p>' +
        '<table class="cs-keys"><tr><th>Действие</th><th>Основная</th><th>Вторая</th></tr>' + I.ACTIONS.map(([a, name]) => {
          const ks = I.keysOf(a);
          const cell = (slot) => { const w = csWait && csWait.a === a && csWait.slot === slot; return '<td><button class="cs-key' + (w ? ' wait' : '') + '" data-cs="key" data-a="' + a + '" data-slot="' + slot + '">' + (w ? 'Нажми клавишу…' : I.keyName(ks[slot])) + '</button></td>'; };
          return '<tr><td>' + name + '</td>' + cell(0) + cell(1) + '</tr>';
        }).join('') + '</table>' + (csMsg ? '<p class="tac-msg">' + csMsg + '</p>' : '') +
        '<div class="row-btns"><button class="btn" data-cs="reset">Вернуть стандартные клавиши</button></div>';
    } else if (csTab === 'help') {
      h = onOff('assist', o.assist, 'Помощник в защите', 'Пока ты не трогаешь стик, защитник сам держит позицию и опекает соперника. Выключи — и без нажатий игрок будет стоять на месте.') +
        onOff('autoSwitch', o.autoSwitch, 'Автосмена игрока', 'Когда соперник принял пас далеко от тебя, управление переходит к ближайшему защитнику.') +
        onOff('autoPower', o.autoPower, 'Автосила броска', 'Короткое нажатие «Бросок» сразу даёт сильный бросок (85%), держать не обязательно. Удобно на телефоне.');
    } else if (csTab === 'touch') {
      h = '<div class="tac-sec"><div class="tac-lbl">Размер кнопок</div><div class="seg">' + [['normal', 'Обычный'], ['large', 'Крупный']].map(([v, n]) => '<button data-cs="size" data-v="' + v + '" aria-pressed="' + (o.touchSize === v) + '">' + n + '</button>').join('') + '</div></div>' +
        onOff('lefty', o.lefty, 'Для левши', 'Стик справа, кнопки слева.') +
        onOff('autoSprint', o.autoSprint, 'Авторывок', 'Стик до упора — игрок сам включает рывок (тратит силы). Работает и на геймпаде.') +
        onOff('vibrate', o.vibrate, 'Вибрация кнопок', 'Короткий отклик при нажатии (на телефонах, где браузер это поддерживает).') +
        '<div class="tac-sec"><div class="tac-lbl">Жесты на кнопках (как в FC Mobile)</div><p class="small muted"><b>Пас</b>: тап — обычный, держать — резкий, свайп ↑ — верхом, свайп ↓ — сильный. <b>Разрез</b>: тап — пас в разрез, свайп ↑ — в разрез верхом. <b>Бросок</b>: держать — сила, свайп ↑ — парашют, свайп ↓ — с отскоком. Пока ведёшь пальцем, кнопка подсвечивается сверху или снизу.</p></div>';
    } else {
      h = '<table class="cs-keys"><tr><th>Кнопка</th><th>Действие</th></tr>' + [['Левый стик', 'плыть'], ['A', 'пас (держать — резкий) · «Дай!» / сменить игрока'], ['X', 'бросок (держать — сильнее) · отбор'], ['B', 'парашют · блок'], ['Y', 'бросок с отскоком'], ['LB', 'финт (держать — кач)'], ['RB', 'заработать фол · руки вверх'], ['RT', 'рывок'], ['L3 (нажать стик)', 'заслон'], ['R3 (нажать правый стик)', 'пас в разрез (держать — прицел)'], ['LT', 'видеочеллендж'], ['Back', 'тайм-аут'], ['Start', 'пауза'], ['B → X → X', 'чистый вынос']].map(r => '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>').join('') + '</table>' +
        '<p class="small muted">Геймпад подключается сам — нажми любую кнопку. Авторывок (вкладка «Сенсорное») работает и для стика геймпада.</p>';
    }
    $('csBody').innerHTML = h;
  }
  function showCtl(on) {
    $('ctlset').hidden = !on;
    csWait = null; csMsg = ''; WP.Input.cancelCapture();
    if (on) { csTab = isTouch ? 'touch' : 'keys'; renderCtl(); }
  }

  // ---------- Тактика и замены ----------
  let tacSide = 0, subSel = null, tacMsg = '';
  const TAC = {
    att: { label: 'Нападение (6 на 6)', opts: [['33', '3-3', 'Трое у 2 м (крайние 1 и 5, центровой 6), трое на 5–7 м (2, 3, 4). Классика: игра через центрового.'], ['arc', 'Зонтик', 'Полевые по дуге на 5–7 м, центровой — «ручка» зонтика. Много места для проходов и заслонов, хорош против прессинга.'], ['42', '4-2', 'Два центровых у штанг и четверо на 5 м. Давит у ворот, но бросков издали меньше.']] },
    pp: { label: 'Большинство (6 на 5)', opts: [['42', '4-2', 'Двое на штангах, четверо на 5 м — стандарт большинства: мяч ходит по дуге, пока кто-то не откроется.'], ['33', '3-3', 'Трое на 2 м, трое на 5 м: больше передач к воротам и кросс-пасов через центр.']] },
    def: { label: 'Защита', opts: [['man', 'Опека', 'Каждый держит своего, дальние чуть отходят к центровому.'], ['press', 'Прессинг', 'Плотно у каждого, без отходов: мешает пасам, но легко пропустить проход или получить удаление.'], ['zone', 'Зона', 'Каждый держит участок, к мячу выходит ближайший. Закрывает центр, оставляет броски издали.'], ['mdrop', 'M-зона', 'Защитник разыгрывающего отходит к центровому (двойная опека), остальные — в «щели». Против сильного центрового.']] },
    move: { label: 'Стиль атаки', opts: [['hold', 'Держать позиции', 'Игроки стоят на своих точках и бросают из позиции; проходы — только в розыгрышах.'], ['motion', 'Движение', 'Проходы к воротам и смена позиций по ходу атаки.']] },
  };
  const ROLE_S = { GK: 'ВРТ', CF: 'ЦН', CB: 'ЦЗ', W: 'КР', D: 'УН' };
  function tacTeam() {
    if (!match) return null;
    const hum = match.teams.filter(t => t.human);
    if (!hum.length) return null;
    if (tacSide >= hum.length) tacSide = 0;
    return hum[tacSide];
  }
  function formSvg(team) {
    const n = match.activeField(team), oppN = match.activeField(team.opp);
    const id = oppN < n && n >= 6 ? (team.tac.pp === '33' ? '33pp' : '42') : team.tac.att === 'arc' ? 'arc' : team.tac.att === '42' ? '42e' : '33';
    const f = WP.AI.FORMS[id];
    const X = (r) => 100 + r * 9, Y = (dx) => 8 + dx * 9;
    let g = '<rect x="4" y="8" width="192" height="80" rx="3" class="fs-pool"/><rect x="85" y="3" width="30" height="5" class="fs-goal"/>' +
      '<line x1="4" x2="196" y1="' + Y(2) + '" y2="' + Y(2) + '" class="fs-l2"/><line x1="4" x2="196" y1="' + Y(5) + '" y2="' + Y(5) + '" class="fs-l5"/>' +
      '<text x="190" y="' + (Y(2) - 2) + '" class="fs-t">2 м</text><text x="190" y="' + (Y(5) - 2) + '" class="fs-t">5 м</text>';
    f.F.forEach((p, i) => { g += '<circle cx="' + X(p[1]) + '" cy="' + Y(p[0]) + '" r="6.5" class="fs-p"/><text x="' + X(p[1]) + '" y="' + (Y(p[0]) + 3) + '" class="fs-n">' + f.pos[i] + '</text>'; });
    return '<svg viewBox="0 0 200 92" class="form-svg" aria-label="Схема расстановки">' + g + '</svg>';
  }
  function renderTactics() {
    const team = tacTeam(); if (!team) return;
    const ro = !!match.cfg.pc;
    // Гость онлайн-матча меняет тактику (она уходит хозяину), а замены делает ИИ хозяина
    const subsRo = ro || !!(match.cfg.net && match.cfg.net.role === 'guest');
    const hum = match.teams.filter(t => t.human);
    $('tacTeams').innerHTML = hum.length > 1 ? hum.map((t, i) => '<button data-t="team" data-v="' + i + '" aria-pressed="' + (i === tacSide) + '">' + t.code + '</button>').join('') : '<span class="muted small">' + team.name + '</span>';
    let L = ro ? '<p class="small muted">В карьере игрока тактику и замены выбирает тренер. Заслон можно попросить в игре кнопкой ' + WP.Input.kbd('play') + '.</p>' : '';
    for (const k of ['att', 'pp', 'def', 'move']) {
      const g = TAC[k], cur = g.opts.find(o => o[0] === team.tac[k]) || g.opts[0];
      L += '<div class="tac-sec"><div class="tac-lbl">' + g.label + '</div><div class="seg">' + g.opts.map(o => '<button data-t="' + k + '" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur[0]) + '"' + (ro ? ' disabled' : '') + '>' + o[1] + '</button>').join('') + '</div><p class="small muted">' + cur[2] + '</p>' + (k === 'att' ? formSvg(team) : '') + '</div>';
    }
    L += '<div class="tac-sec"><div class="tac-lbl">Розыгрыш «заслон» — кнопка ' + WP.Input.kbd('play') + '</div><p class="small muted">Партнёр встаёт корпусом между защитником и воротами (спиной к защитнику), игрок обходит заслон и уходит к воротам — отдай ему пас, стрелка сама укажет на открывшегося. Если защита переключилась, открывается сам заслоняющий. Соперник тоже разыгрывает заслоны.</p></div>';
    $('tacLeft').innerHTML = L;
    const stam = (p) => '<span class="tac-st"><i style="width:' + Math.round(p.stamina * 100) + '%" class="' + (p.stamina < 0.35 ? 'lo' : p.stamina < 0.6 ? 'mid' : '') + '"></i></span>';
    const dots = (p) => '<span class="tac-f">' + '●'.repeat(Math.min(3, p.fouls || 0)) + '</span>';
    const row = (p, kind) => {
      const st = p.excluded ? '<em class="bad">удалён</em>' : p.rolling ? '<em>плывёт на замену</em>' : p.outForGame ? '<em class="bad">до конца матча</em>' : '';
      const dis = subsRo || (kind === 'in' && p.outForGame);
      return '<button class="tac-row' + (kind === 'out' && subSel === String(p.num) ? ' sel' : '') + '" data-t="' + kind + '" data-v="' + p.num + '"' + (dis ? ' disabled' : '') + '><b>' + p.num + '</b><span>' + p.name + (match.isMe(p) ? ' (ты)' : '') + '<small>' + ROLE_S[p.role] + ' · ' + WP.ovr(p.role, p.attrs) + '</small></span>' + stam(p) + dots(p) + st + '</button>';
    };
    const R = '<div class="tac-sec"><div class="tac-lbl">На воде' + (subsRo ? '' : ' — выбери, кого заменить') + '</div>' + team.players.map(p => row(p, 'out')).join('') + '</div>' +
      '<div class="tac-sec"><div class="tac-lbl">Скамейка' + (ro ? '' : ' — кто выйдет') + '</div>' + (team.bench.length ? team.bench.map(p => row(p, 'in')).join('') : '<p class="small muted">Скамейка пуста</p>') + '</div>' +
      (tacMsg ? '<p class="tac-msg">' + tacMsg + '</p>' : '') +
      '<p class="small muted">В остановке игры замена сразу, по ходу игры — через зону возвращения у своих ворот. Быстрая замена самого уставшего — ' + WP.Input.kbd('sub') + '.</p>' +
      '<button class="tac-row tac-auto" data-t="auto"' + (subsRo ? ' disabled' : '') + '><b>' + (team.tac.autoSubs ? '✓' : '') + '</b><span>Автозамены уставших</span></button>';
    $('tacRight').innerHTML = R;
  }
  function showTactics(on) {
    if (on && !tacTeam()) return;
    $('tac').hidden = !on;
    if (on) { subSel = null; tacMsg = ''; renderTactics(); }
  }

  function showPause(on) {
    $('pause').hidden = !on;
    if (!on) $('tac').hidden = true;
    const car = !!(match && match.cfg.career);
    $('pRestart').hidden = car || !!(match && match.cfg.net);
    $('pTac').hidden = !(match && match.teams.some(t => t.human));
    $('pMenu').textContent = car ? 'Досимулировать и выйти' : match && match.cfg.net ? 'Выйти из онлайн-матча' : 'В меню';
    if (on && match) {
      $('pauseStats').innerHTML = statsTable(match);
      $('pauseSub').textContent = match.periodName() + ' · ' + match.clockLabel();
    }
  }

  function setMuteIcon(m) { $('muteWave').style.opacity = m ? 0.15 : 1; }

  function update(m, dt, camera) {
    if (!m) return;
    bannerT -= dt;
    if (bannerT <= 0 && $('banner').classList.contains('show')) $('banner').classList.remove('show');
    textAcc += dt;
    if (textAcc > 0.1) { textAcc = 0; updateText(m); }
    radarAcc += dt;
    if (radarAcc > 1 / 30) { radarAcc = 0; drawRadar(m); }
    updateLabels(m, camera);
    let pw = 0, pass = false, risk = -1;
    for (const id of ['p1', 'p2']) {
      const p = m.controlled[id];
      if (p && p.action && p.action.type === 'windup' && !p.action.ai) pw = Math.max(pw, Math.min(1, Math.max(WP.Input.opts.autoPower ? 0.85 : 0.25, (p.action.t - 0.08) / 0.65)));
      const pc = m.passCharge && m.passCharge[id];
      if (pc && p && p.hasBall && m.inputs[id]) {
        pass = true; pw = Math.max(0.04, Math.min(1, (m.t - pc.t - 0.16) / 0.55));
        const to = m.pickReceiver(p, m.inputs[id]);
        if (to) risk = m.passRisk(p, to);
      }
    }
    const pe = $('power');
    pe.classList.toggle('on', pw > 0); pe.classList.toggle('pass', pass);
    pe.firstElementChild.style.width = Math.round(pw * 100) + '%';
    const mk = pe.querySelector('u');
    mk.hidden = !(pass && risk >= 0 && risk < 1);
    if (!mk.hidden) mk.style.left = (risk * 100).toFixed(1) + '%';
    pe.classList.toggle('risky', pass && risk >= 0 && pw > risk);
    updatePcard(m);
  }

  // Карточка игрока под управлением: параметры и запас сил
  let pcardKey = '';
  function updatePcard(m) {
    const el = $('pcard');
    const p = m.controlled.p1;
    const show = !!(p && m.cfg.mode !== 'demo' && m.cfg.mode !== '2p' && !['intro', 'final'].includes(m.state));
    el.hidden = !show;
    if (!show) return;
    const key = p.team.code + p.num;
    if (key !== pcardKey) {
      pcardKey = key;
      const a = p.attrs, ks = p.isGK ? ['gk', 'spd', 'pas', 'str', 'sta'] : ['spd', 'sht', 'acc', 'pas', 'def', 'str', 'sta'];
      el.querySelector('.pc-top').innerHTML = '<b>' + WP.ovr(p.role, a) + '</b><span>№' + p.num + ' ' + p.name + '<i>' + WP.ROLE_NAMES[p.role] + ' · ' + p.heightCm + ' см</i></span>';
      el.querySelector('.pc-at').innerHTML = ks.map(k => '<span class="' + (a[k] >= 88 ? 'hi' : a[k] < 70 ? 'lo' : '') + '"><em>' + WP.ATTR_SHORT[k] + '</em>' + Math.round(a[k]) + '</span>').join('');
    }
    const st = el.querySelector('.pc-st i');
    st.style.width = Math.round(p.stamina * 100) + '%';
    st.className = p.stamina < 0.35 ? 'lo' : p.stamina < 0.6 ? 'mid' : '';
  }

  function updateText(m) {
    const [a, b] = m.teams;
    $('sbHc').textContent = a.code; $('sbAc').textContent = b.code;
    if (flagKey !== a.code + b.code) { flagKey = a.code + b.code; $('sbHf').innerHTML = WP.flag(a.code); $('sbAf').innerHTML = WP.flag(b.code); }
    $('sbHs').textContent = a.score; $('sbAs').textContent = b.score;
    const holder = m.ball.holder;
    const poss = holder ? holder.team : (m.restart ? m.restart.team : m.possession);
    $('sbHp').classList.toggle('on', poss === a); $('sbAp').classList.toggle('on', poss === b);
    $('sbPer').textContent = m.so ? 'Серия пенальти' : m.period + '-й период';
    $('sbClock').textContent = m.so ? m.soScore() : m.clockLabel();
    const showShot = m.possession && !m.so && !['break', 'final', 'intro', 'sprint'].includes(m.state) && m.shotClock < m.clock + 0.5;
    const sc = Math.max(0, Math.ceil(m.shotClock));
    $('sbShot').textContent = showShot ? sc : '';
    $('sbShotBox').classList.toggle('low', !!showShot && sc <= 5);
    const pills = [];
    for (const t of m.teams) for (const p of t.players) if (p.excluded) {
      const tm = p.outForGame ? 'до конца матча' : p.hardTime ? Math.floor(p.exclTimer / 60) + ':' + String(Math.max(0, Math.ceil(p.exclTimer % 60))).padStart(2, '0') : Math.max(0, Math.ceil(p.exclTimer)) + ' с';
      pills.push('<span class="pill"><b>' + t.code + '</b> №' + p.num + ' ' + p.name + ' · ' + tm + '</span>');
    }
    const html = pills.join('');
    if ($('exclRow').innerHTML !== html) $('exclRow').innerHTML = html;
    // Кнопка видеочелленджа, пока решение против игрока можно оспорить
    const ht = m.teams.find(x => x.human === 'p1');
    $('btnVar').hidden = !(ht && m.canChallenge(ht));
    // Карьера игрока: пока ты на скамейке, матч можно перемотать
    const benched = !!(m.cfg.pc && m.state !== 'final' && !m.teams.some(t => t.players.some(p => m.isMe(p) && p.active)));
    if (!benched && m.ffOn) m.ffOn = false;
    $('btnFF').hidden = !benched;
    const ffl = m.ffOn ? '▶ Обычная скорость' : '⏩ Перемотать';
    if ($('btnFF').textContent !== ffl) $('btnFF').textContent = ffl;
    let hint = '';
    if (m.cfg.mode === '1p' && !isTouch) {
      const p = m.controlled.p1;
      const rs = m.restart;
      const K = WP.Input.kbd;
      if (p && p.hasBall && m.thruAiming && m.thruAiming('p1')) {
        // Прицел разреза: что делать дальше
        const lp = WP.Input.keysOf('lobpass');
        hint = 'Прицел разреза: ' + WP.Input.moveKbd() + ' — выбрать партнёра · отпусти ' + K('thru') + ' — пас · ' + K('sprint') + ' — верхом / по воде' + (lp[0] || lp[1] ? ' · ' + K('lobpass') + ' — сразу верхом' : '');
      }
      else if (m.state === 'penalty' && rs && rs.taker === p) hint = 'Пенальти: ' + K('left') + '/' + K('right') + ' — угол, ' + K('shoot') + ' — бросок сразу, без финта';
      else if (rs && rs.type === 'throwoff' && rs.taker === p) hint = 'Ввод из центра: ' + K('pass') + ' — пас партнёру';
      else if (rs && rs.taker === p && rs.allowShot && rs.ready) hint = 'Штрафной из-за 6 м: можно сразу бросать ' + K('shoot') + ' · ' + K('pass') + ' пас · поплыть — ввести мяч';
      else if (p && p.hasBall) hint = K('pass') + ' пас, держи — резкий · ' + K('thru') + ' разрез, держи — прицел · ' + K('shoot') + ' бросок · ' + K('lob') + ' парашют · ' + K('fake') + ' кач · ' + K('foul') + ' фол · ' + K('play') + ' заслон · ' + K('tac') + ' тактика';
      else if (!p && m.cfg.pc) hint = m.cfg.pc.enter && m.period < m.cfg.pc.enter ? 'Ты на скамейке — выход в ' + m.cfg.pc.enter + '-м периоде · ⏩ перемотать' : 'Ты вне игры';
      else if (m.state === 'intro' || m.state === 'sprint') hint = 'Спринт: плывите к мячу ' + WP.Input.moveKbd() + ' + ' + K('sprint');
      else hint = K('pass') + (m.cfg.pc ? ' «Дай!» — попросить мяч' : ' сменить игрока') + ' · держи ' + K('foul') + ' — руки вверх, без фола · ' + K('shoot') + ' отбор · ' + K('lob') + ' блок · комбо ' + K('lob') + '→' + K('shoot') + '→' + K('shoot') + ' — чистый вынос';
    }
    updateTouch(m);
    if ($('hint').innerHTML !== hint) $('hint').innerHTML = hint;
    // Онлайн: соперник свернул игру — плашка с отсчётом
    const ns = m.cfg.net ? WP.Net.status() : null;
    $('netPill').hidden = !ns;
    if (ns && $('netPill').textContent !== ns) $('netPill').textContent = ns;
    // Связь в онлайн-матче: напрямую или через сервер и задержка
    const ni = m.cfg.net ? WP.Net.info() : null, nt = ni ? (ni.p2p ? 'P2P' : 'сервер') + (ni.rtt ? ' · ' + ni.rtt + ' мс' : '') : '';
    $('netPing').hidden = !nt;
    if (nt && $('netPing').textContent !== nt) { $('netPing').textContent = nt; $('netPing').className = ni.rtt > 350 ? 'bad' : ni.rtt > 180 ? 'mid' : ''; }
    $('hint').hidden = !hint;
  }

  // Тач-кнопки меняют подписи: с мячом — атака, без мяча — защита
  let touchMode = '';
  // В атаке подписи кнопок с жестами показывают свайпы: ↑ и ↓ по кнопке
  const TOUCH_LBL = {
    att: { fake: 'Кач', lob: 'Разрез<small>↑ верхом</small>', sprint: 'Рывок', foul: 'Фол', pass: 'Пас<small>↑ верхом ↓ сильный</small>', shoot: 'Бросок<small>↑ парашют ↓ отскок</small>' },
    def: { fake: '', lob: 'Блок', sprint: 'Рывок', foul: 'Руки', pass: 'Игрок', shoot: 'Отбор' },
    call: { fake: '', lob: 'Блок', sprint: 'Рывок', foul: 'Руки', pass: 'Дай!', shoot: 'Отбор' },
  };
  function updateTouch(m) {
    if (!isTouch || $('touch').hidden) return;
    const p = m.controlled.p1;
    const h = m.ball.holder;
    const mode = p && p.hasBall ? 'att' : m.cfg.pc && h && p && h.team === p.team ? 'call' : 'def';
    const pb = $('touch').querySelector('[data-b="play"]');
    if (pb) pb.classList.toggle('off', mode === 'def');
    if (mode === touchMode) return;
    touchMode = mode;
    const L = TOUCH_LBL[mode];
    $('touch').querySelector('.tbtns').classList.toggle('def', mode !== 'att');
    $('touch').querySelectorAll('.tbtns button:not([data-b="play"])').forEach((b) => {
      const slot = b.dataset.slot || (b.dataset.slot = b.dataset.b);
      const t = L[slot]; b.innerHTML = t || ''; b.classList.toggle('off', !t);
      // Кнопка «Парашют/Блок»: в атаке это «Разрез» (пас в разрез), в защите — «Блок»
      if (slot === 'lob') b.dataset.b = mode === 'att' ? 'thru' : 'lob';
    });
  }

  function updateLabels(m, camera) {
    const items = [];
    for (const id of ['p1', 'p2']) { const p = m.controlled[id]; if (p && p.rig && p.active) items.push([p, id]); }
    const h = m.ball.holder;
    if (h && h.rig && !items.some(i => i[0] === h)) items.push([h, '']);
    for (const t of m.teams) for (const p of t.players) if (p.excluded && p.rig && items.length < 6) items.push([p, 'ex']);
    const w = camera.userData.w, hh = camera.userData.h;
    for (let i = 0; i < labelEls.length; i++) {
      const el = labelEls[i], it = items[i];
      if (!it || m.state === 'break' || m.state === 'final' || !$('menu').hidden || !$('replay').hidden) { el.hidden = true; continue; }
      const [p, cls] = it;
      V.set(p.x, 0.75 + p.lift * 0.35, p.z).project(camera);
      if (V.z > 1) { el.hidden = true; continue; }
      el.hidden = false;
      el.className = 'lb ' + cls;
      const txt = cls === 'ex' ? '№' + p.num + ' · ' + (p.outForGame ? 'удалён' : Math.max(0, Math.ceil(p.exclTimer)) + ' с') : p.num + ' · ' + p.name.toUpperCase();
      if (el.textContent !== txt) el.textContent = txt;
      el.style.left = ((V.x + 1) / 2 * w).toFixed(1) + 'px';
      el.style.top = ((1 - V.y) / 2 * hh).toFixed(1) + 'px';
    }
  }

  function drawRadar(m) {
    const c = $('radar'), g = c.getContext('2d');
    const W = c.width, H = c.height, pad = 22;
    const sx = (W - pad * 2) / (R.HALF_L * 2), sz = (H - pad * 2) / (R.HALF_W * 2);
    const X = (x) => pad + (x + R.HALF_L) * sx, Z = (z) => pad + (z + R.HALF_W) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,90,110,0.35)'; g.fillRect(X(-R.HALF_L), Z(-R.HALF_W), R.HALF_L * 2 * sx, R.HALF_W * 2 * sz);
    const vline = (x, col, lw) => { g.strokeStyle = col; g.lineWidth = lw || 2; g.beginPath(); g.moveTo(X(x), Z(-R.HALF_W)); g.lineTo(X(x), Z(R.HALF_W)); g.stroke(); };
    for (const s of [-1, 1]) {
      vline(s * R.HALF_L, '#e9f2f5', 3);
      vline(s * (R.HALF_L - 2), 'rgba(214,40,40,.85)');
      vline(s * (R.HALF_L - 5), 'rgba(242,196,0,.85)');
      vline(s * (R.HALF_L - 6), 'rgba(42,157,74,.85)');
      g.fillStyle = '#ffffff'; g.fillRect(X(s * R.HALF_L) - (s > 0 ? 0 : 8), Z(-R.GOAL_HALF_W), 8, R.GOAL_HALF_W * 2 * sz);
    }
    vline(0, 'rgba(233,242,245,.7)');
    for (const t of m.teams) for (const p of t.players) {
      if (!p.rig) continue;
      g.globalAlpha = p.excluded ? 0.35 : 1;
      g.beginPath(); g.arc(X(p.x), Z(p.z), 7, 0, Math.PI * 2);
      g.fillStyle = p.isGK ? '#d7262e' : t.capHex; g.fill();
      g.lineWidth = 2; g.strokeStyle = t.side === 0 ? '#13264a' : '#dfe8ff'; g.stroke();
      if (p.ctrl) { g.beginPath(); g.arc(X(p.x), Z(p.z), 12, 0, Math.PI * 2); g.strokeStyle = p.ctrl === 'p1' ? '#ffc23a' : '#3dd6f5'; g.lineWidth = 3; g.stroke(); }
    }
    g.globalAlpha = 1;
    const b = m.ball.pos;
    g.beginPath(); g.arc(X(b.x), Z(b.z), 6, 0, Math.PI * 2); g.fillStyle = '#ffd21f'; g.fill(); g.strokeStyle = '#1d3f9a'; g.lineWidth = 2; g.stroke();
  }

  return { init, showMenu, bind, update, showPause, showLineup, setMuteIcon, openHelp, closeHelp, replay, showTactics, showCtl, get ctlOpen() { return !$('ctlset').hidden; }, get gfx() { return cfg.gfx; }, get helpOpen() { return !$('help').hidden; }, get tacOpen() { return !$('tac').hidden; } };
})();
