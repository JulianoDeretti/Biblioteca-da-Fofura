// Aumente esta versão sempre que style.css/app.js/index.html mudarem,
// para forçar os aparelhos já instalados a buscar a versão nova.
const VERSAO_CACHE = 'fofura-shell-v1';

const ARQUIVOS_DO_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (evento) => {
    evento.waitUntil(
        caches.open(VERSAO_CACHE).then((cache) => cache.addAll(ARQUIVOS_DO_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil(
        caches.keys().then((chaves) =>
            Promise.all(
                chaves
                    .filter((chave) => chave !== VERSAO_CACHE)
                    .map((chave) => caches.delete(chave))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
    const url = new URL(evento.request.url);

    // IMPORTANTE: dados de livros (/api/...) NUNCA são servidos do cache.
    // Livros são o que realmente importa aqui — preferimos mostrar um erro
    // claro de "sem conexão" a arriscar mostrar uma lista desatualizada ou
    // deixar a pessoa achar que salvou algo que não foi para o servidor.
    if (url.pathname.startsWith('/api/')) {
        evento.respondWith(
            fetch(evento.request).catch(() =>
                new Response(
                    JSON.stringify({ erro: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        return;
    }

    // Para o "visual" do app (HTML/CSS/JS/ícones): cache primeiro, para abrir
    // instantâneo mesmo com internet ruim, atualizando o cache em segundo plano.
    evento.respondWith(
        caches.match(evento.request).then((respostaCache) => {
            const buscaRede = fetch(evento.request)
                .then((respostaRede) => {
                    if (respostaRede && respostaRede.ok) {
                        const copia = respostaRede.clone();
                        caches.open(VERSAO_CACHE).then((cache) => cache.put(evento.request, copia));
                    }
                    return respostaRede;
                })
                .catch(() => respostaCache);

            return respostaCache || buscaRede;
        })
    );
});
