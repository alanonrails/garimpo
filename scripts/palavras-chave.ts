import { atribuirPalavra } from '../src/categorias.js';
import { db } from '../src/db.js';

const titulos = (db.prepare('SELECT titulo_produto t FROM oferta ORDER BY titulo_produto').all() as { t: string }[]).map((l) => l.t);
const uso = new Map<string, number>();
const sem: string[] = [];
for (const t of titulos) {
  const p = atribuirPalavra(t);
  if (p) uso.set(`${p.categoria} › ${p.palavra}`, (uso.get(`${p.categoria} › ${p.palavra}`) ?? 0) + 1);
  else sem.push(t);
}
console.log(`ofertas: ${titulos.length}  sem categoria: ${sem.length}\n`);
for (const t of sem) console.log(`  ${t}`);
console.log('');
for (const [k, n] of [...uso].sort()) console.log(`${String(n).padStart(4)}  ${k}`);
