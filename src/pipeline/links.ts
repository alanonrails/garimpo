import { config } from '../config.js';
import { cacheGravar, cacheObter } from '../db.js';

export interface LinkResolvido {
  linkOriginal: string;
  linkFinal: string;
  loja: string | null;
  idLoja: string | null;
  erro: string | null;
}

interface RegraLoja {
  nome: string;
  dominios: RegExp;
  id?: (u: URL) => string | null;
}

const casar = (re: RegExp, alvo: string, f: (m: RegExpMatchArray) => string = (m) => m[1]) => {
  const m = alvo.match(re);
  return m ? f(m) : null;
};

const LOJAS: RegraLoja[] = [
  {
    nome: 'Amazon',
    dominios: /(^|\.)amazon\.com(\.br)?$|(^|\.)amzn\.(to|com)$/,
    id: (u) => casar(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|product)\/([A-Z0-9]{10})(?=[/?#]|$)/i, u.pathname, (m) => m[1].toUpperCase()),
  },
  {
    nome: 'Mercado Livre',
    dominios: /(^|\.)mercadoli(vre|bre)\.com(\.br)?$|(^|\.)meli\.la$/,
    id: (u) =>
      casar(/\b(ML[A-Z])-?(\d{6,})/i, `${u.pathname} ${u.searchParams.get('item_id') ?? ''} ${u.searchParams.get('wid') ?? ''}`, (m) => `${m[1].toUpperCase()}${m[2]}`),
  },
  {
    nome: 'Shopee',
    dominios: /(^|\.)shopee\.com\.br$|(^|\.)shope\.ee$/,
    id: (u) =>
      casar(/-i\.(\d+)\.(\d+)/, u.pathname, (m) => `${m[1]}.${m[2]}`) ??
      casar(/\/product\/(\d+)\/(\d+)/, u.pathname, (m) => `${m[1]}.${m[2]}`) ??
      casar(/\/[^/]+\/(\d+)\/(\d+)/, u.pathname, (m) => `${m[1]}.${m[2]}`),
  },
  {
    nome: 'Magalu',
    dominios: /(^|\.)(magazineluiza|magalu|magazinevoce)\.com(\.br)?$/,
    id: (u) => casar(/\/p\/([a-z0-9]{6,})\/?/i, u.pathname, (m) => m[1].toLowerCase()),
  },
  { nome: 'AliExpress', dominios: /(^|\.)aliexpress\.(com|us)$|(^|\.)a\.aliexpress\.com$/, id: (u) => casar(/\/item\/(\d+)\.html/, u.pathname) },
  { nome: 'KaBuM!', dominios: /(^|\.)kabum\.com\.br$/, id: (u) => casar(/\/produto\/(\d+)/, u.pathname) },
  { nome: 'Americanas', dominios: /(^|\.)americanas\.com\.br$/, id: (u) => casar(/\/produto\/(\d+)/, u.pathname) },
  { nome: 'Submarino', dominios: /(^|\.)submarino\.com\.br$/, id: (u) => casar(/\/produto\/(\d+)/, u.pathname) },
  { nome: 'Casas Bahia', dominios: /(^|\.)casasbahia\.com\.br$/, id: (u) => casar(/(\d{6,})(?:\/p|\.html)/, u.pathname) },
  { nome: 'Ponto', dominios: /(^|\.)pontofrio\.com\.br$|(^|\.)pontodafrio/, id: (u) => casar(/(\d{6,})(?:\/p|\.html)/, u.pathname) },
  { nome: 'Extra', dominios: /(^|\.)extra\.com\.br$/, id: (u) => casar(/(\d{6,})(?:\/p|\.html)/, u.pathname) },
  { nome: 'Carrefour', dominios: /(^|\.)carrefour\.com\.br$/, id: (u) => casar(/-(\d{6,})\/p/, u.pathname) },
  { nome: 'Netshoes', dominios: /(^|\.)netshoes\.com\.br$/, id: (u) => casar(/([A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{3})/i, u.pathname, (m) => m[1].toUpperCase()) },
  { nome: 'Centauro', dominios: /(^|\.)centauro\.com\.br$/, id: (u) => casar(/-(\d{6,})\.html/, u.pathname) },
  { nome: 'Nike', dominios: /(^|\.)nike\.com\.br$/, id: (u) => casar(/-([A-Z0-9]{6}-\d{3}|\d{6,})(?:\.html)?$/i, u.pathname) },
  { nome: 'Adidas', dominios: /(^|\.)adidas\.com\.br$/, id: (u) => casar(/\/([A-Z]{1,2}\d{4,})\.html/i, u.pathname, (m) => m[1].toUpperCase()) },
  { nome: 'Dafiti', dominios: /(^|\.)dafiti\.com\.br$/, id: (u) => casar(/-(\d{6,})\.html/, u.pathname) },
  { nome: 'Zattini', dominios: /(^|\.)zattini\.com\.br$/ },
  { nome: 'Shein', dominios: /(^|\.)shein\.com(\.br)?$/, id: (u) => casar(/-p-(\d+)/, u.pathname) },
  { nome: 'Temu', dominios: /(^|\.)temu\.com$/, id: (u) => casar(/-g-(\d+)\.html/, u.pathname) },
  { nome: 'Fast Shop', dominios: /(^|\.)fastshop\.com\.br$/ },
  { nome: 'Pichau', dominios: /(^|\.)pichau\.com\.br$/ },
  { nome: 'Terabyte', dominios: /(^|\.)terabyteshop\.com\.br$/, id: (u) => casar(/\/produto\/(\d+)/, u.pathname) },
  { nome: 'Natura', dominios: /(^|\.)natura\.com(\.br)?$/, id: (u) => casar(/\/(NATBRA-\d+)/i, u.pathname, (m) => m[1].toUpperCase()) },
  { nome: 'O Boticário', dominios: /(^|\.)boticario\.com\.br$/ },
  { nome: 'Época Cosméticos', dominios: /(^|\.)epocacosmeticos\.com\.br$/ },
  { nome: 'Beleza na Web', dominios: /(^|\.)belezanaweb\.com\.br$/ },
  { nome: 'Drogasil', dominios: /(^|\.)drogasil\.com\.br$/ },
  { nome: 'Droga Raia', dominios: /(^|\.)drogaraia\.com\.br$/ },
  { nome: 'Petz', dominios: /(^|\.)petz\.com\.br$/ },
  { nome: 'Cobasi', dominios: /(^|\.)cobasi\.com\.br$/ },
  { nome: 'Leroy Merlin', dominios: /(^|\.)leroymerlin\.com\.br$/, id: (u) => casar(/_(\d{6,})/, u.pathname) },
  { nome: 'MadeiraMadeira', dominios: /(^|\.)madeiramadeira\.com\.br$/, id: (u) => casar(/-(\d{6,})\.html/, u.pathname) },
  { nome: 'Samsung', dominios: /(^|\.)samsung\.com$/ },
  { nome: 'Girafa', dominios: /(^|\.)girafa\.com\.br$/ },
];

const ENCURTADORES = /(^|\.)(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co|ow\.ly|rebrand\.ly|linktr\.ee|tidd\.ly|amzn\.pro|divulgador\.link|s\.click\.aliexpress\.com|onelink\.me)$/;

const PISTAS: [RegExp, string][] = [
  [/(^|[./])(amz|amzn|amazon)([./-]|$)/i, 'Amazon'],
  [/(^|[./])(mercadolivre|meli|ml)([./-]|$)/i, 'Mercado Livre'],
  [/(^|[./])shopee([./-]|$)/i, 'Shopee'],
  [/(^|[./])shein([./-]|$)/i, 'Shein'],
  [/(^|[./])natura([./-]|$)/i, 'Natura'],
  [/(^|[./])(magalu|magazineluiza)([./-]|$)/i, 'Magalu'],
  [/(^|[./])aliexpress([./-]|$)/i, 'AliExpress'],
  [/(^|[./])netshoes([./-]|$)/i, 'Netshoes'],
  [/(^|[./])centauro([./-]|$)/i, 'Centauro'],
  [/(^|[./])nike([./-]|$)/i, 'Nike'],
];

export function identificarLoja(url: string): { loja: string | null; idLoja: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const regra = LOJAS.find((l) => l.dominios.test(host));
    if (!regra) {
      const alvo = `${host}${u.pathname.split('/').slice(0, 2).join('/')}`;
      const pista = PISTAS.find(([re]) => re.test(alvo));
      return { loja: pista?.[1] ?? null, idLoja: null };
    }
    return { loja: regra.nome, idLoja: regra.id?.(u) ?? null };
  } catch {
    return { loja: null, idLoja: null };
  }
}

const CABECALHOS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

function urlsDaPagina(html: string, base: string): { proximo: string | null; todas: string[] } {
  const padroes = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=['"]?([^"'>\s]+)/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+(?:property|name)=["'](?:og:image|image)["'][^>]+content=["']([^"']+)/i,
  ];
  const achadas = padroes.map((p) => {
    const m = html.match(p);
    try {
      return m ? new URL(m[1].replace(/&amp;/g, '&'), base).toString() : null;
    } catch {
      return null;
    }
  });
  return { proximo: achadas.slice(0, 3).find(Boolean) ?? null, todas: achadas.filter((u): u is string => !!u) };
}

export function ehVitrine(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)mercadoli(vre|bre)\.com(\.br)?$/.test(u.hostname.toLowerCase()) && u.pathname.startsWith('/social/');
  } catch {
    return false;
  }
}

function idNaPagina(atual: string, html: string, urls: string[]): string | null {
  if (ehVitrine(atual)) return html.match(/"shared_item":\{"id":"(ML[A-Z]\d+)"/)?.[1] ?? null;
  const regra = LOJAS.find((l) => l.dominios.test(new URL(atual).hostname.toLowerCase()));
  for (const u of urls) {
    const id = regra?.id?.(new URL(u));
    if (id) return id;
  }
  return null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buscar(url: string): Promise<Response> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(url, { redirect: 'manual', headers: CABECALHOS, signal: AbortSignal.timeout(config.linkTimeoutMs) });
    if ((r.status !== 403 && r.status !== 429) || tentativa === 4) return r;
    await r.body?.cancel().catch(() => {});
    await esperar(5000 * 2 ** (tentativa - 1));
  }
}

async function seguir(original: string): Promise<{ final: string; idLoja: string | null; erro: string | null }> {
  let atual = original;
  const vistos = new Set<string>();
  for (let salto = 0; salto < config.linkMaxSaltos; salto++) {
    const pelaUrl = identificarLoja(atual).idLoja;
    if (pelaUrl) return { final: atual, idLoja: pelaUrl, erro: null };
    if (vistos.has(atual)) break;
    vistos.add(atual);
    let r: Response;
    try {
      r = await buscar(atual);
    } catch (e) {
      return { final: atual, idLoja: null, erro: `falha de rede: ${(e as Error).message}` };
    }
    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get('location');
      await r.body?.cancel().catch(() => {});
      if (!destino) return { final: atual, idLoja: null, erro: `redirect ${r.status} sem location` };
      atual = new URL(destino, atual).toString();
      continue;
    }
    if (r.status >= 400) {
      await r.body?.cancel().catch(() => {});
      return { final: atual, idLoja: null, erro: `HTTP ${r.status}` };
    }
    const tipo = r.headers.get('content-type') ?? '';
    if (!tipo.includes('html')) {
      await r.body?.cancel().catch(() => {});
      return { final: atual, idLoja: null, erro: null };
    }
    const html = (await r.text().catch(() => '')).slice(0, 300000);
    const { proximo, todas } = urlsDaPagina(html, atual);
    const id = idNaPagina(atual, html, todas);
    if (id) return { final: atual, idLoja: id, erro: null };
    if (proximo && proximo !== atual && !vistos.has(proximo)) {
      atual = proximo;
      continue;
    }
    return { final: atual, idLoja: null, erro: null };
  }
  return { final: atual, idLoja: null, erro: null };
}

export async function resolverLink(original: string, dia: string): Promise<LinkResolvido> {
  const emCache = cacheObter<LinkResolvido>('link_cache', original);
  if (emCache) return emCache;
  let resultado: LinkResolvido;
  try {
    const { final, idLoja, erro } = await seguir(original);
    const { loja } = identificarLoja(final);
    const host = new URL(final).hostname;
    const aindaEncurtado = ENCURTADORES.test(host);
    resultado = {
      linkOriginal: original,
      linkFinal: aindaEncurtado && !loja ? original : final,
      loja,
      idLoja,
      erro: erro ?? (loja ? null : 'loja não identificada pela URL'),
    };
  } catch (e) {
    resultado = { linkOriginal: original, linkFinal: original, loja: null, idLoja: null, erro: (e as Error).message };
  }
  cacheGravar('link_cache', original, dia, resultado);
  return resultado;
}
