const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'db.json');

const STATUS_VALIDOS = ['lido', 'lendo', 'quero-ler'];
const GENEROS_PADRAO = ['Fantasia', 'Romance', 'Terror', 'Ficção', 'Suspense', 'Biografia', 'Poesia', 'Autoajuda'];

app.use(express.json());
app.use(express.static(__dirname)); // serve index.html, style.css, app.js na raiz

// ══════════════════════════════════════
// PERSISTÊNCIA
// ══════════════════════════════════════
// IMPORTANTE: só cria um banco novo se o arquivo realmente não existir.
// Se já existir, ele é sempre lido e reaproveitado — nunca recriado do
// zero — para garantir que os livros nunca desapareçam entre reinícios.

function lerDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            const dbInicial = { livros: [], generosPersonalizados: [] };
            fs.writeFileSync(DB_PATH, JSON.stringify(dbInicial, null, 2));
            return dbInicial;
        }
        const dados = fs.readFileSync(DB_PATH, 'utf-8');
        const db = JSON.parse(dados);
        db.livros = Array.isArray(db.livros) ? db.livros : [];
        db.generosPersonalizados = Array.isArray(db.generosPersonalizados) ? db.generosPersonalizados : [];
        return db;
    } catch (erro) {
        console.error('Erro ao ler banco de dados:', erro);
        // Em caso de erro de leitura, NÃO sobrescrevemos o arquivo —
        // preferimos falhar a requisição a arriscar perder dados.
        throw new Error('Não foi possível ler a base de dados');
    }
}

function salvarDB(dados) {
    // Escrita atômica: grava em arquivo temporário e troca o nome no final,
    // para nunca deixar o db.json corrompido caso o processo caia no meio da escrita.
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(dados, null, 2));
    fs.renameSync(tmpPath, DB_PATH);
}

// Fila simples para serializar escritas concorrentes
let filaDeEscrita = Promise.resolve();
function comTravaDeEscrita(tarefa) {
    const execucao = filaDeEscrita.then(() => tarefa());
    filaDeEscrita = execucao.catch(() => {});
    return execucao;
}

function gerarId(array) {
    return array.length > 0 ? Math.max(...array.map(item => item.id)) + 1 : 1;
}

// ══════════════════════════════════════
// SANITIZAÇÃO E VALIDAÇÃO
// ══════════════════════════════════════

function limparTexto(valor, maxLen = 500) {
    if (typeof valor !== 'string') return '';
    return valor.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function urlCapaValida(valor) {
    if (typeof valor !== 'string' || valor.trim() === '') return null;
    try {
        const url = new URL(valor.trim());
        return (url.protocol === 'http:' || url.protocol === 'https:') ? valor.trim() : null;
    } catch {
        return null;
    }
}

function validarNota(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (Number.isNaN(n) || n < 0 || n > 5) return undefined; // undefined = inválido
    return Math.round(n * 2) / 2; // permite meias notas (0, 0.5, 1, 1.5 ... 5)
}

function validarPaginas(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) return undefined;
    return n;
}

function validarIsbn(valor) {
    if (valor === undefined || valor === null || valor.trim() === '') return null;
    const limpo = valor.replace(/[\s-]/g, '');
    if (!/^\d{10}(\d{3})?$/.test(limpo)) return undefined; // ISBN-10 ou ISBN-13
    return limpo;
}

function validarStatus(valor) {
    return STATUS_VALIDOS.includes(valor) ? valor : undefined;
}

function normalizarNomeAutor(nome) {
    return limparTexto(nome, 150);
}

// Remove acentos para permitir buscar "principe" e encontrar "Príncipe"
function normalizarBusca(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

// Monta o objeto final do livro a partir do corpo da requisição.
// Retorna { erro } se algo obrigatório/errado, ou { livro } se tudo ok.
function montarLivro(corpo, livroExistente = {}) {
    const {
        titulo, autor, genero, status, dataLeitura, paginas,
        editora, isbn, nota, favorito, sinopse, observacoes, capa
    } = corpo;

    const resultado = { ...livroExistente };

    if (titulo !== undefined) {
        const t = limparTexto(titulo, 250);
        if (t === '') return { erro: 'Título é obrigatório' };
        resultado.titulo = t;
    } else if (!resultado.titulo) {
        return { erro: 'Título é obrigatório' };
    }

    if (autor !== undefined) {
        const a = normalizarNomeAutor(autor);
        if (a === '') return { erro: 'Autor é obrigatório' };
        resultado.autor = a;
    } else if (!resultado.autor) {
        return { erro: 'Autor é obrigatório' };
    }

    if (genero !== undefined) resultado.genero = limparTexto(genero, 60) || 'Não informado';
    else if (!resultado.genero) resultado.genero = 'Não informado';

    if (status !== undefined) {
        const s = validarStatus(status);
        if (s === undefined) return { erro: 'Status inválido. Use: lido, lendo ou quero-ler' };
        resultado.status = s;
    } else if (!resultado.status) {
        resultado.status = 'quero-ler';
    }

    if (dataLeitura !== undefined) {
        resultado.dataLeitura = dataLeitura ? limparTexto(dataLeitura, 30) : null;
    } else if (resultado.dataLeitura === undefined) {
        resultado.dataLeitura = null;
    }

    if (paginas !== undefined) {
        const p = validarPaginas(paginas);
        if (p === undefined) return { erro: 'Número de páginas deve ser um inteiro maior ou igual a zero' };
        resultado.paginas = p;
    } else if (resultado.paginas === undefined) {
        resultado.paginas = null;
    }

    if (editora !== undefined) resultado.editora = limparTexto(editora, 150) || null;
    else if (resultado.editora === undefined) resultado.editora = null;

    if (isbn !== undefined) {
        const i = validarIsbn(isbn);
        if (i === undefined) return { erro: 'ISBN inválido (use 10 ou 13 dígitos)' };
        resultado.isbn = i;
    } else if (resultado.isbn === undefined) {
        resultado.isbn = null;
    }

    if (nota !== undefined) {
        const n = validarNota(nota);
        if (n === undefined) return { erro: 'Nota deve ser um número entre 0 e 5' };
        resultado.nota = n;
    } else if (resultado.nota === undefined) {
        resultado.nota = null;
    }

    if (favorito !== undefined) resultado.favorito = Boolean(favorito);
    else if (resultado.favorito === undefined) resultado.favorito = false;

    if (sinopse !== undefined) resultado.sinopse = limparTexto(sinopse, 2000) || null;
    else if (resultado.sinopse === undefined) resultado.sinopse = null;

    if (observacoes !== undefined) resultado.observacoes = limparTexto(observacoes, 2000) || null;
    else if (resultado.observacoes === undefined) resultado.observacoes = null;

    if (capa !== undefined) resultado.capa = urlCapaValida(capa) || null;
    else if (resultado.capa === undefined) resultado.capa = null;

    return { livro: resultado };
}

// ══════════════════════════════════════
// ENDPOINTS - LIVROS
// ══════════════════════════════════════

app.get('/api/livros', (req, res) => {
    const db = lerDB();
    let livros = [...db.livros];

    const { busca, status, genero, autor, favorito, ordenarPor, direcao } = req.query;

    if (busca && busca.trim() !== '') {
        const termo = normalizarBusca(busca.trim());
        livros = livros.filter(l =>
            normalizarBusca(l.titulo).includes(termo) ||
            normalizarBusca(l.autor).includes(termo) ||
            normalizarBusca(l.genero || '').includes(termo) ||
            (l.isbn || '').includes(termo)
        );
    }

    if (status && STATUS_VALIDOS.includes(status)) {
        livros = livros.filter(l => l.status === status);
    }

    if (genero && genero !== 'todos') {
        livros = livros.filter(l => (l.genero || '').toLowerCase() === genero.toLowerCase());
    }

    if (autor) {
        livros = livros.filter(l => l.autor.toLowerCase() === autor.toLowerCase());
    }

    if (favorito === 'true') {
        livros = livros.filter(l => l.favorito === true);
    }

    const campoOrdenacao = ['titulo', 'autor', 'dataAdicao', 'nota', 'genero'].includes(ordenarPor) ? ordenarPor : 'dataAdicao';
    const dir = direcao === 'asc' ? 1 : -1;

    livros.sort((a, b) => {
        let valA = a[campoOrdenacao];
        let valB = b[campoOrdenacao];
        if (campoOrdenacao === 'nota') {
            valA = valA ?? -1;
            valB = valB ?? -1;
        }
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });

    res.json(livros);
});

app.get('/api/livros/:id', (req, res) => {
    const db = lerDB();
    const livro = db.livros.find(l => l.id === parseInt(req.params.id));
    if (!livro) return res.status(404).json({ erro: 'Livro não encontrado' });
    res.json(livro);
});

app.post('/api/livros', (req, res) => {
    comTravaDeEscrita(async () => {
        const { erro, livro } = montarLivro(req.body);
        if (erro) return res.status(400).json({ erro });

        const db = lerDB();
        const novoLivro = {
            id: gerarId(db.livros),
            ...livro,
            dataAdicao: new Date().toISOString()
        };

        db.livros.push(novoLivro);

        if (novoLivro.genero && novoLivro.genero !== 'Não informado' &&
            !GENEROS_PADRAO.some(g => g.toLowerCase() === novoLivro.genero.toLowerCase()) &&
            !db.generosPersonalizados.some(g => g.toLowerCase() === novoLivro.genero.toLowerCase())) {
            db.generosPersonalizados.push(novoLivro.genero);
        }

        salvarDB(db);
        res.status(201).json({ mensagem: '💕 Livro adicionado à sua biblioteca!', livro: novoLivro });
    }).catch(erro => {
        console.error('Erro ao adicionar livro:', erro);
        res.status(500).json({ erro: 'Erro interno ao adicionar livro' });
    });
});

app.put('/api/livros/:id', (req, res) => {
    comTravaDeEscrita(async () => {
        const id = parseInt(req.params.id);
        const db = lerDB();
        const indice = db.livros.findIndex(l => l.id === id);
        if (indice === -1) return res.status(404).json({ erro: 'Livro não encontrado' });

        const { erro, livro } = montarLivro(req.body, db.livros[indice]);
        if (erro) return res.status(400).json({ erro });

        livro.id = id;
        db.livros[indice] = livro;

        if (livro.genero && livro.genero !== 'Não informado' &&
            !GENEROS_PADRAO.some(g => g.toLowerCase() === livro.genero.toLowerCase()) &&
            !db.generosPersonalizados.some(g => g.toLowerCase() === livro.genero.toLowerCase())) {
            db.generosPersonalizados.push(livro.genero);
        }

        salvarDB(db);
        res.json({ mensagem: 'Livro atualizado com sucesso', livro });
    }).catch(erro => {
        console.error('Erro ao atualizar livro:', erro);
        res.status(500).json({ erro: 'Erro interno ao atualizar livro' });
    });
});

app.patch('/api/livros/:id/status', (req, res) => {
    comTravaDeEscrita(async () => {
        const id = parseInt(req.params.id);
        const { status } = req.body;
        const statusValido = validarStatus(status);
        if (!statusValido) return res.status(400).json({ erro: 'Status inválido. Use: lido, lendo ou quero-ler' });

        const db = lerDB();
        const indice = db.livros.findIndex(l => l.id === id);
        if (indice === -1) return res.status(404).json({ erro: 'Livro não encontrado' });

        db.livros[indice].status = statusValido;
        if (statusValido === 'lido' && !db.livros[indice].dataLeitura) {
            db.livros[indice].dataLeitura = new Date().toISOString();
        }

        salvarDB(db);

        const mensagens = {
            'lido': '❤️ Livro marcado como lido!',
            'lendo': '📖 Livro movido para "Lendo".',
            'quero-ler': '📚 Livro movido para "Quero Ler".'
        };

        res.json({ mensagem: mensagens[statusValido], livro: db.livros[indice] });
    }).catch(erro => {
        console.error('Erro ao alterar status:', erro);
        res.status(500).json({ erro: 'Erro interno ao alterar status' });
    });
});

app.patch('/api/livros/:id/favorito', (req, res) => {
    comTravaDeEscrita(async () => {
        const id = parseInt(req.params.id);
        const { favorito } = req.body;

        const db = lerDB();
        const indice = db.livros.findIndex(l => l.id === id);
        if (indice === -1) return res.status(404).json({ erro: 'Livro não encontrado' });

        db.livros[indice].favorito = Boolean(favorito);
        salvarDB(db);

        res.json({
            mensagem: db.livros[indice].favorito ? '❤️ Adicionado aos favoritos!' : 'Removido dos favoritos',
            livro: db.livros[indice]
        });
    }).catch(erro => {
        console.error('Erro ao favoritar:', erro);
        res.status(500).json({ erro: 'Erro interno ao favoritar' });
    });
});

app.delete('/api/livros/:id', (req, res) => {
    comTravaDeEscrita(async () => {
        const id = parseInt(req.params.id);
        const db = lerDB();
        const indice = db.livros.findIndex(l => l.id === id);
        if (indice === -1) return res.status(404).json({ erro: 'Livro não encontrado' });

        db.livros.splice(indice, 1);
        salvarDB(db);

        res.json({ mensagem: 'Livro removido da sua coleção' });
    }).catch(erro => {
        console.error('Erro ao excluir livro:', erro);
        res.status(500).json({ erro: 'Erro interno ao excluir livro' });
    });
});

// ══════════════════════════════════════
// ENDPOINTS - AUTORES
// ══════════════════════════════════════

app.get('/api/autores', (req, res) => {
    const db = lerDB();
    const mapa = new Map();

    db.livros.forEach(l => {
        const chave = l.autor.toLowerCase();
        if (!mapa.has(chave)) {
            mapa.set(chave, { nome: l.autor, totalLivros: 0, lidos: 0 });
        }
        const registro = mapa.get(chave);
        registro.totalLivros++;
        if (l.status === 'lido') registro.lidos++;
    });

    const autores = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json(autores);
});

app.get('/api/autores/:nome/livros', (req, res) => {
    const db = lerDB();
    const nome = decodeURIComponent(req.params.nome).toLowerCase();
    const livros = db.livros.filter(l => l.autor.toLowerCase() === nome);
    res.json(livros);
});

// ══════════════════════════════════════
// ENDPOINTS - GÊNEROS
// ══════════════════════════════════════

app.get('/api/generos', (req, res) => {
    const db = lerDB();
    const generosUsados = [...new Set(db.livros.map(l => l.genero).filter(g => g && g !== 'Não informado'))];
    const todos = [...new Set([...GENEROS_PADRAO, ...db.generosPersonalizados, ...generosUsados])];
    res.json(todos.sort((a, b) => a.localeCompare(b, 'pt-BR')));
});

// ══════════════════════════════════════
// ENDPOINTS - ESTATÍSTICAS
// ══════════════════════════════════════

app.get('/api/estatisticas', (req, res) => {
    const db = lerDB();
    const livros = db.livros;

    const lidos = livros.filter(l => l.status === 'lido');
    const lendo = livros.filter(l => l.status === 'lendo');
    const queroLer = livros.filter(l => l.status === 'quero-ler');
    const favoritos = livros.filter(l => l.favorito);

    const autoresUnicos = new Set(livros.map(l => l.autor.toLowerCase()));

    const contagemGeneros = {};
    livros.forEach(l => {
        if (l.genero && l.genero !== 'Não informado') {
            contagemGeneros[l.genero] = (contagemGeneros[l.genero] || 0) + 1;
        }
    });
    let generoMaisLido = null;
    let maxGenero = 0;
    for (const [genero, qtd] of Object.entries(contagemGeneros)) {
        if (qtd > maxGenero) { maxGenero = qtd; generoMaisLido = genero; }
    }

    const contagemAutores = {};
    livros.forEach(l => {
        contagemAutores[l.autor] = (contagemAutores[l.autor] || 0) + 1;
    });
    let autorComMais = null;
    let maxAutor = 0;
    for (const [autor, qtd] of Object.entries(contagemAutores)) {
        if (qtd > maxAutor) { maxAutor = qtd; autorComMais = autor; }
    }

    const notasValidas = livros.filter(l => typeof l.nota === 'number');
    const mediaNotas = notasValidas.length > 0
        ? Math.round((notasValidas.reduce((s, l) => s + l.nota, 0) / notasValidas.length) * 10) / 10
        : null;

    const totalPaginasLidas = lidos.reduce((soma, l) => soma + (l.paginas || 0), 0);

    res.json({
        totalLivros: livros.length,
        lidos: lidos.length,
        lendo: lendo.length,
        queroLer: queroLer.length,
        favoritos: favoritos.length,
        autores: autoresUnicos.size,
        generoMaisLido,
        autorComMais,
        mediaNotas,
        totalPaginasLidas,
        recentes: [...livros]
            .sort((a, b) => new Date(b.dataAdicao) - new Date(a.dataAdicao))
            .slice(0, 6),
        continuandoLendo: lendo.slice(0, 5)
    });
});

// ══════════════════════════════════════
// ROTA CATCH-ALL PARA O FRONTEND (SPA)
// ══════════════════════════════════════
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

app.listen(PORT, () => {
    console.log('════════════════════════════════════════');
    console.log('  💗 BIBLIOTECA DA FOFURA - SERVIDOR');
    console.log('════════════════════════════════════════');
    console.log(`  ✅ Rodando em http://localhost:${PORT}`);
    console.log('════════════════════════════════════════');
});
