import type { DadosExtraidos } from './extracao.js';
import { extrairLinks } from './filtro.js';
import { identificarLoja } from './links.js';

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const URL_NO_TEXTO = /\bhttps?:\/\/\S+/gi;

function limparLinha(l: string): string {
  return l
    .replace(EMOJI, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/^[\s•·\-–—>|:.]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const letras = (s: string) => s.replace(/[^\p{L}]/gu, '');
const ehMaiuscula = (s: string) => {
  const l = letras(s);
  return l.length >= 4 && l === l.toLocaleUpperCase('pt-BR') && l !== l.toLocaleLowerCase('pt-BR');
};

const NUMERO = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const RE_POR = new RegExp(String.raw`\bpor\s*:?\s*(?:apenas\s*|só\s*)?(?:R\$\s*)?${NUMERO}`, 'i');
const RE_REAIS = new RegExp(String.raw`R\$\s*${NUMERO}`, 'gi');
const RE_LINHA_PRECO = /^(de|por)\b\s*:?\s*(R\$\s*)?\d|R\$\s*\d|\bpor\s*:?\s*(R\$\s*)?\d/i;

export function paraNumero(v: string): number | null {
  const s = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RE_FORMATO_PRECO = /^(de|por)\b|R\$|\|\s*por\b/i;

function precoDe(linhas: string[]): { preco: number | null; linha: number } {
  for (const exigirFormato of [true, false]) {
    for (let i = 0; i < linhas.length; i++) {
      const m = linhas[i].match(RE_POR);
      if (m && (!exigirFormato || RE_FORMATO_PRECO.test(linhas[i]))) return { preco: paraNumero(m[1]), linha: i };
    }
  }
  for (let i = 0; i < linhas.length; i++) {
    for (const m of linhas[i].matchAll(RE_REAIS)) {
      const antes = linhas[i].slice(0, m.index).toLowerCase();
      if (/\b(de|acima de|limite de|limitado a|at[eé]|m[ií]nimo de|economia de|off em|off nas? compras? (de|acima de))\s*:?\s*$/.test(antes) || /^\s*\)?\s*(cada|unidade|parcela|x\b|off|de desconto|em r\$|acima)/.test(linhas[i].slice(m.index! + m[0].length).toLowerCase())) continue;
      const n = paraNumero(m[1]);
      if (n) return { preco: n, linha: i };
    }
  }
  return { preco: null, linha: -1 };
}

const RE_DESCONTO = /(\d+\s*%|R\$\s*\d+)\s*off\b/i;
const RE_CUPOM = /(?<![\p{L}])[Cc][Uu][Pp](?:[Oo][Mm]|[Oo][Nn][Ss])(?![\p{L}])/u;

function codigosDaLinha(linha: string): string | null {
  const m = linha.match(RE_CUPOM);
  if (!m) return null;
  const resto = linha.slice(m.index! + m[0].length).replace(/^[^:\n]{0,30}?:/, ' ');
  const palavras = resto.trim().split(/\s+/);
  const codigos: string[] = [];
  let seguidas = 0;
  for (const p of palavras) {
    const limpo = p.replace(/[^A-Z0-9_-]/g, '');
    if (/^[A-Z0-9][A-Z0-9_-]{3,}$/.test(limpo) && limpo === p.replace(/[.,;!*]+$/, '')) {
      codigos.push(limpo);
      seguidas = 0;
    } else if (/^(ou|e|\/|,)$/i.test(p)) {
      continue;
    } else if (/^[A-ZÀ-Ú]{1,3}$/.test(p)) {
      if (++seguidas >= 1 && codigos.length) return null;
      break;
    } else break;
  }
  const validos = codigos.filter((c) => !/^(DE|OFF|PIX|ABAIXO|AQUI)$/.test(c));
  return validos.length ? validos.join(' ou ') : null;
}
const RE_LINHA_AUXILIAR =
  /^(use o|use os|usar o|resgate|ative\b|aplique\b|selecione|adicione|cupo(m|ns)|link|compre\b|comprar|participe|entre n|grupo|loja|disponível|achado n|frete|clique|acesse|garanta|confira|v[aá]lido|limite|estoque|parcel|em at[eé]|sem juros|programe|compra m[ií]nima|pagamento|o desconto|desconto aparece|\d+\s*%\s*off)/i;

function condicaoDe(texto: string, linhaPreco: string): string | null {
  const partes: string[] = [];
  const t = texto.replace(/[*_~`]/g, '');
  const lp = linhaPreco.toLowerCase();
  if (/\bpix\b/.test(lp) || /selecione\s+(o\s+)?pix/i.test(t)) partes.push('no Pix');
  else if (/[àa] vista/.test(lp)) partes.push('à vista');
  const codigo = t
    .split('\n')
    .filter((l) => l.includes(':') || !ehMaiuscula(l))
    .map(codigosDaLinha)
    .find(Boolean);
  if (codigo && !/^(DE|DESCONTO|OFF)$/.test(codigo)) partes.push(`com cupom ${codigo}`);
  else {
    const desc = t.match(/cupom de\s+(R\$\s*\d+|\d+\s*%)\s*(off)?/i);
    if (desc) partes.push(`com cupom de ${desc[1].replace(/\s+/g, '')} OFF`);
  }
  if (/programe e poupe/i.test(t)) partes.push('programe e poupe');
  if (/mercado pago/i.test(t)) partes.push('pagando com Mercado Pago');
  return partes.length ? partes.join(', ') : null;
}

const LINK_AUXILIAR = /grupo|participe|cupom|resgate|whatsapp|instagram|telegram|t\.me\//i;

function linkDe(texto: string): string | null {
  const linhas = texto.split('\n');
  const todos = extrairLinks(texto);
  for (const link of todos) {
    const i = linhas.findIndex((l) => l.includes(link.replace(/^https:\/\//, '')) || l.includes(link));
    const contexto = `${linhas[i - 1] ?? ''} ${linhas[i] ?? ''}`.replace(URL_NO_TEXTO, '');
    if (/chat\.whatsapp|whatsapp\.com\/channel|instagram\.com|t\.me\//i.test(link)) continue;
    if (i >= 0 && LINK_AUXILIAR.test(contexto) && !/compr|oferta|link:?\s*$/i.test(linhas[i - 1] ?? '')) continue;
    return link;
  }
  return todos[0] ?? null;
}

const LOJA_NO_TEXTO: [RegExp, string][] = [
  [/\b(mercado livre|no ml|meli)\b/i, 'Mercado Livre'],
  [/\bamazon\b/i, 'Amazon'],
  [/\bshopee\b/i, 'Shopee'],
  [/\bmagalu|magazine luiza\b/i, 'Magalu'],
  [/\bnetshoes\b/i, 'Netshoes'],
  [/\bcentauro\b/i, 'Centauro'],
  [/\baliexpress\b/i, 'AliExpress'],
  [/\bkabum\b/i, 'KaBuM!'],
  [/\bshein\b/i, 'Shein'],
  [/\bnike\b/i, 'Nike'],
  [/\badidas\b/i, 'Adidas'],
];

function lojaDe(texto: string, link: string | null): string | null {
  const pelaUrl = link ? identificarLoja(link).loja : null;
  if (pelaUrl) return pelaUrl;
  const linhas = texto.split('\n').filter((l) => /\b(loja|achado|compre|no ml|na |no )\b/i.test(l));
  for (const [re, nome] of LOJA_NO_TEXTO) if (linhas.some((l) => re.test(l))) return nome;
  return null;
}

const tituloCapitalizado = (s: string) =>
  s.toLocaleLowerCase('pt-BR').replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('pt-BR'));

export function extrairPorRegras(texto: string): DadosExtraidos | null {
  const brutas = texto.split('\n');
  const linhas = brutas.map(limparLinha);
  const { preco, linha: iPreco } = precoDe(linhas);
  const link = linkDe(texto);
  if (!link) return null;

  const fim = iPreco >= 0 ? iPreco : linhas.length;
  const blocos: string[][] = [[]];
  for (let i = 0; i < fim; i++) {
    const l = linhas[i];
    if (!l || !letras(l)) {
      if (blocos.at(-1)!.length) blocos.push([]);
      continue;
    }
    if (URL_NO_TEXTO.test(brutas[i]) || /^https?:/i.test(l)) {
      URL_NO_TEXTO.lastIndex = 0;
      continue;
    }
    URL_NO_TEXTO.lastIndex = 0;
    const chamadaInicial = ehMaiuscula(l) && blocos.length === 1 && !blocos[0].length && !/^(de|por)\b/i.test(l);
    if (!chamadaInicial && (RE_LINHA_PRECO.test(l) || RE_LINHA_AUXILIAR.test(l))) continue;
    blocos.at(-1)!.push(l);
  }
  const conteudo = blocos.filter((b) => b.length);
  if (!conteudo.length) return null;

  const abertura = [linhas.find((l) => letras(l)) ?? '', conteudo[0][0]];
  const soChamada = conteudo.every((bloco) => bloco.every(ehMaiuscula));
  const ehCupom =
    preco == null &&
    (abertura.some((l) => RE_CUPOM.test(l) || RE_DESCONTO.test(l)) || (soChamada && (RE_CUPOM.test(texto) || RE_DESCONTO.test(texto))));
  if (ehCupom) {
    const semFormato = texto.replace(/[*_~`]/g, '').split('\n');
    const codigo =
      semFormato.filter((l) => l.includes(':') || !ehMaiuscula(l)).map(codigosDaLinha).find(Boolean)?.split(' ou ')[0] ??
      semFormato.map(limparLinha).find((l) => /^[A-Z][A-Z0-9]{3,19}$/.test(l));
    const loja = lojaDe(texto, link);
    if (!codigo && !loja) return null;
    return {
      titulo_produto: codigo ? ['Cupom', loja, codigo].filter(Boolean).join(' ') : `Cupons ${loja}`,
      loja,
      preco: null,
      condicao: null,
      link,
    };
  }

  let produto: string;
  const primeiro = conteudo[0];
  if (ehMaiuscula(primeiro[0]) && conteudo.length > 1) {
    produto = conteudo[1][0];
  } else if (ehMaiuscula(primeiro[0]) && primeiro.length > 1 && ehMaiuscula(primeiro[1])) {
    produto = primeiro[1];
  } else {
    produto = primeiro[0];
  }

  produto = produto.replace(/\s*[.!]+$/, '').trim();
  if (ehMaiuscula(produto)) produto = tituloCapitalizado(produto);
  if (produto.length < 3 || produto.length > 160) return null;
  if (preco == null && !/cupom/i.test(texto)) return null;

  return {
    titulo_produto: produto,
    loja: lojaDe(texto, link),
    preco,
    condicao: condicaoDe(texto, iPreco >= 0 ? brutas[iPreco] : ''),
    link,
  };
}
