// Ввод: клавиатура (два игрока), геймпады, экранный джойстик.
WP.Input = (function () {
  const keys = new Set(), pressed = new Set(), released = new Set();
  const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'Tab']);
  let captureCb = null; // переназначение: следующая нажатая клавиша уходит в настройки, а не в игру
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (captureCb) { e.preventDefault(); e.stopPropagation(); const cb = captureCb; captureCb = null; cb(e.code); return; }
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (GAME_KEYS.has(e.code) || bound.has(e.code)) e.preventDefault();
  }, true);
  window.addEventListener('keyup', (e) => { keys.delete(e.code); released.add(e.code); });
  window.addEventListener('blur', () => { for (const k of keys) released.add(k); keys.clear(); });

  const MAP = {
    p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], pass: ['KeyJ'], shoot: ['KeyK'], lob: ['KeyL'], skip: ['KeyI'], fake: ['KeyU'], foul: ['KeyE'], thru: ['KeyH'], lobpass: ['KeyO'], play: ['KeyG'], sub: ['KeyR'], tac: ['KeyQ'], timeout: ['KeyT'], challenge: ['KeyY'] },
    // Вторая раскладка для одиночной игры: стрелки + Z X C V B
    alt: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], pass: ['KeyZ'], shoot: ['KeyX', 'Space'], lob: ['KeyC'], skip: ['KeyV'], fake: ['KeyB'], foul: ['KeyN'], thru: [], lobpass: [], play: [], sub: [], tac: [], timeout: [], challenge: [] },
    p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], pass: ['Comma'], shoot: ['Period'], lob: ['Slash'], skip: ['Semicolon'], fake: ['Quote'], foul: ['BracketRight'], thru: ['Enter'], lobpass: [], play: ['BracketLeft'], sub: [], tac: [], timeout: [], challenge: ['Backslash'] },
  };

  // ---------- настройки управления (хранятся в браузере) ----------
  const DEFAULT = JSON.parse(JSON.stringify({ p1: MAP.p1, alt: MAP.alt }));
  const ACTIONS = [
    ['up', 'Плыть вперёд'], ['down', 'Плыть назад'], ['left', 'Плыть влево'], ['right', 'Плыть вправо'], ['sprint', 'Рывок'],
    ['pass', 'Пас (держать — резкий) · без мяча: сменить игрока / «Дай!»'], ['thru', 'Пас в разрез (держать — прицел) · Рывок в прицеле — верхом'], ['lobpass', 'Пас верхом — навесом над защитником'], ['shoot', 'Бросок (держать — сильнее) · без мяча: отбор'], ['lob', 'Парашют · без мяча: блок'],
    ['skip', 'Бросок с отскоком'], ['fake', 'Финт (держать — кач)'], ['foul', 'Заработать фол · в защите держать: руки вверх'], ['play', 'Заслон'],
    ['sub', 'Быстрая замена'], ['tac', 'Тактика и замены'], ['timeout', 'Тайм-аут'], ['challenge', 'Видеочеллендж'],
  ];
  const RESERVED = { Escape: 'пауза', Tab: 'камера', KeyM: 'звук', KeyP: 'пауза' };
  const OPTS_DEFAULT = { assist: true, autoSwitch: true, autoPower: false, touchSize: 'normal', lefty: false, autoSprint: false, vibrate: true };
  const opts = Object.assign({}, OPTS_DEFAULT);
  const bound = new Set();
  function rebuildBound() { bound.clear(); for (const m of [MAP.p1, MAP.alt, MAP.p2]) for (const k in m) for (const c of m[k]) bound.add(c); for (const c in RESERVED) bound.delete(c); bound.delete('Tab'); }
  function saveCfg() { try { localStorage.setItem('polo25_controls', JSON.stringify({ p1: MAP.p1, alt: MAP.alt, opts })); } catch (e) { /* хранилище недоступно */ } }
  function loadCfg() {
    try {
      const d = JSON.parse(localStorage.getItem('polo25_controls') || 'null');
      if (d) {
        for (const lay of ['p1', 'alt']) if (d[lay]) for (const [a] of ACTIONS) if (Array.isArray(d[lay][a])) MAP[lay][a] = d[lay][a].slice(0, 2);
        if (d.opts) Object.assign(opts, d.opts);
      }
    } catch (e) { /* повреждённые настройки — остаются стандартные */ }
    rebuildBound();
  }
  const KEY_NAMES = { Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Пр. Shift', ControlLeft: 'Ctrl', ControlRight: 'Пр. Ctrl', AltLeft: 'Alt', AltRight: 'Пр. Alt', MetaLeft: 'Cmd', MetaRight: 'Пр. Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', CapsLock: 'Caps', Tab: 'Tab', Escape: 'Esc' };
  function keyName(c) {
    if (!c) return '—';
    if (KEY_NAMES[c]) return KEY_NAMES[c];
    if (c.startsWith('Key')) return c.slice(3);
    if (c.startsWith('Digit')) return c.slice(5);
    if (c.startsWith('Numpad')) return 'Num ' + c.slice(6);
    return c;
  }
  // Подпись действия: основная клавиша (или дополнительная, если основной нет)
  function label(a) { return keyName(MAP.p1[a][0] || MAP.alt[a][0]); }
  function kbd(a) { return '<kbd>' + label(a) + '</kbd>'; }
  function kbd2(a) { const x = MAP.p1[a][0], y = MAP.alt[a][0]; return (x ? '<kbd>' + keyName(x) + '</kbd>' : '') + (x && y ? ' / ' : '') + (y ? '<kbd>' + keyName(y) + '</kbd>' : ''); }
  function moveKbd() { return '<kbd>' + ['up', 'left', 'down', 'right'].map(label).join(' ') + '</kbd>'; }
  // Назначить клавишу: слот 0 — основная раскладка, 1 — дополнительная; клавиша снимается с других действий
  function bind(a, slot, code) {
    if (RESERVED[code]) return 'Клавиша ' + keyName(code) + ' занята: ' + RESERVED[code];
    let was = '';
    for (const lay of ['p1', 'alt']) for (const [b] of ACTIONS) {
      const i = MAP[lay][b].indexOf(code);
      if (i >= 0 && !(b === a && (lay === 'p1') === (slot === 0))) { MAP[lay][b].splice(i, 1); was = b; }
    }
    MAP[slot === 0 ? 'p1' : 'alt'][a] = [code];
    rebuildBound(); saveCfg();
    const nm = ACTIONS.find(x => x[0] === was);
    return was ? keyName(code) + ' снята с действия «' + nm[1].split(' ·')[0] + '»' : '';
  }
  function unbind(a, slot) { MAP[slot === 0 ? 'p1' : 'alt'][a] = []; rebuildBound(); saveCfg(); }
  function resetKeys() { for (const lay of ['p1', 'alt']) for (const [a] of ACTIONS) MAP[lay][a] = DEFAULT[lay][a].slice(); rebuildBound(); saveCfg(); }
  function setOpt(k, v) { opts[k] = v; saveCfg(); applyBodyOpts(); }
  function applyBodyOpts() {
    document.body.classList.toggle('tb-large', opts.touchSize === 'large');
    document.body.classList.toggle('lefty', !!opts.lefty);
  }
  loadCfg();
  if (document.body) applyBodyOpts(); else window.addEventListener('DOMContentLoaded', applyBodyOpts);

  const touch = { x: 0, y: 0, on: false, btn: {}, gest: {}, pressed: new Set(), released: new Set() };
  const padPrev = [{}, {}];

  function any(list, set) { for (const k of list) if (set.has(k)) return true; return false; }
  function blank() { return { ax: 0, ay: 0, sprint: false, sprintK: false, pass: false, passD: false, shootP: false, shootD: false, lob: false, skipP: false, skipD: false, fake: false, fakeD: false, foul: false, foulD: false, play: false, sub: false, tac: false, thru: false, thruD: false, thruUp: false, lobpass: false, passGest: null, shootGest: null, timeout: false, challenge: false }; }

  function addKeys(s, m) {
    s.ax += (any(m.right, keys) ? 1 : 0) - (any(m.left, keys) ? 1 : 0);
    s.ay += (any(m.up, keys) ? 1 : 0) - (any(m.down, keys) ? 1 : 0);
    s.sprint = s.sprint || any(m.sprint, keys);
    s.sprintK = s.sprintK || any(m.sprint, keys); // сама кнопка рывка (без авторывка): в прицеле разреза — «верхом»
    s.pass = s.pass || any(m.pass, pressed);
    s.passD = s.passD || any(m.pass, keys) || (any(m.pass, pressed) && any(m.pass, released));
    s.shootP = s.shootP || any(m.shoot, pressed);
    s.shootD = s.shootD || any(m.shoot, keys) || (any(m.shoot, pressed) && any(m.shoot, released));
    s.lob = s.lob || any(m.lob, pressed);
    s.skipP = s.skipP || any(m.skip, pressed);
    s.skipD = s.skipD || any(m.skip, keys) || (any(m.skip, pressed) && any(m.skip, released));
    s.timeout = s.timeout || any(m.timeout, pressed);
    s.fake = s.fake || any(m.fake, pressed);
    s.fakeD = s.fakeD || any(m.fake, keys);
    s.foul = s.foul || any(m.foul, pressed);
    s.play = s.play || any(m.play, pressed);
    s.thru = s.thru || any(m.thru, pressed);
    // Удержание разреза — прицел; нажали и отпустили за один кадр — всё равно «нажата» в этом кадре
    s.thruD = s.thruD || any(m.thru, keys) || (any(m.thru, pressed) && any(m.thru, released));
    s.lobpass = s.lobpass || any(m.lobpass, pressed);
    s.sub = s.sub || any(m.sub, pressed);
    s.tac = s.tac || any(m.tac, pressed);
    s.foulD = s.foulD || any(m.foul, keys) || (any(m.foul, pressed) && any(m.foul, released));
    s.challenge = s.challenge || any(m.challenge, pressed);
  }

  function addPad(s, idx) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[idx];
    if (!gp) return;
    const prev = padPrev[idx];
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = (i) => b(i) && !prev[i];
    let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.hypot(x, y) < 0.18) { x = 0; y = 0; }
    if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
    s.ax += x; s.ay -= y;
    s.sprint = s.sprint || b(7) || (opts.autoSprint && Math.hypot(x, y) > 0.93); s.sprintK = s.sprintK || b(7);
    s.foul = s.foul || edge(5); s.foulD = s.foulD || b(5);
    s.play = s.play || edge(10);
    s.thru = s.thru || edge(11); s.thruD = s.thruD || b(11);
    s.pass = s.pass || edge(0); s.passD = s.passD || b(0);
    s.shootP = s.shootP || edge(2); s.shootD = s.shootD || b(2);
    s.lob = s.lob || edge(1);
    s.skipP = s.skipP || edge(3); s.skipD = s.skipD || b(3);
    s.timeout = s.timeout || edge(8);
    s.fake = s.fake || edge(4); s.fakeD = s.fakeD || b(4);
    s.challenge = s.challenge || edge(6);
    s.padPause = edge(9);
    for (let i = 0; i < gp.buttons.length; i++) prev[i] = b(i);
  }

  function addTouch(s) {
    if (touch.on) { s.ax += touch.x; s.ay += touch.y; }
    const T = touch;
    s.sprint = s.sprint || !!T.btn.sprint || (opts.autoSprint && touch.on && Math.hypot(touch.x, touch.y) > 0.93);
    s.pass = s.pass || T.pressed.has('pass'); s.passD = s.passD || !!T.btn.pass || T.pressed.has('pass');
    s.shootP = s.shootP || T.pressed.has('shoot'); s.shootD = s.shootD || !!T.btn.shoot;
    s.lob = s.lob || T.pressed.has('lob');
    s.fake = s.fake || T.pressed.has('fake'); s.fakeD = s.fakeD || !!T.btn.fake;
    s.play = s.play || T.pressed.has('play');
    // «Разрез» срабатывает при отпускании: свайп вверх — разрез верхом
    if (T.released.has('thru')) { s.thru = true; s.thruUp = T.gest.thru === 'up'; }
    if (T.released.has('pass') && T.gest.pass) s.passGest = T.gest.pass;
    if (T.released.has('shoot') && T.gest.shoot) s.shootGest = T.gest.shoot;
    s.foul = s.foul || T.pressed.has('foul'); s.foulD = s.foulD || !!T.btn.foul || T.pressed.has('foul');
    s.challenge = s.challenge || T.pressed.has('var');
  }

  function norm(s) {
    const m = Math.hypot(s.ax, s.ay);
    if (m > 1) { s.ax /= m; s.ay /= m; }
    s.mag = Math.min(1, m);
    return s;
  }

  function poll(mode) {
    const out = { p1: blank(), p2: null, pause: false, cam: false, mute: false };
    addKeys(out.p1, MAP.p1);
    addPad(out.p1, 0);
    addTouch(out.p1);
    if (mode === '2p') { out.p2 = blank(); addKeys(out.p2, MAP.p2); addPad(out.p2, 1); norm(out.p2); }
    else addKeys(out.p1, MAP.alt);
    norm(out.p1);
    out.pause = pressed.has('Escape') || pressed.has('KeyP') || !!out.p1.padPause;
    out.cam = pressed.has('Tab');
    out.mute = pressed.has('KeyM');
    out.anyKey = pressed.size > 0;
    pressed.clear(); released.clear();
    touch.pressed.clear(); touch.released.clear();
    return out;
  }

  function bindTouch(root) {
    const stick = root.querySelector('#stick'), knob = stick.querySelector('i');
    let sid = null, cx = 0, cy = 0;
    const RAD = 46;
    const move = (e) => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > RAD) { dx = dx / m * RAD; dy = dy / m * RAD; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touch.x = dx / RAD; touch.y = -dy / RAD; touch.on = true;
    };
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId; stick.setPointerCapture(sid);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    stick.addEventListener('pointermove', move);
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; touch.on = false; touch.x = touch.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('selectstart', (e) => e.preventDefault());
    // Кнопки с жестами как в FC Mobile: тап — обычное действие, свайп вверх/вниз по кнопке — другой вариант.
    // Действие кнопки читается в момент нажатия: подпись «Разрез»/«Блок» меняется между атакой и защитой.
    root.querySelectorAll('[data-b]').forEach((btn) => {
      let k = btn.dataset.b, y0 = 0;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); k = btn.dataset.b; y0 = e.clientY;
        try { btn.setPointerCapture(e.pointerId); } catch (er) { /* старые браузеры */ }
        touch.btn[k] = true; touch.gest[k] = null;
        if (k !== 'thru') touch.pressed.add(k);
        btn.classList.add('on'); btn.dataset.g = '';
        if (opts.vibrate && navigator.vibrate) { try { navigator.vibrate(12); } catch (er) { /* нет вибро */ } }
      });
      btn.addEventListener('pointermove', (e) => {
        if (!touch.btn[k]) return;
        const dy = e.clientY - y0, g = dy < -26 ? 'up' : dy > 26 ? 'down' : null;
        if (g !== touch.gest[k]) { touch.gest[k] = g; btn.dataset.g = g || ''; }
      });
      const up = () => { if (touch.btn[k]) touch.released.add(k); touch.btn[k] = false; btn.classList.remove('on'); btn.dataset.g = ''; };
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
    });
  }

  return {
    poll, bindTouch, opts, ACTIONS, RESERVED, label, kbd, kbd2, moveKbd, keyName, bind, unbind, resetKeys, setOpt,
    keysOf: (a) => [MAP.p1[a][0] || '', MAP.alt[a][0] || ''],
    capture(cb) { captureCb = cb; }, cancelCapture() { captureCb = null; },
  };
})();
