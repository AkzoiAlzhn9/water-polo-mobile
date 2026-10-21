// Быстрый турнир: 8 сборных, две группы по 4 (круг), полуфиналы крест-накрест и финал.
// Свои матчи играешь сам, остальные досчитываются по силе команд. Хранится в браузере (localStorage 'polo25_cup_v1').
WP.Cup = (function () {
  const KEY = 'polo25_cup_v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (code) => WP.TEAMS.find(t => t.code === code) || WP.TEAMS[0];
  let C = null, hooks = {}, pick = { team: null, len: 4, diff: 1 }, confirmNew = false;
  const load = () => { try { C = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { C = null; } };
  const save = () => { try { if (C) localStorage.setItem(KEY, JSON.stringify(C)); else localStorage.removeItem(KEY); } catch (e) { /* нет хранилища */ } };

  // ---------- турнир ----------
  function create(team, len, diff) {
    const pool = WP.TEAMS.filter(t => t.code !== team && !/^AS\d$/.test(t.code)).map(t => t.code);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    // Посев: сильнейшие разведены по группам
    const eight = [team].concat(pool.slice(0, 7)).sort((a, b) => T(b).rating - T(a).rating);
    const A = [], B = [];
    eight.forEach((c, i) => ((i % 4 === 0 || i % 4 === 3) ? A : B).push(c));
    const fx = [];
    const rr = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
    for (const [g, list] of [['A', A], ['B', B]]) rr.forEach((r, ri) => {
      fx.push({ id: g + ri + 'a', stage: 'G', group: g, round: ri, home: list[r[0]], away: list[r[1]], played: false });
      fx.push({ id: g + ri + 'b', stage: 'G', group: g, round: ri, home: list[r[2]], away: list[r[3]], played: false });
    });
    C = { v: 1, team, len, diff, groups: { A, B }, fx, round: 0, stage: 'G', champion: null };
    save();
  }
  // Счёт по силе: ватерпольный (в среднем ~11 голов), разница рейтингов сдвигает ожидание; ничья в плей-офф — пенальти
  function simScore(home, away, from) {
    const ra = T(home).rating, rb = T(away).rating;
    const pois = (l) => { let k = 0, p = Math.exp(-l), s = p, u = Math.random(); while (u > s && k < 40) { k++; p *= l / k; s += p; } return k; };
    const left = from ? from.left : 1;
    const la = 10.5 * Math.pow(10, (ra - rb) / 120) * left, lb = 10.5 * Math.pow(10, (rb - ra) / 120) * left;
    return [(from ? from.h : 0) + pois(la), (from ? from.a : 0) + pois(lb)];
  }
  function decide(f) {
    if (f.stage !== 'G' && f.hs === f.as) { const pa = 0.5 + (T(f.home).rating - T(f.away).rating) / 100; f.pen = Math.random() < pa ? 'h' : 'a'; }
  }
  const winner = (f) => (f.hs > f.as || f.pen === 'h' ? f.home : f.away);
  function table(g) {
    const rows = {};
    for (const c of C.groups[g]) rows[c] = { c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    for (const f of C.fx) if (f.stage === 'G' && f.group === g && f.played) {
      const h = rows[f.home], a = rows[f.away];
      h.p++; a.p++; h.gf += f.hs; h.ga += f.as; a.gf += f.as; a.ga += f.hs;
      if (f.hs > f.as) { h.w++; a.l++; h.pts += 3; } else if (f.hs < f.as) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
    }
    // Очки, затем личная встреча не считаем — разница мячей, забитые, рейтинг
    return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || T(y.c).rating - T(x.c).rating);
  }
  const current = () => C.fx.filter(f => !f.played && (C.stage === 'G' ? f.stage === 'G' && f.round === C.round : f.stage === C.stage));
  const myMatch = () => current().find(f => f.home === C.team || f.away === C.team);
  // Доиграть тур: остальные матчи — по силе; дальше следующий тур или стадия
  function advance() {
    for (const f of current()) if (!(f.home === C.team || f.away === C.team)) { [f.hs, f.as] = simScore(f.home, f.away); decide(f); f.played = true; }
    if (current().length) return save();
    if (C.stage === 'G') {
      if (C.round < 2) C.round++;
      else {
        const a = table('A'), b = table('B');
        C.fx.push({ id: 'SF1', stage: 'SF', home: a[0].c, away: b[1].c, played: false }, { id: 'SF2', stage: 'SF', home: b[0].c, away: a[1].c, played: false });
        C.stage = 'SF';
      }
    } else if (C.stage === 'SF') {
      const sf = C.fx.filter(f => f.stage === 'SF');
      C.fx.push({ id: 'F', stage: 'F', home: winner(sf[0]), away: winner(sf[1]), played: false });
      C.stage = 'F';
    } else if (C.stage === 'F') { C.champion = winner(C.fx.find(f => f.stage === 'F')); C.stage = 'done'; }
    save();
    // Тебя нет в текущем туре (вылетел) — всё досчитывается сразу
    if (C.stage !== 'done' && !myMatch() && current().length) advance();
  }

  // ---------- матч ----------
  function play(auto) {
    const f = myMatch(); if (!f) return;
    if (auto) { [f.hs, f.as] = simScore(f.home, f.away); decide(f); f.played = true; advance(); render(); return; }
    close();
    const home = C.team === f.home;
    if (hooks.play) hooks.play({ home: T(f.home), away: T(f.away), mode: '1p', humanSide: home ? 0 : 1, periodMin: C.len, difficulty: C.diff, shootout: f.stage !== 'G', cup: f.id });
  }
  // Матч окончен (или брошен — тогда оставшееся время досчитывается по силе от текущего счёта)
  function finishMatch(m, opts) {
    load();
    if (!C || !m || !m.cfg.cup) return;
    const f = C.fx.find(x => x.id === m.cfg.cup); if (!f || f.played) return;
    const hs = m.teams[0].score, as = m.teams[1].score;
    if (m.state === 'final') {
      f.hs = hs; f.as = as;
      if (f.stage !== 'G' && hs === as) { const so = m.so && m.soScore ? String(m.soScore()).split(':').map(Number) : null; f.pen = so && so[0] !== so[1] ? (so[0] > so[1] ? 'h' : 'a') : null; if (!f.pen) decide(f); }
    } else {
      const total = 4 * (m.cfg.periodMin || 8) * 60, gone = (m.period - 1) * (m.cfg.periodMin || 8) * 60 + ((m.cfg.periodMin || 8) * 60 - (m.clock || 0));
      [f.hs, f.as] = simScore(f.home, f.away, { h: hs, a: as, left: Math.max(0, Math.min(1, 1 - gone / total)) });
      decide(f);
    }
    f.played = true;
    advance();
  }

  // ---------- интерфейс ----------
  function ensureDom() {
    if ($('cup')) return;
    const d = document.createElement('div');
    d.id = 'cup'; d.className = 'overlay scrim'; d.hidden = true;
    d.innerHTML = '<div class="card on-card"><div class="tac-head"><h2>Турнир</h2><button class="btn" id="cupClose">Закрыть</button></div><div id="cupBody"></div></div>';
    document.body.appendChild(d);
    $('cupClose').addEventListener('click', close);
    $('cupBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cup]'); if (!b) return;
      const a = b.dataset.cup, n = WP.TEAMS.length;
      if (a === 'prev' || a === 'next') { const i = WP.TEAMS.findIndex(t => t.code === pick.team); pick.team = WP.TEAMS[(i + (a === 'next' ? 1 : -1) + n) % n].code; }
      if (a === 'len') pick.len = +b.dataset.v;
      if (a === 'diff') pick.diff = +b.dataset.v;
      if (a === 'start') { create(pick.team, pick.len, pick.diff); confirmNew = false; }
      if (a === 'play') return play(false);
      if (a === 'auto') return play(true);
      if (a === 'new') { if (confirmNew || !C || C.stage === 'done') { C = null; save(); confirmNew = false; } else confirmNew = true; }
      render();
    });
  }
  const flag = (c) => (WP.flag ? WP.flag(c) : '');
  const nm = (c) => '<span class="cup-t' + (c === (C && C.team) ? ' me' : '') + '">' + flag(c) + esc(T(c).name) + '</span>';
  const res = (f) => f.played ? '<b>' + f.hs + ':' + f.as + '</b>' + (f.pen ? '<small> пен.</small>' : '') : '<small class="muted">—</small>';
  const STAGE = { G: 'Групповой этап', SF: 'Полуфиналы', F: 'Финал', done: 'Турнир окончен' };
  function render() {
    ensureDom();
    let h = '';
    if (!C) {
      const t = T(pick.team || 'KAZ');
      pick.team = t.code;
      h += '<div class="tac-sec"><div class="tac-lbl">Твоя сборная</div><div class="on-code cup-pick"><button class="btn" data-cup="prev">‹</button><span>' + flag(t.code) + '<b>' + esc(t.name) + '</b> <small class="muted">рейтинг ' + t.rating + '</small></span><button class="btn" data-cup="next">›</button></div></div>';
      h += '<div class="tac-sec"><div class="tac-lbl">Период</div><div class="seg">' + [4, 6, 8].map(v => '<button data-cup="len" data-v="' + v + '" aria-pressed="' + (pick.len === v) + '">' + v + ' мин</button>').join('') + '</div></div>';
      h += '<div class="tac-sec"><div class="tac-lbl">Сложность</div><div class="seg">' + ['Любитель', 'Профи', 'Мировой класс'].map((v, i) => '<button data-cup="diff" data-v="' + i + '" aria-pressed="' + (pick.diff === i) + '">' + v + '</button>').join('') + '</div></div>';
      h += '<p class="small muted">8 сборных: две группы по 4 (каждый с каждым), двое лучших выходят в полуфиналы крест-накрест, затем финал. В плей-офф при ничьей — пенальти.</p>';
      h += '<div class="cta-row"><button class="cta" data-cup="start">Начать турнир</button></div>';
    } else {
      h += '<div class="tac-sec"><div class="tac-lbl">' + STAGE[C.stage] + (C.stage === 'G' ? ' · тур ' + (C.round + 1) + ' из 3' : '') + '</div>';
      if (C.stage === 'done') h += '<p class="cup-champ">' + flag(C.champion) + '<b>' + esc(T(C.champion).name) + '</b> — чемпион!' + (C.champion === C.team ? ' 🏆' : '') + '</p>';
      const mm = myMatch();
      if (mm) h += '<div class="on-game cup-next"><span>' + nm(mm.home) + ' <small>—</small> ' + nm(mm.away) + '</span><button class="btn primary" data-cup="play">Играть</button><button class="btn" data-cup="auto" title="Досчитать по силе">Авто</button></div>';
      else if (C.stage !== 'done') h += '<p class="small muted">Твоя сборная выбыла — турнир досчитан.</p>';
      h += '</div>';
      for (const g of ['A', 'B']) {
        h += '<div class="tac-sec"><div class="tac-lbl">Группа ' + g + '</div><table class="cup-tab"><tr><th></th><th>И</th><th>В</th><th>Н</th><th>П</th><th>М</th><th>О</th></tr>' +
          table(g).map((r, i) => '<tr class="' + (i < 2 ? 'q' : '') + '"><td>' + nm(r.c) + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + r.gf + '–' + r.ga + '</td><td><b>' + r.pts + '</b></td></tr>').join('') + '</table>';
        h += C.fx.filter(f => f.stage === 'G' && f.group === g && f.played).map(f => '<div class="cup-res">' + nm(f.home) + ' ' + res(f) + ' ' + nm(f.away) + '</div>').join('') + '</div>';
      }
      const ko = C.fx.filter(f => f.stage !== 'G');
      if (ko.length) h += '<div class="tac-sec"><div class="tac-lbl">Плей-офф</div>' + ko.map(f => '<div class="cup-res"><small class="muted">' + (f.stage === 'F' ? 'Финал' : 'Полуфинал') + '</small> ' + nm(f.home) + ' ' + res(f) + ' ' + nm(f.away) + '</div>').join('') + '</div>';
      h += '<div class="cta-row"><button class="btn" data-cup="new">' + (confirmNew ? 'Точно? Нажми ещё раз' : 'Новый турнир') + '</button></div>';
    }
    $('cupBody').innerHTML = h;
  }
  function open() { load(); ensureDom(); confirmNew = false; render(); $('cup').hidden = false; }
  function close() { if ($('cup')) $('cup').hidden = true; if (hooks.menu && !(hooks.playing && hooks.playing())) hooks.menu(); }
  function bindUi() {
    const b = $('btnCup');
    if (b) b.addEventListener('click', () => { WP.Audio.init(); if (hooks.open) hooks.open(); else open(); });
  }
  return { open, close, bindUi, finishMatch, setHooks(h) { hooks = h; }, get active() { load(); return !!C && C.stage !== 'done'; } };
})();
