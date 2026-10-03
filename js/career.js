// Карьера (по мотивам Manager Career и Player Career в EA SPORTS FC).
// Тренер: Суперлига, цели правления, трансферы, развитие, тренировки, скауты, академия, рынок тренеров.
// Игрок: свой пловец с 17 лет, статус в команде, задачи тренера на матч, опыт → очки навыков → параметры,
// доверие тренера, интерес других клубов и переходы.
WP.Career = (function () {
  const KEY = 'polo25_career_v1';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (k) => Math.abs(k) >= 1000 ? (k / 1000).toFixed(2).replace('.', ',') + ' млн €' : Math.round(k) + ' тыс. €';
  const ROLE_SHORT = { GK: 'ВРТ', CF: 'ЦН', CB: 'ЦЗ', W: 'КР', D: 'УН' };
  const ATTR = WP.ATTR;
  const STATUS = { start: 'Основной состав', rot: 'Ротация', res: 'Запасной', inj: 'Травма' };
  const PC_ATTRS = ['spd', 'sht', 'acc', 'pas', 'def', 'str', 'sta'];
  const ATTR_HINT = { spd: 'плывёшь быстрее, выигрываешь спринт и контратаки', sht: 'бросок и резкий пас летят быстрее', acc: 'броски и передачи точнее', pas: 'точнее пас и уверенный приём сильных передач', def: 'чаще отбираешь и перехватываешь', str: 'выигрываешь борьбу, держишь мяч под давлением', sta: 'медленнее устаёшь, дольше без замены' };
  const STAGE_NAMES = { QF: '1/4 финала', SF: 'Полуфинал', F: 'Финал', W: 'Чемпион' };
  const MAX_SQUAD = 14;

  // Пулы имён для сгенерированных игроков (воспитанники, свободные агенты)
  const SUR = {
    SRB: ['Петрович', 'Николич', 'Маркович', 'Стоянович', 'Павлович', 'Лазаревич', 'Тодорович', 'Илич', 'Попович', 'Васич', 'Ракич', 'Ценич'],
    CRO: ['Хорват', 'Ковачевич', 'Бабич', 'Марич', 'Юрич', 'Кнежевич', 'Вукович', 'Перич', 'Томич', 'Шарич', 'Балич'],
    MNE: ['Вукчевич', 'Радонич', 'Бошкович', 'Шчепанович', 'Кривокапич', 'Раичевич', 'Дамьянович'],
    HUN: ['Ковач', 'Надь', 'Тот', 'Сабо', 'Варга', 'Киш', 'Немет', 'Фаркаш', 'Балог', 'Папп', 'Такач', 'Юхас'],
    ESP: ['Гарсия', 'Мартинес', 'Лопес', 'Санчес', 'Перес', 'Гомес', 'Руис', 'Диас', 'Морено', 'Альварес', 'Наварро', 'Торрес'],
    ITA: ['Росси', 'Руссо', 'Феррари', 'Эспозито', 'Бьянки', 'Романо', 'Коломбо', 'Риччи', 'Марино', 'Греко', 'Галло', 'Конти'],
    GRE: ['Пападопулос', 'Василиу', 'Николау', 'Георгиу', 'Пападакис', 'Димитриу', 'Макрис', 'Антонопулос', 'Стефану'],
    USA: ['Смит', 'Джонсон', 'Уильямс', 'Браун', 'Миллер', 'Дэвис', 'Уилсон', 'Андерсон', 'Тейлор', 'Кларк'],
    AUS: ['Томпсон', 'Уайт', 'Мартин', 'Кинг', 'Робертс', 'Холл', 'Янг', 'Райт', 'Грин'],
    FRA: ['Мартен', 'Бернар', 'Тома', 'Робер', 'Ришар', 'Пети', 'Дюран', 'Леруа', 'Моро', 'Лоран'],
    JPN: ['Сато', 'Такахаси', 'Танака', 'Ито', 'Ямамото', 'Накамура', 'Кобаяси', 'Като', 'Ёсида', 'Ямада'],
    ROU: ['Попеску', 'Ионеску', 'Попа', 'Станку', 'Думитру', 'Константин', 'Маринеску', 'Раду', 'Опреа'],
    KAZ: ['Ахметов', 'Жумабаев', 'Серикбаев', 'Нурланов', 'Касымов', 'Оспанов', 'Тулегенов', 'Абдрахманов', 'Сагинтаев', 'Есенов', 'Ким', 'Кузнецов'],
  };
  const FIRST = {
    SRB: ['Никола', 'Марко', 'Стефан', 'Лука', 'Душан', 'Милош', 'Филип', 'Огнен'], CRO: ['Иван', 'Анте', 'Лука', 'Марин', 'Йосип', 'Дино'],
    MNE: ['Вук', 'Андрия', 'Марко', 'Данило'], HUN: ['Бенце', 'Адам', 'Мате', 'Балаж', 'Даниэль', 'Золтан'],
    ESP: ['Алехандро', 'Пабло', 'Хавьер', 'Серхио', 'Марк', 'Альваро'], ITA: ['Лоренцо', 'Маттео', 'Франческо', 'Андреа', 'Джулио'],
    GRE: ['Георгиос', 'Николаос', 'Костас', 'Димитрис', 'Янис'], USA: ['Джейк', 'Райан', 'Коннор', 'Тайлер', 'Бен'],
    AUS: ['Джош', 'Лиам', 'Блейк', 'Натан', 'Том'], FRA: ['Юго', 'Тео', 'Лука', 'Матье', 'Энзо'],
    JPN: ['Кэнта', 'Юто', 'Хару', 'Со', 'Рэн'], ROU: ['Андрей', 'Влад', 'Штефан', 'Мирча'],
    KAZ: ['Арман', 'Данияр', 'Ерлан', 'Нурсултан', 'Алихан', 'Тимур', 'Ильяс', 'Максим'],
  };
  const NATS = Object.keys(SUR);
  const natOf = (code) => (code === 'AST' || code === 'AS1' || code === 'AS2' ? 'KAZ' : SUR[code] ? code : pick(NATS));

  let C = null, tab = 'home', hooks = {}, root = null, body = null, modalEl = null, setup = null;

  // ---------- игроки ----------
  const ovr = (p) => WP.ovr(p.role, p.attrs);
  const isPC = () => !!(C && C.mode === 'player');
  function value(p) {
    const o = ovr(p);
    const af = p.age <= 21 ? 1.3 + Math.max(0, p.pot - o) / 40 : p.age <= 27 ? 1.15 : p.age <= 30 ? 1 : p.age <= 33 ? 0.7 : 0.4;
    return Math.max(5, Math.round(Math.pow(Math.max(1, o - 55), 2.4) * 0.35 * af / 5) * 5);
  }
  const blank = () => ({ apps: 0, goals: 0, assists: 0, saves: 0, excl: 0, rating: 0 });

  function fromReal(team, t) {
    const [num, name, role, star, full, height] = t;
    const attrs = WP.makeAttrs(team, t, 0);
    const h = WP.hash(team.code + name + 'age');
    const age = team.club ? 19 + Math.floor(h * 11) : star ? 26 + Math.floor(h * 6) : 21 + Math.floor(h * 13);
    const p = { id: team.code + '-' + num + '-' + name, name, full: full || name, role, num, age, height: height || null, attrs, team: team.code, nat: natOf(team.code), star: !!star, morale: 70, form: 0, injury: 0, st: blank(), career: blank(), promised: 0 };
    const o = ovr(p);
    p.pot = clamp(Math.round(o + Math.max(0, 27 - age) * rnd(0.9, 2.2) + rnd(0, 3)), o, 97);
    return p;
  }

  function genPlayer(nat, role, ageMin, ageMax, oMin, oMax, potMax) {
    const t = rnd(oMin, oMax);
    const a = { spd: t, sht: t, acc: t, pas: t, def: t, str: t, sta: t, gk: t - 25 };
    if (role === 'CF') { a.str += 8; a.spd -= 5; }
    if (role === 'CB') { a.def += 7; a.str += 6; a.sht -= 3; }
    if (role === 'W') { a.spd += 6; a.sht += 2; a.str -= 5; }
    if (role === 'D') { a.pas += 3; }
    if (role === 'GK') { for (const k in a) a[k] -= 12; a.gk = t + 8; }
    for (const k in a) a[k] = clamp(Math.round(a[k] + rnd(-4, 4)), 35, 99);
    const sur = pick(SUR[nat] || SUR.KAZ), first = pick(FIRST[nat] || FIRST.KAZ);
    const p = { id: 'G' + (C.seq++), name: sur, full: first + ' ' + sur, role, num: 0, age: irnd(ageMin, ageMax), height: null, attrs: a, team: null, nat, star: false, morale: 75, form: 0, injury: 0, st: blank(), career: blank(), promised: 0 };
    const o = ovr(p);
    p.pot = clamp(Math.round(o + rnd(3, Math.max(4, potMax - o))), o + 1, 97);
    C.players[p.id] = p;
    return p;
  }
  const genYouth = (nat, role, q) => genPlayer(nat, role || pick(['D', 'W', 'CB', 'CF', 'D', 'W', 'GK']), 15, 17, 44 + q * 2, 56 + q * 3, 74 + q * 6);

  // ---------- команды ----------
  const T = (code) => C.teams[code];
  const squad = (code) => T(code).squad.map(id => C.players[id]).filter(Boolean);
  function lineup(code) {
    const sq = squad(code).filter(p => !p.injury);
    const t = T(code);
    let gk = null, field = [];
    if (t.starters && code === C.team) {
      const st = t.starters.map(id => C.players[id]).filter(p => p && !p.injury && p.team === code);
      gk = st.find(p => p.role === 'GK') || null;
      field = st.filter(p => p.role !== 'GK').slice(0, 6);
    }
    if (!gk) gk = sq.filter(p => p.role === 'GK').sort((a, b) => ovr(b) - ovr(a))[0] || null;
    // Карьера игрока: тренер смотрит и на форму, а твоё место зависит ещё и от его доверия
    const pcT = isPC() && code === C.team;
    // Заявленная основа клуба (например, у «Астаны») получает доверие тренера: +6 к рейтингу при выборе состава
    const core = (p) => (t.core && t.core.includes(p.id) ? 6 : 0);
    const key = (p) => ovr(p) + core(p) + (pcT ? p.form * 1.2 + (p.id === C.me ? (C.pc.trust - 50) / 6 + (p.age <= 19 ? 4 : 0) : 0) : 0);
    const rest = sq.filter(p => p.role !== 'GK' && !field.includes(p)).sort((a, b) => key(b) - key(a));
    if (!field.some(p => p.role === 'CF')) { const cf = rest.find(p => p.role === 'CF'); if (cf && field.length < 6) { field.push(cf); rest.splice(rest.indexOf(cf), 1); } }
    while (field.length < 6 && rest.length) field.push(rest.shift());
    return { gk, field, bench: sq.filter(p => p !== gk && !field.includes(p)).sort((a, b) => key(b) - key(a)) };
  }
  function teamOvr(code) {
    const L = lineup(code);
    const vals = L.field.map(ovr); while (vals.length < 6) vals.push(50);
    return Math.round((vals.reduce((a, b) => a + b, 0) + (L.gk ? ovr(L.gk) : 50)) / 7);
  }
  function freeNum(code, role) {
    const used = new Set(squad(code).map(p => p.num));
    const pref = role === 'GK' ? [1, 13, 14] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 13];
    return pref.find(n => !used.has(n)) || 15 + squad(code).length;
  }
  function joinTeam(p, code) {
    if (p.team) { const old = T(p.team); if (old) { old.squad = old.squad.filter(id => id !== p.id); if (old.starters) old.starters = old.starters.filter(id => id !== p.id); } }
    C.freeAgents = C.freeAgents.filter(id => id !== p.id);
    C.academy = C.academy.filter(id => id !== p.id);
    C.listed = C.listed.filter(id => id !== p.id);
    p.team = code;
    if (code) { p.num = freeNum(code, p.role); T(code).squad.push(p.id); }
  }

  // ---------- создание карьеры и сезона ----------
  function create(code, manager, settings, pl) {
    C = { v: 1, seq: 1, season: 1, year: 2026, manager: manager || 'Тренер', team: code, settings, teams: {}, players: {}, fixtures: [], round: 0, phase: 'league', playoff: null, stageReached: null,
      inbox: [], scouts: [], shortlist: [], academy: [], training: { focus: 'balanced', intensity: 1 }, listed: [], history: [], confidence: 60, objectives: [], budget: 0, freeAgents: [], fired: false, lastMatch: null, devLog: [], window: true, offersFor: [] };
    for (const def of WP.TEAMS) {
      const t = { code: def.code, name: def.name, color: def.color, style: def.style, note: def.note, club: !!def.club, squad: [], starters: null, budget: 0, core: [] };
      C.teams[def.code] = t;
      for (const tu of def.players) { const p = fromReal(def, tu); C.players[p.id] = p; t.squad.push(p.id); if (def.starters && def.starters.includes(tu[0])) t.core.push(p.id); }
    }
    for (const c in C.teams) C.teams[c].budget = baseBudget(c);
    C.budget = baseBudget(code) + 300;
    if (pl) { createMe(code, pl); refillFreeAgents(); makeSeason(); welcomePC(); save(); return; }
    for (let i = 0; i < 3; i++) { const y = genYouth(natOf(code), null, 1); C.academy.push(y.id); }
    refillFreeAgents();
    makeSeason();
    const obj = C.objectives.map(o => '• ' + o.text).join('<br>');
    mail('Правление', 'Добро пожаловать, ' + esc(C.manager), 'Вы возглавили команду «' + esc(T(code).name) + '». Бюджет на трансферы — ' + money(C.budget) + '.<br><br>Цели на сезон:<br>' + obj + '<br><br>Трансферное окно открыто до первого тура.');
    save();
  }
  // ---------- карьера игрока ----------
  function createMe(code, o) {
    C.mode = 'player'; C.me = 'ME';
    const role = o.role, h = o.height, t0 = rnd(64, 67);
    const a = { spd: t0, sht: t0, acc: t0, pas: t0, def: t0, str: t0, sta: t0, gk: 30 };
    if (role === 'CF') { a.str += 7; a.spd -= 4; a.sht += 1; a.sta -= 2; }
    if (role === 'CB') { a.def += 6; a.str += 5; a.sht -= 3; }
    if (role === 'W') { a.spd += 5; a.sht += 2; a.str -= 4; a.sta += 3; }
    if (role === 'D') { a.pas += 3; a.acc += 1; }
    // Рост: высокий — сильнее в борьбе и мощнее бросок, но медленнее
    a.str += (h - 190) * 0.5; a.sht += (h - 190) * 0.15; a.spd -= Math.max(0, h - 193) * 0.35; a.spd += Math.max(0, 186 - h) * 0.3;
    for (const k in a) a[k] = clamp(Math.round(a[k] + rnd(-2, 2)), 35, 99);
    const full = (o.name || 'Игрок').trim(), parts = full.split(/\s+/);
    const me = { id: 'ME', name: parts[parts.length - 1], full, role, num: 0, age: 17, height: h, attrs: a, team: null, nat: natOf(code), star: false, morale: 80, form: 0, injury: 0, st: blank(), career: blank(), promised: 0, pot: irnd(86, 93) };
    C.players.ME = me;
    makeRoom(code);
    joinTeam(me, code);
    wantNum(me, o.num);
    C.pc = { xp: 0, sp: 3, trust: 50, totalXp: 0, requested: false, obj: null, last: null, seasons: [], clubs: [code], wantNum: o.num };
  }
  function makeRoom(code) {
    if (T(code).squad.length < MAX_SQUAD) return;
    const cut = squad(code).filter(p => p.role !== 'GK' && p.id !== C.me).sort((a, b) => ovr(a) - ovr(b))[0];
    if (cut) { joinTeam(cut, null); C.freeAgents.push(cut.id); }
  }
  function wantNum(me, n) {
    if (!n) return;
    if (!squad(me.team).some(p => p !== me && p.num === n)) me.num = n;
  }
  function welcomePC() {
    const me = C.players[C.me], st = myStatus();
    mail('Тренер', 'Добро пожаловать в «' + esc(T(C.team).name) + '»', 'Тебе 17, у тебя №' + me.num + ' и большое будущее — скауты оценивают потенциал в ' + potRange(me) + '.<br><br>Сейчас твой статус — <b>' + STATUS[st] + '</b>. ' + (st === 'start' ? 'Держи уровень, и место в старте останется за тобой.' : 'Выполняй мои задачи на матч и хорошо играй — доверие растёт, а вместе с ним и игровое время.') +
      '<br><br>За матчи ты получаешь опыт. Каждые 100 опыта — очко навыка: трать их во вкладке «Мой игрок».');
  }
  function myStatus() {
    const me = C.players[C.me];
    if (!me || me.team !== C.team) return 'res';
    if (me.injury) return 'inj';
    const L = lineup(C.team);
    if (L.field.includes(me) || L.gk === me) return 'start';
    const i = L.bench.filter(p => p.role !== 'GK').indexOf(me);
    return i >= 0 && i < 4 ? 'rot' : 'res';
  }
  const upCost = (v) => v < 70 ? 1 : v < 80 ? 2 : v < 88 ? 3 : v < 94 ? 4 : 5;
  function addXp(n) {
    const pc = C.pc; let got = 0;
    pc.xp += n; pc.totalXp += n;
    while (pc.xp >= 100) { pc.xp -= 100; pc.sp++; got++; }
    return got;
  }
  function makeObjective(f) {
    const me = C.players[C.me], st = myStatus();
    let pool;
    if (st === 'start') pool = me.role === 'CF' ? [['goals', 2, 'Забить 2 гола'], ['rating', 7.0, 'Оценка за матч 7.0+']] :
      me.role === 'CB' ? [['steals', 1, 'Сделать отбор или перехват'], ['rating', 6.7, 'Оценка за матч 6.7+']] :
      [['goals', 1, 'Забить гол'], ['assists', 1, 'Отдать голевую передачу'], ['rating', 6.8, 'Оценка за матч 6.8+']];
    else if (st === 'rot') pool = [['goals', 1, 'Выйти со скамейки и забить'], ['rating', 6.4, 'Оценка за матч 6.4+']];
    else pool = [['rating', 6.0, 'Использовать шанс: оценка 6.0+'], ['assists', 1, 'Выйти и отдать голевую']];
    const [kind, need, text] = pick(pool);
    return { fid: f.id, kind, need, text };
  }
  function ensureObjective(f) { if (isPC() && f && (!C.pc.obj || C.pc.obj.fid !== f.id)) { C.pc.obj = makeObjective(f); save(); } }
  // После матча своей команды: опыт, задача тренера, доверие
  function afterMyMatch(f, res) {
    const me = C.players[C.me], pc = C.pc, s = res.stats[C.me];
    const played = !!(s && s.played);
    const draw = f.hs === f.as && !f.pens, won = !draw && winner(f) === C.team;
    let xp = 10;
    if (played) xp = 30 + s.goals * 25 + (s.assists || 0) * 15 + (s.steals || 0) * 10 + Math.max(0, (me.lastRating - 6) * 40) + (won ? 20 : 0);
    const o = pc.obj && pc.obj.fid === f.id ? pc.obj : null;
    let met = null;
    if (o && played) { const v = o.kind === 'rating' ? me.lastRating : (s[o.kind] || 0); met = v >= o.need; }
    if (met) { xp += 50; pc.trust += 4; } else if (met === false) pc.trust -= 3;
    pc.trust += played ? (me.lastRating - 6.6) * 1.6 : -0.5;
    // Доверие не копится бесконечно: без свежих поводов тренер возвращается к ровному отношению
    pc.trust += (55 - pc.trust) * 0.06;
    pc.trust = clamp(Math.round(pc.trust), 0, 100);
    xp = Math.round(xp);
    const sp = addXp(xp);
    pc.last = { fid: f.id, played, xp, sp, rating: played ? +me.lastRating.toFixed(1) : null, goals: played ? s.goals : 0, assists: played ? (s.assists || 0) : 0, steals: played ? (s.steals || 0) : 0, obj: o ? { text: o.text, met } : null, won, draw };
    pc.obj = null;
  }
  // Клубы, где ты претендуешь на место в семёрке
  function pcOffers(n, requested) {
    const o = ovr(C.players[C.me]), cur = teamOvr(C.team);
    return Object.keys(C.teams).filter(c => c !== C.team).map(c => {
      const f = squad(c).filter(p => p.role !== 'GK').map(ovr).sort((a, b) => b - a);
      return { c, fit: o - (f[5] || 50), str: teamOvr(c) };
    }).filter(x => x.fit >= -2 && (requested || x.str >= cur - 3 || Math.random() < 0.25))
      .sort((a, b) => (b.str + b.fit * 0.5 + rnd(-3, 3)) - (a.str + a.fit * 0.5 + rnd(-3, 3))).slice(0, n).map(x => x.c);
  }
  function offerPCMail(list, why) {
    const me = C.players[C.me];
    mail('Агент', why, 'Тобой интересуются: ' + list.map(c => '«' + esc(T(c).name) + '» (сила ' + teamOvr(c) + ')').join(', ') + '. Клубы готовы заплатить около ' + money(value(me)) + '. Переход возможен, пока открыто трансферное окно.',
      list.map(c => ({ label: 'Перейти в «' + T(c).name + '»', act: 'pmove', buyer: c })).concat([{ label: 'Остаться', act: 'none' }]));
  }
  function movePC(code) {
    const me = C.players[C.me], from = C.team, fee = value(me);
    makeRoom(code);
    T(code).budget -= fee; T(from).budget += fee;
    joinTeam(me, code); wantNum(me, C.pc.wantNum);
    C.team = code;
    C.pc.trust = 50; C.pc.requested = false; C.pc.obj = null;
    C.pc.clubs.push(code);
    setObjectives();
    mail('Агент', 'Переход в «' + esc(T(code).name) + '»', 'Контракт подписан, сумма трансфера — ' + money(fee) + '. Твой номер — ' + me.num + '. Статус в новой команде: <b>' + STATUS[myStatus()] + '</b>.');
  }
  function playerEvent() {
    const me = C.players[C.me], list = [];
    list.push(() => mail('Пресс-служба', 'Интервью после тренировки', 'Журналист спрашивает о твоей роли в команде. Что ответишь?', [{ label: '«Работаю на команду»', act: 'intHumble' }, { label: '«Я готов играть в старте»', act: 'intBold' }]));
    list.push(() => mail('Тренер', 'Индивидуальная тренировка', 'Тренер предлагает задержаться после занятия и поработать один на один над броском и выходами.', [{ label: 'Остаться (+40 опыта)', act: 'extra' }, { label: 'Отдохнуть', act: 'none' }]));
    if (ovr(me) >= 76) list.push(() => { addXp(60); mail('Федерация', 'Вызов в сборную', 'Тебя вызвали на сбор национальной команды. Опыт +60.'); });
    list.push(() => { const d = irnd(-4, 6); C.pc.trust = clamp(C.pc.trust + d, 0, 100); mail('Тренер', d >= 0 ? 'Тренер доволен тренировками' : 'Замечание тренера', d >= 0 ? 'Хорошая неделя на тренировках. Доверие тренера +' + d + '.' : 'Тренер недоволен отношением к тренировкам. Доверие ' + d + '.'); });
    pick(list)();
  }

  const baseBudget = (code) => Math.round(Math.pow(Math.max(5, teamOvr(code) - 60), 2) * 3 / 10) * 10;
  function refillFreeAgents() {
    while (C.freeAgents.length < 16) {
      const p = genPlayer(pick(NATS), pick(['D', 'W', 'CB', 'CF', 'D', 'W', 'GK']), 24, 34, 60, 77, 80);
      p.team = null; C.freeAgents.push(p.id);
    }
  }
  function roundRobin(codes) {
    const arr = codes.slice().sort(() => Math.random() - 0.5);
    if (arr.length % 2) arr.push(null);
    const n = arr.length, out = [];
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        if (a && b) out.push({ id: 'L' + C.season + '-' + r + '-' + i, round: r, home: (r + i) % 2 ? a : b, away: (r + i) % 2 ? b : a, played: false, stage: 'league' });
      }
      arr.splice(1, 0, arr.pop());
    }
    return out;
  }
  const leagueRounds = () => Object.keys(C.teams).length - 1 + (Object.keys(C.teams).length % 2);
  function makeSeason() {
    C.fixtures = roundRobin(Object.keys(C.teams));
    C.round = 0; C.phase = 'league'; C.playoff = null; C.stageReached = null; C.window = true;
    for (const id in C.players) C.players[id].st = blank();
    setObjectives();
  }
  function setObjectives() {
    const order = Object.keys(C.teams).sort((a, b) => teamOvr(b) - teamOvr(a));
    const r = order.indexOf(C.team) + 1;
    let o;
    if (r <= 3) o = [{ kind: 'playoff', need: 'W', text: 'Выиграть плей-офф Суперлиги' }, { kind: 'league', need: 3, text: 'Регулярный чемпионат — не ниже 3-го места' }];
    else if (r <= 6) o = [{ kind: 'playoff', need: 'SF', text: 'Выйти в полуфинал плей-офф' }, { kind: 'league', need: 6, text: 'Регулярный чемпионат — не ниже 6-го места' }];
    else if (r <= 10) o = [{ kind: 'league', need: 8, text: 'Попасть в плей-офф (топ-8)' }];
    else o = [{ kind: 'league', need: 12, text: 'Не опуститься ниже 12-го места' }];
    o.push({ kind: 'youth', need: 5, text: 'Дать игроку до 21 года 5+ матчей' });
    C.objectives = o; C.expectRank = r;
  }

  // ---------- таблица и плей-офф ----------
  function table() {
    const rows = {};
    for (const c in C.teams) rows[c] = { code: c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    for (const f of C.fixtures) {
      if (!f.played) continue;
      const h = rows[f.home], a = rows[f.away];
      h.p++; a.p++; h.gf += f.hs; h.ga += f.as; a.gf += f.as; a.ga += f.hs;
      if (f.hs > f.as) { h.w++; a.l++; h.pts += 3; } else if (f.hs < f.as) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
    }
    return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || teamOvr(y.code) - teamOvr(x.code));
  }
  const posOf = (code) => table().findIndex(r => r.code === code) + 1;
  function winner(f) { if (f.hs !== f.as) return f.hs > f.as ? f.home : f.away; return f.pens && f.pens[0] > f.pens[1] ? f.home : f.away; }
  function setupPlayoff() {
    const t = table().map(r => r.code).slice(0, 8);
    const pairs = [[t[0], t[7]], [t[3], t[4]], [t[1], t[6]], [t[2], t[5]]];
    C.playoff = { stage: 'QF', ties: { QF: pairs.map((p, i) => ({ id: 'QF' + C.season + i, home: p[0], away: p[1], played: false, stage: 'QF' })), SF: [], F: [] } };
    C.phase = 'playoff';
    if (t.includes(C.team)) C.stageReached = 'QF';
    mail('Суперлига', 'Сетка плей-офф', 'Регулярный чемпионат завершён. ' + (t.includes(C.team) ? '«' + esc(T(C.team).name) + '» в плей-офф! Соперник в 1/4 финала — ' + esc(T(pairs.flat()[pairs.flat().indexOf(C.team) ^ 1]).name) + '.' : 'Ваша команда не попала в восьмёрку.'));
  }
  function currentFixtures() {
    if (C.phase === 'league') return C.fixtures.filter(f => f.round === C.round);
    if (C.phase === 'playoff') return C.playoff.ties[C.playoff.stage];
    return [];
  }
  function userFixture() { return currentFixtures().find(f => !f.played && (f.home === C.team || f.away === C.team)) || null; }
  const allFixtures = () => C.fixtures.concat(C.playoff ? [...C.playoff.ties.QF, ...C.playoff.ties.SF, ...C.playoff.ties.F] : []);
  const findFixture = (id) => allFixtures().find(f => f.id === id);

  // ---------- симуляция ----------
  function poisson(l) { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
  function strength(code) {
    const L = lineup(code);
    const f = L.field.length ? L.field : [];
    const avg = (fn) => f.reduce((s, p) => s + fn(p), 0) / Math.max(1, f.length);
    const form = avg(p => p.form);
    return {
      att: avg(p => p.attrs.sht * 0.35 + p.attrs.acc * 0.25 + p.attrs.pas * 0.2 + p.attrs.spd * 0.2) + form * 0.8,
      def: avg(p => p.attrs.def * 0.5 + p.attrs.str * 0.3 + p.attrs.spd * 0.2) * 0.6 + (L.gk ? L.gk.attrs.gk : 55) * 0.4 + form * 0.5,
      L,
    };
  }
  function quickSim(f, fraction, base) {
    fraction = fraction === undefined ? 1 : fraction;
    const H = strength(f.home), A = strength(f.away);
    // Около 10 голов на команду за матч; разница в силе сдвигает счёт, но без разгромов 20:7
    const lh = 10 * Math.exp(clamp(H.att - A.def, -18, 18) * 0.026) * 1.04 * fraction, la = 10 * Math.exp(clamp(A.att - H.def, -18, 18) * 0.026) * fraction;
    const res = base || { hs: 0, as: 0, pens: null, stats: {} };
    const add = (L, n, oppN, side) => {
      const played = [L.gk, ...L.field, ...L.bench.filter(p => p.role !== 'GK').slice(0, 4)].filter(Boolean);
      // Запасной в карьере игрока иногда получает минуты в концовке
      if (isPC()) { const me = C.players[C.me]; if (L.bench.includes(me) && !played.includes(me) && !me.injury && Math.random() < 0.4 * fraction) played.push(me); }
      for (const p of played) if (!res.stats[p.id]) res.stats[p.id] = { goals: 0, assists: 0, saves: 0, excl: 0, steals: 0, played: true };
      const shooters = played.filter(p => p.role !== 'GK');
      for (let i = 0; i < n; i++) {
        let tot = 0; const w = shooters.map(p => { const x = (p.attrs.sht + p.attrs.acc) * ({ CF: 1.25, D: 1.1, W: 1.0, CB: 0.6 }[p.role] || 1) * (L.field.includes(p) ? 1 : 0.45); tot += x; return x; });
        let r = Math.random() * tot, sc = -1; for (let k = 0; k < shooters.length; k++) { r -= w[k]; if (r <= 0) { res.stats[shooters[k].id].goals++; sc = k; break; } }
        if (sc >= 0 && Math.random() < 0.6) {
          let ta = 0; const wa = shooters.map((p, k) => { const x = k === sc ? 0 : p.attrs.pas * (L.field.includes(p) ? 1 : 0.45); ta += x; return x; });
          let q = Math.random() * ta; for (let k = 0; k < shooters.length; k++) { q -= wa[k]; if (q <= 0 && wa[k] > 0) { res.stats[shooters[k].id].assists = (res.stats[shooters[k].id].assists || 0) + 1; break; } }
        }
      }
      for (let i = 0; i < poisson(3.5 * fraction); i++) {
        let tt = 0; const wd = shooters.map(p => { const x = Math.pow(p.attrs.def / 70, 3) * (L.field.includes(p) ? 1 : 0.45); tt += x; return x; });
        let q = Math.random() * tt; for (let k = 0; k < shooters.length; k++) { q -= wd[k]; if (q <= 0) { res.stats[shooters[k].id].steals = (res.stats[shooters[k].id].steals || 0) + 1; break; } }
      }
      if (L.gk) res.stats[L.gk.id].saves += Math.round(oppN * rnd(0.7, 1.1));
      for (let i = 0; i < poisson(5.5 * fraction); i++) { const p = pick(shooters); if (p) res.stats[p.id].excl++; }
      if (side === 0) res.hs += n; else res.as += n;
    };
    add(H.L, poisson(lh), 0, 0); add(A.L, poisson(la), 0, 1);
    if (H.L.gk) res.stats[H.L.gk.id].saves = Math.max(res.stats[H.L.gk.id].saves, Math.round(res.as * rnd(0.7, 1.1)));
    if (A.L.gk) res.stats[A.L.gk.id].saves = Math.max(res.stats[A.L.gk.id].saves, Math.round(res.hs * rnd(0.7, 1.1)));
    if (f.stage !== 'league' && res.hs === res.as && !res.pens) res.pens = shootout(H, A);
    return res;
  }
  function shootout(H, A) {
    const kick = (S, O) => Math.random() < 0.7 + (S.att - O.def) * 0.004;
    let a = 0, b = 0;
    for (let i = 0; i < 5; i++) { if (kick(H, A)) a++; if (kick(A, H)) b++; }
    while (a === b) { const x = kick(H, A), y = kick(A, H); if (x) a++; if (y) b++; }
    return [a, b];
  }

  // ---------- после матча ----------
  function applyResult(f, res) {
    f.played = true; f.hs = res.hs; f.as = res.as; f.pens = res.pens || null;
    const w = winner(f);
    const draw = f.hs === f.as && !f.pens;
    for (const pid in res.stats) {
      const s = res.stats[pid], p = C.players[pid];
      if (!p || !s.played) continue;
      const won = !draw && w === p.team, lost = !draw && w !== p.team;
      const rating = clamp(6 + s.goals * 0.7 + (s.assists || 0) * 0.45 + s.saves * 0.12 + (s.steals || 0) * 0.3 - s.excl * 0.35 + (won ? 0.4 : lost ? -0.3 : 0) + rnd(-0.45, 0.45), 3, 10);
      for (const st of [p.st, p.career]) { st.apps++; st.goals += s.goals; st.assists = (st.assists || 0) + (s.assists || 0); st.saves += s.saves; st.excl += s.excl; st.rating += rating; }
      p.lastRating = rating;
      p.form = clamp(p.form * 0.6 + (rating - 6.6) * 0.8, -3, 3);
      p.playedRound = true;
      if (p.team === C.team) p.morale = clamp(p.morale + 3 + (won ? 2 : lost ? -2 : 0), 0, 100);
    }
  }

  function develop(p, mult, focus) {
    const o = ovr(p), gap = p.pot - o;
    const ag = p.age <= 20 ? 0.55 : p.age <= 23 ? 0.4 : p.age <= 26 ? 0.2 : p.age <= 29 ? 0.04 : p.age <= 31 ? -0.1 : p.age <= 33 ? -0.24 : -0.45;
    let d = ag > 0 ? ag * Math.max(0, gap) / 10 * mult : ag * 0.8;
    if (!d) return 0;
    const keys = p.role === 'GK' ? (focus === 'gk' ? ['gk'] : ['gk', 'gk', 'str', 'spd']) :
      focus === 'attack' ? ['sht', 'acc', 'pas'] : focus === 'defense' ? ['def', 'str'] : focus === 'fitness' ? ['spd', 'str'] : ['spd', 'sht', 'acc', 'pas', 'def', 'str'];
    const boost = p.role === 'GK' && focus === 'gk' ? 1.6 : 1;
    const per = d * boost * 6 / keys.length / 6 * 2.2;
    for (const k of keys) p.attrs[k] = clamp(p.attrs[k] + per * rnd(0.6, 1.4), 35, 99);
    return ovr(p) - o;
  }

  function endRound(userRes) {
    const tr = C.training, im = [0.7, 1, 1.35][tr.intensity], injM = [0.6, 1, 1.6][tr.intensity];
    const before = {};
    for (const id of T(C.team).squad.concat(C.academy)) { const p = C.players[id]; if (p) before[id] = ovr(p); }
    // Развитие, травмы, мораль
    for (const id in C.players) {
      const p = C.players[id];
      if (p.injury > 0) p.injury--;
      const mine = p.team === C.team, acad = C.academy.includes(id);
      if (!p.team && !acad) continue;
      // Свой игрок растёт в основном за счёт очков навыков, естественный рост вдвое медленнее
      develop(p, (mine ? im : acad ? 1.1 : 0.9) * (p.playedRound ? 1 : 0.55) * (p.id === C.me ? 0.5 : 1), mine ? tr.focus : 'balanced');
      if (p.playedRound && Math.random() < 0.012 * (mine ? injM : 1)) {
        p.injury = irnd(1, 4);
        if (mine && (!isPC() || p.id === C.me)) mail('Медицинский штаб', 'Травма: ' + esc(p.full), (p.id === C.me ? 'Ты пропустишь ' : esc(p.full) + ' пропустит ') + p.injury + ' ' + plural(p.injury, 'тур', 'тура', 'туров') + '.');
      }
      if (mine && !isPC()) {
        if (!p.playedRound && !p.injury) p.morale = clamp(p.morale - (p.age <= 21 ? 2 : 4), 0, 100);
        if (tr.intensity === 2) p.morale = clamp(p.morale - 1, 0, 100);
        if (p.promised > 0) { if (p.playedRound) p.promised--; else { p.morale = clamp(p.morale - 15, 0, 100); p.promised = 0; mail(p.full, 'Вы не сдержали слово', 'Мне обещали место в составе. Я разочарован.'); } }
      }
      p.playedRound = false;
    }
    C.devLog = Object.keys(before).map(id => ({ id, d: ovr(C.players[id]) - before[id] })).filter(x => x.d !== 0).sort((a, b) => b.d - a.d);
    // Скауты
    for (const s of C.scouts) {
      s.left--;
      if (s.left <= 0) {
        const n = s.rounds >= 6 ? 3 : 2, q = s.rounds >= 6 ? 3 : s.rounds >= 4 ? 2 : 1;
        const found = [];
        for (let i = 0; i < n; i++) { const y = genYouth(s.nat, s.role === 'any' ? null : s.role, q); C.shortlist.push(y.id); found.push(y); }
        mail('Скаут', 'Отчёт: ' + regionName(s.nat), 'Нашёл ' + n + ' ' + plural(n, 'талант', 'таланта', 'талантов') + ': ' + found.map(y => esc(y.full) + ' (' + ROLE_SHORT[y.role] + ', ' + y.age + ' лет)').join(', ') + '. Смотрите вкладку «Академия».');
      }
    }
    C.scouts = C.scouts.filter(s => s.left > 0);
    // Предложения за выставленных игроков
    if (C.window) for (const id of C.listed.slice()) {
      const p = C.players[id]; if (!p || p.team !== C.team) continue;
      if (Math.random() < 0.55) {
        const buyers = Object.keys(C.teams).filter(c => c !== C.team && T(c).budget > value(p) * 0.8 && T(c).squad.length < MAX_SQUAD);
        if (buyers.length) { const b = pick(buyers); const offer = Math.round(value(p) * rnd(0.8, 1.15) / 5) * 5; offerMail(p, b, offer); }
      }
    }
    // ИИ-команды дозакрывают состав свободными агентами
    for (const c in C.teams) {
      if (c === C.team && !isPC()) continue;
      while (T(c).squad.length < 11 && C.freeAgents.length) { const fa = C.players[C.freeAgents[0]]; joinTeam(fa, c); }
      const sq = squad(c); if (!sq.some(p => p.role === 'GK')) { const g = genPlayer(natOf(c), 'GK', 22, 30, 60, 70, 75); joinTeam(g, c); }
    }
    refillFreeAgents();
    // Неожиданные события
    if (Math.random() < (isPC() ? 0.3 : 0.24)) (isPC() ? playerEvent : randomEvent)();
  }

  // Завершение тура: матч игрока + симуляция остальных
  function completeRound(userFx, userRes) {
    if (userFx && userRes) {
      applyResult(userFx, userRes);
      const mine = userFx.home === C.team ? 0 : 1;
      const opp = mine === 0 ? userFx.away : userFx.home;
      const w = winner(userFx), draw = userFx.hs === userFx.as && !userFx.pens;
      const exp = 1 / (1 + Math.exp(-(teamOvr(C.team) - teamOvr(opp)) / 4));
      const act = draw ? 0.5 : w === C.team ? 1 : 0;
      const dc = Math.round((act - exp) * 7);
      C.confidence = clamp(C.confidence + dc, 0, 100);
      let prize = act === 1 ? 40 : act === 0.5 ? 15 : 0;
      if (userFx.stage !== 'league' && w === C.team) prize += { QF: 60, SF: 120, F: 250 }[userFx.stage];
      C.budget += prize;
      if (C.pendingBonus) { if (act === 1) { C.budget += C.pendingBonus; mail('Спонсор', 'Бонус получен', 'Спонсор перечислил ' + money(C.pendingBonus) + ' за победу.'); } else { for (const id of T(C.team).squad) C.players[id].morale = clamp(C.players[id].morale - 5, 0, 100); } C.pendingBonus = 0; }
      const my = [mine === 0 ? userFx.hs : userFx.as, mine === 0 ? userFx.as : userFx.hs];
      const top = Object.keys(userRes.stats).map(id => C.players[id]).filter(p => p && p.team === C.team && userRes.stats[p.id].played).sort((a, b) => (b.lastRating || 0) - (a.lastRating || 0)).slice(0, 3);
      C.lastMatch = { opp, my, pens: userFx.pens ? (mine === 0 ? userFx.pens : [userFx.pens[1], userFx.pens[0]]) : null, stage: userFx.stage, dc, prize, top: top.map(p => ({ id: p.id, r: p.lastRating })), res: act, fresh: true };
      if (isPC()) afterMyMatch(userFx, userRes);
    }
    for (const f of currentFixtures()) if (!f.played) applyResult(f, quickSim(f));
    endRound();
    advance();
    save();
  }

  function advance() {
    if (C.phase === 'league') {
      C.round++;
      if (C.round === 6) {
        C.window = true;
        if (!isPC()) mail('Суперлига', 'Открыто зимнее трансферное окно', 'Окно открыто на два тура: можно покупать и продавать игроков.');
        else { const l = pcOffers(C.pc.requested ? 3 : 2, C.pc.requested); if (l.length && (C.pc.requested || Math.random() < 0.6)) offerPCMail(l, 'Зимнее окно: есть интерес'); }
      }
      if (C.round === 8) { C.window = false; if (!isPC()) mail('Суперлига', 'Трансферное окно закрыто', 'Следующее окно — перед новым сезоном.'); }
      if (C.round === 1) C.window = false;
      if (C.round >= leagueRounds()) setupPlayoff();
    } else if (C.phase === 'playoff') {
      const st = C.playoff.stage, ties = C.playoff.ties[st];
      if (ties.every(f => f.played)) {
        const ws = ties.map(winner);
        if (ws.includes(C.team)) C.stageReached = st === 'QF' ? 'SF' : st === 'SF' ? 'F' : 'W';
        if (st === 'QF') { C.playoff.stage = 'SF'; C.playoff.ties.SF = [[ws[0], ws[1]], [ws[2], ws[3]]].map((p, i) => ({ id: 'SF' + C.season + i, home: p[0], away: p[1], played: false, stage: 'SF' })); }
        else if (st === 'SF') { C.playoff.stage = 'F'; C.playoff.ties.F = [{ id: 'F' + C.season, home: ws[0], away: ws[1], played: false, stage: 'F' }]; }
        else { C.phase = 'done'; C.champion = ws[0]; seasonEnd(); }
      }
    }
  }

  // ---------- конец сезона ----------
  function seasonEnd() {
    const pos = posOf(C.team), tbl = table();
    const stageOk = (need) => ['QF', 'SF', 'F', 'W'].indexOf(C.stageReached || '') >= ['QF', 'SF', 'F', 'W'].indexOf(need);
    const youthApps = Math.max(0, ...squad(C.team).filter(p => p.age <= 21).map(p => p.st.apps), 0);
    let met = 0, total = 0;
    for (const o of C.objectives) {
      total++;
      o.met = o.kind === 'league' ? pos <= o.need : o.kind === 'playoff' ? stageOk(o.need) : youthApps >= o.need;
      if (o.met) met++;
    }
    const primary = C.objectives[0].met;
    C.confidence = clamp(C.confidence + (primary ? 15 : -15) + (met - 1) * 5, 0, 100);
    // Награды
    const all = Object.values(C.players).filter(p => p.team);
    const scorer = all.slice().sort((a, b) => b.st.goals - a.st.goals)[0];
    const keeper = all.filter(p => p.role === 'GK').sort((a, b) => b.st.saves - a.st.saves)[0];
    const mvp = all.filter(p => p.st.apps >= 8).sort((a, b) => b.st.rating / b.st.apps - a.st.rating / a.st.apps)[0];
    const champ = C.champion;
    if (champ === C.team) C.budget += 400;
    C.budget += Math.round(baseBudget(C.team) * 0.6);
    C.history.push({ season: C.season, year: C.year, team: C.team, pos, stage: C.stageReached, champion: champ, met, total });
    C.lastSeason = { pos, stage: C.stageReached, champion: champ, scorer: scorer && { id: scorer.id, g: scorer.st.goals }, keeper: keeper && { id: keeper.id, s: keeper.st.saves }, mvp: mvp && { id: mvp.id, r: +(mvp.st.rating / mvp.st.apps).toFixed(2) }, objectives: C.objectives.map(o => ({ text: o.text, met: o.met })), top3: tbl.slice(0, 3).map(r => r.code), retired: [], youth: [], offers: [] };
    // Возраст, завершение карьеры, выпуск академии
    for (const id in C.players) {
      const p = C.players[id];
      p.age++;
      const o = ovr(p);
      if (p.team && p.id !== C.me && (p.age >= 36 || (p.age >= 33 && o < 70 && Math.random() < 0.5))) {
        if (p.team === C.team) C.lastSeason.retired.push(p.full);
        joinTeam(p, null); p.retired = true;
      }
    }
    for (const c in C.teams) {
      if (c === C.team && !isPC()) continue;
      const n = irnd(1, 2);
      for (let i = 0; i < n && T(c).squad.length < MAX_SQUAD; i++) { const y = genPlayer(natOf(c), pick(['D', 'W', 'CB', 'CF', 'GK']), 17, 19, 58, 70, 88); joinTeam(y, c); }
      T(c).budget = baseBudget(c);
    }
    if (isPC()) {
      const me = C.players[C.me];
      C.pc.seasons.push({ year: C.year, team: C.team, apps: me.st.apps, goals: me.st.goals, assists: me.st.assists || 0, rating: me.st.apps ? +(me.st.rating / me.st.apps).toFixed(2) : 0, ovr: ovr(me), champ: C.champion === C.team });
      C.lastSeason.me = { apps: me.st.apps, goals: me.st.goals, assists: me.st.assists || 0, rating: me.st.apps ? (me.st.rating / me.st.apps).toFixed(2) : '—', ovr: ovr(me) };
      C.lastSeason.offers = pcOffers(C.pc.requested ? 3 : 2, C.pc.requested);
      C.phase = 'summary';
      return;
    }
    for (let i = 0; i < 2; i++) { const y = genYouth(natOf(C.team), null, 2); C.academy.push(y.id); C.lastSeason.youth.push(y.full); }
    // Увольнение или рынок тренеров
    const order = Object.keys(C.teams).sort((a, b) => teamOvr(b) - teamOvr(a));
    if (C.confidence < 20) {
      C.fired = true;
      C.lastSeason.offers = order.slice(Math.min(order.length - 3, order.indexOf(C.team) + 1)).filter(c => c !== C.team).sort(() => Math.random() - 0.5).slice(0, 3);
    } else if (C.confidence > 78 && order.indexOf(C.team) > 0) {
      C.lastSeason.offers = order.slice(0, order.indexOf(C.team)).sort(() => Math.random() - 0.5).slice(0, 2);
    }
    C.phase = 'summary';
  }

  function nextSeason(takeTeam) {
    if (isPC()) {
      if (takeTeam) movePC(takeTeam);
      C.season++; C.year++;
      refillFreeAgents();
      makeSeason();
      const me = C.players[C.me];
      mail('Тренер', 'Сезон ' + C.year + '/' + String(C.year + 1).slice(2), 'Тебе ' + me.age + ', рейтинг ' + ovr(me) + '. Статус на старте сезона — <b>' + STATUS[myStatus()] + '</b>.');
      save();
      return;
    }
    if (takeTeam) {
      mail('Рынок тренеров', 'Новая работа', 'Вы подписали контракт с командой «' + esc(T(takeTeam).name) + '».');
      C.team = takeTeam; C.budget = baseBudget(takeTeam) + 200; C.confidence = 55; C.listed = []; C.fired = false;
    }
    C.season++; C.year++;
    if (!takeTeam) C.confidence = Math.round(clamp(C.confidence * 0.6 + 25, 30, 90));
    refillFreeAgents();
    makeSeason();
    mail('Правление', 'Сезон ' + C.year + '/' + String(C.year + 1).slice(2), 'Бюджет на трансферы — ' + money(C.budget) + '.<br>Цели:<br>' + C.objectives.map(o => '• ' + o.text).join('<br>'));
    save();
  }

  // ---------- трансферы ----------
  function asking(p) {
    const t = T(p.team);
    const key = squad(p.team).sort((a, b) => ovr(b) - ovr(a)).slice(0, 3).includes(p);
    return Math.round(value(p) * (key ? 1.5 : 1.15) * (t.squad.length <= 10 ? 1.3 : 1) / 5) * 5;
  }
  function tryBuy(p, offer) {
    if (!C.window) return { ok: false, msg: 'Трансферное окно закрыто.' };
    if (squad(C.team).length >= MAX_SQUAD) return { ok: false, msg: 'В заявке уже ' + MAX_SQUAD + ' игроков. Сначала продайте или отчислите кого-то.' };
    if (offer > C.budget) return { ok: false, msg: 'Не хватает бюджета.' };
    const ask = asking(p);
    if (offer < ask * 0.85) return { ok: false, msg: '«' + esc(T(p.team).name) + '» отклоняет предложение. Они хотят не меньше ' + money(ask) + '.', counter: ask };
    if (offer < ask) return { ok: false, msg: '«' + esc(T(p.team).name) + '» готовы отпустить игрока за ' + money(ask) + '.', counter: ask };
    if (teamOvr(C.team) < teamOvr(p.team) - 6 && ovr(p) >= 84 && Math.random() < 0.55) return { ok: false, msg: esc(p.full) + ' не хочет переходить в более слабую команду.' };
    C.budget -= offer; T(p.team).budget += offer;
    joinTeam(p, C.team);
    p.morale = 80;
    mail('Трансферы', 'Сделка закрыта: ' + esc(p.full), esc(p.full) + ' переходит в команду за ' + money(offer) + '. Игровой номер — ' + p.num + '.');
    save();
    return { ok: true, msg: esc(p.full) + ' теперь ваш игрок!' };
  }
  function signFree(p) {
    const fee = Math.round(value(p) * 0.3 / 5) * 5;
    if (squad(C.team).length >= MAX_SQUAD) return { ok: false, msg: 'В заявке уже ' + MAX_SQUAD + ' игроков.' };
    if (fee > C.budget) return { ok: false, msg: 'Не хватает бюджета на подъёмные.' };
    C.budget -= fee; joinTeam(p, C.team); p.morale = 75;
    save();
    return { ok: true, msg: esc(p.full) + ' подписан как свободный агент (подъёмные ' + money(fee) + ').' };
  }
  function sellNow(p) {
    const price = Math.round(value(p) * 0.7 / 5) * 5;
    const buyers = Object.keys(C.teams).filter(c => c !== C.team && T(c).squad.length < MAX_SQUAD);
    const b = pick(buyers);
    C.budget += price; T(b).budget -= price;
    joinTeam(p, b);
    mail('Трансферы', 'Продажа: ' + esc(p.full), esc(p.full) + ' продан в «' + esc(T(b).name) + '» за ' + money(price) + '.');
    save();
  }
  function release(p) { joinTeam(p, null); C.freeAgents.push(p.id); save(); }
  function offerMail(p, buyer, offer) {
    mail('Трансферы', 'Предложение за ' + esc(p.full), '«' + esc(T(buyer).name) + '» предлагает ' + money(offer) + ' (оценка ' + money(value(p)) + ').', [
      { label: 'Продать', act: 'sell', pid: p.id, buyer, offer }, { label: 'Отказать', act: 'none' }]);
  }

  // ---------- почта и события ----------
  function mail(from, subject, bodyHtml, actions) {
    C.inbox.unshift({ id: 'M' + (C.seq++), from, subject, body: bodyHtml, actions: actions || null, read: false, when: stageLabel() });
    if (C.inbox.length > 60) C.inbox.length = 60;
  }
  function randomEvent() {
    const mine = squad(C.team);
    const list = [];
    list.push(() => mail('Коммерческий отдел', 'Спонсор предлагает бонус', 'Банк-партнёр заплатит ' + money(120) + ' за победу в следующем матче. Если проиграем — игрокам придётся отработать рекламную съёмку в выходной (мораль −5).', [{ label: 'Принять', act: 'sponsor' }, { label: 'Отказаться', act: 'none' }]));
    const bencher = mine.filter(p => !p.injury && p.st.apps <= C.round / 3 && ovr(p) >= 70 && p.age >= 22)[0];
    if (bencher) list.push(() => mail(bencher.full, 'Хочу больше играть', 'Я провёл мало матчей в этом сезоне. Дайте мне шанс в стартовом составе, иначе мне придётся думать о переходе.', [{ label: 'Обещать место в старте', act: 'promise', pid: bencher.id }, { label: 'Место надо заслужить', act: 'tough', pid: bencher.id }]));
    const healthy = mine.filter(p => !p.injury);
    if (healthy.length > 7) list.push(() => { const p = pick(healthy); p.injury = irnd(1, 3); mail('Медицинский штаб', 'Травма на тренировке', esc(p.full) + ' травмировался на тренировке и пропустит ' + p.injury + ' ' + plural(p.injury, 'тур', 'тура', 'туров') + '.'); });
    const young = mine.filter(p => p.age <= 23).sort((a, b) => ovr(b) - ovr(a))[0];
    if (young && C.window) list.push(() => { const b = pick(Object.keys(C.teams).filter(c => c !== C.team)); offerMail(young, b, Math.round(value(young) * 1.3 / 5) * 5); });
    if (C.academy.length) list.push(() => { const p = C.players[pick(C.academy)]; p.pot = Math.min(97, p.pot + 3); mail('Академия', 'Звезда молодёжного турнира', esc(p.full) + ' стал лучшим игроком юношеского турнира. Тренеры академии повысили оценку его потенциала.'); });
    list.push(() => { const fine = 30; C.budget -= fine; mail('Федерация', 'Штраф за дисциплину', 'Федерация оштрафовала команду на ' + money(fine) + ' за нарушения регламента на скамейке.'); });
    list.push(() => { C.budget += 150; C.confidence = clamp(C.confidence - 4, 0, 100); mail('Правление', 'Новый инвестор', 'В клуб пришёл инвестор: бюджет +' + money(150) + '. Но теперь от вас ждут результата — доверие правления немного снизилось.'); });
    pick(list)();
  }
  function doAction(msgId, idx) {
    const m = C.inbox.find(x => x.id === msgId); if (!m || !m.actions) return;
    const a = m.actions[idx];
    const p = a.pid ? C.players[a.pid] : null;
    if (a.act === 'sell' && p && p.team === C.team) {
      if (T(a.buyer).squad.length >= MAX_SQUAD) m.result = 'Сделка сорвалась: у покупателя полная заявка.';
      else { C.budget += a.offer; T(a.buyer).budget -= a.offer; joinTeam(p, a.buyer); m.result = esc(p.full) + ' продан за ' + money(a.offer) + '.'; }
    } else if (a.act === 'pmove') {
      if (!C.window) m.result = 'Трансферное окно уже закрыто.';
      else { movePC(a.buyer); m.result = 'Ты перешёл в «' + esc(T(a.buyer).name) + '».'; }
    }
    else if (a.act === 'intHumble') { C.pc.trust = clamp(C.pc.trust + 3, 0, 100); m.result = 'Тренеру понравился ответ. Доверие +3.'; }
    else if (a.act === 'intBold') { const ok = Math.random() < 0.5; C.pc.trust = clamp(C.pc.trust + (ok ? 6 : -5), 0, 100); m.result = ok ? 'Тренер оценил амбиции. Доверие +6.' : 'Тренеру не понравились слова в прессе. Доверие −5.'; }
    else if (a.act === 'extra') { addXp(40); if (Math.random() < 0.12) { C.players[C.me].injury = 1; m.result = 'Опыт +40, но ты потянул плечо и пропустишь тур.'; } else m.result = 'Опыт +40.'; }
    else if (a.act === 'sponsor') { C.pendingBonus = 120; m.result = 'Бонус ждёт победы в следующем матче.'; }
    else if (a.act === 'promise' && p) { p.promised = 3; p.morale = clamp(p.morale + 15, 0, 100); m.result = 'Вы пообещали место в старте на 3 матча.'; }
    else if (a.act === 'tough' && p) { p.morale = clamp(p.morale - 20, 0, 100); if (!C.listed.includes(p.id)) C.listed.push(p.id); m.result = esc(p.full) + ' недоволен и просит выставить его на трансфер.'; }
    else m.result = 'Предложение отклонено.';
    m.actions = null; m.read = true;
    save(); render();
  }
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const regionName = (nat) => ({ SRB: 'Сербия', CRO: 'Хорватия', MNE: 'Черногория', HUN: 'Венгрия', ESP: 'Испания', ITA: 'Италия', GRE: 'Греция', USA: 'США', AUS: 'Австралия', FRA: 'Франция', JPN: 'Япония', ROU: 'Румыния', KAZ: 'Казахстан' }[nat] || nat);
  function stageLabel() {
    if (!C) return '';
    if (C.phase === 'league') return 'Тур ' + (C.round + 1);
    if (C.phase === 'playoff') return STAGE_NAMES[C.playoff.stage];
    return 'Межсезонье';
  }

  // ---------- сохранение ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) { /* хранилище недоступно — карьера живёт до перезагрузки */ } }
  function load() { try { const s = localStorage.getItem(KEY); if (s) { const d = JSON.parse(s); if (d && d.v === 1) { C = d; for (const id in C.players) { const p = C.players[id]; WP.fixAttrs(p.attrs); for (const st of [p.st, p.career]) if (st && st.assists === undefined) st.assists = 0; } return true; } } } catch (e) { /* повреждённое сохранение */ } return false; }
  function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return !!C; } }

  // ---------- связка с матчем ----------
  function teamDef(code) {
    const t = T(code), L = lineup(code);
    const base = WP.TEAMS.find(d => d.code === code) || {};
    const list = [L.gk, ...L.field, ...L.bench].filter(Boolean);
    // Нехватка игроков: подтягиваем временный резерв из академии или сгенерированных (не сохраняются)
    const temps = [];
    while (list.filter(p => p.role !== 'GK').length < 6) {
      const acad = C.academy.map(id => C.players[id]).find(p => p.role !== 'GK' && !list.includes(p));
      const r = acad || genPlayer(natOf(code), 'D', 18, 20, 58, 64, 70);
      if (!acad) temps.push(r);
      if (!r.num) r.num = 20 + list.length;
      list.push(r);
    }
    if (!list.some(p => p.role === 'GK')) { const g = genPlayer(natOf(code), 'GK', 18, 20, 58, 64, 70); g.num = 13; list.unshift(g); temps.push(g); }
    for (const tp of temps) delete C.players[tp.id];
    const top = list.slice().sort((a, b) => ovr(b) - ovr(a)).slice(0, 2);
    const used = new Set();
    const tuples = list.map(p => { let n = p.num; while (!n || used.has(n)) n = (n || 20) + 1; used.add(n); return [n, p.name, p.role, top.includes(p) ? 1 : 0, p.full, p.height, p.attrs, p.id]; });
    const starters = [L.gk, ...L.field].filter(Boolean).map(p => tuples.find(tu => tu[7] === p.id)[0]);
    return { code, name: t.name, rating: teamOvr(code), color: t.color || base.color || '#888', style: t.style || {}, note: '', club: t.club, players: tuples, starters, career: true };
  }
  function matchCfg(f) {
    const humanSide = f.home === C.team ? 0 : 1;
    const cfg = { home: teamDef(f.home), away: teamDef(f.away), mode: '1p', humanSide, periodMin: C.settings.periodMin, difficulty: C.settings.difficulty, shootout: f.stage !== 'league', career: { fixtureId: f.id } };
    if (!isPC() && C.tac) cfg.tac = Object.assign({}, C.tac);
    if (isPC()) {
      ensureObjective(f);
      const st = myStatus();
      cfg.pc = { pid: C.me, enter: st === 'start' ? 0 : st === 'rot' ? 3 : 4, status: st, obj: C.pc.obj ? C.pc.obj.text : '' };
    }
    return cfg;
  }
  function finishMatch(m, opts) {
    const f = findFixture(m.cfg.career.fixtureId);
    if (!f || f.played) return;
    const res = { hs: m.teams[0].score, as: m.teams[1].score, pens: null, stats: {} };
    for (const t of m.teams) for (const p of t.roster) if (p.cid && C.players[p.cid]) res.stats[p.cid] = { goals: p.stats.goals, assists: p.stats.assists || 0, saves: p.stats.saves, excl: p.stats.excl, steals: p.stats.steals, played: !!p.played };
    if (m.so) res.pens = [m.so.kicks[0].filter(Boolean).length, m.so.kicks[1].filter(Boolean).length];
    if (opts && opts.simRest && m.state !== 'final') {
      const total = 4 * m.periodLen;
      const left = Math.max(0, (4 - m.period) * m.periodLen + Math.max(0, m.clock));
      res.pens = null;
      quickSim(f, left / total, res);
    }
    if (f.stage !== 'league' && res.hs === res.as && !res.pens) res.pens = shootout(strength(f.home), strength(f.away));
    completeRound(f, res);
  }

  // ---------- интерфейс ----------
  function el(id) { return document.getElementById(id); }
  function open() {
    root = el('career'); body = el('crBody'); modalEl = el('crModal');
    if (!root.dataset.bound) bind();
    if (!C && !load()) setup = newSetup();
    root.hidden = false;
    render();
    if (C && C.lastMatch && C.lastMatch.fresh) showMatchSummary();
    if (C && C.phase === 'summary') showSeasonSummary();
  }
  function close() { if (root) root.hidden = true; }
  const newSetup = () => ({ mode: 'player', team: 'AS1', manager: '', name: '', role: 'W', height: 190, num: 9, periodMin: 4, difficulty: 1 });

  function bind() {
    root.dataset.bound = '1';
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, v = b.dataset.v;
      handle(a, v, b);
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'crFilterRole' || t.id === 'crFilterMax') { render(); }
      if (t.id === 'crScoutRole' || t.id === 'crScoutNat' || t.id === 'crScoutDur') { /* читается при отправке */ }
      if (t.id === 'crManager' && setup) setup.manager = t.value;
      if (t.id === 'crName' && setup) setup.name = t.value;
      if (t.id === 'crHeight' && setup) setup.height = +t.value;
      if (t.id === 'crNum' && setup) setup.num = +t.value;
    });
  }

  function handle(a, v, btn) {
    if (a === 'menu') { close(); hooks.menu && hooks.menu(); return; }
    if (a === 'tab') { tab = v; render(); return; }
    if (a === 'setupTeam') { setup.team = v; render(); return; }
    if (a === 'setupMode') { setup.mode = v; render(); return; }
    if (a === 'setupRole') { setup.role = v; render(); return; }
    if (a === 'up') {
      const me = C.players[C.me], cost = upCost(me.attrs[v]);
      if (me.attrs[v] >= 99) return;
      if (C.pc.sp < cost) { toast('Нужно ' + cost + ' ' + plural(cost, 'очко', 'очка', 'очков') + ' навыка.'); return; }
      const o = ovr(me);
      C.pc.sp -= cost; me.attrs[v] = Math.min(99, Math.round(me.attrs[v]) + 1);
      save(); render();
      if (ovr(me) > o) toast('Рейтинг вырос: ' + ovr(me) + '!');
      return;
    }
    if (a === 'request') {
      if (C.pc.requested) { C.pc.requested = false; toast('Запрос на трансфер отозван.'); }
      else { C.pc.requested = true; C.pc.trust = clamp(C.pc.trust - 8, 0, 100); toast('Агент ищет клуб. Предложения придут, когда откроется окно. Доверие тренера −8.'); }
      save(); render(); return;
    }
    if (a === 'setupLen') { setup.periodMin = +v; render(); return; }
    if (a === 'setupDiff') { setup.difficulty = +v; render(); return; }
    if (a === 'start') {
      const settings = { periodMin: setup.periodMin, difficulty: setup.difficulty };
      if (setup.mode === 'player') {
        const nm = el('crName'), name = (nm && nm.value.trim()) || 'Игрок';
        create(setup.team, 'Тренер', settings, { name, role: setup.role, height: +((el('crHeight') || {}).value || setup.height), num: +((el('crNum') || {}).value || setup.num) });
      } else { const mn = el('crManager'); create(setup.team, (mn && mn.value.trim()) || 'Тренер', settings); }
      setup = null; tab = 'home'; render(); return;
    }
    if (a === 'newCareer') { askConfirm('Начать новую карьеру? Текущее сохранение будет удалено.', () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } C = null; setup = newSetup(); render(); }); return; }
    if (a === 'play') { const f = userFixture(); if (f && hooks.play) { if (isPC() && myStatus() === 'inj') { toast('Ты травмирован — этот матч можно только симулировать.'); return; } close(); hooks.play(matchCfg(f)); } return; }
    if (a === 'sim') { const f = userFixture(); if (f) { ensureObjective(f); const r = quickSim(f); completeRound(f, r); render(); if (C.phase === 'summary') showSeasonSummary(); else showMatchSummary(); } return; }
    if (a === 'seasonSummary') { showSeasonSummary(); return; }
    if (a === 'simRound') { completeRound(null, null); render(); if (C.phase === 'summary') showSeasonSummary(); return; }
    if (a === 'player') { showPlayer(v); return; }
    if (a === 'starter') { toggleStarter(v); return; }
    if (a === 'autoXI') { T(C.team).starters = null; save(); render(); return; }
    if (a === 'list') { const p = C.players[v]; if (C.listed.includes(v)) C.listed = C.listed.filter(x => x !== v); else C.listed.push(v); save(); closeModal(); render(); return; }
    if (a === 'sellNow') { const p = C.players[v]; askConfirm('Продать ' + esc(p.full) + ' сразу за ' + money(Math.round(value(p) * 0.7 / 5) * 5) + '?', () => { sellNow(p); closeModal(); render(); }); return; }
    if (a === 'release') { const p = C.players[v]; askConfirm('Расторгнуть контракт с ' + esc(p.full) + '? Он станет свободным агентом.', () => { release(p); closeModal(); render(); }); return; }
    if (a === 'offer') { showOffer(v); return; }
    if (a === 'bid') { const [pid, amt] = v.split('|'); const r = tryBuy(C.players[pid], +amt); showOffer(pid, r); if (r.ok) render(); return; }
    if (a === 'free') { const r = signFree(C.players[v]); toast(r.msg); render(); return; }
    if (a === 'mail') { const m = C.inbox.find(x => x.id === v); if (m) { m.open = !m.open; m.read = true; save(); render(); } return; }
    if (a === 'mailAct') { const [id, i] = v.split('|'); doAction(id, +i); return; }
    if (a === 'focus') { C.training.focus = v; save(); render(); return; }
    if (a === 'intensity') { C.training.intensity = +v; save(); render(); return; }
    if (a === 'scout') {
      if (C.scouts.length >= 2) { toast('Оба скаута уже в командировке.'); return; }
      const rounds = +el('crScoutDur').value, cost = rounds * 10;
      if (cost > C.budget) { toast('Не хватает бюджета.'); return; }
      C.budget -= cost;
      C.scouts.push({ role: el('crScoutRole').value, nat: el('crScoutNat').value, rounds, left: rounds });
      save(); render(); toast('Скаут отправлен на ' + rounds + ' ' + plural(rounds, 'тур', 'тура', 'туров') + '.'); return;
    }
    if (a === 'signYouth') { const p = C.players[v]; const fee = 20 + Math.round((p.pot - 70) * 1.5); if (fee > C.budget) { toast('Не хватает бюджета.'); return; } C.budget -= Math.max(10, fee); C.shortlist = C.shortlist.filter(x => x !== v); C.academy.push(v); save(); render(); toast(esc(p.full) + ' подписан в академию.'); return; }
    if (a === 'dropYouth') { C.shortlist = C.shortlist.filter(x => x !== v); C.academy = C.academy.filter(x => x !== v); save(); render(); return; }
    if (a === 'promote') { const p = C.players[v]; if (squad(C.team).length >= MAX_SQUAD) { toast('В заявке уже ' + MAX_SQUAD + ' игроков.'); return; } joinTeam(p, C.team); save(); render(); toast(esc(p.full) + ' переведён в основную команду (№' + p.num + ').'); return; }
    if (a === 'nextSeason') { closeModal(); nextSeason(v || null); tab = 'home'; render(); return; }
    if (a === 'closeModal') { closeModal(); return; }
    if (a === 'goMe') { closeModal(); tab = 'me'; render(); return; }
    if (a === 'confirmYes') { const fn = modalEl._yes; closeModal(); if (fn) fn(); return; }
  }

  function toggleStarter(pid) {
    const t = T(C.team);
    const L = lineup(C.team);
    let cur = t.starters ? t.starters.slice() : [L.gk, ...L.field].filter(Boolean).map(p => p.id);
    const p = C.players[pid];
    if (cur.includes(pid)) cur = cur.filter(x => x !== pid);
    else {
      if (p.injury) { toast('Игрок травмирован.'); return; }
      if (p.role === 'GK') cur = cur.filter(x => C.players[x].role !== 'GK');
      else if (cur.filter(x => C.players[x].role !== 'GK').length >= 6) { toast('В старте уже 6 полевых. Уберите кого-то.'); return; }
      cur.push(pid);
    }
    t.starters = cur; save(); render();
  }

  function toast(msg) {
    const tEl = el('crToast'); tEl.innerHTML = msg; tEl.className = 'show';
    clearTimeout(toast._t); toast._t = setTimeout(() => { tEl.className = ''; }, 2600);
  }
  function showModal(html) { modalEl.innerHTML = '<div class="cr-mcard">' + html + '</div>'; modalEl.hidden = false; }
  function closeModal() { modalEl.hidden = true; modalEl.innerHTML = ''; if (C && C.lastMatch) { C.lastMatch.fresh = false; save(); } }
  function askConfirm(text, yes) { showModal('<p>' + text + '</p><div class="row-btns"><button class="btn primary" data-a="confirmYes">Да</button><button class="btn" data-a="closeModal">Отмена</button></div>'); modalEl._yes = yes; }

  const flag = (code) => WP.flag(code);
  const bar = (v, max) => '<span class="cr-bar"><i style="width:' + clamp(v / (max || 100) * 100, 0, 100) + '%"></i></span>';
  const ovrChip = (o) => '<b class="cr-ovr ' + (o >= 85 ? 'gold' : o >= 75 ? 'silver' : 'bronze') + '">' + o + '</b>';
  const potRange = (p) => { const o = ovr(p); const lo = Math.max(o, p.pot - 4), hi = Math.min(97, p.pot + 3); return lo + '–' + hi; };

  function render() {
    if (!root) return;
    if (!C) { renderSetup(); return; }
    if (isPC()) { renderPC(); return; }
    const t = T(C.team);
    const unread = C.inbox.filter(m => !m.read).length;
    el('crHead').innerHTML =
      '<div class="cr-club">' + flag(C.team) + '<div><b>' + esc(t.name) + '</b><small>' + esc(C.manager) + ' · сезон ' + C.year + '/' + String(C.year + 1).slice(2) + ' · ' + stageLabel() + '</small></div></div>' +
      '<div class="cr-kpis"><span><small>Бюджет</small><b>' + money(C.budget) + '</b></span><span><small>Сила</small><b>' + teamOvr(C.team) + '</b></span><span><small>Доверие правления</small><b>' + C.confidence + '</b>' + bar(C.confidence) + '</span><span><small>Окно</small><b class="' + (C.window ? 'ok' : 'muted') + '">' + (C.window ? 'открыто' : 'закрыто') + '</b></span></div>' +
      '<div class="cr-headbtns"><button class="btn" data-a="newCareer">Новая карьера</button><button class="btn" data-a="menu">В меню</button></div>';
    const tabs = [['home', 'Главная'], ['league', 'Турнир'], ['squad', 'Состав'], ['transfers', 'Трансферы'], ['training', 'Тренировки'], ['academy', 'Академия'], ['mail', 'Почта' + (unread ? ' · ' + unread : '')]];
    el('crTabs').innerHTML = tabs.map(([k, n]) => '<button data-a="tab" data-v="' + k + '" aria-pressed="' + (tab === k) + '">' + n + '</button>').join('');
    body.innerHTML = ({ home: viewHome, league: viewLeague, squad: viewSquad, transfers: viewTransfers, training: viewTraining, academy: viewAcademy, mail: viewMail }[tab] || viewHome)();
  }

  function renderPC() {
    const t = T(C.team), me = C.players[C.me], st = myStatus();
    const unread = C.inbox.filter(m => !m.read).length;
    el('crHead').innerHTML =
      '<div class="cr-club">' + flag(C.team) + '<div><b>№' + me.num + ' ' + esc(me.full) + '</b><small>' + WP.ROLE_NAMES[me.role] + ' · ' + me.age + ' лет · ' + esc(t.name) + ' · ' + C.year + '/' + String(C.year + 1).slice(2) + ' · ' + stageLabel() + '</small></div></div>' +
      '<div class="cr-kpis"><span><small>Рейтинг</small><b>' + ovrChip(ovr(me)) + '</b></span><span><small>Потенциал</small><b>' + potRange(me) + '</b></span><span><small>Очки навыков</small><b class="' + (C.pc.sp ? 'ok' : '') + '">' + C.pc.sp + '</b></span><span><small>Доверие тренера</small><b>' + C.pc.trust + '</b>' + bar(C.pc.trust) + '</span><span><small>Статус</small><b class="' + (st === 'start' ? 'ok' : st === 'inj' ? 'bad' : '') + '">' + STATUS[st] + '</b></span></div>' +
      '<div class="cr-headbtns"><button class="btn" data-a="newCareer">Новая карьера</button><button class="btn" data-a="menu">В меню</button></div>';
    const tabs = [['home', 'Главная'], ['me', 'Мой игрок' + (C.pc.sp ? ' · ' + C.pc.sp : '')], ['squad', 'Команда'], ['league', 'Турнир'], ['mail', 'Почта' + (unread ? ' · ' + unread : '')]];
    if (!tabs.some(x => x[0] === tab)) tab = 'home';
    el('crTabs').innerHTML = tabs.map(([k, n]) => '<button data-a="tab" data-v="' + k + '" aria-pressed="' + (tab === k) + '">' + n + '</button>').join('');
    body.innerHTML = ({ home: viewHomePC, me: viewMe, squad: viewTeamPC, league: viewLeague, mail: viewMail }[tab] || viewHomePC)();
  }

  function viewHomePC() {
    const me = C.players[C.me], st = myStatus(), f = userFixture();
    let h = '<div class="cr-grid">';
    if (C.phase === 'summary') h += '<div class="cr-card cr-next"><div class="cr-eyebrow">Сезон окончен</div><p>Чемпион — ' + esc(T(C.champion).name) + '.</p><div class="row-btns"><button class="btn primary" data-a="seasonSummary">Итоги сезона</button></div></div>';
    else if (f) {
      ensureObjective(f);
      const stage = f.stage === 'league' ? 'Суперлига · тур ' + (f.round + 1) : 'Плей-офф · ' + STAGE_NAMES[f.stage];
      const side = (c) => '<div class="cr-fxteam">' + flag(c) + '<b>' + esc(T(c).name) + '</b>' + ovrChip(teamOvr(c)) + '<small>' + (c === C.team ? 'твоя команда' : posOf(c) + '-е место') + '</small></div>';
      const role = st === 'start' ? 'Ты в стартовой семёрке.' : st === 'rot' ? 'Начинаешь на скамейке, выход — после большого перерыва (3-й период).' : st === 'res' ? 'Ты в запасе: тренер выпустит тебя в 4-м периоде.' : 'Ты травмирован и пропускаешь матч.';
      h += '<div class="cr-card cr-next"><div class="cr-eyebrow">' + stage + (f.stage !== 'league' ? ' · при ничьей — серия пенальти' : '') + '</div><div class="cr-fx">' + side(f.home) + '<span class="cr-vs">vs</span>' + side(f.away) + '</div>' +
        '<p class="small">' + role + '</p>' + (C.pc.obj && st !== 'inj' ? '<p class="cr-task"><span class="cr-badge">Задача тренера</span> ' + esc(C.pc.obj.text) + ' <span class="muted small">· +50 опыта и доверие</span></p>' : '') +
        '<div class="row-btns">' + (st !== 'inj' ? '<button class="btn primary" data-a="play">Играть матч</button>' : '') + '<button class="btn' + (st === 'inj' ? ' primary' : '') + '" data-a="sim">Симулировать</button></div></div>';
    } else h += '<div class="cr-card cr-next"><div class="cr-eyebrow">' + stageLabel() + '</div><p>' + (C.phase === 'playoff' ? 'Твоя команда выбыла из плей-офф. Досмотри турнир.' : 'В этом туре команда не играет.') + '</p><div class="row-btns"><button class="btn primary" data-a="simRound">Симулировать тур</button></div></div>';
    const L = C.pc.last, lm = C.lastMatch;
    if (L && lm) {
      h += '<div class="cr-card"><div class="cr-eyebrow">Последний матч</div><div class="cr-last">' + flag(C.team) + '<b class="cr-score ' + (lm.res === 1 ? 'win' : lm.res === 0 ? 'loss' : '') + '">' + lm.my[0] + ':' + lm.my[1] + (lm.pens ? ' <small>пен. ' + lm.pens[0] + ':' + lm.pens[1] + '</small>' : '') + '</b>' + flag(lm.opp) + '<span>' + esc(T(lm.opp).name) + '</span></div>' +
        '<p class="small">' + (L.played ? 'Оценка <b>' + L.rating.toFixed(1) + '</b> · голы ' + L.goals + ' · передачи ' + L.assists + ' · отборы ' + L.steals : 'Ты не выходил на воду.') + '</p>' +
        (L.obj ? '<p class="small">Задача «' + esc(L.obj.text) + '»: <span class="cr-badge ' + (L.obj.met ? 'ok' : L.obj.met === false ? 'bad' : '') + '">' + (L.obj.met ? 'выполнена' : L.obj.met === false ? 'не выполнена' : 'не сыграл') + '</span></p>' : '') +
        '<p class="small">Опыт <b class="ok">+' + L.xp + '</b>' + (L.sp ? ' · новые очки навыков: <b class="ok">+' + L.sp + '</b>' : '') + '</p></div>';
    }
    h += '<div class="cr-card"><div class="cr-eyebrow">Опыт до очка навыка</div>' + bar(C.pc.xp, 100) + '<p class="small">' + C.pc.xp + '/100 · очков навыка: <b>' + C.pc.sp + '</b></p><button class="btn" data-a="tab" data-v="me">Прокачать игрока</button></div>';
    const tb = table(), my = tb.findIndex(r => r.code === C.team);
    const rows = tb.slice(0, 5); if (my >= 5) rows.push(tb[my]);
    h += '<div class="cr-card"><div class="cr-eyebrow">Таблица</div>' + tableHtml(rows, tb) + '</div>';
    const mails = C.inbox.slice(0, 3);
    h += '<div class="cr-card"><div class="cr-eyebrow">Почта</div>' + (mails.length ? mails.map(m => '<p class="small"><b>' + esc(m.from) + ':</b> ' + esc(m.subject) + (m.actions ? ' <span class="cr-badge">нужно решение</span>' : '') + '</p>').join('') : '<p class="muted small">Писем нет</p>') + '<button class="btn" data-a="tab" data-v="mail">Открыть почту</button></div>';
    return h + '</div>';
  }

  function viewMe() {
    const me = C.players[C.me], a = me.attrs;
    const rows = PC_ATTRS.map(k => {
      const v = Math.round(a[k]), c = upCost(v), can = C.pc.sp >= c && v < 99;
      return '<div class="cr-up"><div><b>' + ATTR[k] + '</b><small>' + ATTR_HINT[k] + '</small></div>' + bar(v, 99) + '<b class="cr-upv">' + v + '</b><button class="btn small ' + (can ? 'primary' : '') + '" data-a="up" data-v="' + k + '"' + (v >= 99 ? ' disabled' : '') + ' title="Стоимость: ' + c + '">+1 · ' + c + '</button></div>';
    }).join('');
    const avg = me.st.apps ? (me.st.rating / me.st.apps).toFixed(2) : '—';
    let h = '<div class="cr-grid two"><div class="cr-card"><div class="cr-eyebrow">Параметры · очков навыка: <b class="' + (C.pc.sp ? 'ok' : '') + '">' + C.pc.sp + '</b></div>' + rows +
      '<p class="small muted">Цена улучшения растёт: до 70 — 1 очко, до 80 — 2, до 88 — 3, до 94 — 4, дальше — 5. Параметры прямо влияют на игру: скорость — на ход в воде, сила броска — на скорость мяча, пас — на то, какой силы передачу ты удержишь.</p></div>';
    h += '<div class="cr-card"><div class="cr-eyebrow">Профиль</div><div class="cr-phead">' + flag(me.nat) + '<div><h2>' + esc(me.full) + '</h2><p class="muted">№' + me.num + ' · ' + WP.ROLE_NAMES[me.role] + ' · ' + me.age + ' лет · ' + me.height + ' см</p></div>' + ovrChip(ovr(me)) + '</div>' +
      '<p class="small">Потенциал: <b>' + potRange(me) + '</b> · стоимость: <b>' + money(value(me)) + '</b></p>' +
      '<p class="small">Опыт: ' + bar(C.pc.xp, 100) + ' ' + C.pc.xp + '/100 · всего ' + C.pc.totalXp + '</p>' +
      '<p class="small">Доверие тренера: ' + bar(C.pc.trust) + ' ' + C.pc.trust + ' · статус: <b>' + STATUS[myStatus()] + '</b></p>' +
      '<p class="small">Сезон: ' + me.st.apps + ' матчей · ' + me.st.goals + ' голов · ' + (me.st.assists || 0) + ' передач · средняя оценка ' + avg + '</p>' +
      '<p class="small">Карьера: ' + me.career.apps + ' матчей · ' + me.career.goals + ' голов · ' + (me.career.assists || 0) + ' передач</p>' +
      (me.injury ? '<p class="bad small">Травма: ещё ' + me.injury + ' ' + plural(me.injury, 'тур', 'тура', 'туров') + '</p>' : '') +
      '<div class="row-btns"><button class="btn" data-a="request">' + (C.pc.requested ? 'Отозвать запрос на трансфер' : 'Попросить трансфер') + '</button></div>' +
      '<p class="small muted">Клубы присылают предложения в зимнее окно (7–8-й тур) и после сезона. Интересуются теми, кто пройдёт в их семёрку.</p></div>';
    if (C.pc.seasons.length) h += '<div class="cr-card wide"><div class="cr-eyebrow">История</div><div class="cr-scroll"><table class="cr-table"><tr><th>Сезон</th><th>Клуб</th><th>Матчи</th><th>Голы</th><th>Передачи</th><th>Оценка</th><th>Рейтинг</th></tr>' +
      C.pc.seasons.map(x => '<tr><td>' + x.year + '/' + String(x.year + 1).slice(2) + '</td><td class="tn">' + flag(x.team) + esc(T(x.team).name) + (x.champ ? ' 🏆' : '') + '</td><td>' + x.apps + '</td><td>' + x.goals + '</td><td>' + x.assists + '</td><td>' + (x.rating || '—') + '</td><td>' + x.ovr + '</td></tr>').join('') + '</table></div></div>';
    return h + '</div>';
  }

  function viewTeamPC() {
    const L = lineup(C.team), starters = [L.gk, ...L.field].filter(Boolean);
    const rot = L.bench.filter(p => p.role !== 'GK').slice(0, 4);
    const list = squad(C.team).sort((a, b) => (b.role === 'GK') - (a.role === 'GK') || ovr(b) - ovr(a));
    let h = '<div class="cr-card wide"><div class="cr-eyebrow">' + esc(T(C.team).name) + ' · сила ' + teamOvr(C.team) + ' · состав выбирает тренер: рейтинг, форма и доверие</div>' +
      '<div class="cr-scroll"><table class="cr-table cr-squad"><tr><th>№</th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Форма</th><th>Роль</th><th>Сезон</th></tr>' +
      list.map(p => {
        const role = p.injury ? '<span class="cr-badge bad">травма</span>' : starters.includes(p) ? '<span class="cr-badge ok">старт</span>' : rot.includes(p) ? '<span class="cr-badge">ротация</span>' : '<span class="muted small">запас</span>';
        return '<tr class="' + (p.id === C.me ? 'me' : '') + '"><td>' + p.num + '</td><td class="tn"><button class="cr-link" data-a="player" data-v="' + p.id + '">' + esc(p.full) + '</button>' + (p.id === C.me ? ' <span class="cr-badge ok">ты</span>' : '') + '</td><td>' + ROLE_SHORT[p.role] + '</td><td>' + p.age + '</td><td>' + ovrChip(ovr(p)) + '</td><td>' + formIcon(p.form) + '</td><td>' + role + '</td><td class="small">' + p.st.apps + ' м · ' + (p.role === 'GK' ? p.st.saves + ' сейв.' : p.st.goals + ' г') + '</td></tr>';
      }).join('') + '</table></div></div>';
    h += '<div class="cr-card wide"><div class="cr-eyebrow">Цели клуба на сезон</div><ul class="cr-obj">' + C.objectives.filter(o => o.kind !== 'youth').map(o => '<li>' + esc(o.text) + objStatus(o) + '</li>').join('') + '</ul></div>';
    return h;
  }

  function renderSetup() {
    const pm = setup.mode === 'player';
    el('crHead').innerHTML = '<div class="cr-club"><div><b>Новая карьера</b><small>Суперлига водного поло · 14 команд</small></div></div><div class="cr-headbtns"><button class="btn" data-a="menu">В меню</button></div>';
    el('crTabs').innerHTML = '';
    // Временная карьера нужна, чтобы посчитать силу команд
    const tmp = C; C = { teams: {}, players: {}, seq: 1, freeAgents: [], academy: [], listed: [] };
    const rows = WP.TEAMS.map(def => { const t = { code: def.code, name: def.name, squad: [], starters: null }; C.teams[def.code] = t; for (const tu of def.players) { const p = fromReal(def, tu); C.players[p.id] = p; t.squad.push(p.id); } return def; });
    const ovrs = {}; for (const d of rows) ovrs[d.code] = teamOvr(d.code);
    C = tmp;
    const order = rows.slice().sort((a, b) => ovrs[b.code] - ovrs[a.code]);
    const hint = (code) => { const r = order.findIndex(d => d.code === code) + 1; return pm ? (r <= 4 ? 'Сильный клуб: пробиться в старт трудно' : r <= 9 ? 'Шанс на игровое время есть' : 'Много игрового времени') : r <= 3 ? 'Цель: чемпионство' : r <= 6 ? 'Цель: полуфинал' : r <= 10 ? 'Цель: плей-офф' : 'Цель: не последнее место'; };
    const modeSeg = '<div class="cr-modes">' + [['player', 'Карьера игрока', 'Свой пловец с 17 лет: играешь только за него, растишь параметры, борешься за место в семёрке'], ['manager', 'Карьера тренера', 'Управляешь клубом: состав, трансферы, тренировки, академия, цели правления']].map(([k, n, d]) => '<button class="cr-opt" data-a="setupMode" data-v="' + k + '" aria-pressed="' + (setup.mode === k) + '"><b>' + n + '</b><small>' + d + '</small></button>').join('') + '</div>';
    const pform = '<div class="cr-form"><label>Имя и фамилия <input id="crName" maxlength="28" placeholder="Например, Алихан Ауданбеков" value="' + esc(setup.name || '') + '"></label>' +
      '<div><span class="muted small">Амплуа</span><div class="seg">' + [['CF', 'Центральный'], ['W', 'Крайний'], ['D', 'Универсал'], ['CB', 'Защитник']].map(([k, n]) => '<button data-a="setupRole" data-v="' + k + '" aria-pressed="' + (setup.role === k) + '">' + n + '</button>').join('') + '</div></div>' +
      '<label>Рост <select id="crHeight">' + [180, 183, 186, 188, 190, 192, 194, 196, 198, 200, 203].map(v => '<option value="' + v + '"' + (v === setup.height ? ' selected' : '') + '>' + v + ' см' + (v >= 196 ? ' · мощь, но медленнее' : v <= 186 ? ' · быстрее, слабее в борьбе' : '') + '</option>').join('') + '</select></label>' +
      '<label>Желаемый номер <select id="crNum">' + [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(v => '<option value="' + v + '"' + (v === setup.num ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>';
    body.innerHTML = '<div class="cr-setup">' + modeSeg + '<p class="muted">' + (pm ? 'Выбери клуб, где начнёшь. В сильной команде расти престижнее, но пробиться в семёрку труднее.' : 'Выберите команду. Сила — средний рейтинг стартовой семёрки.') + ' Карьера сохраняется в этом браузере.</p>' +
      '<div class="cr-teams">' + order.map(d => '<button class="cr-teamcard" data-a="setupTeam" data-v="' + d.code + '" aria-pressed="' + (setup.team === d.code) + '">' + flag(d.code) + '<b>' + esc(d.name) + '</b><span>' + ovrChip(ovrs[d.code]) + '</span><small>' + hint(d.code) + '</small></button>').join('') + '</div>' +
      (pm ? pform : '<div class="cr-form"><label>Имя тренера <input id="crManager" maxlength="28" placeholder="Например, Алихан" value="' + esc(setup.manager || '') + '"></label>') +
      '<div><span class="muted small">Длина периода</span><div class="seg">' + [2, 4, 8].map(n => '<button data-a="setupLen" data-v="' + n + '" aria-pressed="' + (setup.periodMin === n) + '">' + n + ' мин</button>').join('') + '</div></div>' +
      '<div><span class="muted small">Сложность ИИ</span><div class="seg">' + ['Любитель', 'Профи', 'Мировой класс'].map((n, i) => '<button data-a="setupDiff" data-v="' + i + '" aria-pressed="' + (setup.difficulty === i) + '">' + n + '</button>').join('') + '</div></div></div>' +
      '<button class="cta" data-a="start">Начать карьеру</button></div>';
  }

  function fixtureCard(f) {
    const stage = f.stage === 'league' ? 'Суперлига · тур ' + (f.round + 1) : 'Плей-офф · ' + STAGE_NAMES[f.stage];
    const side = (c) => '<div class="cr-fxteam">' + flag(c) + '<b>' + esc(T(c).name) + '</b>' + ovrChip(teamOvr(c)) + '<small>' + (c === C.team ? 'ваша команда' : posOf(c) + '-е место') + '</small></div>';
    return '<div class="cr-card cr-next"><div class="cr-eyebrow">' + stage + (f.stage !== 'league' ? ' · при ничьей — серия пенальти' : '') + '</div><div class="cr-fx">' + side(f.home) + '<span class="cr-vs">vs</span>' + side(f.away) + '</div>' +
      '<div class="row-btns"><button class="btn primary" data-a="play">Играть матч</button><button class="btn" data-a="sim">Симулировать</button></div></div>';
  }

  function viewHome() {
    let h = '<div class="cr-grid">';
    const f = userFixture();
    if (C.phase === 'summary') h += '<div class="cr-card cr-next"><div class="cr-eyebrow">Сезон окончен</div><p>Чемпион — ' + esc(T(C.champion).name) + '.</p><div class="row-btns"><button class="btn primary" data-a="seasonSummary">Итоги сезона</button></div></div>';
    else if (f) h += fixtureCard(f);
    else h += '<div class="cr-card cr-next"><div class="cr-eyebrow">' + stageLabel() + '</div><p>' + (C.phase === 'playoff' ? 'Ваша команда выбыла из плей-офф. Досмотрите турнир.' : 'В этом туре вы не играете.') + '</p><div class="row-btns"><button class="btn primary" data-a="simRound">Симулировать тур</button></div></div>';
    if (C.lastMatch) {
      const lm = C.lastMatch;
      h += '<div class="cr-card"><div class="cr-eyebrow">Последний матч</div><div class="cr-last">' + flag(C.team) + '<b class="cr-score ' + (lm.res === 1 ? 'win' : lm.res === 0 ? 'loss' : '') + '">' + lm.my[0] + ':' + lm.my[1] + (lm.pens ? ' <small>пен. ' + lm.pens[0] + ':' + lm.pens[1] + '</small>' : '') + '</b>' + flag(lm.opp) + '<span>' + esc(T(lm.opp).name) + '</span></div>' +
        '<p class="muted small">Доверие правления ' + (lm.dc >= 0 ? '+' : '') + lm.dc + (lm.prize ? ' · призовые ' + money(lm.prize) : '') + '</p>' +
        (lm.top.length ? '<p class="small">Лучшие: ' + lm.top.map(x => esc(C.players[x.id].full) + ' <b>' + x.r.toFixed(1) + '</b>').join(', ') + '</p>' : '') + '</div>';
    }
    h += '<div class="cr-card"><div class="cr-eyebrow">Цели правления</div><ul class="cr-obj">' + C.objectives.map(o => '<li>' + esc(o.text) + objStatus(o) + '</li>').join('') + '</ul></div>';
    const tb = table();
    const my = tb.findIndex(r => r.code === C.team);
    const rows = tb.slice(0, 5); if (my >= 5) rows.push(tb[my]);
    h += '<div class="cr-card"><div class="cr-eyebrow">Таблица</div>' + tableHtml(rows, tb) + '</div>';
    const mails = C.inbox.slice(0, 3);
    h += '<div class="cr-card"><div class="cr-eyebrow">Почта</div>' + (mails.length ? mails.map(m => '<p class="small"><b>' + esc(m.from) + ':</b> ' + esc(m.subject) + (m.actions ? ' <span class="cr-badge">нужно решение</span>' : '') + '</p>').join('') : '<p class="muted small">Писем нет</p>') + '<button class="btn" data-a="tab" data-v="mail">Открыть почту</button></div>';
    if (C.devLog && C.devLog.length) h += '<div class="cr-card"><div class="cr-eyebrow">Развитие за тур</div><p class="small">' + C.devLog.slice(0, 6).map(x => esc(C.players[x.id].full) + ' <b class="' + (x.d > 0 ? 'ok' : 'bad') + '">' + (x.d > 0 ? '+' : '') + x.d + '</b>').join(' · ') + '</p></div>';
    return h + '</div>';
  }
  function objStatus(o) {
    if (o.kind === 'league') { const p = posOf(C.team); return ' <span class="cr-badge ' + (p <= o.need ? 'ok' : 'bad') + '">сейчас ' + p + '-е</span>'; }
    if (o.kind === 'youth') { const n = Math.max(0, ...squad(C.team).filter(p => p.age <= 21).map(p => p.st.apps), 0); return ' <span class="cr-badge ' + (n >= o.need ? 'ok' : '') + '">' + n + '/' + o.need + '</span>'; }
    return C.stageReached ? ' <span class="cr-badge ok">' + STAGE_NAMES[C.stageReached] + '</span>' : '';
  }
  function tableHtml(rows, full) {
    return '<div class="cr-scroll"><table class="cr-table"><tr><th>#</th><th>Команда</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>Мячи</th><th>О</th></tr>' + rows.map(r => {
      const i = full.indexOf(r) + 1;
      return '<tr class="' + (r.code === C.team ? 'me' : '') + (i === 8 ? ' cut' : '') + '"><td>' + i + '</td><td class="tn">' + flag(r.code) + esc(T(r.code).name) + '</td><td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td><td>' + r.gf + ':' + r.ga + '</td><td><b>' + r.pts + '</b></td></tr>';
    }).join('') + '</table></div>';
  }

  function viewLeague() {
    const tb = table();
    let h = '<div class="cr-grid two"><div class="cr-card"><div class="cr-eyebrow">Регулярный чемпионат · топ-8 выходят в плей-офф</div>' + tableHtml(tb, tb) + '</div>';
    h += '<div class="cr-card"><div class="cr-eyebrow">Ваш календарь</div><div class="cr-cal">' + allFixtures().filter(f => f.home === C.team || f.away === C.team).map(f => {
      const opp = f.home === C.team ? f.away : f.home, home = f.home === C.team;
      const lbl = f.stage === 'league' ? 'Тур ' + (f.round + 1) : STAGE_NAMES[f.stage];
      let r = '—';
      if (f.played) { const my = home ? f.hs : f.as, op = home ? f.as : f.hs; const w = winner(f) === C.team, d = f.hs === f.as && !f.pens; r = '<b class="' + (d ? '' : w ? 'ok' : 'bad') + '">' + my + ':' + op + (f.pens ? ' п' : '') + '</b>'; }
      return '<div class="cr-calrow"><span class="muted">' + lbl + '</span>' + flag(opp) + '<span>' + (home ? '' : '@ ') + esc(T(opp).name) + '</span>' + r + '</div>';
    }).join('') + '</div></div>';
    if (C.playoff) {
      const col = (st) => '<div class="cr-bcol"><div class="cr-eyebrow">' + STAGE_NAMES[st] + '</div>' + (C.playoff.ties[st].length ? C.playoff.ties[st].map(f => '<div class="cr-tie ' + (f.home === C.team || f.away === C.team ? 'me' : '') + '"><span>' + flag(f.home) + esc(T(f.home).name) + '</span><b>' + (f.played ? f.hs : '') + '</b><span>' + flag(f.away) + esc(T(f.away).name) + '</span><b>' + (f.played ? f.as : '') + '</b>' + (f.pens ? '<small>пен. ' + f.pens[0] + ':' + f.pens[1] + '</small>' : '') + '</div>').join('') : '<p class="muted small">ожидание</p>') + '</div>';
      h += '<div class="cr-card wide"><div class="cr-eyebrow">Плей-офф</div><div class="cr-bracket">' + col('QF') + col('SF') + col('F') + '</div></div>';
    }
    if (C.history.length) h += '<div class="cr-card wide"><div class="cr-eyebrow">История карьеры</div>' + C.history.map(x => '<p class="small">' + x.year + '/' + String(x.year + 1).slice(2) + ' · ' + esc(T(x.team).name) + ': ' + x.pos + '-е место' + (x.stage ? ', ' + STAGE_NAMES[x.stage] : '') + ' · чемпион — ' + esc(T(x.champion).name) + (x.champion === x.team ? ' 🏆' : '') + '</p>').join('') + '</div>';
    return h + '</div>';
  }

  function viewSquad() {
    const t = T(C.team), L = lineup(C.team);
    const starters = [L.gk, ...L.field].filter(Boolean);
    const list = squad(C.team).sort((a, b) => (b.role === 'GK') - (a.role === 'GK') || ovr(b) - ovr(a));
    let h = '<div class="cr-card wide"><div class="cr-eyebrow">Заявка: ' + list.length + '/' + MAX_SQUAD + ' · в старте 1 вратарь и 6 полевых · ' + (t.starters ? 'состав выбран вручную' : 'состав выбирается автоматически') + '</div>' +
      '<div class="row-btns" style="margin:0 0 10px"><button class="btn" data-a="autoXI">Лучшая семёрка автоматически</button></div>' +
      '<div class="cr-scroll"><table class="cr-table cr-squad"><tr><th>Старт</th><th>№</th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Потенц.</th><th>Форма</th><th>Мораль</th><th>Сезон</th><th>Цена</th><th></th></tr>' +
      list.map(p => {
        const st = starters.includes(p);
        const status = p.injury ? '<span class="cr-badge bad">травма ' + p.injury + '</span>' : C.listed.includes(p.id) ? '<span class="cr-badge">на продаже</span>' : p.promised ? '<span class="cr-badge">обещан старт</span>' : '';
        return '<tr class="' + (st ? 'me' : '') + '"><td><button class="cr-check" data-a="starter" data-v="' + p.id + '" aria-pressed="' + st + '" aria-label="В старте">' + (st ? '✓' : '') + '</button></td><td>' + p.num + '</td><td class="tn"><button class="cr-link" data-a="player" data-v="' + p.id + '">' + esc(p.full) + '</button> ' + status + '</td><td>' + ROLE_SHORT[p.role] + '</td><td>' + p.age + '</td><td>' + ovrChip(ovr(p)) + '</td><td>' + potRange(p) + '</td><td>' + formIcon(p.form) + '</td><td>' + bar(p.morale) + '</td><td class="small">' + p.st.apps + ' м · ' + (p.role === 'GK' ? p.st.saves + ' сейв.' : p.st.goals + ' г') + '</td><td class="small">' + money(value(p)) + '</td><td><button class="btn small" data-a="player" data-v="' + p.id + '">Профиль</button></td></tr>';
      }).join('') + '</table></div></div>';
    return h;
  }
  const formIcon = (f) => '<span class="cr-form ' + (f > 0.8 ? 'up' : f < -0.8 ? 'down' : '') + '">' + (f > 0.8 ? '▲' : f < -0.8 ? '▼' : '●') + '</span>';

  function showPlayer(pid) {
    const p = C.players[pid], mine = p.team === C.team && !isPC();
    const avg = p.st.apps ? (p.st.rating / p.st.apps).toFixed(2) : '—';
    const attrs = (p.role === 'GK' ? ['gk', 'spd', 'str', 'pas', 'sta'] : PC_ATTRS).map(k => '<div class="cr-attr"><span>' + ATTR[k] + '</span>' + bar(p.attrs[k], 99) + '<b>' + Math.round(p.attrs[k]) + '</b></div>').join('');
    let actions = '';
    if (mine) actions = '<button class="btn" data-a="list" data-v="' + p.id + '">' + (C.listed.includes(p.id) ? 'Снять с продажи' : 'Выставить на трансфер') + '</button><button class="btn" data-a="sellNow" data-v="' + p.id + '">Продать сразу (70%)</button><button class="btn" data-a="release" data-v="' + p.id + '">Расторгнуть</button>';
    else if (isPC()) actions = '';
    else if (p.team) actions = '<button class="btn primary" data-a="offer" data-v="' + p.id + '">Сделать предложение</button>';
    else if (C.freeAgents.includes(p.id)) actions = '<button class="btn primary" data-a="free" data-v="' + p.id + '">Подписать (подъёмные ' + money(Math.round(value(p) * 0.3 / 5) * 5) + ')</button>';
    showModal('<div class="cr-phead">' + flag(p.team || p.nat) + '<div><h2>' + esc(p.full) + '</h2><p class="muted">' + WP.ROLE_NAMES[p.role] + ' · ' + p.age + ' лет' + (p.height ? ' · ' + p.height + ' см' : '') + ' · ' + (p.team ? esc(T(p.team).name) : 'свободный агент') + '</p></div>' + ovrChip(ovr(p)) + '</div>' +
      '<div class="cr-pgrid"><div>' + attrs + '</div><div class="small"><p>Потенциал: <b>' + potRange(p) + '</b></p><p>Стоимость: <b>' + money(value(p)) + '</b></p><p>Мораль: ' + bar(p.morale) + ' · форма ' + formIcon(p.form) + '</p><p>Сезон: ' + p.st.apps + ' матчей, ' + p.st.goals + ' голов' + (p.role === 'GK' ? ', ' + p.st.saves + ' сейвов' : '') + ', ' + p.st.excl + ' удалений · средняя оценка ' + avg + '</p><p>Карьера: ' + p.career.apps + ' матчей, ' + p.career.goals + ' голов</p>' + (p.injury ? '<p class="bad">Травма: ещё ' + p.injury + ' ' + plural(p.injury, 'тур', 'тура', 'туров') + '</p>' : '') + '</div></div>' +
      '<div class="row-btns">' + actions + '<button class="btn" data-a="closeModal">Закрыть</button></div>');
  }

  function showOffer(pid, res) {
    const p = C.players[pid], val = value(p), ask = asking(p);
    const opts = [0.9, 1, 1.15, 1.35, 1.6].map(k => Math.round(val * k / 5) * 5);
    if (res && res.counter && !opts.includes(res.counter)) opts.push(res.counter);
    showModal('<div class="cr-phead">' + flag(p.team) + '<div><h2>Предложение за ' + esc(p.full) + '</h2><p class="muted">' + esc(T(p.team).name) + ' · рыночная оценка ' + money(val) + ' · ваш бюджет ' + money(C.budget) + '</p></div>' + ovrChip(ovr(p)) + '</div>' +
      (C.window ? '' : '<p class="bad">Трансферное окно закрыто: откроется перед 7-м туром и перед новым сезоном.</p>') +
      (res ? '<p class="' + (res.ok ? 'ok' : 'bad') + '">' + res.msg + '</p>' : '<p class="small muted">Выберите сумму. Ключевых игроков клубы отпускают дороже; сильные игроки неохотно идут в слабые команды.</p>') +
      (res && res.ok ? '' : '<div class="row-btns">' + opts.sort((a, b) => a - b).map(o => '<button class="btn ' + (res && res.counter === o ? 'primary' : '') + '" data-a="bid" data-v="' + pid + '|' + o + '"' + (o > C.budget ? ' disabled' : '') + '>' + money(o) + '</button>').join('') + '</div>') +
      '<div class="row-btns"><button class="btn" data-a="closeModal">Закрыть</button></div>');
  }

  function viewTransfers() {
    const role = (el('crFilterRole') || {}).value || 'all', maxv = +((el('crFilterMax') || {}).value || 0);
    const others = Object.values(C.players).filter(p => p.team && p.team !== C.team && (role === 'all' || p.role === role) && (!maxv || value(p) <= maxv)).sort((a, b) => ovr(b) - ovr(a)).slice(0, 60);
    const frees = C.freeAgents.map(id => C.players[id]).filter(p => role === 'all' || p.role === role).sort((a, b) => ovr(b) - ovr(a));
    const row = (p, free) => '<tr><td>' + flag(p.team || p.nat) + '</td><td class="tn"><button class="cr-link" data-a="player" data-v="' + p.id + '">' + esc(p.full) + '</button></td><td>' + ROLE_SHORT[p.role] + '</td><td>' + p.age + '</td><td>' + ovrChip(ovr(p)) + '</td><td>' + potRange(p) + '</td><td class="small">' + (free ? 'подъёмные ' + money(Math.round(value(p) * 0.3 / 5) * 5) : money(value(p))) + '</td><td>' + (free ? '<button class="btn small" data-a="free" data-v="' + p.id + '">Подписать</button>' : '<button class="btn small" data-a="offer" data-v="' + p.id + '">Предложить</button>') + '</td></tr>';
    const selected = (v, cur) => v === cur ? ' selected' : '';
    let h = '<div class="cr-card wide"><div class="cr-eyebrow">Трансферное окно ' + (C.window ? '<b class="ok">открыто</b>' : '<b class="bad">закрыто</b> — свободных агентов можно подписывать всегда') + ' · бюджет ' + money(C.budget) + '</div>' +
      '<div class="cr-filters"><label>Позиция <select id="crFilterRole"><option value="all">все</option>' + Object.keys(ROLE_SHORT).map(r => '<option value="' + r + '"' + selected(r, role) + '>' + WP.ROLE_NAMES[r] + '</option>').join('') + '</select></label>' +
      '<label>Цена до <select id="crFilterMax"><option value="0">любая</option>' + [100, 300, 600, 1000, 2000].map(v => '<option value="' + v + '"' + selected(String(v), String(maxv)) + '>' + money(v) + '</option>').join('') + '</select></label></div>' +
      '<div class="cr-scroll"><table class="cr-table"><tr><th></th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Потенц.</th><th>Цена</th><th></th></tr>' + others.map(p => row(p, false)).join('') + '</table></div></div>';
    h += '<div class="cr-card wide"><div class="cr-eyebrow">Свободные агенты</div><div class="cr-scroll"><table class="cr-table"><tr><th></th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Потенц.</th><th>Цена</th><th></th></tr>' + frees.map(p => row(p, true)).join('') + '</table></div></div>';
    const listed = C.listed.map(id => C.players[id]).filter(p => p && p.team === C.team);
    h += '<div class="cr-card wide"><div class="cr-eyebrow">Ваши игроки на продаже</div>' + (listed.length ? listed.map(p => '<p class="small">' + esc(p.full) + ' · оценка ' + money(value(p)) + ' — предложения придут в почту, пока открыто окно</p>').join('') : '<p class="muted small">Никого. Выставить игрока можно в его профиле на вкладке «Состав».</p>') + '</div>';
    return h;
  }

  function viewTraining() {
    const F = [['balanced', 'Сбалансированно', 'Все качества понемногу'], ['attack', 'Атака', 'Бросок, точность, пас'], ['defense', 'Защита', 'Игра в защите, сила в борьбе'], ['fitness', 'Физподготовка', 'Скорость и сила'], ['gk', 'Вратари', 'Удвоенная работа с вратарями']];
    const I = [['Щадящая', 'рост ×0,7 · травмы реже · мораль не страдает'], ['Обычная', 'рост ×1 · обычный риск'], ['Интенсивная', 'рост ×1,35 · риск травм ×1,6 · мораль −1 за тур']];
    let h = '<div class="cr-grid two"><div class="cr-card"><div class="cr-eyebrow">Упор тренировок</div>' + F.map(([k, n, d]) => '<button class="cr-opt" data-a="focus" data-v="' + k + '" aria-pressed="' + (C.training.focus === k) + '"><b>' + n + '</b><small>' + d + '</small></button>').join('') + '</div>';
    h += '<div class="cr-card"><div class="cr-eyebrow">Нагрузка</div>' + I.map(([n, d], i) => '<button class="cr-opt" data-a="intensity" data-v="' + i + '" aria-pressed="' + (C.training.intensity === i) + '"><b>' + n + '</b><small>' + d + '</small></button>').join('') +
      '<p class="small muted">Рост зависит от возраста и разницы между силой и потенциалом. Игроки до 23 лет растут быстрее всех, после 30 — начинают сдавать. Сыгранные матчи ускоряют развитие почти вдвое.</p></div>';
    h += '<div class="cr-card wide"><div class="cr-eyebrow">Изменения за последний тур</div>' + (C.devLog && C.devLog.length ? '<p class="small">' + C.devLog.map(x => esc(C.players[x.id].full) + ' <b class="' + (x.d > 0 ? 'ok' : 'bad') + '">' + (x.d > 0 ? '+' : '') + x.d + '</b>').join(' · ') + '</p>' : '<p class="muted small">Пока без изменений — сыграйте тур.</p>') + '</div>';
    return h + '</div>';
  }

  function viewAcademy() {
    let h = '<div class="cr-grid two"><div class="cr-card"><div class="cr-eyebrow">Скауты · ' + C.scouts.length + '/2 в командировке</div>' +
      C.scouts.map(s => '<p class="small">' + regionName(s.nat) + ' · ' + (s.role === 'any' ? 'любая позиция' : WP.ROLE_NAMES[s.role]) + ' · вернётся через ' + s.left + ' ' + plural(s.left, 'тур', 'тура', 'туров') + '</p>').join('') +
      (C.scouts.length < 2 ? '<div class="cr-filters"><label>Регион <select id="crScoutNat">' + NATS.map(n => '<option value="' + n + '"' + (n === natOf(C.team) ? ' selected' : '') + '>' + regionName(n) + '</option>').join('') + '</select></label>' +
        '<label>Позиция <select id="crScoutRole"><option value="any">любая</option>' + Object.keys(ROLE_SHORT).map(r => '<option value="' + r + '">' + WP.ROLE_NAMES[r] + '</option>').join('') + '</select></label>' +
        '<label>Срок <select id="crScoutDur"><option value="2">2 тура · ' + money(20) + '</option><option value="4">4 тура · ' + money(40) + '</option><option value="6">6 туров · ' + money(60) + '</option></select></label></div>' +
        '<button class="btn primary" data-a="scout">Отправить скаута</button><p class="small muted">Чем дольше командировка, тем больше и талантливее находки.</p>' : '') + '</div>';
    const shl = C.shortlist.map(id => C.players[id]).filter(Boolean);
    h += '<div class="cr-card"><div class="cr-eyebrow">Находки скаутов</div>' + (shl.length ? '<div class="cr-scroll"><table class="cr-table"><tr><th></th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Потенц.</th><th></th></tr>' + shl.map(p => '<tr><td>' + flag(p.nat) + '</td><td class="tn">' + esc(p.full) + '</td><td>' + ROLE_SHORT[p.role] + '</td><td>' + p.age + '</td><td>' + ovrChip(ovr(p)) + '</td><td>' + potRange(p) + '</td><td><button class="btn small" data-a="signYouth" data-v="' + p.id + '">В академию · ' + money(Math.max(10, 20 + Math.round((p.pot - 70) * 1.5))) + '</button> <button class="btn small" data-a="dropYouth" data-v="' + p.id + '">✕</button></td></tr>').join('') + '</table></div>' : '<p class="muted small">Пока пусто — отправьте скаута.</p>') + '</div>';
    const ac = C.academy.map(id => C.players[id]).filter(Boolean);
    h += '<div class="cr-card wide"><div class="cr-eyebrow">Академия · ' + ac.length + ' ' + plural(ac.length, 'игрок', 'игрока', 'игроков') + '</div>' + (ac.length ? '<div class="cr-scroll"><table class="cr-table"><tr><th></th><th>Игрок</th><th>Поз.</th><th>Возр.</th><th>Сила</th><th>Потенц.</th><th></th></tr>' + ac.map(p => '<tr><td>' + flag(p.nat) + '</td><td class="tn"><button class="cr-link" data-a="player" data-v="' + p.id + '">' + esc(p.full) + '</button></td><td>' + ROLE_SHORT[p.role] + '</td><td>' + p.age + '</td><td>' + ovrChip(ovr(p)) + '</td><td>' + potRange(p) + '</td><td><button class="btn small" data-a="promote" data-v="' + p.id + '">В основу</button> <button class="btn small" data-a="dropYouth" data-v="' + p.id + '">Отчислить</button></td></tr>').join('') + '</table></div>' : '<p class="muted small">Академия пуста.</p>') + '<p class="small muted">Воспитанники растут каждый тур. Если в основе не хватает игроков, академия автоматически закрывает дыры в составе.</p></div>';
    return h + '</div>';
  }

  function viewMail() {
    if (!C.inbox.length) return '<div class="cr-card"><p class="muted">Писем нет.</p></div>';
    return '<div class="cr-card wide">' + C.inbox.map(m => '<div class="cr-mail ' + (m.read ? '' : 'unread') + '"><button class="cr-mailhead" data-a="mail" data-v="' + m.id + '"><span class="muted">' + esc(m.when) + '</span><b>' + esc(m.from) + '</b><span>' + esc(m.subject) + '</span>' + (m.actions ? '<span class="cr-badge">нужно решение</span>' : '') + '</button>' +
      (m.open || m.actions ? '<div class="cr-mailbody">' + m.body + (m.result ? '<p class="ok small">' + m.result + '</p>' : '') + (m.actions ? '<div class="row-btns">' + m.actions.map((a, i) => '<button class="btn ' + (i === 0 ? 'primary' : '') + '" data-a="mailAct" data-v="' + m.id + '|' + i + '">' + esc(a.label) + '</button>').join('') + '</div>' : '') + '</div>' : '') + '</div>').join('') + '</div>';
  }

  function showMatchSummary() {
    const lm = C.lastMatch; if (!lm) return;
    if (isPC() && C.pc.last) {
      const L = C.pc.last, res0 = lm.res === 1 ? 'Победа' : lm.res === 0 ? 'Поражение' : 'Ничья';
      showModal('<div class="cr-eyebrow">' + (lm.stage === 'league' ? 'Суперлига' : 'Плей-офф · ' + STAGE_NAMES[lm.stage]) + '</div><h2>' + res0 + '</h2><div class="cr-last big">' + flag(C.team) + '<b class="cr-score">' + lm.my[0] + ':' + lm.my[1] + (lm.pens ? ' <small>пен. ' + lm.pens[0] + ':' + lm.pens[1] + '</small>' : '') + '</b>' + flag(lm.opp) + '<span>' + esc(T(lm.opp).name) + '</span></div>' +
        (L.played ? '<p>Твоя оценка: <b class="cr-rate">' + L.rating.toFixed(1) + '</b> · голы ' + L.goals + ' · передачи ' + L.assists + ' · отборы ' + L.steals + '</p>' : '<p class="muted">Ты не выходил на воду.</p>') +
        (L.obj ? '<p class="small">Задача тренера «' + esc(L.obj.text) + '»: <span class="cr-badge ' + (L.obj.met ? 'ok' : L.obj.met === false ? 'bad' : '') + '">' + (L.obj.met ? 'выполнена · +50 опыта' : L.obj.met === false ? 'не выполнена' : 'не сыграл') + '</span></p>' : '') +
        '<p class="small">Опыт <b class="ok">+' + L.xp + '</b>' + (L.sp ? ' · очки навыков <b class="ok">+' + L.sp + '</b>' : '') + ' · доверие тренера ' + C.pc.trust + ' · статус: ' + STATUS[myStatus()] + '</p>' +
        '<div class="row-btns">' + (C.pc.sp ? '<button class="btn primary" data-a="goMe">Потратить очки (' + C.pc.sp + ')</button>' : '') + '<button class="btn' + (C.pc.sp ? '' : ' primary') + '" data-a="closeModal">Дальше</button></div>');
      return;
    }
    const res = lm.res === 1 ? 'Победа' : lm.res === 0 ? 'Поражение' : 'Ничья';
    showModal('<div class="cr-eyebrow">' + (lm.stage === 'league' ? 'Суперлига' : 'Плей-офф · ' + STAGE_NAMES[lm.stage]) + '</div><h2>' + res + '</h2><div class="cr-last big">' + flag(C.team) + '<b class="cr-score">' + lm.my[0] + ':' + lm.my[1] + (lm.pens ? ' <small>пен. ' + lm.pens[0] + ':' + lm.pens[1] + '</small>' : '') + '</b>' + flag(lm.opp) + '<span>' + esc(T(lm.opp).name) + '</span></div>' +
      '<p class="small">Доверие правления: ' + (lm.dc >= 0 ? '+' : '') + lm.dc + ' → ' + C.confidence + (lm.prize ? ' · призовые ' + money(lm.prize) : '') + '</p>' +
      (lm.top.length ? '<p class="small">Оценки: ' + lm.top.map(x => esc(C.players[x.id].full) + ' <b>' + x.r.toFixed(1) + '</b>').join(', ') + '</p>' : '') +
      (C.devLog.length ? '<p class="small">Развитие: ' + C.devLog.slice(0, 5).map(x => esc(C.players[x.id].full) + ' <b class="' + (x.d > 0 ? 'ok' : 'bad') + '">' + (x.d > 0 ? '+' : '') + x.d + '</b>').join(' · ') + '</p>' : '') +
      '<div class="row-btns"><button class="btn primary" data-a="closeModal">Дальше</button></div>');
  }

  function showSeasonSummary() {
    const s = C.lastSeason; if (!s) return;
    if (isPC()) {
      const nm = (x) => x ? (x.id === C.me ? '<b class="ok">ты</b>' : esc(C.players[x.id].full)) : '—';
      const me = s.me || {};
      showModal('<div class="cr-eyebrow">Итоги сезона ' + C.year + '/' + String(C.year + 1).slice(2) + '</div><h2>Чемпион — ' + esc(T(s.champion).name) + (s.champion === C.team ? ' 🏆' : '') + '</h2>' +
        '<p>«' + esc(T(C.team).name) + '»: ' + s.pos + '-е место' + (s.stage ? ', плей-офф — ' + STAGE_NAMES[s.stage] : ', без плей-офф') + '.</p>' +
        '<p>Твой сезон: ' + me.apps + ' матчей · ' + me.goals + ' голов · ' + me.assists + ' передач · средняя оценка ' + me.rating + ' · рейтинг ' + me.ovr + '</p>' +
        '<p class="small">Лучший бомбардир: ' + nm(s.scorer) + ' — ' + (s.scorer ? s.scorer.g : 0) + ' голов<br>MVP: ' + nm(s.mvp) + (s.mvp ? ' — ' + s.mvp.r : '') + '</p>' +
        (s.offers.length ? '<p>Предложения клубов:</p><div class="row-btns">' + s.offers.map(c => '<button class="btn" data-a="nextSeason" data-v="' + c + '">' + flag(c) + ' Перейти: ' + esc(T(c).name) + ' (' + teamOvr(c) + ')</button>').join('') + '</div>' : '<p class="muted small">Предложений от других клубов нет.</p>') +
        '<div class="row-btns"><button class="btn primary" data-a="nextSeason" data-v="">Остаться · новый сезон</button></div>');
      return;
    }
    const nm = (x) => x ? esc(C.players[x.id].full) + ' (' + esc(T(C.players[x.id].team || C.team) ? T(C.players[x.id].team || C.team).name : '') + ')' : '—';
    let offers = '';
    if (C.fired) offers = '<p class="bad"><b>Правление уволило вас.</b> Доверие упало до ' + C.confidence + '.</p>' + (s.offers.length ? '<p>Вам предлагают работу:</p><div class="row-btns">' + s.offers.map(c => '<button class="btn primary" data-a="nextSeason" data-v="' + c + '">' + flag(c) + ' ' + esc(T(c).name) + '</button>').join('') + '</div>' : '') + '<div class="row-btns"><button class="btn" data-a="newCareer">Новая карьера</button></div>';
    else offers = (s.offers.length ? '<p>Вашей работой заинтересовались сильные команды:</p><div class="row-btns">' + s.offers.map(c => '<button class="btn" data-a="nextSeason" data-v="' + c + '">Перейти: ' + esc(T(c).name) + '</button>').join('') + '</div>' : '') + '<div class="row-btns"><button class="btn primary" data-a="nextSeason" data-v="">Остаться · новый сезон</button></div>';
    showModal('<div class="cr-eyebrow">Итоги сезона ' + C.year + '/' + String(C.year + 1).slice(2) + '</div><h2>Чемпион — ' + esc(T(s.champion).name) + (s.champion === C.team ? ' 🏆' : '') + '</h2>' +
      '<p>Ваша команда: ' + s.pos + '-е место в регулярке' + (s.stage ? ', плей-офф — ' + STAGE_NAMES[s.stage] : ', без плей-офф') + '.</p>' +
      '<ul class="cr-obj">' + s.objectives.map(o => '<li>' + esc(o.text) + ' <span class="cr-badge ' + (o.met ? 'ok' : 'bad') + '">' + (o.met ? 'выполнено' : 'провал') + '</span></li>').join('') + '</ul>' +
      '<p class="small">Лучший бомбардир: ' + nm(s.scorer) + ' — ' + (s.scorer ? s.scorer.g : 0) + ' голов<br>Лучший вратарь: ' + nm(s.keeper) + ' — ' + (s.keeper ? s.keeper.s : 0) + ' сейвов<br>MVP: ' + nm(s.mvp) + (s.mvp ? ' — средняя оценка ' + s.mvp.r : '') + '</p>' +
      (s.retired.length ? '<p class="small">Завершили карьеру: ' + s.retired.map(esc).join(', ') + '</p>' : '') +
      (s.youth.length ? '<p class="small">Выпуск академии: ' + s.youth.map(esc).join(', ') + '</p>' : '') + offers);
  }

  return {
    open, close, hasSave, finishMatch, matchCfg,
    setHooks(h) { hooks = h; },
    // Тактика, выбранная тренером в матче, запоминается на следующие матчи
    saveTac(t) { if (C && !isPC()) { C.tac = { att: t.att, pp: t.pp, def: t.def, move: t.move, autoSubs: t.autoSubs }; save(); } },
    get state() { return C; },
    get active() { return !!C; },
    _debug: { quickSim, completeRound, userFixture, table, teamOvr, ovr, value, pcOffers, movePC, myStatus },
  };
})();
