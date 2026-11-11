import { atribuirPalavra, CATEGORIAS, SEM_CATEGORIA, vocabulario } from './categorias.js';
import { config } from './config.js';
import { db } from './db.js';
import { cosseno, embeddings } from './llm/ollama.js';

interface LinhaOferta {
  id: number;
  fonte_ids: string;
  titulo_produto: string;
  palavra_chave: string | null;
  variante: string | null;
  loja: string | null;
  categoria: string;
  preco: number | null;
  condicao: string | null;
  link_final: string | null;
  link_original: string | null;
  caminho_imagem: string | null;
  extraido_em: string;
  embedding: Buffer | null;
  texto_mensagem: string | null;
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function caminhoImagem(id: number): string | null {
  const l = db.prepare('SELECT caminho_imagem FROM oferta WHERE id = ?').get(id) as { caminho_imagem: string | null } | undefined;
  return l?.caminho_imagem ?? null;
}

export async function listarOfertas(q?: string) {
  const linhas = db.prepare('SELECT * FROM oferta').all() as LinhaOferta[];
  const fontes = new Map(
    (db.prepare('SELECT id, nome FROM fonte').all() as { id: string; nome: string }[]).map((f) => [f.id, f.nome]),
  );

  const relevancia = new Map<number, number>();
  const termo = q?.trim();
  if (termo) {
    const tokens = normalizar(termo).split(/\s+/).filter(Boolean);
    for (const l of linhas) {
      const palheiro = normalizar(
        [l.titulo_produto, l.palavra_chave, l.loja, l.condicao, l.categoria].filter(Boolean).join(' '),
      );
      if (tokens.every((t) => palheiro.includes(t))) relevancia.set(l.id, 2);
    }
    const corte = relevancia.size > 0 ? config.buscaLimiar + 0.1 : config.buscaLimiar;
    try {
      const [vq] = await embeddings([termo.toLowerCase()]);
      for (const l of linhas) {
        if (!l.embedding || relevancia.has(l.id)) continue;
        const v = new Float32Array(l.embedding.buffer, l.embedding.byteOffset, l.embedding.byteLength / 4);
        if (v.length !== vq.length) continue;
        const s = cosseno(vq, v);
        if (s >= corte) relevancia.set(l.id, s);
      }
    } catch {}
  }

  const filtradas = termo ? linhas.filter((l) => relevancia.has(l.id)) : linhas;
  const paraJson = (l: LinhaOferta) => ({
    id: l.id,
    titulo_produto: l.titulo_produto,
    palavra_chave: l.palavra_chave,
    variante: l.variante,
    loja: l.loja,
    categoria: l.categoria,
    preco: l.preco,
    condicao: l.condicao,
    link: l.link_final ?? l.link_original,
    imagem: l.caminho_imagem ? `/api/imagens/${l.id}?v=${Date.parse(l.extraido_em)}` : null,
    fontes: (JSON.parse(l.fonte_ids) as string[]).map((id) => fontes.get(id) ?? id),
    mensagem: l.texto_mensagem,
  });

  const comparar = (x: string, y: string) => x.localeCompare(y, 'pt-BR', { sensitivity: 'base' });
  const posicao = new Map(vocabulario().map((p, i) => [p.palavra, i]));
  const pos = (l: LinhaOferta) => (l.palavra_chave != null ? (posicao.get(l.palavra_chave) ?? Infinity) : Infinity);
  const ordenar = (a: LinhaOferta, b: LinhaOferta) => pos(a) - pos(b) || comparar(a.titulo_produto, b.titulo_produto);

  const categorias = CATEGORIAS.map((categoria) => ({
    categoria,
    ofertas: filtradas.filter((l) => l.categoria === categoria).sort(ordenar).map(paraJson),
  })).filter((c) => c.ofertas.length > 0);

  return { total: filtradas.length, categorias };
}

export function reclassificarOfertas() {
  const linhas = db.prepare('SELECT id, titulo_produto FROM oferta').all() as { id: number; titulo_produto: string }[];
  const atualizar = db.prepare('UPDATE oferta SET palavra_chave = ?, variante = ?, categoria = ? WHERE id = ?');
  db.transaction(() => {
    for (const l of linhas) {
      const p = atribuirPalavra(l.titulo_produto);
      atualizar.run(p?.palavra ?? null, p?.variante ?? null, p?.categoria ?? SEM_CATEGORIA, l.id);
    }
  })();
}

export function resumoVocabulario() {
  const uso = new Map(
    (db.prepare('SELECT palavra_chave p, COUNT(*) n FROM oferta WHERE palavra_chave IS NOT NULL GROUP BY palavra_chave').all() as { p: string; n: number }[]).map(
      (l) => [l.p, l.n],
    ),
  );
  const semCategoria = (db.prepare('SELECT titulo_produto t FROM oferta WHERE palavra_chave IS NULL ORDER BY titulo_produto').all() as { t: string }[]).map(
    (l) => l.t,
  );
  return {
    categorias: CATEGORIAS.filter((c) => c !== SEM_CATEGORIA),
    palavras: vocabulario().map((p) => ({ ...p, ofertas: uso.get(p.palavra) ?? 0 })),
    semCategoria,
  };
}
