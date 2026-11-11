import {
  type BinaryNode,
  getBinaryNodeChild,
  proto,
  S_WHATSAPP_NET,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { configFontes } from '../fontes.js';

interface Canal {
  jid: string;
  nome: string;
  origem: string;
}

const CONSULTAS_INSCRITOS = [
  { queryId: '6388546374527196', caminho: 'xwa2_newsletter_subscribed' },
  { queryId: '9779843322044422', caminho: 'xwa2_newsletter_subscribed' },
];

async function mex(sock: WASocket, queryId: string, variables: Record<string, unknown>) {
  const res = await sock.query({
    tag: 'iq',
    attrs: { id: sock.generateMessageTag(), type: 'get', to: S_WHATSAPP_NET, xmlns: 'w:mex' },
    content: [{ tag: 'query', attrs: { query_id: queryId }, content: Buffer.from(JSON.stringify({ variables }), 'utf-8') }],
  });
  const filho = getBinaryNodeChild(res, 'result');
  if (!filho?.content) throw new Error('resposta mex vazia');
  const dados = JSON.parse(filho.content.toString());
  if (dados.errors?.length) throw new Error(dados.errors.map((e: { message?: string }) => e.message).join(', '));
  return dados.data;
}

export async function listarCanais(sock: WASocket, nomesChats: Map<string, string>, diag: string[]): Promise<Canal[]> {
  const canais = new Map<string, Canal>();

  for (const c of CONSULTAS_INSCRITOS) {
    try {
      const data = await mex(sock, c.queryId, {});
      const lista = data?.[c.caminho];
      if (Array.isArray(lista)) {
        for (const item of lista) {
          const jid = item?.id;
          if (typeof jid !== 'string') continue;
          canais.set(jid, { jid, nome: item?.thread_metadata?.name?.text ?? jid, origem: `mex:${c.queryId}` });
        }
        break;
      }
    } catch (e) {
      diag.push(`mex ${c.queryId} falhou: ${(e as Error).message}`);
    }
  }

  for (const [jid, nome] of nomesChats) {
    if (jid.endsWith('@newsletter') && !canais.has(jid)) canais.set(jid, { jid, nome, origem: 'historico' });
  }

  for (const extra of configFontes().canaisExtras) {
    try {
      const codigo = extra.replace(/^https?:\/\/(www\.)?whatsapp\.com\/channel\//, '').replace(/\/$/, '');
      const meta = codigo.endsWith('@newsletter')
        ? await sock.newsletterMetadata('jid', codigo)
        : await sock.newsletterMetadata('invite', codigo);
      const m = meta as { id?: string; thread_metadata?: { name?: { text?: string } } } | null;
      if (m?.id) canais.set(m.id, { jid: m.id, nome: m.thread_metadata?.name?.text ?? m.id, origem: 'extra' });
      else diag.push(`canal extra "${extra}" não encontrado`);
    } catch (e) {
      diag.push(`canal extra "${extra}" falhou: ${(e as Error).message}`);
    }
  }

  for (const canal of canais.values()) {
    if (canal.nome !== canal.jid) continue;
    try {
      const m = (await sock.newsletterMetadata('jid', canal.jid)) as { thread_metadata?: { name?: { text?: string } } } | null;
      if (m?.thread_metadata?.name?.text) canal.nome = m.thread_metadata.name.text;
    } catch {}
  }

  return [...canais.values()];
}

function filhos(no: BinaryNode): BinaryNode[] {
  return Array.isArray(no.content) ? (no.content as BinaryNode[]) : [];
}

function coletarNosMensagem(no: BinaryNode, saida: BinaryNode[] = []): BinaryNode[] {
  if (no.tag === 'message') saida.push(no);
  for (const f of filhos(no)) coletarNosMensagem(f, saida);
  return saida;
}

function nosParaMensagens(jid: string, raiz: BinaryNode): WAMessage[] {
  const msgs: WAMessage[] = [];
  for (const no of coletarNosMensagem(raiz)) {
    const plain = getBinaryNodeChild(no, 'plaintext');
    if (!plain?.content || !(plain.content instanceof Uint8Array)) continue;
    try {
      const message = proto.Message.decode(plain.content as Uint8Array);
      const serverId = no.attrs.server_id ?? no.attrs.id;
      msgs.push({
        key: { remoteJid: jid, id: no.attrs.id ?? serverId, fromMe: false },
        message,
        messageTimestamp: Number(no.attrs.t ?? 0),
        newsletterServerId: serverId ? Number(serverId) : undefined,
      } as unknown as WAMessage);
    } catch {}
  }
  return msgs;
}

export async function buscarMensagensCanal(
  sock: WASocket,
  jid: string,
  desde: number,
  diag: string[],
): Promise<WAMessage[]> {
  const coletadas = new Map<string, WAMessage>();
  const adicionar = (lista: WAMessage[]) => {
    for (const m of lista) coletadas.set(m.key.id!, m);
  };

  try {
    const r = await sock.newsletterFetchMessages(jid, 100, desde, undefined as unknown as number);
    adicionar(nosParaMensagens(jid, r));
  } catch (e) {
    diag.push(`${jid} message_updates(since) falhou: ${(e as Error).message}`);
  }

  if (coletadas.size === 0) {
    try {
      const r = await sock.newsletterFetchMessages(jid, 100, undefined as unknown as number, undefined as unknown as number);
      adicionar(nosParaMensagens(jid, r));
    } catch (e) {
      diag.push(`${jid} message_updates falhou: ${(e as Error).message}`);
    }
  }

  let antes: number | undefined;
  for (let pagina = 0; pagina < 10; pagina++) {
    try {
      const attrs: Record<string, string> = { type: 'jid', jid, count: '100' };
      if (antes) attrs.before = String(antes);
      const r = await sock.query({
        tag: 'iq',
        attrs: { id: sock.generateMessageTag(), type: 'get', xmlns: 'newsletter', to: S_WHATSAPP_NET },
        content: [{ tag: 'messages', attrs }],
      });
      const lote = nosParaMensagens(jid, r);
      const antesTam = coletadas.size;
      adicionar(lote);
      if (!lote.length || coletadas.size === antesTam) break;
      const maisAntiga = lote.reduce((a, b) => (Number(a.messageTimestamp) < Number(b.messageTimestamp) ? a : b));
      if (Number(maisAntiga.messageTimestamp) < desde) break;
      const sid = (maisAntiga as unknown as { newsletterServerId?: number }).newsletterServerId;
      if (!sid) break;
      antes = sid;
    } catch (e) {
      diag.push(`${jid} messages(jid) falhou: ${(e as Error).message}`);
      break;
    }
  }

  return [...coletadas.values()];
}
