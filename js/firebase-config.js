// Настройки Firebase для версии игры на своём сайте (GitHub Pages).
// Это публичные параметры веб-приложения Firebase (не пароль): доступ защищают правила базы и вход через Google.
// Версия на claude.ai использует комнаты claude.ai и этот файл не подключает.
WP.FIREBASE = {
  apiKey: 'AIzaSyBWLaSPF-ubNsO6F3SYtT9n--sLbF0wIhw',
  authDomain: 'water-polo-mobile.firebaseapp.com',
  databaseURL: 'https://water-polo-mobile-default-rtdb.firebaseio.com',
  projectId: 'water-polo-mobile',
  storageBucket: 'water-polo-mobile.firebasestorage.app',
  messagingSenderId: '986945549935',
  appId: '1:986945549935:web:16c4f837a60785ca56bf9a',
};

// TURN-ретранслятор для онлайна (Metered, бесплатно 20 ГБ в месяц): dashboard.metered.ca → TURN Server → Credentials.
// user/pass — постоянный логин из панели (сервера global.relay.metered.ca). Вместо них можно дать url выдачи временных
// ключей: 'https://<приложение>.metered.live/api/v1/turn/credentials?apiKey=<ключ>'. Пусто — STUN и сервер Firebase, как раньше.
WP.TURN = { user: '28d3446419a8b0dd9bb5764d', pass: 'gP+ZQdELZsL2KnaY', url: '' };
