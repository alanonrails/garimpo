const REGEX_URL = /\bhttps?:\/\/[^\s<>"'*]+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|com\.br|net|pro|to|la|me|ly|link|io|shop)\/[^\s<>"'*]+/gi;

const SINAIS_PROMO = [
  /R\$\s?\d/i,
  /\b\d{1,3}(?:\.\d{3})*,\d{2}\b/,
  /\bcupom\b/i,
  /\bcupons?\b/i,
  /\bdesconto\b/i,
  /\d+\s?%/,
  /\boff\b/i,
  /\boferta\b/i,
  /\bpromo/i,
  /frete\s+gr[aá]tis/i,
  /a partir de/i,
  /\bpor\s*(?:R\$)?\s?\d/i,
  /por apenas/i,
  /menor pre[cç]o/i,
  /\bbaixou\b/i,
  /\bachado/i,
  /\bpre[cç]o\b/i,
  /\bde\s+R?\$?\s?\d+.*\bpor\b/i,
];

export function extrairLinks(texto: string): string[] {
  const achados = texto.match(REGEX_URL) ?? [];
  const limpos = achados.map((u) => {
    const sem = u.replace(/[).,;:!?\]]+$/, '');
    return /^https?:\/\//i.test(sem) ? sem : `https://${sem}`;
  });
  return [...new Set(limpos)];
}

export function ehPromocao(texto: string): boolean {
  if (!texto) return false;
  if (!extrairLinks(texto).length) return false;
  return SINAIS_PROMO.some((r) => r.test(texto));
}
