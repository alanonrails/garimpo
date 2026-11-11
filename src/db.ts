import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.pastaDados, { recursive: true });

export const db = new Database(path.join(config.pastaDados, 'garimpo.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS fonte (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('grupo', 'canal')),
  nome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oferta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte_ids TEXT NOT NULL,
  titulo_produto TEXT NOT NULL,
  palavra_chave TEXT,
  variante TEXT,
  loja TEXT,
  id_loja TEXT,
  categoria TEXT NOT NULL,
  preco REAL,
  condicao TEXT,
  link_final TEXT,
  link_original TEXT,
  caminho_imagem TEXT,
  qtd_mensagens INTEGER NOT NULL,
  extraido_em TEXT NOT NULL,
  embedding BLOB
);
CREATE TABLE IF NOT EXISTS mensagem_dia (
  chave TEXT PRIMARY KEY,
  dia TEXT NOT NULL,
  fonte_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  dados TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extracao_cache (
  hash TEXT PRIMARY KEY,
  dia TEXT NOT NULL,
  dados TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS link_cache (
  url TEXT PRIMARY KEY,
  dia TEXT NOT NULL,
  dados TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`);

if (!(db.prepare('PRAGMA table_info(oferta)').all() as { name: string }[]).some((c) => c.name === 'texto_mensagem')) {
  db.exec('ALTER TABLE oferta ADD COLUMN texto_mensagem TEXT');
}

export function limparDiasAnteriores(dia: string) {
  db.transaction(() => {
    for (const t of ['mensagem_dia', 'extracao_cache', 'link_cache']) db.prepare(`DELETE FROM ${t} WHERE dia <> ?`).run(dia);
  })();
  if (fs.existsSync(config.pastaImagens)) {
    for (const nome of fs.readdirSync(config.pastaImagens)) {
      if (nome !== dia) fs.rmSync(path.join(config.pastaImagens, nome), { recursive: true, force: true });
    }
  }
}

export function cacheObter<T>(tabela: 'extracao_cache' | 'link_cache', chave: string): T | undefined {
  const col = tabela === 'link_cache' ? 'url' : 'hash';
  const linha = db.prepare(`SELECT dados FROM ${tabela} WHERE ${col} = ?`).get(chave) as { dados: string } | undefined;
  return linha ? (JSON.parse(linha.dados) as T) : undefined;
}

export function cacheGravar(tabela: 'extracao_cache' | 'link_cache', chave: string, dia: string, dados: unknown) {
  const col = tabela === 'link_cache' ? 'url' : 'hash';
  db.prepare(`INSERT OR REPLACE INTO ${tabela} (${col}, dia, dados) VALUES (?, ?, ?)`).run(chave, dia, JSON.stringify(dados));
}

export function metaObter<T>(chave: string): T | null {
  const l = db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return l ? (JSON.parse(l.valor) as T) : null;
}

export function metaGravar(chave: string, valor: unknown) {
  db.prepare('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)').run(chave, JSON.stringify(valor));
}
