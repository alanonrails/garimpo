import 'dotenv/config';
import path from 'node:path';

const texto = (nome: string, padrao: string) => process.env[nome]?.trim() || padrao;
const numero = (nome: string, padrao: number) => {
  const v = process.env[nome]?.trim();
  return v && Number.isFinite(Number(v)) ? Number(v) : padrao;
};

const pastaDados = path.resolve(texto('PASTA_DADOS', './data'));

export const config = {
  porta: numero('PORTA', 3000),
  fuso: texto('FUSO', 'America/Maceio'),
  pastaDados,
  pastaAuth: path.join(pastaDados, 'auth'),
  pastaImagens: path.join(pastaDados, 'imagens'),
  ollamaUrl: texto('OLLAMA_URL', 'http://127.0.0.1:11434'),
  llmModelo: texto('LLM_MODELO', 'qwen3:8b'),
  embeddingModelo: texto('EMBEDDING_MODELO', 'bge-m3'),
  limiarSimilaridade: numero('LIMIAR_SIMILARIDADE', 0.77),
  buscaLimiar: numero('BUSCA_LIMIAR', 0.52),
  llmConcorrencia: 4,
  linkConcorrencia: 8,
  linkMaxSaltos: 6,
  linkTimeoutMs: 8000,
  coletaOciosoMs: 10000,
  coletaMaxMs: 180000,
};
