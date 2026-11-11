import fs from 'node:fs';
import path from 'node:path';
import { atribuirPalavra, SEM_CATEGORIA } from './categorias.js';
import { config } from './config.js';
import { db, limparDiasAnteriores, metaGravar, metaObter } from './db.js';
import { fontePermitida, gravarFontesEncontradas } from './fontes.js';
import { verificarOllama } from './llm/ollama.js';
import { deduplicar, type OfertaCandidata } from './pipeline/dedup.js';
import { extrairOferta, type DadosExtraidos } from './pipeline/extracao.js';
import { ehPromocao, extrairLinks } from './pipeline/filtro.js';
import { buscarImagemDaPagina } from './pipeline/imagens.js';
import { resolverLink, type LinkResolvido } from './pipeline/links.js';
import { extrairPorRegras } from './pipeline/regras.js';
import { dataDoDia } from './tempo.js';
import { coletarDoDia } from './whatsapp/coleta.js';
import type { MensagemColetada } from './whatsapp/mensagem.js';
import { SessaoWhatsApp } from './whatsapp/sessao.js';

const WHATSAPP = '1. WhatsApp';
const EXTRACAO = '2. Extração';
const DEDUPLICACAO = '3. Deduplicação';
const CATEGORIZACAO = '4. Categorização';
const EXIBICAO = '5. Exibição';

interface ErroRegistrado {
  etapa: string;
  fonte?: string;
  mensagem?: string;
  erro: string;
}

interface Resumo {
  finalizadoEm: string;
  mensagensDoDia: number;
  extraidasPelaIa: number;
  duplicadasUnificadas: number;
  semPalavraChave: number;
  semImagem: number;
  ofertasFinais: number;
  duracaoSegundos?: number;
}

export const status = {
  estado: 'ocioso' as 'ocioso' | 'rodando' | 'concluido' | 'erro',
  etapa: '',
  atual: 0,
  total: 0,
  iniciadoEm: null as string | null,
  erros: [] as ErroRegistrado[],
  resumo: metaObter<Resumo>('ultimo_resumo'),
};

const pareado = () => fs.existsSync(path.join(config.pastaAuth, 'creds.json'));

export const conexao = {
  estado: (pareado() ? 'conectado' : 'desconectado') as 'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado',
  numero: metaObter<{ numero?: string }>('conexao')?.numero ?? null,
  etapa: null as string | null,
  erro: null as string | null,
};

export const sessao = new SessaoWhatsApp(() => {
  conexao.estado = 'aguardando_qr';
});

let operandoConexao = false;
export const ocupado = () => operandoConexao || status.estado === 'rodando';

export function previsao(): number | null {
  const ultima = metaObter<Resumo>('ultimo_resumo')?.duracaoSegundos;
  if (status.estado !== 'rodando' || !ultima || !status.iniciadoEm) return null;
  return Math.max(0, Math.round(ultima - (Date.now() - Date.parse(status.iniciadoEm)) / 1000));
}

function etapa(projeto: string, nome: string, atual = 0, total = 0) {
  Object.assign(status, { etapa: `${projeto} · ${nome}`, atual, total });
}

function registrarErro(e: ErroRegistrado) {
  if (status.erros.length < 500) status.erros.push(e);
}

async function emPool<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>) {
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, itens.length)) }, async () => {
      while (proximo < itens.length) await fn(itens[proximo++]);
    }),
  );
}

const LOJAS_DO_TEXTO: Record<string, string> = {
  'amazon': 'Amazon',
  'amazon brasil': 'Amazon',
  'mercado livre': 'Mercado Livre',
  'mercadolivre': 'Mercado Livre',
  'shopee': 'Shopee',
  'magalu': 'Magalu',
  'magazine luiza': 'Magalu',
  'aliexpress': 'AliExpress',
  'kabum': 'KaBuM!',
  'kabum!': 'KaBuM!',
};
const nomeLoja = (loja: string | null) => (loja ? (LOJAS_DO_TEXTO[loja.trim().toLowerCase()] ?? loja.trim()) : null);

export async function processarDia(dia: string) {
  const nomesFontes = new Map((db.prepare('SELECT id, nome FROM fonte').all() as { id: string; nome: string }[]).map((f) => [f.id, f.nome]));
  const mensagens = (
    db.prepare('SELECT chave, dados FROM mensagem_dia WHERE dia = ? ORDER BY timestamp').all(dia) as { chave: string; dados: string }[]
  )
    .map((l) => ({ chave: l.chave, m: JSON.parse(l.dados) as MensagemColetada }))
    .filter((x) => fontePermitida(x.m.fonteId));

  etapa(WHATSAPP, 'filtrando promoções', 0, mensagens.length);
  const promos = mensagens
    .map((x) => ({ ...x, texto: [x.m.texto, x.m.legenda].filter(Boolean).join('\n') }))
    .filter((x) => ehPromocao(x.texto));

  etapa(EXTRACAO, 'lendo mensagens', 0, promos.length);
  const extraidas = new Map<string, DadosExtraidos>();
  const foraDoPadrao = promos.filter((x) => {
    const d = extrairPorRegras(x.texto);
    if (d) extraidas.set(x.chave, d);
    return !d;
  });
  let feitas = 0;
  await emPool(foraDoPadrao, config.llmConcorrencia, async (x) => {
    try {
      extraidas.set(x.chave, await extrairOferta(x.texto, extrairLinks(x.texto), dia));
    } catch (e) {
      registrarErro({ etapa: `${EXTRACAO} · leitura da mensagem`, fonte: nomesFontes.get(x.m.fonteId), mensagem: x.texto.slice(0, 120), erro: (e as Error).message });
    }
    etapa(EXTRACAO, 'lendo mensagens fora do padrão (IA)', ++feitas, foraDoPadrao.length);
  });

  const linksUnicos = [...new Set([...extraidas.values()].map((d) => d.link))];
  const resolvidos = new Map<string, LinkResolvido>();
  feitas = 0;
  await emPool(linksUnicos, config.linkConcorrencia, async (link) => {
    const r = await resolverLink(link, dia);
    resolvidos.set(link, r);
    if (r.erro && !r.loja) registrarErro({ etapa: `${EXTRACAO} · links`, mensagem: link, erro: r.erro });
    etapa(EXTRACAO, 'resolvendo links', ++feitas, linksUnicos.length);
  });

  etapa(EXTRACAO, 'atribuindo palavras-chave');
  const palavraDoTitulo = new Map<string, ReturnType<typeof atribuirPalavra>>();
  const palavraDe = (titulo: string) => {
    if (!palavraDoTitulo.has(titulo)) palavraDoTitulo.set(titulo, atribuirPalavra(titulo));
    return palavraDoTitulo.get(titulo) ?? null;
  };
  const candidatas: OfertaCandidata[] = [];
  for (const x of promos) {
    const d = extraidas.get(x.chave);
    if (!d || (d.preco == null && !d.loja)) continue;
    const r = resolvidos.get(d.link)!;
    candidatas.push({
      palavraChave: palavraDe(d.titulo_produto)?.palavra ?? null,
      fonteId: x.m.fonteId,
      timestamp: x.m.timestamp,
      tituloProduto: d.titulo_produto,
      loja: r.loja ?? nomeLoja(d.loja),
      idLoja: r.idLoja,
      preco: d.preco,
      condicao: d.condicao,
      linkFinal: r.linkFinal,
      linkOriginal: d.link,
      caminhoImagem: x.m.imagem,
      imagemOrigem: x.m.imagemOrigem,
      textoMensagem: x.texto,
    });
  }

  const ofertas = await deduplicar(candidatas, (a, t) => etapa(DEDUPLICACAO, 'unindo anúncios repetidos', a, t));

  const pastaImagens = path.join(config.pastaImagens, dia);
  const semImagem = ofertas.filter((o) => !o.caminhoImagem);
  feitas = 0;
  await emPool(semImagem, config.linkConcorrencia, async (o) => {
    o.caminhoImagem = await buscarImagemDaPagina(o.linkFinal, pastaImagens).catch(() => null);
    etapa(DEDUPLICACAO, 'buscando imagens nas páginas', ++feitas, semImagem.length);
  });

  etapa(CATEGORIZACAO, 'categorizando pela palavra-chave');
  const palavras = ofertas.map((o) => palavraDe(o.tituloProduto));

  etapa(EXIBICAO, 'gravando ofertas');
  const extraidoEm = new Date().toISOString();
  const inserir = db.prepare(`INSERT INTO oferta (fonte_ids, titulo_produto, palavra_chave, variante, loja, id_loja, categoria, preco,
    condicao, link_final, link_original, caminho_imagem, qtd_mensagens, extraido_em, embedding, texto_mensagem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare('DELETE FROM oferta').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'oferta'").run();
    ofertas.forEach((o, i) => {
      inserir.run(
        JSON.stringify(o.fonteIds),
        o.tituloProduto,
        palavras[i]?.palavra ?? null,
        palavras[i]?.variante ?? null,
        o.loja,
        o.idLoja,
        palavras[i]?.categoria ?? SEM_CATEGORIA,
        o.preco,
        o.condicao,
        o.linkFinal,
        o.linkOriginal,
        o.caminhoImagem,
        o.qtdMensagens,
        extraidoEm,
        o.embedding ? Buffer.from(o.embedding.buffer, o.embedding.byteOffset, o.embedding.byteLength) : null,
        o.textoMensagem,
      );
    });
  })();

  const resumo: Resumo = {
    finalizadoEm: new Date().toISOString(),
    mensagensDoDia: mensagens.length,
    extraidasPelaIa: foraDoPadrao.length,
    duplicadasUnificadas: candidatas.length - ofertas.length,
    semPalavraChave: palavras.filter((p) => !p).length,
    semImagem: ofertas.filter((o) => !o.caminhoImagem).length,
    ofertasFinais: ofertas.length,
  };
  return resumo;
}

async function coletarESalvar(aoProgresso: (nome: string, atual?: number, total?: number) => void) {
  const dia = dataDoDia();
  limparDiasAnteriores(dia);
  conexao.erro = null;
  conexao.estado = 'conectando';
  try {
    const coleta = await coletarDoDia(sessao, (nome, atual, total) => {
      if (nome !== 'conectando') conexao.estado = 'conectado';
      aoProgresso(nome, atual, total);
    });
    gravarFontesEncontradas(coleta.todas);
    const salvarFonte = db.prepare('INSERT OR REPLACE INTO fonte (id, tipo, nome) VALUES (?, ?, ?)');
    const salvarMsg = db.prepare('INSERT OR REPLACE INTO mensagem_dia (chave, dia, fonte_id, timestamp, dados) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      for (const f of coleta.todas) salvarFonte.run(f.id, f.tipo, f.nome);
      for (const r of coleta.fontes) {
        for (const e of r.erros) registrarErro({ etapa: `${WHATSAPP} · coleta`, fonte: r.fonte.nome, erro: e });
        for (const m of r.mensagens) salvarMsg.run(`${m.fonteId}|${m.id}`, dia, m.fonteId, m.timestamp, JSON.stringify(m));
      }
    })();
    for (const erro of coleta.erros) registrarErro({ etapa: `${WHATSAPP} · coleta`, erro });
    Object.assign(conexao, { estado: 'conectado', numero: sessao.numero ?? conexao.numero });
    metaGravar('conexao', { numero: conexao.numero });
    return dia;
  } catch (e) {
    await sessao.fechar().catch(() => {});
    conexao.estado = pareado() ? 'conectado' : 'desconectado';
    throw e;
  }
}

export async function conectar() {
  if (ocupado()) return;
  operandoConexao = true;
  try {
    await coletarESalvar((nome, atual, total) => {
      conexao.etapa = total ? `${nome} (${atual} de ${total})` : nome;
    });
  } catch (e) {
    const msg = (e as Error).message;
    conexao.erro = msg === 'Conexão cancelada.' ? null : msg;
  } finally {
    operandoConexao = false;
    conexao.etapa = null;
  }
}

export async function cancelarConexao() {
  if (conexao.estado === 'aguardando_qr' || conexao.estado === 'conectando') await sessao.fechar();
}

export async function desconectar() {
  if (ocupado()) return;
  operandoConexao = true;
  try {
    await sessao.sair();
  } finally {
    Object.assign(conexao, { estado: 'desconectado', numero: null, etapa: null, erro: null });
    metaGravar('conexao', {});
    operandoConexao = false;
  }
}

export async function executarExtracao() {
  if (ocupado() || conexao.estado !== 'conectado') return;
  Object.assign(status, { estado: 'rodando', iniciadoEm: new Date().toISOString(), erros: [] });
  const inicio = Date.now();
  try {
    etapa(EXTRACAO, 'verificando Ollama');
    const problema = await verificarOllama();
    if (problema) throw new Error(problema);
    const dia = await coletarESalvar((nome, atual, total) => etapa(WHATSAPP, nome, atual ?? 0, total ?? 0));
    const resumo = { ...(await processarDia(dia)), duracaoSegundos: Math.round((Date.now() - inicio) / 1000) };
    metaGravar('ultimo_resumo', resumo);
    Object.assign(status, { estado: 'concluido', resumo, etapa: 'concluído' });
  } catch (e) {
    registrarErro({ etapa: status.etapa, erro: (e as Error).message });
    Object.assign(status, { estado: 'erro', etapa: `falhou: ${(e as Error).message}` });
    await sessao.fechar().catch(() => {});
  }
}
