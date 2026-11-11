import { processarDia, status } from '../src/servico.js';
import { dataDoDia } from '../src/tempo.js';

const inicio = Date.now();
const resumo = await processarDia(dataDoDia());
console.log({ ...resumo, segundos: Math.round((Date.now() - inicio) / 1000), erros: status.erros.length });
process.exit(0);
