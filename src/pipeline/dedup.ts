import { config } from '../config.js';
import { cosseno, embeddings } from '../llm/ollama.js';

export interface OfertaCandidata {
  palavraChave: string | null;
  fonteId: string;
  timestamp: number;
  tituloProduto: string;
  loja: string | null;
  idLoja: string | null;
  preco: number | null;
  condicao: string | null;
  linkFinal: string;
  linkOriginal: string;
  caminhoImagem: string | null;
  imagemOrigem: 'midia' | 'preview_hd' | 'preview_link' | null;
  textoMensagem: string;
}

interface OfertaFinal {
  fonteIds: string[];
  tituloProduto: string;
  loja: string | null;
  idLoja: string | null;
  preco: number | null;
  condicao: string | null;
  linkFinal: string;
  linkOriginal: string;
  caminhoImagem: string | null;
  qtdMensagens: number;
  textoMensagem: string;
  embedding: Float32Array | null;
}

interface Pilha {
  palavraChave: string | null;
  membros: OfertaCandidata[];
  rep: OfertaCandidata;
  loja: string | null;
  idLoja: string | null;
  embedding?: Float32Array;
}

function escolherRep(membros: OfertaCandidata[]) {
  const comPreco = membros.filter((m) => m.preco != null);
  if (comPreco.length) return comPreco.reduce((a, b) => (b.preco! < a.preco! ? b : a));
  return membros[0];
}

function mesmaLoja(a: Pilha, b: Pilha) {
  return !!a.loja && !!b.loja && a.loja.toLowerCase() === b.loja.toLowerCase();
}

function unir(destino: Pilha, origem: Pilha) {
  destino.membros.push(...origem.membros);
  destino.rep = escolherRep(destino.membros);
  destino.loja ??= origem.loja;
  destino.idLoja ??= origem.idLoja;
  destino.palavraChave ??= origem.palavraChave;
}

const similaridade = (a: Pilha, b: Pilha) => cosseno(a.embedding!, b.embedding!);

function notaUniao(a: Pilha, b: Pilha): number | null {
  if (!mesmaLoja(a, b)) return null;
  if (a.idLoja && b.idLoja) return null;
  if (a.palavraChave !== b.palavraChave) return null;
  const s = similaridade(a, b);
  return s >= config.limiarSimilaridade && medidasEPrecoBatem(a, b) ? s : null;
}

const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|mm|cm|m|w|v|gb|tb|mah|btus?|pol(?:egadas)?|"|un(?:idades)?|pe[cç]as|pares|cubos|bocas|lugares|portas)\b|\b(?:kit|c\/|com)\s*(\d+)\b|^(\d+)\s+\p{L}/giu;
function medidas(titulo: string): Set<string> {
  const achadas = [...titulo.toLowerCase().matchAll(RE_MEDIDA)].map((m) =>
    m[1] ? `${m[1].replace(',', '.')}${m[2].replace(/^btus?$/, 'btu').replace(/^pol(egadas)?$/, '"')}` : `q${m[3] ?? m[4]}`,
  );
  return new Set(achadas);
}

function medidasEPrecoBatem(a: Pilha, b: Pilha): boolean {
  const ma = medidas(a.rep.tituloProduto);
  const mb = medidas(b.rep.tituloProduto);
  const contem = (x: Set<string>, y: Set<string>) => [...y].every((m) => x.has(m));
  if (!contem(ma, mb) && !contem(mb, ma)) return false;
  const pa = a.rep.preco;
  const pb = b.rep.preco;
  return pa == null || pb == null || Math.max(pa, pb) / Math.min(pa, pb) <= 1.25;
}

function tituloMaisCitado(membros: OfertaCandidata[]) {
  const contagem = new Map<string, number>();
  for (const m of membros) contagem.set(m.tituloProduto, (contagem.get(m.tituloProduto) ?? 0) + 1);
  return [...contagem].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

export async function deduplicar(
  candidatas: OfertaCandidata[],
  aoProgresso: (atual: number, total: number) => void,
): Promise<OfertaFinal[]> {
  const porId = new Map<string, Pilha>();
  const pilhas: Pilha[] = [];
  for (const c of [...candidatas].sort((a, b) => a.timestamp - b.timestamp)) {
    if (c.loja && c.idLoja) {
      const k = `${c.loja}|${c.idLoja}`;
      const g = porId.get(k);
      if (g && g.palavraChave === c.palavraChave) {
        g.membros.push(c);
        g.rep = escolherRep(g.membros);
        continue;
      }
      const novo: Pilha = { membros: [c], rep: c, loja: c.loja, idLoja: c.idLoja, palavraChave: c.palavraChave };
      if (!g) porId.set(k, novo);
      pilhas.push(novo);
    } else {
      pilhas.push({ membros: [c], rep: c, loja: c.loja, idLoja: null, palavraChave: c.palavraChave });
    }
  }

  const titulos = [...new Set(candidatas.map((c) => c.tituloProduto.toLowerCase()))];
  const vetorDe = new Map((await embeddings(titulos)).map((v, i) => [titulos[i], v]));
  for (const g of pilhas) g.embedding = vetorDe.get(g.rep.tituloProduto.toLowerCase());

  const finais: Pilha[] = [];
  for (let i = 0; i < pilhas.length; i++) {
    aoProgresso(i + 1, pilhas.length);
    const g = pilhas[i];
    const alvo = finais
      .map((f) => ({ f, s: notaUniao(f, g) }))
      .filter((x): x is { f: Pilha; s: number } => x.s != null)
      .sort((a, b) => b.s - a.s)[0]?.f;
    if (alvo) unir(alvo, g);
    else finais.push(g);
  }

  for (let mudou = true; mudou; ) {
    mudou = false;
    for (let i = 0; i < finais.length; i++) {
      for (let j = i + 1; j < finais.length; j++) {
        if (notaUniao(finais[i], finais[j]) == null) continue;
        unir(finais[i], finais[j]);
        finais.splice(j--, 1);
        mudou = true;
      }
    }
  }

  return finais.map((g): OfertaFinal => {
    const rep = g.rep;
    return {
      fonteIds: [...new Set(g.membros.map((m) => m.fonteId))],
      tituloProduto: tituloMaisCitado(g.membros),
      loja: rep.loja ?? g.loja,
      idLoja: g.idLoja,
      preco: rep.preco,
      condicao: rep.condicao,
      linkFinal: rep.linkFinal,
      linkOriginal: rep.linkOriginal,
      caminhoImagem:
        [rep, ...g.membros].find((m) => m.caminhoImagem && m.imagemOrigem !== 'preview_link')?.caminhoImagem ??
        [rep, ...g.membros].find((m) => m.caminhoImagem)?.caminhoImagem ??
        null,
      qtdMensagens: g.membros.length,
      textoMensagem: rep.textoMensagem,
      embedding: g.embedding ?? null,
    };
  });
}
