const CACHE = 'appayo-v113';
const ASSETS = [
  './', './index.html', './tournament.html', './styles.css', './tournament.css', './app.js', './tournament-app.js', './tournament-progress.js', './brand.js', './routes.js', './logic.js', './chart.js', './symbols.js', './share.js', './legacy-tournament.js', './fonts/BricolageGrotesque.woff2',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-header.svg', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Xarxa primer (per rebre actualitzacions), memòria cau si no hi ha connexió.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate'
        ? caches.match(url.pathname.startsWith('/tournaments') ? './tournament.html' : './index.html')
        : Response.error())))
  );
});
