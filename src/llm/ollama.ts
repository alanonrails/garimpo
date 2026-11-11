import { config } from '../config.js';

let suportaThink = true;

interface MensagemChat {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function post(caminho: string, corpo: unknown, timeoutMs = 180000) {
  const r = await fetch(`${config.ollamaUrl}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Ollama ${caminho} HTTP ${r.status}: ${texto.slice(0, 300)}`);
  return JSON.parse(texto);
}

export async function chatJson(mensagens: MensagemChat[], schema: object, maxTokens = 400): Promise<string> {
  const corpo: Record<string, unknown> = {
    model: config.llmModelo,
    messages: mensagens,
    format: schema,
    stream: false,
    keep_alive: '30m',
    options: { temperature: 0, num_ctx: 4096, num_predict: maxTokens },
  };
  if (suportaThink) corpo.think = false;
  try {
    const r = await post('/api/chat', corpo);
    return r.message?.content ?? '';
  } catch (e) {
    if (suportaThink && /think/i.test((e as Error).message)) {
      suportaThink = false;
      return chatJson(mensagens, schema, maxTokens);
    }
    throw e;
  }
}

export async function embeddings(textos: string[]): Promise<Float32Array[]> {
  const saida: Float32Array[] = [];
  for (let i = 0; i < textos.length; i += 64) {
    const lote = textos.slice(i, i + 64);
    const r = await post('/api/embed', { model: config.embeddingModelo, input: lote, keep_alive: '30m' });
    for (const v of r.embeddings as number[][]) {
      const arr = Float32Array.from(v);
      let norma = 0;
      for (const x of arr) norma += x * x;
      norma = Math.sqrt(norma) || 1;
      for (let j = 0; j < arr.length; j++) arr[j] /= norma;
      saida.push(arr);
    }
  }
  return saida;
}

export function cosseno(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export async function verificarOllama(): Promise<string | null> {
  try {
    const r = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const dados = (await r.json()) as { models?: { name: string }[] };
    const nomes = (dados.models ?? []).map((m) => m.name);
    const tem = (m: string) => nomes.some((n) => n === m || n === `${m}:latest`);
    const faltando = [config.llmModelo, config.embeddingModelo].filter((m) => !tem(m));
    return faltando.length ? `Modelos ausentes no Ollama: ${faltando.join(', ')} (rode: ollama pull <modelo>)` : null;
  } catch {
    return `Ollama não está acessível em ${config.ollamaUrl}`;
  }
}
