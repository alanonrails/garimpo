import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import { config } from '../config.js';

interface EventoHistorico {
  progress: number | null | undefined;
  isLatest: boolean | undefined;
}

export class SessaoWhatsApp {
  sock: WASocket | null = null;
  qrPng: Buffer | null = null;
  mensagens = new Map<string, WAMessage>();
  nomesChats = new Map<string, string>();
  historico: EventoHistorico[] = [];
  ultimoEventoEm = 0;
  pendentesRecebidas = false;
  abertaEm = 0;
  numero: string | null = null;
  private encerrando = false;
  private tentativas = 0;
  private logger = pino({ level: 'silent' });

  constructor(private aoQr?: () => void) {}

  private registrar(msgs: WAMessage[]) {
    for (const m of msgs) {
      if (!m.key?.remoteJid || !m.key.id) continue;
      const k = `${m.key.remoteJid}|${m.key.id}`;
      const existente = this.mensagens.get(k);
      if (!existente || (!existente.message && m.message)) this.mensagens.set(k, m);
    }
    this.ultimoEventoEm = Date.now();
  }

  abrir(): Promise<WASocket> {
    fs.mkdirSync(config.pastaAuth, { recursive: true });
    this.encerrando = false;
    return new Promise((resolve, reject) => {
      const iniciar = async () => {
        try {
          const { state, saveCreds } = await useMultiFileAuthState(config.pastaAuth);
          const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
          const sock = makeWASocket({
            auth: state,
            version,
            logger: this.logger,
            browser: Browsers.macOS('Desktop'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            emitOwnEvents: false,
            generateHighQualityLinkPreview: false,
            getMessage: async () => undefined,
          });
          this.sock = sock;

          sock.ev.on('creds.update', saveCreds);

          sock.ev.on('messaging-history.set', ({ messages, chats, progress, isLatest }) => {
            for (const c of chats) if (c.id && c.name) this.nomesChats.set(c.id, c.name);
            this.registrar(messages);
            this.historico.push({ progress, isLatest });
          });

          sock.ev.on('messages.upsert', ({ messages }) => this.registrar(messages));

          sock.ev.on('chats.upsert', (chats) => {
            for (const c of chats) if (c.id && c.name) this.nomesChats.set(c.id, c.name);
            this.ultimoEventoEm = Date.now();
          });

          sock.ev.on('connection.update', async (u) => {
            if (u.qr) {
              this.qrPng = await QRCode.toBuffer(u.qr, { width: 400 }).catch(() => null);
              qrTerminal.generate(u.qr, { small: true });
              this.aoQr?.();
            }
            if (u.receivedPendingNotifications) {
              this.pendentesRecebidas = true;
              this.ultimoEventoEm = Date.now();
            }
            if (u.connection === 'open') {
              this.qrPng = null;
              this.tentativas = 0;
              this.abertaEm = Date.now();
              this.numero = sock.user?.id ? sock.user.id.split(/[:@]/)[0] : null;
              this.ultimoEventoEm = Date.now();
              resolve(sock);
            }
            if (u.connection === 'close') {
              if (this.encerrando) {
                reject(new Error('Conexão cancelada.'));
                return;
              }
              const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
                ?.statusCode;
              if (codigo === DisconnectReason.loggedOut) {
                fs.rmSync(config.pastaAuth, { recursive: true, force: true });
                reject(new Error('Sessão desconectada pelo celular (logout). Escaneie o QR novamente.'));
                return;
              }
              this.tentativas += 1;
              if (codigo === DisconnectReason.restartRequired || this.tentativas <= 5) {
                setTimeout(iniciar, codigo === DisconnectReason.restartRequired ? 0 : 2000 * this.tentativas);
                return;
              }
              reject(new Error(`Falha ao conectar no WhatsApp (código ${codigo ?? 'desconhecido'}).`));
            }
          });
        } catch (e) {
          reject(e);
        }
      };
      iniciar();
    });
  }

  async aguardarSincronizacao(ociosoMs = config.coletaOciosoMs, maxMs = config.coletaMaxMs) {
    const inicio = Date.now();
    while (Date.now() - inicio < maxMs) {
      await new Promise((r) => setTimeout(r, 500));
      const ocioso = Date.now() - this.ultimoEventoEm >= ociosoMs;
      const ultimoHist = this.historico.at(-1);
      const histEmAndamento = ultimoHist && ultimoHist.progress != null && ultimoHist.progress < 100 && !ultimoHist.isLatest;
      if (this.pendentesRecebidas && ocioso && !histEmAndamento) return true;
      if (!this.pendentesRecebidas && Date.now() - this.abertaEm > ociosoMs * 3 && ocioso) return true;
    }
    return false;
  }

  async sair() {
    try {
      if (fs.existsSync(path.join(config.pastaAuth, 'creds.json'))) {
        const sock = await Promise.race([
          this.abrir(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 30000)),
        ]);
        await sock.logout().catch(() => {});
      }
    } catch {
    } finally {
      await this.fechar();
      fs.rmSync(config.pastaAuth, { recursive: true, force: true });
      this.numero = null;
    }
  }

  async fechar() {
    this.encerrando = true;
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try {
      sock.ev.removeAllListeners('messages.upsert');
      sock.ev.removeAllListeners('messaging-history.set');
      sock.end(undefined);
    } catch {}
  }
}
