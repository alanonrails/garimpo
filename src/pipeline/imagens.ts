import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ehVitrine } from './links.js';

const CABECALHOS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

const PADROES = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i,
  /data-old-hires=["'](https:[^"']+)/i,
  /"hiRes":"(https:[^"]+)"/,
  /"large":"(https:\/\/m\.media-amazon\.com[^"]+)"/,
];

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export async function buscarImagemDaPagina(url: string, pasta: string): Promise<string | null> {
  if (ehVitrine(url)) return null;
  const base = path.join(pasta, `pagina_${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}`);
  const existente = Object.values(EXTENSOES)
    .map((e) => `${base}.${e}`)
    .find((f) => fs.existsSync(f));
  if (existente) return existente;

  const pagina = await fetch(url, { headers: CABECALHOS, signal: AbortSignal.timeout(config.linkTimeoutMs) });
  if (!pagina.ok) return null;
  const html = (await pagina.text()).slice(0, 600000);
  let enderecoImagem: string | null = null;
  for (const p of PADROES) {
    const m = html.match(p);
    if (m) {
      enderecoImagem = new URL(m[1].replace(/&amp;/g, '&').replace(/\\u002F/g, '/'), url).toString();
      break;
    }
  }
  if (!enderecoImagem) return null;

  const imagem = await fetch(enderecoImagem, { headers: CABECALHOS, signal: AbortSignal.timeout(config.linkTimeoutMs) });
  const tipo = (imagem.headers.get('content-type') ?? '').split(';')[0].trim();
  const extensao = EXTENSOES[tipo];
  if (!imagem.ok || !extensao) return null;
  const dados = Buffer.from(await imagem.arrayBuffer());
  if (dados.length < 2000) return null;
  fs.mkdirSync(pasta, { recursive: true });
  const destino = `${base}.${extensao}`;
  fs.writeFileSync(destino, dados);
  return destino;
}
