import { db, metaGravar, metaObter } from './db.js';
import type { Fonte } from './whatsapp/coleta.js';

interface ConfigFontes {
  selecionadas: string[];
  canaisExtras: string[];
}

interface FonteEncontrada extends Fonte {
  novo: boolean;
}

const CHAVE = 'config_fontes';
const CHAVE_ENCONTRADAS = 'fontes_encontradas';

const lista = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean))];

const salvo = metaObter<ConfigFontes>(CHAVE);
let atual: ConfigFontes = { selecionadas: salvo?.selecionadas ?? [], canaisExtras: salvo?.canaisExtras ?? [] };

function gravar(c: ConfigFontes) {
  atual = { selecionadas: lista(c.selecionadas), canaisExtras: lista(c.canaisExtras) };
  metaGravar(CHAVE, atual);
}

const fontesEncontradas = (): FonteEncontrada[] => metaObter<FonteEncontrada[]>(CHAVE_ENCONTRADAS) ?? [];

export const configFontes = () => atual;

export const fontePermitida = (id: string) => atual.selecionadas.includes(id);

export function salvarConfigFontes(c: { selecionadas?: unknown; canaisExtras?: unknown }) {
  gravar({
    selecionadas: c.selecionadas === undefined ? atual.selecionadas : lista(c.selecionadas),
    canaisExtras: c.canaisExtras === undefined ? atual.canaisExtras : lista(c.canaisExtras),
  });
}

export function gravarFontesEncontradas(fontes: Fonte[]) {
  const anteriores = new Set(fontesEncontradas().map((f) => f.id));
  metaGravar(
    CHAVE_ENCONTRADAS,
    fontes.map(({ id, tipo, nome }) => ({ id, tipo, nome, novo: anteriores.size > 0 && !anteriores.has(id) })),
  );
  const extras = fontes.filter((f) => f.extra && !anteriores.has(f.id)).map((f) => f.id);
  if (extras.length) gravar({ ...atual, selecionadas: [...atual.selecionadas, ...extras] });
}

export function resumoFontes() {
  const encontradas = fontesEncontradas();
  const ids = new Set(encontradas.map((f) => f.id));
  const conhecidas = new Map((db.prepare('SELECT id, tipo, nome FROM fonte').all() as Fonte[]).map((f) => [f.id, f]));
  const ausentes = atual.selecionadas
    .filter((id) => !ids.has(id))
    .map((id) => conhecidas.get(id) ?? { id, tipo: 'canal' as const, nome: id });
  return { ...atual, encontradas, ausentes };
}
