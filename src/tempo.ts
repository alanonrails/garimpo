import { config } from './config.js';

function partesNoFuso(data: Date, fuso: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

export function inicioDoDia(agora = new Date(), fuso = config.fuso): Date {
  const p = partesNoFuso(agora, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const deslocamento = comoUtc - Math.floor(agora.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia) - deslocamento);
}

export function dataDoDia(agora = new Date(), fuso = config.fuso): string {
  const p = partesNoFuso(agora, fuso);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}
