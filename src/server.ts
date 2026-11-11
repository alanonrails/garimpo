import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { salvarVocabulario } from './categorias.js';
import { config } from './config.js';
import { configFontes, resumoFontes, salvarConfigFontes } from './fontes.js';
import { caminhoImagem, listarOfertas, reclassificarOfertas, resumoVocabulario } from './ofertas.js';
import { cancelarConexao, conectar, conexao, desconectar, executarExtracao, ocupado, previsao, sessao, status } from './servico.js';

const app = Fastify({ logger: { level: 'warn' } });
const emUso = { erro: 'O WhatsApp já está em uso.' };

app.get('/api/status', async () => ({
  ...status,
  previsao: { restanteSegundos: previsao() },
  conexao: { ...conexao, ocupado: ocupado() },
}));

app.post('/api/extrair', async (_req, reply) => {
  if (ocupado()) return reply.code(409).send(emUso);
  if (conexao.estado !== 'conectado') return reply.code(409).send({ erro: 'Conecte o WhatsApp antes de extrair.' });
  if (!configFontes().selecionadas.length) return reply.code(409).send({ erro: 'Nenhuma fonte selecionada.' });
  executarExtracao();
  return reply.code(202).send({ ok: true });
});

app.post('/api/conectar', async (_req, reply) => {
  if (ocupado()) return reply.code(409).send(emUso);
  conectar();
  return reply.code(202).send({ ok: true });
});

app.post('/api/conectar/cancelar', async () => {
  await cancelarConexao();
  return { ok: true };
});

app.post('/api/desconectar', async (_req, reply) => {
  if (ocupado()) return reply.code(409).send(emUso);
  await desconectar();
  return { ok: true };
});

app.get('/api/qr', async (_req, reply) => {
  if (!sessao.qrPng) return reply.code(404).send({ erro: 'Nenhum QR code pendente.' });
  reply.header('cache-control', 'no-store');
  return reply.type('image/png').send(sessao.qrPng);
});

app.get('/api/fontes', async () => resumoFontes());

app.put<{ Body: Record<string, unknown> }>('/api/fontes', async (req) => {
  salvarConfigFontes(req.body ?? {});
  return resumoFontes();
});

app.get<{ Querystring: { q?: string } }>('/api/ofertas', async (req) => listarOfertas(req.query.q));

app.get<{ Params: { id: string } }>('/api/imagens/:id', async (req, reply) => {
  const caminho = caminhoImagem(Number(req.params.id));
  if (!caminho || !fs.existsSync(caminho)) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
  const tipos: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
  reply.header('cache-control', 'public, max-age=3600');
  return reply.type(tipos[path.extname(caminho).toLowerCase()] ?? 'image/jpeg').send(fs.createReadStream(caminho));
});

app.get('/api/vocabulario', async () => resumoVocabulario());

app.put<{ Body: unknown }>('/api/vocabulario', async (req, reply) => {
  const r = salvarVocabulario(req.body);
  if (!r.ok) return reply.code(400).send({ erros: r.erros });
  reclassificarOfertas();
  return resumoVocabulario();
});

const pastaWeb = path.resolve('web/dist');
if (fs.existsSync(pastaWeb)) await app.register(fastifyStatic, { root: pastaWeb });

await app.listen({ port: config.porta, host: '127.0.0.1' });
console.log(`Garimpo rodando em http://localhost:${config.porta}`);
