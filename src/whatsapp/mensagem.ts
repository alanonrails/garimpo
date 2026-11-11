import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage, normalizeMessageContent, type proto, type WAMessage } from 'baileys';

export interface MensagemColetada {
  id: string;
  fonteId: string;
  timestamp: number;
  texto: string | null;
  legenda: string | null;
  temImagem: boolean;
  imagem: string | null;
  imagemOrigem: 'midia' | 'preview_hd' | 'preview_link' | null;
}

export function paraNumero(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && 'toNumber' in (v as object)) return (v as { toNumber(): number }).toNumber();
  return Number(v) || 0;
}

export function normalizar(msg: WAMessage, fonteId: string): MensagemColetada | null {
  const conteudo = normalizeMessageContent(msg.message);
  if (!conteudo) return null;
  if (conteudo.protocolMessage || conteudo.reactionMessage) return null;
  const ts = paraNumero(msg.messageTimestamp);
  const ext = conteudo.extendedTextMessage;
  const img = conteudo.imageMessage;
  const legenda = img?.caption ?? conteudo.videoMessage?.caption ?? conteudo.documentMessage?.caption ?? null;
  const texto = conteudo.conversation ?? ext?.text ?? null;
  if (!texto && !legenda && !img) return null;
  return {
    id: msg.key.id!,
    fonteId,
    timestamp: ts,
    texto,
    legenda,
    temImagem: !!img || !!ext?.jpegThumbnail?.length || !!ext?.thumbnailDirectPath,
    imagem: null,
    imagemOrigem: null,
  };
}

async function baixarCriptografada(img: proto.Message.IImageMessage): Promise<Buffer> {
  const stream = await downloadContentFromMessage(
    { mediaKey: img.mediaKey, directPath: img.directPath, url: img.url },
    'image',
  );
  const partes: Buffer[] = [];
  for await (const p of stream) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

async function baixarPreviaHd(ext: proto.Message.IExtendedTextMessage): Promise<Buffer> {
  if (!ext.mediaKey?.length) return baixarSemCriptografia({ directPath: ext.thumbnailDirectPath });
  const stream = await downloadContentFromMessage(
    { mediaKey: ext.mediaKey, directPath: ext.thumbnailDirectPath },
    'thumbnail-link',
  );
  const partes: Buffer[] = [];
  for await (const p of stream) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

async function baixarSemCriptografia(img: proto.Message.IImageMessage): Promise<Buffer> {
  const url = img.directPath ? `https://mmg.whatsapp.net${img.directPath}` : img.url;
  if (!url) throw new Error('imagem sem URL');
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function baixarImagem(msg: WAMessage, coletada: MensagemColetada, pasta: string) {
  const conteudo = normalizeMessageContent(msg.message);
  const img = conteudo?.imageMessage;
  const ext = conteudo?.extendedTextMessage;
  const thumb = ext?.jpegThumbnail;
  const nome = `${coletada.fonteId.replace(/[^a-zA-Z0-9]/g, '_')}_${coletada.id.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;
  const destino = path.join(pasta, nome);
  if (fs.existsSync(destino) && (img || !ext?.thumbnailDirectPath)) {
    coletada.imagem = destino;
    coletada.imagemOrigem ??= img ? 'midia' : 'preview_link';
    return;
  }
  try {
    let dados: Buffer | null = null;
    if (img) {
      dados = img.mediaKey?.length ? await baixarCriptografada(img) : await baixarSemCriptografia(img);
      coletada.imagemOrigem = 'midia';
    } else if (ext?.thumbnailDirectPath) {
      dados = await baixarPreviaHd(ext).catch(() => null);
      if (dados) coletada.imagemOrigem = 'preview_hd';
    }
    if (!dados && thumb?.length) {
      dados = Buffer.from(thumb);
      coletada.imagemOrigem = 'preview_link';
    }
    if (!dados) return;
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(destino, dados);
    coletada.imagem = destino;
  } catch {
    if (img?.jpegThumbnail?.length) {
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(destino, Buffer.from(img.jpegThumbnail));
      coletada.imagem = destino;
      coletada.imagemOrigem = 'preview_link';
    }
  }
}
