import fs from 'node:fs';
import path from 'node:path';
import type { WAMessage } from 'baileys';
import { config } from '../config.js';
import { fontePermitida } from '../fontes.js';
import { dataDoDia, inicioDoDia } from '../tempo.js';
import { buscarMensagensCanal, listarCanais } from './canais.js';
import { baixarImagem, normalizar, paraNumero, type MensagemColetada } from './mensagem.js';
import type { SessaoWhatsApp } from './sessao.js';

export interface Fonte {
  id: string;
  tipo: 'grupo' | 'canal';
  nome: string;
  extra?: boolean;
}

export interface ResultadoFonte {
  fonte: Fonte;
  mensagens: MensagemColetada[];
  erros: string[];
}

export async function coletarDoDia(sessao: SessaoWhatsApp, aoProgresso: (etapa: string, atual?: number, total?: number) => void) {
  const desde = Math.floor(inicioDoDia().getTime() / 1000);
  const pastaImagens = path.join(config.pastaImagens, dataDoDia());
  const erros: string[] = [];
  const primeiraConexao = !fs.existsSync(path.join(config.pastaAuth, 'creds.json'));

  aoProgresso('conectando');
  const sock = await sessao.abrir();
  try {
    aoProgresso('sincronizando');
    await sessao.aguardarSincronizacao();

    aoProgresso('listando fontes');
    const grupos: Fonte[] = [];
    try {
      for (const g of Object.values(await sock.groupFetchAllParticipating())) grupos.push({ id: g.id, tipo: 'grupo', nome: g.subject || g.id });
    } catch (e) {
      erros.push(`falha ao listar grupos: ${(e as Error).message}`);
    }
    const canais: Fonte[] = (await listarCanais(sock, sessao.nomesChats, erros)).map((c) => ({
      id: c.jid,
      tipo: 'canal',
      nome: c.nome,
      extra: c.origem === 'extra',
    }));

    const todas = [...grupos, ...canais];
    const fontes = todas.filter((f) => (primeiraConexao && f.tipo === 'grupo') || fontePermitida(f.id) || !!f.extra);
    const resultados: ResultadoFonte[] = [];

    for (const [i, fonte] of fontes.entries()) {
      aoProgresso(`coletando ${fonte.tipo}: ${fonte.nome}`, i + 1, fontes.length);
      const r: ResultadoFonte = { fonte, mensagens: [], erros: [] };
      try {
        const brutas = new Map<string, WAMessage>();
        for (const m of sessao.mensagens.values()) if (m.key.remoteJid === fonte.id) brutas.set(m.key.id!, m);
        if (fonte.tipo === 'canal') for (const m of await buscarMensagensCanal(sock, fonte.id, desde, erros)) brutas.set(m.key.id!, m);
        for (const m of brutas.values()) {
          if (paraNumero(m.messageTimestamp) < desde) continue;
          try {
            const c = normalizar(m, fonte.id);
            if (!c) continue;
            if (c.temImagem) await baixarImagem(m, c, pastaImagens);
            r.mensagens.push(c);
          } catch (e) {
            r.erros.push(`mensagem ${m.key.id}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        r.erros.push((e as Error).message);
      }
      resultados.push(r);
    }

    return { fontes: resultados, todas, erros: erros.filter((e) => /falh/i.test(e)) };
  } finally {
    aoProgresso('fechando sessão');
    await sessao.fechar();
  }
}
