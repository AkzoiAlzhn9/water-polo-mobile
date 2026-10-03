// Онлайн: вход через аккаунт claude.ai, лобби открытых матчей, матч один на один по сети.
// Хозяин матча считает игру и ~25 раз в секунду рассылает снимок состояния через presence комнаты;
// гость шлёт свои нажатия (счётчиками, чтобы ни одно не потерялось и не задвоилось) и рисует снимки с интерполяцией.
// Локально (?netmock) вместо комнаты платформы работает BroadcastChannel — можно сыграть в двух вкладках.
// На своём сайте (GitHub Pages) вместо claude.ai — Firebase: вход через Google и комнаты в Realtime Database.
WP.Net = (function () {
  const ACT = ['windup', 'release', 'fake', 'block', 'steal', 'catch', 'celebrate', 'dive', 'drawfoul'];
  const STY = ['over', 'side', 'flick', 'back'];
  const STATES = ['intro', 'sprint', 'live', 'dead', 'goal', 'break', 'final', 'timeout', 'penalty'];
  const CNT = ['pass', 'shootP', 'lob', 'skipP', 'fake', 'foul', 'play', 'sub', 'thru', 'lobpass', 'timeout', 'challenge'];
  const HELD = ['passD', 'shootD', 'skipD', 'foulD', 'thruD', 'fakeD', 'sprintK', 'sprint'];
  const r2 = (v) => Math.round(v * 100) / 100;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let room = null, user = null, db = null, me = null, ready = null, mock = false, fb = null, needLogin = false;
  let hooks = {}, game = null, lobbyUnsub = null, msg = '', stats = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  const pref = { team: localStorage.getItem('polo25_netTeam') || 'AS1', len: +(localStorage.getItem('polo25_netLen') || 4) };

  // ---------- подключение к платформе ----------
  function init() {
    if (ready) return ready;
    ready = (async () => {
      if (/netmock/.test(location.search)) { room = mockRoom(); mock = true; }
      else if (window.claude && typeof window.claude.use === 'function') {
        const [r, u, d] = await Promise.all(['room', 'user', 'db'].map(n => window.claude.use(n).catch(() => null)));
        room = r; user = u; db = d;
      } else if (WP.FIREBASE && WP.FIREBASE.apiKey) {
        try { fb = await fbInit(); } catch (e) { fb = null; msg = 'Не удалось подключить Firebase: ' + (e.message || e); }
        if (fb && fb.auth.currentUser) fbSignedIn(); else if (fb) needLogin = true;
      }
      me = me || (user ? await user.me() : { id: null, name: mock ? mockName() : '', avatarUrl: '', color: '#58c6ff' });
      await loadStats();
      return !!room;
    })();
    return ready;
  }
  function mockName() {
    let n = sessionStorage.getItem('wpNick');
    if (!n) { n = 'Игрок ' + (10 + Math.floor(Math.random() * 89)); sessionStorage.setItem('wpNick', n); }
    return n;
  }

  // ---------- Firebase: вход через Google и комнаты поверх Realtime Database ----------
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('не загрузился ' + src)); document.head.appendChild(el); });
  async function fbInit() {
    const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
    if (!window.firebase) {
      await loadScript(B + 'firebase-app-compat.js');
      await loadScript(B + 'firebase-auth-compat.js');
      await loadScript(B + 'firebase-database-compat.js');
    }
    const app = firebase.initializeApp(WP.FIREBASE);
    const auth = app.auth();
    try { await auth.getRedirectResult(); } catch (e) { /* вход через переадресацию не удался */ }
    await new Promise(res => { const un = auth.onAuthStateChanged(() => { un(); res(); }); });
    // Вернулись после переадресации, но браузер не отдал вход (бывает во встроенных браузерах мессенджеров)
    if (sessionStorage.getItem('wpRedir')) {
      sessionStorage.removeItem('wpRedir');
      if (!auth.currentUser) msg = 'Вход не завершился. Разреши всплывающие окна для этого сайта или открой ссылку в Chrome / Safari и нажми «Войти» ещё раз.';
    }
    return { app, auth, db: app.database() };
  }
  function fbSignedIn() {
    const u = fb.auth.currentUser;
    me = { id: u.uid, name: u.displayName || 'Игрок', avatarUrl: u.photoURL || '', color: '#58c6ff' };
    needLogin = false;
    room = fbRoom();
  }
  async function login() {
    if (!fb) return;
    const prov = new firebase.auth.GoogleAuthProvider();
    try { await fb.auth.signInWithPopup(prov); }
    catch (e) {
      const c = (e && e.code) || '';
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') {
        sessionStorage.setItem('wpRedir', '1'); await fb.auth.signInWithRedirect(prov); return;
      }
      msg = 'Вход не удался: ' + (e.message || c); render(); return;
    }
    fbSignedIn(); await loadStats(); lobbyUnsub = null; start(); render();
  }
  // Без Google: анонимный вход Firebase с именем «Гость NN» (нужно включить в консоли Firebase: Authentication → Anonymous)
  async function loginAnon() {
    if (!fb) return;
    try {
      await fb.auth.signInAnonymously();
      const u = fb.auth.currentUser;
      if (u && !u.displayName) await u.updateProfile({ displayName: 'Гость ' + (10 + Math.floor(Math.random() * 90)) }).catch(() => {});
    } catch (e) {
      const c = (e && e.code) || '';
      msg = /operation-not-allowed|admin-restricted/.test(c) ? 'Вход без Google пока выключен — войди через Google' : 'Не получилось войти: ' + (e.message || c);
      render(); return;
    }
    fbSignedIn(); await loadStats(); lobbyUnsub = null; start(); render();
  }
  async function logout() { if (fb) { await fb.auth.signOut(); location.reload(); } }
  // Комната: rooms/<имя>/peers/<вкладка> = { by, name, photo, p: присутствие }; узел сам удаляется при обрыве связи
  function fbRoom() {
    const fdb = fb.db, u = fb.auth.currentUser, self = Math.random().toString(36).slice(2, 12);
    function api(name) {
      const base = fdb.ref('rooms/' + name + '/peers'), mine = base.child(self);
      let pres = {}, peersMap = new Map(), snap = null, handlers = [], pend = null, lastW = 0, alive = true;
      const write = () => { pend = null; lastW = Date.now(); if (alive) mine.set({ by: u.uid, name: u.displayName || '', photo: u.photoURL || '', p: pres, t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}); };
      // Вернулись в сеть (после WhatsApp и т.п.) — заново занимаем место в комнате
      const conn = fdb.ref('.info/connected');
      const onConn = conn.on('value', (s) => { if (s.val() === true && alive) { mine.onDisconnect().remove(); write(); } });
      function build() {
        if (snap) return snap;
        const arr = [{ peer: self, by: u.uid, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...pres }), updatedAt: Date.now() }];
        for (const [peer, v] of peersMap) arr.push({ peer, by: v.by, isMe: v.by === u.uid, sameTab: false, kind: 'viewer', guest: false, presence: v.presence, updatedAt: v.at });
        return (snap = Object.freeze(arr));
      }
      const onVal = base.on('value', (s) => {
        const val = s.val() || {}, prev = peersMap, joined = [], left = [];
        peersMap = new Map();
        for (const id in val) {
          if (id === self) continue;
          const v = val[id] || {}, key = JSON.stringify(v.p || {}), old = prev.get(id);
          if (v.by && v.name) nameCache[v.by] = v.name;
          peersMap.set(id, old && old.key === key ? old : { by: v.by || null, presence: Object.freeze(v.p || {}), key, at: Date.now() });
          if (!old) joined.push(id);
        }
        for (const id of prev.keys()) if (!peersMap.has(id)) left.push(id);
        snap = null;
        const peers = build();
        for (const h of handlers.slice()) h({ peers, joined: peers.filter(p => joined.includes(p.peer)), left: left.map(id => ({ peer: id })), updated: [] });
      }, (err) => { msg = 'Нет доступа к комнате: ' + (err && err.message); });
      return {
        name,
        presence(patch) {
          for (const k in patch) { if (patch[k] === null) delete pres[k]; else pres[k] = patch[k]; }
          snap = null;
          if (Date.now() - lastW > 40) write(); else if (!pend) pend = setTimeout(write, 40);
          return Promise.resolve();
        },
        peers: build,
        onPeers(fn) { handlers.push(fn); setTimeout(() => fn({ peers: build(), joined: build(), left: [], updated: [] }), 0); return () => { handlers = handlers.filter(h => h !== fn); }; },
        connected: () => true,
        leave() { alive = false; base.off('value', onVal); conn.off('value', onConn); mine.onDisconnect().cancel(); handlers = []; return mine.remove().catch(() => {}); },
      };
    }
    const lobby = api('lobby');
    return { presence: lobby.presence, peers: lobby.peers, onPeers: lobby.onPeers, connected: lobby.connected, join: (n) => Promise.resolve(api(n)) };
  }

  // ---------- статистика онлайн-матчей: в базе (у каждого своя), иначе в браузере ----------
  async function loadStats() {
    try {
      if (fb && me && me.id) { const s = await fb.db.ref('users/' + me.id + '/online').get(); if (s.exists()) Object.assign(stats, s.val()); return; }
    } catch (e) { /* база недоступна */ }
    try {
      if (db && me && me.id) { const s = await db.doc('data/users/' + me.id + '/online').get(); if (s && s.exists) Object.assign(stats, s.data()); return; }
    } catch (e) { /* база недоступна — берём из браузера */ }
    try { Object.assign(stats, JSON.parse(localStorage.getItem('polo25_online') || '{}')); } catch (e) { /* пусто */ }
  }
  async function saveResult(my, opp) {
    stats.gf += my; stats.ga += opp;
    if (my > opp) stats.w++; else if (my < opp) stats.l++; else stats.d++;
    try { localStorage.setItem('polo25_online', JSON.stringify(stats)); } catch (e) { /* нет хранилища */ }
    try { if (db && me && me.id) await db.doc('data/users/' + me.id + '/online').set({ ...stats }); } catch (e) { /* остаётся в браузере */ }
    try { if (fb && me && me.id) await fb.db.ref('users/' + me.id + '/online').set({ ...stats }); } catch (e) { /* остаётся в браузере */ }
  }

  // ---------- имена соперников: только через профили платформы, не из чужих данных ----------
  const nameCache = {};
  async function resolveNames(peers) {
    const ids = peers.map(p => p.by).filter(Boolean);
    if (user && ids.length) { try { const ps = await user.profiles(ids); for (const id of ids) nameCache[id] = (ps[id] && ps[id].name) || ''; } catch (e) { /* без имён */ } }
  }
  const peerName = (p) => (p.by && nameCache[p.by]) || (mock && p.presence && p.presence.nick) || 'Соперник';

  // ---------- лобби ----------
  function openGames() {
    if (!room) return [];
    return room.peers().filter(p => !p.sameTab && p.presence && p.presence.v === 1 && p.presence.host && !p.presence.busy);
  }
  const rndCode = () => Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, 'x');
  const teamDef = (code) => WP.TEAMS.find(t => t.code === code) || WP.TEAMS[0];

  async function hostGame(quick) {
    await init(); if (!room) return;
    const code = rndCode();
    let gr;
    try { gr = await room.join('wp-' + code); } catch (e) { msg = 'Не удалось создать комнату: ' + (e.code || e.message); render(); return; }
    game = { role: 'host', code, room: gr, team: pref.team, len: pref.len, phase: 'wait', guestPeer: null, last: null, gc: 0, seq: 0, lastSnap: 0, bn: null, cd: null, tacKey: '', cur: null, inN: -1, ia: 0, sent: {}, rtt: 0 };
    // Матч быстрого поиска не показываем в «Открытых матчах» — он уже обещан найденному сопернику
    room.presence({ v: 1, host: code, team: pref.team, len: pref.len, busy: quick ? true : null, nick: mock ? me.name : null }).catch(() => {});
    gr.presence({ v: 1, role: 'host', team: pref.team, len: pref.len, phase: 'wait' }).catch(() => {});
    gr.onPeers(onGamePeers, onRoomError);
    msg = ''; render();
  }
  async function onRoomError(e) {
    if (!game || (e && e.code === 'not_permitted')) return;
    const g = game;
    setTimeout(async () => {
      if (game !== g) return;
      try {
        g.room = await room.join('wp-' + g.code);
        g.room.presence(g.role === 'host' ? { v: 1, role: 'host', team: g.team, len: g.len, phase: g.phase === 'play' ? 'play' : 'wait', away: g.away || null } : { v: 1, role: 'guest', team: g.team }).catch(() => {});
        g.room.onPeers(onGamePeers, onRoomError);
      } catch (er) { onRoomError(er); }
    }, 1500);
  }
  async function joinGame(code, autoT) {
    await init(); if (!room) return;
    code = String(code || '').toLowerCase().trim().replace(/^wp-/, '');
    if (!/^[a-z0-9]{3,8}$/.test(code)) { msg = 'Код — 4 латинские буквы или цифры'; render(); return; }
    let gr;
    try { gr = await room.join('wp-' + code); } catch (e) { msg = 'Не удалось войти: ' + (e.code || e.message); render(); return; }
    game = { role: 'guest', code, room: gr, team: pref.team, phase: 'wait', buf: [], seq: -1, lastSend: 0, cnt: CNT.map(() => 0), gc: 0, g: {}, prevSt: null, bnId: 0, cdId: 0, scores: [0, 0], n: 0, sentAt: {}, hist: [], pr: null, off: { x: 0, z: 0 }, rtt: 0 };
    if (autoT) { game.auto = Date.now(); game.autoT = autoT; }
    gr.presence({ v: 1, role: 'guest', team: pref.team, nick: mock ? me.name : null }).catch(() => {});
    gr.onPeers(onGamePeers, onRoomError);
    msg = ''; render();
    // Не сдаёмся: хозяин мог свернуть игру на телефоне — когда вернётся, матч начнётся сам
    const g = game;
    const tick = () => {
      if (game !== g || g.phase !== 'wait') return;
      // Быстрый матч: найденный хозяин так и не начал — ищем дальше
      if (g.auto && Date.now() - g.auto > 12000) { leave().then(() => quickStart(g.autoT)); return; }
      const inLobby = room.peers().some(p => !p.sameTab && p.presence && p.presence.host === code);
      g.note = hostPeer() ? 'Хозяин найден — начинаем…' : inLobby ? 'Хозяин в сети, подключаемся к его матчу…'
        : 'Хозяин матча ' + code.toUpperCase() + ' сейчас не в сети. Пусть откроет игру и держит её на экране (не сворачивает) — матч начнётся сам. Если код неверный, отмени и введи заново.';
      render(); setTimeout(tick, 2000);
    };
    setTimeout(tick, 3000);
  }
  function hostPeer() { return game && game.room ? game.room.peers().find(p => !p.sameTab && p.presence && p.presence.role === 'host') : null; }

  function onGamePeers(ch) {
    if (!game) return;
    if (game.role === 'host') {
      const g = ch.peers.find(p => !p.sameTab && p.presence && p.presence.role === 'guest');
      if (game.phase === 'wait' && g) startAsHost(g);
      // Соперник свернул игру (WhatsApp и т.п.) — не сдаёмся сразу: пауза и ждём до 90 с
      if (game.phase === 'play') {
        if (!g && !game.awayAt && !dcAlive()) { game.awayAt = Date.now(); notice('Соперник свернул игру — пауза, ждём его до 90 с'); }
        if (g && game.awayAt) { game.awayAt = 0; game.guestPeer = g.peer; game.last = null; game.cur = null; game.inN = -1; game.room.presence({ gp: g.peer }).catch(() => {}); notice('Соперник вернулся — играем!'); if (!dcOpen()) rtcOffer(); }
        else if (g) game.guestPeer = g.peer;
        const r = g && g.presence.rtc;
        if (r && r.a && r.id === game.rtcId && game.pc && !game.rtcSet) { game.rtcSet = true; game.pc.setRemoteDescription({ type: 'answer', sdp: r.a }).catch(() => {}); }
      }
    } else {
      const h = ch.peers.find(p => !p.sameTab && p.presence && p.presence.role === 'host');
      if (h && game.phase === 'wait' && h.presence.phase === 'play' && h.presence.away) {
        const mine = game.room.peers().find(p => p.sameTab);
        if (h.presence.gp && mine && h.presence.gp !== mine.peer) {
          // Матч уже начался с другим соперником
          const g = game;
          if (g.auto) leave().then(() => quickStart(g.autoT)); else { msg = 'Этот матч уже начался с другим соперником'; leave().then(render); }
          return;
        }
        startAsGuest(h);
      }
      const r = h && h.presence.rtc;
      if (r && r.o && r.id !== game.rtcId) rtcAnswer(game, r);
      if (game.phase === 'play') {
        if (!h && !game.awayAt && !dcAlive()) { game.awayAt = Date.now(); notice('Хозяин свернул игру — ждём его возвращения'); }
        if (h && game.awayAt) { game.awayAt = 0; notice('Хозяин вернулся — играем!'); }
      }
    }
  }
  function startAsHost(g) {
    let away = g.presence.team && WP.TEAMS.some(t => t.code === g.presence.team) ? g.presence.team : 'AS2';
    if (away === game.team) away = (WP.TEAMS.find(t => t.code !== game.team && t.code !== 'KAZ') || WP.TEAMS[1]).code;
    game.phase = 'play'; game.guestPeer = g.peer; game.away = away;
    game.room.presence({ phase: 'play', away, gp: g.peer }).catch(() => {});
    if (search) quickStop(true);
    room.presence({ busy: true, inv: null, st: 'play' }).catch(() => {});
    closeLobby();
    hooks.start({ home: teamDef(game.team), away: teamDef(away), mode: '1p', humanSide: 0, periodMin: game.len, difficulty: 1, shootout: true, net: { role: 'host', code: game.code } });
    rtcOffer();
  }
  function startAsGuest(h) {
    game.phase = 'play';
    room.presence({ st: 'play' }).catch(() => {});
    closeLobby();
    hooks.start({ home: teamDef(h.presence.team), away: teamDef(h.presence.away), mode: '1p', humanSide: 1, periodMin: h.presence.len || 4, difficulty: 1, shootout: true, net: { role: 'guest', code: game.code } });
  }

  function notice(text) { if (hooks.notice) hooks.notice(text); }
  // Сколько ждём вернувшегося соперника и что показать на экране
  const AWAY_HOST = 90, AWAY_GUEST = 120;
  function status() {
    if (!game || !game.awayAt || game.phase !== 'play') return null;
    const left = (game.role === 'host' ? AWAY_HOST : AWAY_GUEST) - Math.floor((Date.now() - game.awayAt) / 1000);
    return (game.role === 'host' ? 'Соперник вне игры — пауза · ' : 'Хозяин вне игры — ждём · ') + Math.max(0, left) + ' с';
  }
  // Хозяин: пока соперника нет, матч стоит; не вернулся вовремя — за него играет ИИ
  function hostWaiting() {
    if (!game || game.role !== 'host' || game.phase !== 'play' || !game.awayAt) return false;
    // Сервер потерял соперника, но напрямую (P2P) он на связи — играем дальше
    if (dcAlive()) { game.awayAt = 0; return false; }
    if (Date.now() - game.awayAt > AWAY_HOST * 1000) { game.phase = 'solo'; game.awayAt = 0; if (hooks.left) hooks.left('Соперник не вернулся — за его команду играет ИИ'); return false; }
    return true;
  }
  async function copyCode() {
    if (!game) return;
    try { await navigator.clipboard.writeText(game.code.toUpperCase()); msg = 'Код скопирован — отправь его другу'; }
    catch (e) { msg = 'Не получилось скопировать — код: ' + game.code.toUpperCase(); }
    render();
  }

  async function leave() {
    const g = game; game = null;
    if (g) rtcClose(g);
    if (room) room.presence({ host: null, busy: null, inv: null }).catch(() => {});
    if (g && g.room) { try { await g.room.leave(); } catch (e) { /* уже вышли */ } }
  }

  // ---------- хозяин: ввод гостя → p2, снимок состояния → presence ----------
  function attachHost(m) {
    const em = m.emit;
    m.emit = (k, d) => {
      em(k, d);
      if (!game) return;
      if (k === 'banner') game.bn = [(game.bn ? game.bn[0] : 0) + 1, d.title || '', d.sub || '', d.tone || ''];
      if (k === 'card' && d.player) game.cd = [(game.cd ? game.cd[0] : 0) + 1, d.kind, d.team === m.teams[0] ? 0 : 1, d.player.num, d.extra || '', d.reason || ''];
      if (k === 'var' && d.phase === 'start') setTimeout(() => m.resolveChallenge(), 1500);
      if (k === 'final') saveResult(m.teams[0].score, m.teams[1].score);
    };
  }
  function hostInput(m) {
    if (!game || game.role !== 'host' || game.phase !== 'play') return null;
    const g = game.room.peers().find(p => p.peer === game.guestPeer);
    // Ввод гостя идёт двумя путями — напрямую (P2P) и через сервер; берём самый свежий по номеру
    const now = performance.now();
    for (const c of [g && g.presence && g.presence.i, game.dcIn]) if (c && Array.isArray(c.c) && (+c.n || 0) >= game.inN) { if ((+c.n || 0) > game.inN || !game.cur) game.curAt = now; game.cur = c; game.inN = +c.n || 0; }
    const i = game.cur;
    if (!i) return null;
    // Ввод гостя замолчал (свернул игру, пропала связь) — его пловец не плывёт дальше по последнему нажатию
    if (now - game.curAt > 1500) return { x: 0, z: 0, mag: 0 };
    game.ia = +i.n || 0;
    if (i.aq && game.sent[i.aq] && i.aq !== game.aqSeen) { game.aqSeen = i.aq; rttAdd(now - game.sent[i.aq]); }
    const out = { x: +i.x || 0, z: +i.z || 0, mag: Math.min(1, +i.m || 0) };
    if (i.as !== undefined) out.assist = !!i.as;
    HELD.forEach((k, b) => { out[k] = !!(i.h & (1 << b)); });
    const last = game.last || i.c;
    CNT.forEach((k, j) => { out[k] = (+i.c[j] || 0) > (+last[j] || 0); });
    game.last = i.c.map((v, j) => Math.max(+v || 0, +last[j] || 0));
    if (i.gc !== game.gc) { game.gc = i.gc; out.passGest = i.pg || null; out.shootGest = i.sg || null; out.thruUp = !!i.tu; }
    else { out.passGest = null; out.shootGest = null; out.thruUp = false; }
    // Тактика гостя приходит вместе с вводом
    if (i.tac && typeof i.tac === 'object') {
      const key = JSON.stringify(i.tac);
      if (key !== game.tacKey && key.length < 300) { game.tacKey = key; const t = m.teams[1].tac; for (const f of ['att', 'pp', 'def', 'move']) if (typeof i.tac[f] === 'string') t[f] = i.tac[f]; m.teams[1].ai.dirty = true; }
    }
    return out;
  }
  function hostFrame(m) {
    if (!game || game.role !== 'host' || game.phase !== 'play') return;
    const now = performance.now(), dc = dcOpen();
    // Напрямую (P2P) — 30 снимков в секунду; через сервер — 25, а при живом P2P сервер получает лишь раз в секунду про запас
    if (now - game.lastSnap < (dc ? 33 : 40)) return;
    game.lastSnap = now;
    const s = snapshot(m);
    game.sent[s.q] = now; delete game.sent[s.q - 300];
    if (dc) { try { dc.send(JSON.stringify({ s })); } catch (e) { game.dc = null; } }
    if (!dc || now - (game.lastPres || 0) > 1000) { game.lastPres = now; game.room.presence({ s }).catch(() => {}); }
  }
  function snapshot(m) {
    const P = [];
    m.teams.forEach((t, ti) => {
      for (const p of t.players) {
        const a = p.action, at = a ? ACT.indexOf(a.type) : -1;
        const sty = a ? STY.indexOf((a.opts && a.opts.style) || a.style || '') : -1;
        const f = (p.hasBall ? 1 : 0) | (p.excluded ? 2 : 0) | (p.hands ? 4 : 0) | (p.gkHandActive ? 8 : 0) | (p.outForGame ? 16 : 0) | (p.hardTime ? 32 : 0);
        const row = [ti, p.num, r2(p.x), r2(p.z), r2(p.heading), r2(p.lift), r2(p.vx), r2(p.vz), at, at >= 0 ? r2(Math.min(a.t, 9)) : 0, at >= 0 ? r2(Math.min(a.dur, 9)) : 0, sty, f, p.excluded ? Math.ceil(p.exclTimer) : 0];
        if (p.gkHandActive) row.push(r2(p.gkHand.x), r2(p.gkHand.y), r2(p.gkHand.z));
        P.push(row);
      }
    });
    const b = m.ball, h = b.holder;
    const s = {
      q: ++game.seq, t: r2(m.t), st: STATES.indexOf(m.state), cl: Math.round(m.clock * 10) / 10, sc: Math.round(m.shotClock * 10) / 10, pe: m.period,
      sco: [m.teams[0].score, m.teams[1].score], po: m.possession ? m.teams.indexOf(m.possession) : -1,
      b: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), h ? m.teams.indexOf(h.team) : -1, h ? h.num : 0],
      c1: m.controlled.p1 ? m.controlled.p1.num : 0, c2: m.controlled.p2 ? m.controlled.p2.num : 0,
      to: [m.teams[0].timeouts, m.teams[1].timeouts], p: P,
      ia: game.ia || 0, s2: m.controlled.p2 ? r2(m.controlled.p2.stamina) : 1,
    };
    if (game.bn) s.bn = game.bn;
    if (game.cd) s.cd = game.cd;
    if (m.so) s.sos = m.soScore();
    if (game.seq % 25 === 0 || m.state === 'final' || m.state === 'break') s.ts = m.teams.map(t => [t.stats.shots, t.stats.onTarget, t.stats.saves, t.stats.exclEarned, t.stats.ppGoals, t.stats.ppAtt, t.stats.penGoals, t.stats.penEarned, t.stats.steals, t.stats.blocks]);
    if (m.state === 'final' || m.state === 'break') s.ps = m.teams.map(t => t.roster.map(p => [p.num, p.stats.goals, p.stats.assists || 0, p.stats.shots, p.stats.saves, p.stats.steals, p.stats.excl, p.played ? 1 : 0]));
    return s;
  }

  // ---------- гость: рисуем снимки хозяина, шлём свой ввод ----------
  function attachGuest(m) {
    // Гость ничего не считает сам: его матч — только картинка, которую заполняют снимки хозяина
    m.teams[1].human = 'p1'; m.teams[0].human = null;
    m.state = 'intro';
  }
  function guestFrame(m, inp) {
    if (!game || game.role !== 'guest' || !game.room) return;
    const h = hostPeer();
    const s = h && h.presence && h.presence.s;
    if (s) takeSnap(s);
    if (game.phase === 'play' && game.awayAt && Date.now() - game.awayAt > AWAY_GUEST * 1000) { game.phase = 'gone'; if (hooks.left) hooks.left('Хозяин матча так и не вернулся'); return; }
    applyBuffered(m);
    if (game.phase === 'play') predict(m, inp);
    if (inp) collectInput(m, inp);
  }
  // Снимки приходят двумя путями (P2P и сервер) — берём только более новые
  function takeSnap(s) {
    if (!(s.q > game.seq)) return;
    const now = performance.now();
    game.seq = s.q; game.buf.push({ at: now, s }); if (game.buf.length > 10) game.buf.shift();
    if (s.ia && game.sentAt[s.ia] && s.ia !== game.iaSeen) { game.iaSeen = s.ia; rttAdd(now - game.sentAt[s.ia]); }
  }
  function rttAdd(v) { if (game && v > 0 && v < 5000) game.rtt = game.rtt ? game.rtt * 0.85 + v * 0.15 : v; }

  // Свой пловец у гостя: плывёт сразу по нажатию (так же, как его сдвинет хозяин), а снимки хозяина лишь мягко поправляют.
  // Хозяин сообщает номер последнего применённого ввода (ia) — от его позиции заново проигрываем ещё не учтённые нажатия.
  function predict(m, inp) {
    const now = performance.now(), dt = game.pt ? Math.min(0.05, (now - game.pt) / 1000) : 0;
    game.pt = now;
    const hs = game.hist;
    hs.push({ t: now, dt, x: inp ? +inp.x || 0 : 0, z: inp ? +inp.z || 0 : 0, mag: inp ? Math.min(1, +inp.mag || 0) : 0, spr: !!(inp && inp.sprint) });
    while (hs.length > 2 && hs[0].t < now - 1500) hs.shift();
    const L = game.buf.length ? game.buf[game.buf.length - 1].s : null, p = m.controlled.p1;
    const from = L && L.ia ? game.sentAt[L.ia] : 0, st = L ? STATES[L.st] : '';
    const ok = p && from && L.c2 === p.num && !p.excluded && (st === 'live' || (st === 'dead' && !p.hasBall));
    const row = ok ? L.p.find(r => r[0] === 1 && r[1] === p.num) : null;
    if (!row) { game.pr = null; return; }
    if (L.s2 != null) p.stamina = L.s2;
    const ix = p.x, iz = p.z;
    let pr = game.pr;
    if (!pr || pr.num !== p.num) { pr = game.pr = replay(m, p, row, from, p.heading); game.off = { x: ix - pr.x, z: iz - pr.z }; }
    else {
      stepPred(m, p, pr, hs[hs.length - 1]);
      if (pr.q !== L.q) { const n = replay(m, p, row, from, pr.h); game.off.x += pr.x - n.x; game.off.z += pr.z - n.z; pr = game.pr = n; }
    }
    pr.q = L.q;
    const o = game.off, k = Math.exp(-dt * 6);
    o.x *= k; o.z *= k;
    if (Math.hypot(o.x, o.z) > 2.5) { o.x = 0; o.z = 0; }
    p.x = pr.x + o.x; p.z = pr.z + o.z; p.vx = pr.vx; p.vz = pr.vz;
    const sp = Math.hypot(pr.vx, pr.vz);
    if (sp > 0.25 && !(p.hasBall && sp < 0.9)) { const rate = (p.hasBall ? 3.8 : 5.5) * 1.6 * dt, d = WP.angNorm(Math.atan2(pr.vz, pr.vx) - pr.h); pr.h = WP.angNorm(pr.h + Math.max(-rate, Math.min(rate, d))); }
    else pr.h = angLerp(pr.h, p.heading, Math.min(1, dt * 8));
    p.heading = pr.h;
    if (m.ball.holder === p) { m.ball.pos.x += p.x - ix; m.ball.pos.z += p.z - iz; }
  }
  function replay(m, p, row, from, h) {
    const s = { num: p.num, x: row[2], z: row[3], vx: row[6], vz: row[7], h };
    for (const e of game.hist) if (e.t > from) stepPred(m, p, s, e);
    return s;
  }
  // То же, что Player.move для игрока под управлением человека
  function stepPred(m, p, s, e) {
    if (!e || !e.dt) return;
    const mm = p.moveMode; p.moveMode = e.spr ? 'sprint' : 'swim';
    const vmax = p.maxSpeed(); p.moveMode = mm;
    let dx = e.x, dz = e.z;
    const mg = Math.hypot(dx, dz), idle = !p.hasBall && e.mag < 0.12;
    const want = idle ? 0 : Math.min(1, mg) * vmax;
    if (mg > 0.001) { dx /= mg; dz /= mg; }
    const tvx = dx * want, tvz = dz * want, ax = tvx - s.vx, az = tvz - s.vz, am = Math.hypot(ax, az);
    const acc = (want > Math.hypot(s.vx, s.vz) ? 3.0 : 4.5) * (idle ? 1 : 1.6) * (0.8 + 0.4 * p.attrs.spd / 100) * e.dt;
    if (am > acc) { s.vx += ax / am * acc; s.vz += az / am * acc; } else { s.vx = tvx; s.vz = tvz; }
    s.x += s.vx * e.dt; s.z += s.vz * e.dt;
    const b = m.boundsFor(p);
    s.x = Math.max(b.x0, Math.min(b.x1, s.x)); s.z = Math.max(b.z0, Math.min(b.z1, s.z));
  }

  // ---------- прямое соединение двух телефонов (WebRTC); сервер Firebase — только для знакомства и про запас ----------
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const rtcOk = () => !!(fb && window.RTCPeerConnection);
  const dcOpen = () => (game && game.dc && game.dc.readyState === 'open' ? game.dc : null);
  const dcAlive = () => !!(dcOpen() && performance.now() - (game.dcAt || 0) < 2000);
  function waitIce(pc) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, 2500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  function rtcClose(g) { if (g.pc) { try { g.pc.close(); } catch (e) { /* уже закрыто */ } } g.pc = null; g.dc = null; }
  function rtcWire(g, pc, ch) {
    ch.onopen = () => { if (g.pc !== pc) return; g.dc = ch; g.rtcTries = 0; g.room.presence({ rtc: null }).catch(() => {}); };
    ch.onclose = () => { if (g.dc === ch) g.dc = null; };
    ch.onmessage = (e) => {
      if (game !== g) return;
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      g.dcAt = performance.now();
      if (g.awayAt) g.awayAt = 0;
      if (g.role === 'guest' && d.s) takeSnap(d.s);
      if (g.role === 'host' && d.i) g.dcIn = d.i;
    };
    pc.onconnectionstatechange = () => {
      if (g.pc !== pc || !['failed', 'closed'].includes(pc.connectionState)) return;
      g.dc = null;
      // Хозяин пробует соединиться заново, но не бесконечно: дальше игра идёт через сервер
      if (g.role === 'host' && (g.rtcTries || 0) < 3) setTimeout(() => { if (game === g && g.phase === 'play' && !dcOpen()) rtcOffer(); }, 3000);
    };
  }
  async function rtcOffer() {
    const g = game;
    if (!rtcOk() || !g || g.role !== 'host') return;
    rtcClose(g);
    g.rtcTries = (g.rtcTries || 0) + 1;
    const id = (g.rtcId || 0) + 1, pc = new RTCPeerConnection({ iceServers: ICE });
    g.rtcId = id; g.pc = pc; g.rtcSet = false;
    try {
      rtcWire(g, pc, pc.createDataChannel('g', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      if (game === g && g.pc === pc) g.room.presence({ rtc: { id, o: pc.localDescription.sdp } }).catch(() => {});
    } catch (e) { if (g.pc === pc) rtcClose(g); }
  }
  async function rtcAnswer(g, r) {
    if (!rtcOk()) return;
    rtcClose(g);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    g.rtcId = r.id; g.pc = pc;
    pc.ondatachannel = (e) => rtcWire(g, pc, e.channel);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: r.o });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      if (game === g && g.pc === pc) g.room.presence({ rtc: { id: r.id, a: pc.localDescription.sdp } }).catch(() => {});
    } catch (e) { if (g.pc === pc) rtcClose(g); }
  }
  // Для плашки в матче: как идёт связь и какая задержка
  function info() {
    if (!game || game.phase !== 'play') return null;
    return { p2p: !!dcOpen(), rtt: Math.round(game.rtt || 0) };
  }
  function collectInput(m, inp) {
    CNT.forEach((k, j) => { if (inp[k]) game.cnt[j]++; });
    if (inp.passGest || inp.shootGest || inp.thruUp) { game.gc++; game.g = { pg: inp.passGest || null, sg: inp.shootGest || null, tu: !!inp.thruUp }; }
    const now = performance.now(), dc = dcOpen();
    if (now - game.lastSend < (dc ? 16 : 33)) return;
    game.lastSend = now;
    let hb = 0; HELD.forEach((k, b) => { if (inp[k]) hb |= 1 << b; });
    const t = m.teams[1].tac, n = ++game.n;
    game.sentAt[n] = now; delete game.sentAt[n - 400];
    const i = { n, aq: game.seq > 0 ? game.seq : 0, as: WP.Input.opts.assist ? 1 : 0, x: r2(inp.x || 0), z: r2(inp.z || 0), m: r2(inp.mag || 0), h: hb, c: game.cnt.slice(), gc: game.gc, pg: game.g.pg || null, sg: game.g.sg || null, tu: !!game.g.tu, tac: { att: t.att, pp: t.pp, def: t.def, move: t.move } };
    if (dc) { try { dc.send(JSON.stringify({ i })); } catch (e) { game.dc = null; } }
    if (!dc || now - (game.lastPres || 0) > 250) { game.lastPres = now; game.room.presence({ i }).catch(() => {}); }
  }
  // Рисуем с задержкой ~100 мс между двумя снимками — движение плавное даже при неровной сети
  function applyBuffered(m) {
    const buf = game.buf; if (!buf.length) return;
    const rt = performance.now() - 100;
    let a = buf[0], b = buf[buf.length - 1], k = 1;
    for (let i = buf.length - 1; i > 0; i--) { if (buf[i - 1].at <= rt) { a = buf[i - 1]; b = buf[i]; k = Math.max(0, Math.min(1, (rt - a.at) / Math.max(1, b.at - a.at))); break; } }
    applySnap(m, a.s, b.s, k);
  }
  const angLerp = (x, y, k) => x + WP.angNorm(y - x) * k;
  function syncRosters(m, s) {
    m.teams.forEach((t, ti) => {
      const want = new Set(s.p.filter(r => r[0] === ti).map(r => r[1]));
      for (const num of want) {
        if (t.players.some(p => p.num === num)) continue;
        const inn = t.bench.find(p => p.num === num); if (!inn) continue;
        const out = t.players.find(p => !want.has(p.num));
        if (out) m.swap(t, out, inn);
      }
    });
  }
  function applySnap(m, sa, sb, k) {
    syncRosters(m, sb);
    const rowsA = {}; for (const r of sa.p) rowsA[r[0] * 100 + r[1]] = r;
    for (const r of sb.p) {
      const t = m.teams[r[0]], p = t.players.find(q => q.num === r[1]); if (!p) continue;
      const o = rowsA[r[0] * 100 + r[1]] || r;
      p.x = o[2] + (r[2] - o[2]) * k; p.z = o[3] + (r[3] - o[3]) * k;
      p.heading = angLerp(o[4], r[4], k); p.lift = o[5] + (r[5] - o[5]) * k;
      p.vx = r[6]; p.vz = r[7];
      const f = r[12];
      p.hasBall = !!(f & 1); p.excluded = !!(f & 2); p.hands = !!(f & 4); p.gkHandActive = !!(f & 8); p.outForGame = !!(f & 16); p.hardTime = !!(f & 32); p.exclTimer = r[13];
      if (r[8] >= 0) {
        const type = ACT[r[8]], style = STY[r[11]] || 'over';
        if (!p.action || p.action.type !== type) p.action = { type, t: r[9], dur: r[10] || 0.3, ai: true, opts: { style }, style };
        else { p.action.t = r[9]; p.action.dur = r[10] || p.action.dur; }
      } else p.action = null;
      if (f & 8 && r.length >= 17) p.gkHand.set(r[14], r[15], r[16]);
    }
    // Мяч
    const ball = m.ball, ba = sa.b, bb = sb.b;
    const x = ba[0] + (bb[0] - ba[0]) * k, y = ba[1] + (bb[1] - ba[1]) * k, z = ba[2] + (bb[2] - ba[2]) * k;
    ball.vel.set((x - ball.pos.x) * 60, (y - ball.pos.y) * 60, (z - ball.pos.z) * 60);
    ball.pos.set(x, y, z);
    if (bb[3] >= 0) { const hp = m.teams[bb[3]].players.find(q => q.num === bb[4]); ball.holder = hp || null; ball.state = hp ? 'held' : 'free'; }
    else { ball.holder = null; ball.state = 'free'; }
    // Табло, состояние, управляемые игроки
    const st = STATES[sb.st] || 'live';
    m.t = sb.t; m.clock = sb.cl; m.shotClock = sb.sc; m.period = sb.pe;
    m.possession = sb.po >= 0 ? m.teams[sb.po] : null;
    if (sb.to) { m.teams[0].timeouts = sb.to[0]; m.teams[1].timeouts = sb.to[1]; }
    if (sb.sos) { m.so = m.so || { net: true }; m.soScore = () => sb.sos; } else m.so = null;
    const mine = m.teams[1].players.find(q => q.num === sb.c2), theirs = m.teams[0].players.find(q => q.num === sb.c1);
    for (const t of m.teams) for (const p of t.players) p.ctrl = null;
    if (mine) mine.ctrl = 'p1';
    if (theirs) theirs.ctrl = 'p2';
    m.controlled.p1 = mine || null; m.controlled.p2 = theirs || null;
    if (sb.ts) m.teams.forEach((t, i) => { const v = sb.ts[i]; Object.assign(t.stats, { shots: v[0], onTarget: v[1], saves: v[2], exclEarned: v[3], ppGoals: v[4], ppAtt: v[5], penGoals: v[6], penEarned: v[7], steals: v[8], blocks: v[9] }); });
    if (sb.ps) m.teams.forEach((t, i) => { for (const row of sb.ps[i] || []) { const p = t.roster.find(q => q.num === row[0]); if (p) { Object.assign(p.stats, { goals: row[1], assists: row[2], shots: row[3], saves: row[4], steals: row[5], excl: row[6] }); p.played = !!row[7]; } } });
    // События: голы, баннеры, карточки, перерывы, финал
    if (sb.sco[0] !== game.scores[0] || sb.sco[1] !== game.scores[1]) { game.scores = sb.sco.slice(); m.teams[0].score = sb.sco[0]; m.teams[1].score = sb.sco[1]; WP.Audio.cheer(true); WP.Audio.net(); }
    if (sb.bn && sb.bn[0] !== game.bnId) { game.bnId = sb.bn[0]; m.emit('banner', { title: sb.bn[1], sub: sb.bn[2], tone: sb.bn[3] }); WP.Audio.whistle('short'); }
    if (sb.cd && sb.cd[0] !== game.cdId) {
      game.cdId = sb.cd[0];
      const t = m.teams[sb.cd[2]], p = t.roster.find(q => q.num === sb.cd[3]);
      if (p) m.emit('card', { kind: sb.cd[1], player: p, team: t, extra: sb.cd[4], reason: sb.cd[5] });
    }
    if (st !== game.prevSt) {
      if (st === 'break') { WP.Audio.horn(); m.state = st; m.emit('break', { period: m.period, shootout: false, net: true }); }
      if (st === 'final' && game.prevSt !== null) { WP.Audio.horn(); m.state = st; m.emit('final', {}); saveResult(sb.sco[1], sb.sco[0]); }
      game.prevSt = st;
    }
    m.state = st;
  }

  // ---------- лобби: интерфейс ----------
  // Сразу после открытия игры: заявляем, что ты в игре, и слушаем лобби — кто в сети, кто зовёт на матч
  let myStatus = 'menu', handledInv = {};
  function start() {
    init().then(() => {
      if (!room || lobbyUnsub) return;
      room.presence({ v: 1, st: myStatus, team: pref.team, len: pref.len }).catch(() => {});
      lobbyUnsub = room.onPeers(async (ch) => { await resolveNames(ch.peers); onLobby(); });
    });
  }
  function setStatus(st) { myStatus = st; if (st === 'solo') quickStop(true); if (room) room.presence({ v: 1, st }).catch(() => {}); badge(); }
  const myPeer = () => { const p = room && room.peers().find(q => q.sameTab); return p ? p.peer : null; };
  // Другие люди с открытой игрой (вкладка — один участник; твоё другое устройство тоже считается)
  const othersOnline = () => (room ? room.peers().filter(p => !p.sameTab && p.presence && p.presence.v === 1) : []);
  function badge() {
    const b = $('btnOnline'); if (!b) return;
    const n = othersOnline().length;
    b.innerHTML = 'Онлайн' + (search ? ' <span class="on-badge">ищем соперника…</span>' : n ? ' <span class="on-badge">' + n + ' в сети</span>' : '');
  }
  function onLobby() {
    badge();
    const me1 = myPeer();
    for (const p of othersOnline()) {
      const pr = p.presence;
      // Меня позвали на матч
      if (pr.inv && pr.inv.to === me1 && pr.inv.code && !handledInv[pr.inv.code] && !(game && game.phase === 'play')) {
        handledInv[pr.inv.code] = true;
        // Пара из быстрого поиска — входим сами, без вопросов
        if (pr.inv.auto) { if (search && !game) { const t = search.t; quickStop(true); if (hooks.beforeJoin) hooks.beforeJoin(); joinGame(pr.inv.code, t); } }
        else showInvite(p);
      }
      // Мой вызов отклонили
      if (game && game.role === 'host' && game.phase === 'wait' && pr.decl && pr.decl.to === me1 && pr.decl.code === game.code) {
        msg = peerName(p) + ' отказался от матча'; leave().then(render);
      }
    }
    if (search) matchTick();
    else if (!$('online').hidden) render();
  }

  // ---------- быстрый матч: случайный соперник из тех, кто сейчас ищет ----------
  // Ищущие сортируются по времени начала поиска; пару составляют двое самых давних: первый создаёт матч и зовёт второго.
  // Ушли в матч — следующая пара. Действуем, только когда список ищущих уже секунду не менялся (все видят одно и то же).
  let search = null;
  function quickStart(t) {
    if (!room || game) return;
    search = { t: t || Date.now(), skip: {}, partner: null, since: 0 };
    room.presence({ v: 1, q: search.t, team: pref.team, len: pref.len, host: null, busy: null, inv: null }).catch(() => {});
    badge(); render(); matchTick();
  }
  function quickStop(silent) {
    if (!search) return;
    search = null; clearTimeout(matchTick.t);
    if (room) room.presence({ q: null }).catch(() => {});
    badge(); if (!silent) render();
  }
  const searchers = () => othersOnline().filter(p => p.presence.q && !p.presence.busy && !p.presence.host && p.presence.st !== 'play' && !(search.skip[p.peer] > Date.now()));
  async function matchTick() {
    if (!search || !room) return;
    clearTimeout(matchTick.t); matchTick.t = setTimeout(matchTick, 1000);
    if (!$('online').hidden) render();
    if (game) {
      // Позвал пару, а она не пришла — снова в поиск, а этого соперника пока пропускаем
      if (game.role === 'host' && game.auto && game.phase === 'wait' && Date.now() - game.auto > 10000) {
        search.skip[game.autoPeer] = Date.now() + 15000;
        await leave();
        if (search) room.presence({ v: 1, q: search.t, host: null, busy: null, inv: null }).catch(() => {});
      }
      return;
    }
    const me1 = myPeer(); if (!me1) return;
    const list = [{ peer: me1, t: search.t }].concat(searchers().map(p => ({ peer: p.peer, t: +p.presence.q })));
    list.sort((a, b) => a.t - b.t || (a.peer < b.peer ? -1 : 1));
    const sig = list.map(x => x.peer).join(','), now = Date.now();
    if (sig !== search.sig) { search.sig = sig; search.sigAt = now; }
    const i = list.findIndex(x => x.peer === me1);
    if (i > 1 || list.length < 2 || now - search.sigAt < 1200) { search.partner = null; return; }
    const partner = list[1 - i];
    if (search.partner !== partner.peer) { search.partner = partner.peer; search.since = now; }
    if (i === 0) quickHost(partner.peer);
    // Второй ждёт приглашения от первого; не дождался — пропускаем его ненадолго
    else if (now - search.since > 8000) { search.skip[partner.peer] = now + 15000; search.partner = null; }
  }
  async function quickHost(peer) {
    if (quickHost.busy) return;
    quickHost.busy = true;
    try {
      await hostGame(true);
      if (!game || game.role !== 'host' || !search) { if (game && !search) await leave(); return; }
      game.auto = Date.now(); game.autoPeer = peer;
      room.presence({ q: null, inv: { to: peer, code: game.code, team: game.team, len: game.len, auto: 1 } }).catch(() => {});
    } finally { quickHost.busy = false; }
  }

  function showInvite(p) {
    const T = teamDef(p.presence.inv.team || p.presence.team);
    const box = $('netInvite');
    box.innerHTML = '<div class="card"><h3>Вызов на матч</h3><p><b></b> зовёт сыграть онлайн: ' + WP.flag(T.code) + ' ' + esc(T.name) + ' · ' + (+p.presence.inv.len || 4) + ' мин</p><div class="row-btns"><button class="btn primary" data-inv="yes">Принять</button><button class="btn" data-inv="no">Отказаться</button></div></div>';
    box.querySelector('b').textContent = peerName(p);
    box.hidden = false;
    WP.Audio.whistle('short');
    box.onclick = (e) => {
      const b = e.target.closest('[data-inv]'); if (!b) return;
      box.hidden = true;
      if (b.dataset.inv === 'yes') { if (hooks.beforeJoin) hooks.beforeJoin(); openLobby(); joinGame(p.presence.inv.code); }
      else room.presence({ decl: { to: p.peer, code: p.presence.inv.code } }).catch(() => {});
    };
    clearTimeout(showInvite.t); showInvite.t = setTimeout(() => { box.hidden = true; }, 45000);
  }
  async function invite(peer) {
    await init(); if (!room) return;
    if (game) await leave();
    await hostGame();
    if (game && game.role === 'host') room.presence({ inv: { to: peer, code: game.code, team: game.team, len: game.len } }).catch(() => {});
    msg = 'Вызов отправлен — ждём ответа'; render();
  }
  function openLobby() {
    $('online').hidden = false;
    msg = ''; render();
    start();
    init().then(render);
  }
  function closeLobby() { $('online').hidden = true; }
  function render() {
    const el = $('onBody'); if (!el) return;
    const T = teamDef(pref.team);
    let h = '';
    if (!ready) h += '<p class="muted">Подключаемся…</p>';
    // Аккаунт
    if (ready && needLogin) {
      h += '<div class="on-acc"><div><b>Войди, чтобы играть онлайн</b><small>Через Google — имя и фото возьмутся из аккаунта, статистика сохранится. Без входа — сыграешь как «Гость».</small></div></div><div class="row-btns"><button class="btn primary" data-net="login">Войти через Google</button><button class="btn" data-net="anon">Играть без входа</button></div>';
      if (msg) h += '<p class="tac-msg">' + esc(msg) + '</p>';
      el.innerHTML = h; return;
    }
    if (me && (me.name || me.id)) {
      h += '<div class="on-acc">' + (me.avatarUrl ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(me.avatarUrl) + '">' : '<span class="on-av" style="background:' + esc(me.color) + '"></span>') +
        '<div><b>' + esc(me.name || 'Вы') + '</b><small>' + (fb ? (fb.auth.currentUser && fb.auth.currentUser.isAnonymous ? 'Гость, без входа' : 'Вход через Google') : 'Вход через аккаунт claude.ai') + ' · онлайн: ' + stats.w + ' побед, ' + stats.d + ' ничьих, ' + stats.l + ' поражений</small></div>' + (fb ? '<button class="btn small" data-net="logout">Выйти</button>' : '') + '</div>';
    } else if (ready && window.claude && window.claude.use) {
      h += '<div class="on-acc warn"><div><b>Вход не выполнен</b><small>Онлайн-матчи доступны тем, кто вошёл в claude.ai и кого владелец пригласил в игру по почте.</small></div></div>';
    }
    if (ready && !room) {
      // Страница открыта внутри claude.ai, но комната не выдана — значит, зашли по публичной ссылке или без входа
      const inClaude = !!(window.claude && window.claude.use);
      if (!inClaude && !mock) { h += '<p class="tac-msg">' + esc(msg || 'Онлайн на этом сайте ещё настраивается (нужен проект Firebase).') + '</p>'; el.innerHTML = h; return; }
      h += inClaude
        ? '<div class="on-steps"><b>Ты открыл игру по публичной ссылке</b> — по ней claude.ai не пускает в онлайн-комнаты. Чтобы играть по сети:<ol><li>Владелец игры: «Поделиться» (Share) → добавить твою почту и дать доступ выше «Can view».</li><li>Ты: войди в claude.ai с этой почтой.</li><li>Открой игру заново по ссылке из приглашения — здесь появится твоё имя и список матчей.</li></ol><span class="muted small">Против ИИ, карьера и обучение работают и так.</span></div>'
        : '<p class="tac-msg">Онлайн работает только в версии игры на claude.ai (не в локальном файле).</p>';
      el.innerHTML = h; return;
    }
    // Кто сейчас в сети (помогает понять, видите ли вы друг друга)
    if (room) {
      const others = othersOnline();
      const ST = { menu: 'в меню', wait: 'ждёт соперника', play: 'в матче', solo: 'играет один', search: 'ищет соперника' };
      h += '<div class="tac-sec"><div class="tac-lbl">Сейчас в сети · ' + (others.length + 1) + '</div>' + (others.length ? others.slice(0, 20).map(p => {
        const pr = p.presence, free = !pr.busy && pr.st !== 'play' && !(game && game.phase === 'play');
        return '<div class="on-game"><span class="on-dot"></span><span><b>' + esc(p.isMe ? 'Ты (другое устройство)' : peerName(p)) + '</b><small>' + (ST[pr.q ? 'search' : pr.st === 'play' || pr.busy ? 'play' : pr.host ? 'wait' : pr.st] || 'в игре') + '</small></span>' +
          (free ? '<button class="btn small primary" data-net="invite" data-v="' + esc(p.peer) + '">Позвать на матч</button>' : '') + '</div>';
      }).join('') + (others.length > 20 ? '<p class="small muted">и ещё ' + (others.length - 20) + '</p>' : '') : '<p class="small muted">Пока никого. Попроси друга открыть игру — он появится здесь, и его можно будет позвать на матч без кодов.</p>') + '</div>';
    }
    // Ожидание соперника
    if (game && game.role === 'host' && game.phase === 'wait') {
      h += '<div class="on-wait"><small>Код матча</small><b>' + esc(game.code.toUpperCase()) + '</b><p>Ждём соперника. Код вводить не обязательно — друг увидит твой матч в списке «Открытые матчи». Если всё-таки уходишь в WhatsApp, матч не пропадёт: когда вернёшься, он начнётся.</p><div class="row-btns" style="justify-content:center"><button class="btn primary" data-net="copy">Скопировать код</button><button class="btn" data-net="cancel">Отменить матч</button></div></div>';
    } else if (game && game.role === 'guest' && game.phase === 'wait') {
      h += '<div class="on-wait"><small>Подключаемся к матчу</small><b>' + esc(game.code.toUpperCase()) + '</b><p>' + esc(game.note || 'Ищем хозяина матча…') + '</p><button class="btn" data-net="cancel">Отменить</button></div>';
    } else if (search) {
      const n = searchers().length, sec = Math.floor((Date.now() - search.t) / 1000);
      h += '<div class="on-wait"><small>Быстрый матч</small><b>Ищем соперника… ' + sec + ' с</b><p>' + (n ? 'Сейчас ищут: ' + (n + 1) + ' — подбираем пару.' : 'Пока ищешь только ты. Можно закрыть это окно и играть в меню — как найдём соперника, матч начнётся сам.') + '</p><button class="btn" data-net="qstop">Отменить поиск</button></div>';
    } else {
      h += '<div class="row-btns" style="justify-content:center"><button class="btn primary big" data-net="quick">Быстрый матч</button></div><p class="small muted" style="text-align:center;margin-top:-4px">Случайный соперник из тех, кто сейчас в игре</p>';
      h += '<div class="tac-sec"><div class="tac-lbl">Твоя команда</div><div class="on-team"><button class="btn small" data-net="prev">‹</button><span>' + WP.flag(T.code) + ' <b>' + esc(T.name) + '</b></span><button class="btn small" data-net="next">›</button></div></div>' +
        '<div class="tac-sec"><div class="tac-lbl">Длина периода</div><div class="seg">' + [2, 4, 8].map(n => '<button data-net="len" data-v="' + n + '" aria-pressed="' + (pref.len === n) + '">' + n + ' мин</button>').join('') + '</div></div>' +
        '<div class="row-btns"><button class="btn" data-net="host">Создать матч</button></div>' +
        '<div class="tac-sec"><div class="tac-lbl">Войти по коду</div><div class="on-code"><input id="onCode" maxlength="8" placeholder="например k3v6" autocomplete="off"><button class="btn" data-net="join">Войти</button></div></div>';
      const games = openGames();
      h += '<div class="tac-sec"><div class="tac-lbl">Открытые матчи</div>' + (games.length ? games.map(p => { const gt = teamDef(p.presence.team); return '<div class="on-game">' + WP.flag(gt.code) + '<span><b>' + esc(peerName(p)) + '</b><small>' + esc(gt.name) + ' · ' + (+p.presence.len || 4) + ' мин · код ' + esc(String(p.presence.host).toUpperCase()) + '</small></span><button class="btn small primary" data-net="play" data-v="' + esc(p.presence.host) + '">Играть</button></div>'; }).join('') : '<p class="small muted">Пока никто не ждёт соперника — создай матч сам.</p>') + '</div>';
    }
    if (msg) h += '<p class="tac-msg">' + esc(msg) + '</p>';
    el.innerHTML = h;
  }
  function bindUi() {
    $('onClose').addEventListener('click', () => closeLobby());
    // Вернулись на вкладку (после WhatsApp и т.п.) — заново заявляем о себе в лобби и в комнате
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !room || !game) return;
      if (game.role === 'host' && game.phase === 'wait') { room.presence({ v: 1, host: game.code, team: game.team, len: game.len, busy: null }).catch(() => {}); game.room.presence({ v: 1, role: 'host', team: game.team, len: game.len, phase: 'wait' }).catch(() => {}); }
      if (game.role === 'guest' && game.phase === 'wait') game.room.presence({ v: 1, role: 'guest', team: game.team }).catch(() => {});
      if (game.phase === 'play') game.room.presence(game.role === 'host' ? { v: 1, role: 'host', team: game.team, len: game.len, phase: 'play', away: game.away } : { v: 1, role: 'guest', team: game.team }).catch(() => {});
    });
    $('onBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-net]'); if (!b) return;
      const a = b.dataset.net;
      if (a === 'prev' || a === 'next') {
        const n = WP.TEAMS.length, i = WP.TEAMS.findIndex(t => t.code === pref.team);
        pref.team = WP.TEAMS[(i + (a === 'next' ? 1 : -1) + n) % n].code; localStorage.setItem('polo25_netTeam', pref.team); render();
      }
      if (a === 'len') { pref.len = +b.dataset.v; localStorage.setItem('polo25_netLen', pref.len); render(); }
      if (a === 'host') hostGame();
      if (a === 'copy') copyCode();
      if (a === 'login') login();
      if (a === 'anon') loginAnon();
      if (a === 'quick') quickStart();
      if (a === 'qstop') quickStop();
      if (a === 'logout') logout();
      if (a === 'invite') invite(b.dataset.v);
      if (a === 'cancel') { leave().then(render); }
      if (a === 'join') joinGame(($('onCode') || {}).value);
      if (a === 'play') joinGame(b.dataset.v);
    });
  }

  // ---------- локальная подмена комнаты для проверки в двух вкладках ----------
  function mockRoom() {
    const ch = new BroadcastChannel('wp-netmock');
    const self = Math.random().toString(36).slice(2, 10);
    const rooms = {};
    const R0 = (name) => rooms[name] || (rooms[name] = { name, peers: new Map(), mine: {}, handlers: [], snap: null, joined: false });
    function snap(R) {
      if (R.snap) return R.snap;
      const arr = [{ peer: self, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...R.mine }), updatedAt: Date.now() }];
      for (const [peer, v] of R.peers) arr.push({ peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: v.presence, updatedAt: v.at });
      return (R.snap = Object.freeze(arr));
    }
    function notify(R, joined, left) { R.snap = null; const peers = snap(R); for (const h of R.handlers.slice()) h({ peers, joined, left, updated: [] }); }
    const send = (R) => ch.postMessage({ t: 'p', room: R.name, peer: self, presence: R.mine });
    ch.onmessage = (e) => {
      const d = e.data, R = rooms[d.room]; if (!R || !R.joined) return;
      if (d.t === 'p') { const had = R.peers.has(d.peer); R.peers.set(d.peer, { presence: Object.freeze(d.presence), at: Date.now() }); R.snap = null; notify(R, had ? [] : snap(R).filter(p => p.peer === d.peer), []); }
      else if (d.t === 'hello') send(R);
      else if (d.t === 'bye' && R.peers.delete(d.peer)) notify(R, [], [{ peer: d.peer }]);
    };
    setInterval(() => { const now = Date.now(); for (const n in rooms) { const R = rooms[n]; if (!R.joined) continue; send(R); for (const [p, v] of R.peers) if (now - v.at > 4000) { R.peers.delete(p); notify(R, [], [{ peer: p }]); } } }, 1000);
    window.addEventListener('beforeunload', () => { for (const n in rooms) if (rooms[n].joined) ch.postMessage({ t: 'bye', room: n, peer: self }); });
    function api(name) {
      const R = R0(name); R.joined = true; ch.postMessage({ t: 'hello', room: name, peer: self });
      let pend = false;
      return {
        name,
        presence(patch) { for (const k in patch) { if (patch[k] === null) delete R.mine[k]; else R.mine[k] = patch[k]; } R.snap = null; if (!pend) { pend = true; setTimeout(() => { pend = false; send(R); }, 33); } return Promise.resolve(); },
        peers() { return snap(R); },
        onPeers(fn) { R.handlers.push(fn); setTimeout(() => fn({ peers: snap(R), joined: snap(R), left: [], updated: [] }), 0); return () => { R.handlers = R.handlers.filter(h => h !== fn); }; },
        connected() { return true; },
        leave() { R.joined = false; ch.postMessage({ t: 'bye', room: name, peer: self }); R.peers.clear(); R.handlers = []; R.mine = {}; R.snap = null; return Promise.resolve(); },
      };
    }
    const lobby = api('lobby');
    return { presence: lobby.presence, peers: lobby.peers, onPeers: lobby.onPeers, connected: lobby.connected, join: (n) => Promise.resolve(api(n)) };
  }

  return {
    init, openLobby, closeLobby, bindUi, leave, attachHost, attachGuest, hostInput, hostFrame, guestFrame, status, info, hostWaiting, start, setStatus,
    setHooks(h) { hooks = h; },
    get role() { return game ? game.role : null; },
    get phase() { return game ? game.phase : null; },
    get dbg() { return game; },
  };
})();
