import crypto from 'node:crypto';
import { z } from 'zod';
import { cacheGravar, cacheObter } from '../db.js';
import { chatJson } from '../llm/ollama.js';

export interface DadosExtraidos {
  titulo_produto: string;
  loja: string | null;
  preco: number | null;
  condicao: string | null;
  link: string;
}

const SCHEMA_JSON = {
  type: 'object',
  properties: {
    produto: { type: 'string' },
    loja: { type: ['string', 'null'] },
    preco: { type: ['number', 'null'] },
    condicao: { type: ['string', 'null'] },
    link: { type: 'integer', minimum: 0 },
  },
  required: ['produto', 'loja', 'preco', 'condicao', 'link'],
};

const precoFlex = z.preprocess((v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  if (typeof v === 'string') {
    const limpo = v.replace(/[^\d,.]/g, '');
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
    const n = Number(normal);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}, z.number().positive().nullable());

const texto = z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : null), z.string().nullable());

const SCHEMA = z.object({
  produto: z.string().trim().min(2),
  loja: texto,
  preco: precoFlex,
  condicao: texto,
  link: z.coerce.number().int().nonnegative().catch(0),
});

const PROMPT_SISTEMA = `Você extrai dados de mensagens de promoção de grupos de WhatsApp brasileiros. Responda SOMENTE com JSON compacto em uma linha.

Campos:
- produto: nome objetivo do produto (marca, modelo, capacidade/tamanho), sem emojis e sem preço. Ignore a frase de gancho da mensagem (ex.: "BAIXOU MUITO!", "GOLA ITALIANA É LUXO"): ela não é o produto. Para cupom genérico de loja (sem produto específico), use "Cupom <loja> <código>" (ex.: "Cupom Mercado Livre ACHEIOFF", "Cupom Nike ULTIMAS30").
- loja: nome da loja (Amazon, Mercado Livre, Shopee, Magalu, AliExpress, KaBuM!, Netshoes, Nike, Shein etc.); null se não der para saber.
- preco: preço PROMOCIONAL final como número (ex.: 1299.9). Em "de X por Y", use Y. Se houver preço com cupom/Pix, use o menor e explique em condicao. null se não houver preço do produto.
- condicao: condição curta desse preço, com os dados reais da mensagem ("à vista", "no Pix", "com cupom POLOWEAR10", "programe e poupe", "pagando com Mercado Pago"); null se nenhuma.
- link: número do link da oferta na lista "Links" (1, 2, ...); 0 se nenhum servir.

Se a mensagem tiver vários produtos, extraia o principal (o primeiro).`;

export function hashMensagem(texto: string) {
  return crypto.createHash('sha1').update(texto.replace(/\s+/g, ' ').trim()).digest('hex');
}

export async function extrairOferta(textoMensagem: string, links: string[], dia: string): Promise<DadosExtraidos> {
  const hash = hashMensagem(textoMensagem);
  const emCache = cacheObter<DadosExtraidos>('extracao_cache', hash);
  if (emCache) return emCache;

  const mensagens = [
    { role: 'system' as const, content: PROMPT_SISTEMA },
    {
      role: 'user' as const,
      content: `Mensagem:\n"""\n${textoMensagem.slice(0, 2500)}\n"""\nLinks:\n${links.map((l, i) => `${i + 1}. ${l}`).join('\n') || '(nenhum)'}`,
    },
  ];

  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const bruto = await chatJson(
        tentativa === 0
          ? mensagens
          : [...mensagens, { role: 'user', content: 'Sua resposta anterior não era um JSON válido no formato pedido. Responda apenas o JSON.' }],
        SCHEMA_JSON,
        200,
      );
      const r = SCHEMA.parse(JSON.parse(bruto));
      const dados: DadosExtraidos = {
        titulo_produto: r.produto,
        loja: r.loja,
        preco: r.preco,
        condicao: r.condicao,
        link: links[r.link - 1] ?? links[0],
      };
      cacheGravar('extracao_cache', hash, dia, dados);
      return dados;
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw new Error(`extração LLM falhou: ${(ultimoErro as Error)?.message?.slice(0, 200)}`);
}
