import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { MARCAS_PADRAO, TIPOS_PADRAO } from './vocabulario-padrao.js';

export const SEM_CATEGORIA = 'Sem categoria';

export const CATEGORIAS = [
  'Eletrodomésticos',
  'Eletrônicos e informática',
  'Casa, decoração e cozinha',
  'Moda',
  'Beleza, perfumaria e higiene pessoal',
  'Esporte e lazer',
  'Ferramentas e automotivo',
  'Supermercado e bebidas',
  'Brinquedos e bebê',
  'Livros e papelaria',
  'Pet',
  'Cupons e serviços',
  SEM_CATEGORIA,
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export interface PalavraChave {
  palavra: string;
  categoria: Categoria;
  variantes: string[];
  marcas: string[];
}

export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&+]+/g, ' ')
    .trim();

const arquivo = () => path.join(config.pastaDados, 'vocabulario.json');

function padrao(): PalavraChave[] {
  return Object.entries(TIPOS_PADRAO).flatMap(([categoria, linhas]) =>
    linhas.map((linha) => {
      const [palavra, ...variantes] = linha.split('|').map((v) => v.trim());
      return { palavra, categoria: categoria as Categoria, variantes, marcas: MARCAS_PADRAO[palavra] ?? [] };
    }),
  );
}

function validar(entrada: unknown): { vocabulario: PalavraChave[]; erros: string[] } {
  const erros: string[] = [];
  const dono = new Map<string, string>();
  const vocabulario: PalavraChave[] = [];
  const limpar = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean))];
  for (const item of (Array.isArray(entrada) ? entrada : []) as Record<string, unknown>[]) {
    const palavra = String(item?.palavra ?? '').trim();
    const categoria = String(item?.categoria ?? '') as Categoria;
    if (!palavra) continue;
    if (!CATEGORIAS.includes(categoria) || categoria === SEM_CATEGORIA) {
      erros.push(`"${palavra}" precisa de uma categoria.`);
      continue;
    }
    const p: PalavraChave = { palavra, categoria, variantes: limpar(item.variantes), marcas: limpar(item.marcas) };
    for (const termo of new Set([p.palavra, ...p.variantes, ...p.marcas].map(normalizar).filter(Boolean))) {
      const outra = dono.get(termo);
      if (outra) erros.push(`"${termo}" está em "${outra}" e em "${palavra}".`);
      else dono.set(termo, palavra);
    }
    vocabulario.push(p);
  }
  return { vocabulario, erros };
}

let atual: PalavraChave[] | null = null;
let compilado: { tipos: Termo[]; marcas: Termo[] } | null = null;

export function vocabulario(): PalavraChave[] {
  if (!atual) {
    let lido: unknown = null;
    try {
      lido = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    } catch {}
    const { vocabulario: v, erros } = validar(lido ?? padrao());
    if (erros.length) console.warn(`Vocabulário com problemas: ${erros.join(' ')}`);
    if (lido == null) {
      fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
      fs.writeFileSync(arquivo(), JSON.stringify(v, null, 2));
    }
    atual = v;
  }
  return atual;
}

export function salvarVocabulario(entrada: unknown): { ok: boolean; erros: string[] } {
  const { vocabulario: v, erros } = validar(entrada);
  if (erros.length) return { ok: false, erros };
  fs.writeFileSync(arquivo(), JSON.stringify(v, null, 2));
  atual = v;
  compilado = null;
  return { ok: true, erros: [] };
}

const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'para', 'com', 'sem', 'a', 'o', 'em', 'na', 'no', 'ao']);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function comPlural(palavra: string): string {
  const p = escapar(palavra);
  if (LIGACOES.has(palavra) || palavra.length <= 2 || /\d$/.test(palavra) || /s$/.test(palavra)) return p;
  if (/ao$/.test(palavra)) return `${p.slice(0, -2)}(?:ao|oes|aes|aos)`;
  if (/m$/.test(palavra)) return `${p.slice(0, -1)}(?:m|ns|ms)`;
  if (/l$/.test(palavra)) return `${p.slice(0, -1)}(?:l|is|ls)`;
  if (/[rz]$/.test(palavra)) return `${p}(?:es|s)?`;
  return `${p}s?`;
}

interface Termo {
  dona: PalavraChave;
  texto: string;
  re: RegExp;
}

function compilar() {
  if (compilado) return compilado;
  const termo = (dona: PalavraChave, t: string): Termo => ({
    dona,
    texto: t,
    re: new RegExp(`(?<![a-z0-9])${normalizar(t).split(' ').map(comPlural).join(' ')}(?![a-z0-9])`, 'g'),
  });
  const v = vocabulario();
  compilado = {
    tipos: v.flatMap((p) => [p.palavra, ...p.variantes].map((t) => termo(p, t))),
    marcas: v.flatMap((p) => p.marcas.map((t) => termo(p, t))),
  };
  return compilado;
}

function melhor(termos: Termo[], texto: string): { dona: PalavraChave; variante: string } | null {
  let escolhido: { dona: PalavraChave; variante: string; inicio: number; tamanho: number } | null = null;
  for (const t of termos) {
    for (const m of texto.matchAll(t.re)) {
      const tamanho = m[0].split(' ').length;
      if (!escolhido || tamanho > escolhido.tamanho || (tamanho === escolhido.tamanho && m.index < escolhido.inicio)) {
        escolhido = { dona: t.dona, variante: t.texto, inicio: m.index, tamanho };
      }
    }
  }
  return escolhido ? { dona: escolhido.dona, variante: escolhido.variante } : null;
}

const ehCodigo = (t: string) => /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,20}$/.test(t);

export function atribuirPalavra(titulo: string): { palavra: string; variante: string; categoria: Categoria } | null {
  const t = normalizar(titulo);
  const { tipos, marcas } = compilar();
  const cupom = ehCodigo(t) ? vocabulario().find((p) => p.palavra === 'cupom') : undefined;
  const achada = cupom ? { dona: cupom, variante: 'código de cupom' } : (melhor(tipos, t) ?? melhor(marcas, t));
  return achada ? { palavra: achada.dona.palavra, variante: achada.variante, categoria: achada.dona.categoria } : null;
}
