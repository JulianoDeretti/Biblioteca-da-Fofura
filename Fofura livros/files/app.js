const API = '/api';

const NOMES_STATUS = {
    'lido': '❤️ Lido',
    'lendo': '📖 Lendo',
    'quero-ler': '📚 Quero Ler'
};

const EMOJIS_CAPA = ['📕', '📗', '📘', '📙', '📔'];

let secaoAtual = 'inicio';
let generosDisponiveis = [];
let autoresDisponiveis = [];
let filtrosColecao = { status: 'todos', genero: 'todos', favorito: false, ordenarPor: 'dataAdicao' };

// ══════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════

function escapeHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function emojiCapa(id) {
    return EMOJIS_CAPA[id % EMOJIS_CAPA.length];
}

function formatarData(dataIso) {
    if (!dataIso) return '—';
    const d = new Date(dataIso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR');
}

// ══════════════════════════════════════
// CONTROLE CENTRAL DE MODAIS
// ══════════════════════════════════════
// Todo modal só deve abrir por uma chamada explícita a abrirModal().
// O scroll da página só é bloqueado enquanto pelo menos um modal
// estiver realmente aberto, e é restaurado assim que o último fechar.

function abrirModal(id) {
    document.getElementById(id).classList.remove('oculto');
    document.body.style.overflow = 'hidden';
}

function fecharModal(id) {
    document.getElementById(id).classList.add('oculto');
    const algumAindaAberto = [...document.querySelectorAll('.modal-fundo')]
        .some(modal => !modal.classList.contains('oculto'));
    if (!algumAindaAberto) {
        document.body.style.overflow = '';
    }
}

// Garantia extra: independentemente do HTML, todo modal começa fechado.
function garantirModaisFechadosNaInicializacao() {
    document.querySelectorAll('.modal-fundo').forEach(modal => modal.classList.add('oculto'));
    document.body.style.overflow = '';
}

function mostrarToast(mensagem, tipo = 'sucesso') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensagem;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visivel'));
    setTimeout(() => {
        toast.classList.remove('toast-visivel');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

function confirmar(mensagem) {
    return new Promise(resolve => {
        document.getElementById('texto-confirmar').textContent = mensagem;
        abrirModal('modal-confirmar');

        const btnOk = document.getElementById('btn-confirmar-confirmar');
        const btnCancelar = document.getElementById('btn-cancelar-confirmar');

        const limpar = (resultado) => {
            fecharModal('modal-confirmar');
            btnOk.removeEventListener('click', onOk);
            btnCancelar.removeEventListener('click', onCancelar);
            resolve(resultado);
        };

        const onOk = () => limpar(true);
        const onCancelar = () => limpar(false);

        btnOk.addEventListener('click', onOk);
        btnCancelar.addEventListener('click', onCancelar);
    });
}

function debounce(fn, atraso) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), atraso);
    };
}

// ══════════════════════════════════════
// CHAMADAS À API
// ══════════════════════════════════════

async function apiRequisicao(metodo, caminho, corpo) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
    }
    const response = await fetch(`${API}${caminho}`, opcoes);
    const dados = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(dados.erro || 'Erro inesperado');
    }
    return dados;
}

const apiGet = (caminho) => apiRequisicao('GET', caminho);
const apiPost = (caminho, corpo) => apiRequisicao('POST', caminho, corpo);
const apiPut = (caminho, corpo) => apiRequisicao('PUT', caminho, corpo);
const apiPatch = (caminho, corpo) => apiRequisicao('PATCH', caminho, corpo);
const apiDelete = (caminho) => apiRequisicao('DELETE', caminho);

// ══════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    garantirModaisFechadosNaInicializacao();
    inicializarNavegacao();
    inicializarModais();
    inicializarBusca();
    inicializarFiltrosColecao();
    inicializarFormulario();
    carregarGenerosEAutoresSugestao();
    mudarSecao('inicio');
});

function inicializarNavegacao() {
    document.querySelectorAll('.nav-item[data-secao]').forEach(btn => {
        btn.addEventListener('click', () => mudarSecao(btn.dataset.secao));
    });
}

async function mudarSecao(secao) {
    secaoAtual = secao;

    document.querySelectorAll('.nav-item[data-secao]').forEach(btn => {
        btn.classList.toggle('ativo', btn.dataset.secao === secao);
    });

    document.querySelectorAll('main .secao').forEach(el => el.classList.add('oculta'));
    const secaoEl = document.getElementById(`secao-${secao}`);
    if (secaoEl) secaoEl.classList.remove('oculta');

    document.getElementById('detalhe-autor').classList.add('oculto');
    document.getElementById('lista-autores').classList.remove('oculto');

    if (secao === 'inicio') await carregarInicio();
    else if (secao === 'lidos') await carregarPorStatus('lido', 'grade-lidos');
    else if (secao === 'lendo') await carregarPorStatus('lendo', 'grade-lendo');
    else if (secao === 'quero-ler') await carregarPorStatus('quero-ler', 'grade-quero-ler');
    else if (secao === 'colecao') await carregarColecao();
    else if (secao === 'autores') await carregarAutores();
    else if (secao === 'estatisticas') await carregarEstatisticasCompletas();
}

// ══════════════════════════════════════
// CARDS DE LIVRO (REUTILIZÁVEL)
// ══════════════════════════════════════

function renderizarCardLivro(livro) {
    const titulo = escapeHtml(livro.titulo);
    const autor = escapeHtml(livro.autor);
    const genero = escapeHtml(livro.genero || '');
    const capaHtml = livro.capa
        ? `<img class="capa-livro" src="${escapeHtml(livro.capa)}" alt="${titulo}" loading="lazy" onerror="this.outerHTML='<div class=&quot;capa-livro-placeholder&quot;>${emojiCapa(livro.id)}</div>'">`
        : `<div class="capa-livro-placeholder">${emojiCapa(livro.id)}</div>`;

    return `
        <div class="card-livro" data-id="${livro.id}">
            ${capaHtml}
            <div class="corpo-card">
                <h4>${titulo}</h4>
                <p class="autor-card">${autor}${genero ? ' · ' + genero : ''}</p>
                <div class="rodape-card">
                    <span class="badge-status badge-${livro.status}">${NOMES_STATUS[livro.status] || livro.status}</span>
                    <button class="estrela-favorito" data-id="${livro.id}" title="Favoritar">${livro.favorito ? '❤️' : '🤍'}</button>
                </div>
                ${typeof livro.nota === 'number' ? `<p class="nota-card">⭐ ${livro.nota.toFixed(1)}</p>` : ''}
            </div>
        </div>
    `;
}

function renderizarGrade(containerId, livros, mensagemVazia) {
    const container = document.getElementById(containerId);
    if (!livros || livros.length === 0) {
        container.innerHTML = `<p class="mensagem-vazia">${mensagemVazia}</p>`;
        return;
    }
    container.innerHTML = livros.map(renderizarCardLivro).join('');
    ativarEventosDosCards(container);
}

function ativarEventosDosCards(container) {
    container.querySelectorAll('.card-livro').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.estrela-favorito')) return;
            abrirDetalheLivro(parseInt(card.dataset.id));
        });
    });

    container.querySelectorAll('.estrela-favorito').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            const jaFavorito = btn.textContent.trim() === '❤️';
            try {
                const resultado = await apiPatch(`/livros/${id}/favorito`, { favorito: !jaFavorito });
                btn.textContent = resultado.livro.favorito ? '❤️' : '🤍';
                btn.classList.add('ativa');
                mostrarToast(resultado.mensagem, 'sucesso');
            } catch (erro) {
                mostrarToast(erro.message, 'erro');
            }
        });
    });
}

// ══════════════════════════════════════
// INÍCIO
// ══════════════════════════════════════

async function carregarInicio() {
    try {
        const stats = await apiGet('/estatisticas');
        renderizarPainelInicio(stats);

        const blocoContinuando = document.getElementById('bloco-continuando');
        if (stats.continuandoLendo && stats.continuandoLendo.length > 0) {
            blocoContinuando.style.display = 'block';
            renderizarGrade('grade-continuando', stats.continuandoLendo, '');
        } else {
            blocoContinuando.style.display = 'none';
        }

        renderizarGrade('grade-recentes', stats.recentes, 'Sua biblioteca ainda está vazia. Que tal adicionar o primeiro livro? 💗');
    } catch (erro) {
        mostrarToast('Erro ao carregar a página inicial', 'erro');
    }
}

function renderizarPainelInicio(stats) {
    document.getElementById('painel-inicio-stats').innerHTML = `
        <div class="stat-card"><span class="stat-numero">${stats.totalLivros}</span><span class="stat-rotulo">Total de livros</span></div>
        <div class="stat-card"><span class="stat-numero">${stats.lidos}</span><span class="stat-rotulo">Lidos ❤️</span></div>
        <div class="stat-card"><span class="stat-numero">${stats.queroLer}</span><span class="stat-rotulo">Quero ler 📚</span></div>
        <div class="stat-card"><span class="stat-numero">${stats.autores}</span><span class="stat-rotulo">Autores ✍️</span></div>
    `;
}

// ══════════════════════════════════════
// LISTAS POR STATUS (LIDOS / LENDO / QUERO LER)
// ══════════════════════════════════════

async function carregarPorStatus(status, containerId) {
    try {
        const livros = await apiGet(`/livros?status=${status}&ordenarPor=dataAdicao`);
        const mensagens = {
            'lido': 'Você ainda não marcou nenhum livro como lido.',
            'lendo': 'Nenhum livro sendo lido no momento.',
            'quero-ler': 'Sua lista de desejos está vazia por enquanto.'
        };
        renderizarGrade(containerId, livros, mensagens[status] || 'Nenhum livro encontrado.');
    } catch (erro) {
        mostrarToast('Erro ao carregar os livros', 'erro');
    }
}

// ══════════════════════════════════════
// COLEÇÃO (ESTANTE COM FILTROS)
// ══════════════════════════════════════

function inicializarFiltrosColecao() {
    document.getElementById('filtro-status').addEventListener('change', (e) => {
        filtrosColecao.status = e.target.value;
        carregarColecao();
    });
    document.getElementById('filtro-genero').addEventListener('change', (e) => {
        filtrosColecao.genero = e.target.value;
        carregarColecao();
    });
    document.getElementById('filtro-favorito').addEventListener('change', (e) => {
        filtrosColecao.favorito = e.target.checked;
        carregarColecao();
    });
    document.getElementById('ordenar-por').addEventListener('change', (e) => {
        filtrosColecao.ordenarPor = e.target.value;
        carregarColecao();
    });
}

async function carregarColecao() {
    try {
        await preencherSelectGeneros();

        const params = new URLSearchParams();
        if (filtrosColecao.status !== 'todos') params.set('status', filtrosColecao.status);
        if (filtrosColecao.genero !== 'todos') params.set('genero', filtrosColecao.genero);
        if (filtrosColecao.favorito) params.set('favorito', 'true');
        params.set('ordenarPor', filtrosColecao.ordenarPor);

        const livros = await apiGet(`/livros?${params.toString()}`);
        renderizarGrade('estante-colecao', livros, 'Nenhum livro encontrado com esses filtros. 💭');
    } catch (erro) {
        mostrarToast('Erro ao carregar a coleção', 'erro');
    }
}

async function preencherSelectGeneros() {
    try {
        generosDisponiveis = await apiGet('/generos');
        const select = document.getElementById('filtro-genero');
        const valorAtual = select.value;
        select.innerHTML = '<option value="todos">Todos</option>' +
            generosDisponiveis.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
        select.value = valorAtual && [...select.options].some(o => o.value === valorAtual) ? valorAtual : 'todos';
    } catch { /* silencioso: filtro de gênero não é crítico */ }
}

// ══════════════════════════════════════
// AUTORES
// ══════════════════════════════════════

async function carregarAutores() {
    try {
        autoresDisponiveis = await apiGet('/autores');
        const container = document.getElementById('lista-autores');

        if (autoresDisponiveis.length === 0) {
            container.innerHTML = '<p class="mensagem-vazia">Nenhum autor cadastrado ainda. ✍️</p>';
            return;
        }

        container.innerHTML = autoresDisponiveis.map(a => `
            <div class="card-autor" data-nome="${escapeHtml(a.nome)}">
                <div class="icone-autor">✍️</div>
                <h4>${escapeHtml(a.nome)}</h4>
                <p>${a.totalLivros} livro${a.totalLivros !== 1 ? 's' : ''} · ${a.lidos} lido${a.lidos !== 1 ? 's' : ''}</p>
            </div>
        `).join('');

        container.querySelectorAll('.card-autor').forEach(card => {
            card.addEventListener('click', () => verLivrosDoAutor(card.dataset.nome));
        });
    } catch (erro) {
        mostrarToast('Erro ao carregar autores', 'erro');
    }
}

async function verLivrosDoAutor(nome) {
    try {
        const livros = await apiGet(`/autores/${encodeURIComponent(nome)}/livros`);
        document.getElementById('lista-autores').classList.add('oculto');
        document.getElementById('detalhe-autor').classList.remove('oculto');
        document.getElementById('titulo-autor').textContent = `✍️ ${nome}`;
        renderizarGrade('grade-livros-autor', livros, 'Nenhum livro encontrado para este autor.');
    } catch (erro) {
        mostrarToast('Erro ao carregar livros do autor', 'erro');
    }
}

document.getElementById('btn-voltar-autores')?.addEventListener('click', () => {
    document.getElementById('detalhe-autor').classList.add('oculto');
    document.getElementById('lista-autores').classList.remove('oculto');
});

// ══════════════════════════════════════
// ESTATÍSTICAS COMPLETAS
// ══════════════════════════════════════

async function carregarEstatisticasCompletas() {
    try {
        const stats = await apiGet('/estatisticas');
        document.getElementById('painel-estatisticas-completo').innerHTML = `
            <div class="stat-card"><span class="stat-numero">${stats.totalLivros}</span><span class="stat-rotulo">Livros cadastrados 📚</span></div>
            <div class="stat-card"><span class="stat-numero">${stats.lidos}</span><span class="stat-rotulo">Livros lidos ❤️</span></div>
            <div class="stat-card"><span class="stat-numero">${stats.lendo}</span><span class="stat-rotulo">Lendo 📖</span></div>
            <div class="stat-card"><span class="stat-numero">${stats.queroLer}</span><span class="stat-rotulo">Quero ler 📋</span></div>
            <div class="stat-card"><span class="stat-numero">${stats.favoritos}</span><span class="stat-rotulo">Favoritos ⭐</span></div>
            <div class="stat-card"><span class="stat-numero">${stats.autores}</span><span class="stat-rotulo">Autores ✍️</span></div>
            <div class="stat-card">
                <span class="stat-numero">${stats.generoMaisLido || '—'}</span>
                <span class="stat-rotulo">Gênero mais lido</span>
            </div>
            <div class="stat-card">
                <span class="stat-numero">${stats.autorComMais || '—'}</span>
                <span class="stat-rotulo">Autor com mais livros</span>
            </div>
            <div class="stat-card">
                <span class="stat-numero">${stats.mediaNotas !== null ? stats.mediaNotas.toFixed(1) : '—'}</span>
                <span class="stat-rotulo">Média das notas ⭐</span>
            </div>
            <div class="stat-card">
                <span class="stat-numero">${stats.totalPaginasLidas}</span>
                <span class="stat-rotulo">Páginas lidas</span>
            </div>
        `;
    } catch (erro) {
        mostrarToast('Erro ao carregar estatísticas', 'erro');
    }
}

// ══════════════════════════════════════
// BUSCA GLOBAL
// ══════════════════════════════════════

function inicializarBusca() {
    const campo = document.getElementById('busca-global');
    const buscar = debounce(async () => {
        const termo = campo.value.trim();

        if (termo === '') {
            document.getElementById('secao-busca').classList.add('oculta');
            mudarSecao(secaoAtual === 'busca' ? 'inicio' : secaoAtual);
            return;
        }

        try {
            const livros = await apiGet(`/livros?busca=${encodeURIComponent(termo)}`);

            document.querySelectorAll('main .secao').forEach(el => el.classList.add('oculta'));
            document.getElementById('secao-busca').classList.remove('oculta');
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('ativo'));

            renderizarGrade('grade-busca', livros, `Nenhum resultado para "${escapeHtml(termo)}". 🔍`);
        } catch (erro) {
            mostrarToast('Erro ao pesquisar', 'erro');
        }
    }, 300);

    campo.addEventListener('input', buscar);
}

// ══════════════════════════════════════
// SUGESTÕES DE AUTOR/GÊNERO NO FORMULÁRIO
// ══════════════════════════════════════

async function carregarGenerosEAutoresSugestao() {
    try {
        generosDisponiveis = await apiGet('/generos');
        document.getElementById('lista-generos-sugestao').innerHTML =
            generosDisponiveis.map(g => `<option value="${escapeHtml(g)}">`).join('');
    } catch { /* opcional */ }

    try {
        autoresDisponiveis = await apiGet('/autores');
        document.getElementById('lista-autores-sugestao').innerHTML =
            autoresDisponiveis.map(a => `<option value="${escapeHtml(a.nome)}">`).join('');
    } catch { /* opcional */ }
}

// ══════════════════════════════════════
// MODAIS (ABRIR/FECHAR)
// ══════════════════════════════════════

function inicializarModais() {
    document.querySelectorAll('[data-fechar]').forEach(btn => {
        btn.addEventListener('click', () => fecharModal(btn.dataset.fechar));
    });

    document.querySelectorAll('.modal-fundo').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) fecharModal(modal.id);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-fundo').forEach(modal => {
            if (!modal.classList.contains('oculto')) fecharModal(modal.id);
        });
    });

    document.getElementById('btn-abrir-adicionar').addEventListener('click', () => abrirModalFormulario());
}

function abrirModalFormulario(livro = null) {
    const form = document.getElementById('form-livro');
    form.reset();

    document.getElementById('titulo-modal-form').textContent = livro ? '✏️ Editar Livro' : '➕ Adicionar Livro';
    document.getElementById('livro-id').value = livro ? livro.id : '';

    document.getElementById('campo-titulo').value = livro ? livro.titulo : '';
    document.getElementById('campo-autor').value = livro ? livro.autor : '';
    document.getElementById('campo-genero').value = livro && livro.genero !== 'Não informado' ? livro.genero : '';
    document.getElementById('campo-status').value = livro ? livro.status : 'quero-ler';
    document.getElementById('campo-data-leitura').value = livro && livro.dataLeitura ? livro.dataLeitura.slice(0, 10) : '';
    document.getElementById('campo-paginas').value = livro && livro.paginas !== null ? livro.paginas : '';
    document.getElementById('campo-editora').value = livro && livro.editora ? livro.editora : '';
    document.getElementById('campo-isbn').value = livro && livro.isbn ? livro.isbn : '';
    document.getElementById('campo-nota').value = livro && livro.nota !== null ? livro.nota : '';
    document.getElementById('campo-favorito').checked = livro ? !!livro.favorito : false;
    document.getElementById('campo-capa').value = livro && livro.capa ? livro.capa : '';
    document.getElementById('campo-sinopse').value = livro && livro.sinopse ? livro.sinopse : '';
    document.getElementById('campo-observacoes').value = livro && livro.observacoes ? livro.observacoes : '';

    abrirModal('modal-form');
}

function inicializarFormulario() {
    document.getElementById('form-livro').addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = document.getElementById('livro-id').value;
        const corpo = {
            titulo: document.getElementById('campo-titulo').value.trim(),
            autor: document.getElementById('campo-autor').value.trim(),
            genero: document.getElementById('campo-genero').value.trim(),
            status: document.getElementById('campo-status').value,
            dataLeitura: document.getElementById('campo-data-leitura').value || null,
            paginas: document.getElementById('campo-paginas').value || null,
            editora: document.getElementById('campo-editora').value.trim(),
            isbn: document.getElementById('campo-isbn').value.trim(),
            nota: document.getElementById('campo-nota').value || null,
            favorito: document.getElementById('campo-favorito').checked,
            capa: document.getElementById('campo-capa').value.trim(),
            sinopse: document.getElementById('campo-sinopse').value.trim(),
            observacoes: document.getElementById('campo-observacoes').value.trim()
        };

        try {
            let resultado;
            if (id) {
                resultado = await apiPut(`/livros/${id}`, corpo);
            } else {
                resultado = await apiPost('/livros', corpo);
            }

            mostrarToast(resultado.mensagem, 'sucesso');
            fecharModal('modal-form');
            carregarGenerosEAutoresSugestao();
            await recarregarSecaoAtual();
        } catch (erro) {
            mostrarToast(erro.message, 'erro');
        }
    });
}

async function recarregarSecaoAtual() {
    await mudarSecao(secaoAtual === 'busca' ? 'inicio' : secaoAtual);
}

// ══════════════════════════════════════
// DETALHE DO LIVRO
// ══════════════════════════════════════

async function abrirDetalheLivro(id) {
    try {
        const livro = await apiGet(`/livros/${id}`);
        renderizarDetalheLivro(livro);
        abrirModal('modal-detalhe');
    } catch (erro) {
        mostrarToast('Erro ao carregar detalhes do livro', 'erro');
    }
}

function renderizarDetalheLivro(livro) {
    const capaHtml = livro.capa
        ? `<img src="${escapeHtml(livro.capa)}" alt="${escapeHtml(livro.titulo)}" onerror="this.outerHTML='<div class=&quot;capa-livro-placeholder&quot;>${emojiCapa(livro.id)}</div>'">`
        : `<div class="capa-livro-placeholder">${emojiCapa(livro.id)}</div>`;

    const container = document.getElementById('conteudo-detalhe-livro');
    container.innerHTML = `
        <button class="modal-fechar" id="btn-fechar-detalhe">✕</button>

        <div class="detalhe-livro-topo">
            ${capaHtml}
            <div class="detalhe-livro-info">
                <h3>${escapeHtml(livro.titulo)}</h3>
                <p>✍️ ${escapeHtml(livro.autor)}</p>
                <p>🏷️ ${escapeHtml(livro.genero || 'Não informado')}</p>
                <p><span class="badge-status badge-${livro.status}">${NOMES_STATUS[livro.status]}</span></p>
                ${typeof livro.nota === 'number' ? `<p>⭐ Nota: ${livro.nota.toFixed(1)} / 5</p>` : ''}
            </div>
        </div>

        <div class="detalhe-grade">
            <p><strong>Páginas:</strong> ${livro.paginas ?? '—'}</p>
            <p><strong>Editora:</strong> ${escapeHtml(livro.editora || '—')}</p>
            <p><strong>ISBN:</strong> ${escapeHtml(livro.isbn || '—')}</p>
            <p><strong>Data de leitura:</strong> ${formatarData(livro.dataLeitura)}</p>
        </div>

        ${livro.sinopse ? `<div class="detalhe-bloco-texto"><h5>Sinopse</h5><p>${escapeHtml(livro.sinopse)}</p></div>` : ''}
        ${livro.observacoes ? `<div class="detalhe-bloco-texto"><h5>Minhas observações</h5><p>${escapeHtml(livro.observacoes)}</p></div>` : ''}

        <div class="acoes-detalhe">
            <button class="botao secundario" id="btn-favoritar-detalhe">${livro.favorito ? '💔 Remover dos favoritos' : '❤️ Favoritar'}</button>
            <select class="botao secundario" id="select-status-detalhe" style="cursor:pointer;">
                <option value="quero-ler" ${livro.status === 'quero-ler' ? 'selected' : ''}>📚 Quero Ler</option>
                <option value="lendo" ${livro.status === 'lendo' ? 'selected' : ''}>📖 Lendo</option>
                <option value="lido" ${livro.status === 'lido' ? 'selected' : ''}>❤️ Lido</option>
            </select>
            <button class="botao secundario" id="btn-editar-detalhe">✏️ Editar</button>
            <button class="botao perigo" id="btn-excluir-detalhe">🗑️ Excluir</button>
        </div>
    `;

    document.getElementById('btn-fechar-detalhe').addEventListener('click', () => {
        fecharModal('modal-detalhe');
    });

    document.getElementById('btn-favoritar-detalhe').addEventListener('click', async () => {
        try {
            const resultado = await apiPatch(`/livros/${livro.id}/favorito`, { favorito: !livro.favorito });
            mostrarToast(resultado.mensagem, 'sucesso');
            renderizarDetalheLivro(resultado.livro);
            recarregarSecaoAtual();
        } catch (erro) {
            mostrarToast(erro.message, 'erro');
        }
    });

    document.getElementById('select-status-detalhe').addEventListener('change', async (e) => {
        try {
            const resultado = await apiPatch(`/livros/${livro.id}/status`, { status: e.target.value });
            mostrarToast(resultado.mensagem, 'sucesso');
            renderizarDetalheLivro(resultado.livro);
            recarregarSecaoAtual();
        } catch (erro) {
            mostrarToast(erro.message, 'erro');
        }
    });

    document.getElementById('btn-editar-detalhe').addEventListener('click', () => {
        fecharModal('modal-detalhe');
        abrirModalFormulario(livro);
    });

    document.getElementById('btn-excluir-detalhe').addEventListener('click', async () => {
        const ok = await confirmar('Tem certeza que deseja remover este livro da sua coleção?');
        if (!ok) return;

        try {
            const resultado = await apiDelete(`/livros/${livro.id}`);
            mostrarToast(resultado.mensagem, 'sucesso');
            fecharModal('modal-detalhe');
            carregarGenerosEAutoresSugestao();
            await recarregarSecaoAtual();
        } catch (erro) {
            mostrarToast(erro.message, 'erro');
        }
    });
}
