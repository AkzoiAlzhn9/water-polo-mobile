// Сервис-воркер нужен, чтобы игру можно было установить на телефон как приложение (запуск во весь экран).
// Ничего не кэширует: всегда берёт свежую версию из сети.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
