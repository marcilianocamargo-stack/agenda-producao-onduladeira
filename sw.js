const CACHE = 'agenda-onduladeira-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1) Dados do dia NUNCA são cacheados — sempre rede (garante fila e programação atuais).
  if (url.pathname.endsWith('programacao-hoje.xlsx') || url.pathname.endsWith('programacao-agenda.json')) {
    return; // deixa o fetch original (com no-store) buscar direto da rede
  }

  // 2) index.html / navegação: REDE PRIMEIRO (app sempre atualizado),
  //    cache só como reserva quando estiver offline.
  if (e.request.mode === 'navigate' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 3) Demais arquivos (biblioteca XLSX, manifest, ícones): cache primeiro.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
