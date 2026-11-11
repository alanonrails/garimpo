import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Oferta {
  id: number;
  titulo_produto: string;
  palavra_chave: string | null;
  variante: string | null;
  loja: string | null;
  categoria: string;
  preco: number | null;
  condicao: string | null;
  link: string | null;
  imagem: string | null;
  fontes: string[];
  mensagem: string | null;
}

interface RespostaOfertas {
  total: number;
  categorias: { categoria: string; ofertas: Oferta[] }[];
}

interface Conexao {
  estado: 'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado';
  numero: string | null;
  etapa: string | null;
  erro: string | null;
  ocupado: boolean;
}

interface Status {
  estado: 'ocioso' | 'rodando' | 'concluido' | 'erro';
  etapa: string;
  atual: number;
  total: number;
  iniciadoEm: string | null;
  resumo: { finalizadoEm?: string; ofertasFinais?: number } | null;
  previsao: { restanteSegundos: number | null };
  conexao: Conexao;
}

interface Fonte {
  id: string;
  tipo: 'grupo' | 'canal';
  nome: string;
  novo: boolean;
}

interface PalavraChave {
  palavra: string;
  categoria: string;
  variantes: string[];
  marcas: string[];
  ofertas?: number;
}

interface RespostaVocabulario {
  categorias: string[];
  palavras: PalavraChave[];
  semCategoria: string[];
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Maceio' }).format(new Date(iso));
const json = async <T,>(rota: string) => (await (await fetch(`/api${rota}`)).json()) as T;
const enviar = (url: string, metodo: string, corpo: unknown) =>
  fetch(`/api${url}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function Topo({ status, qtdFontes, aoAtualizar }: { status: Status | null; qtdFontes: number; aoAtualizar: () => void }) {
  const c = status?.conexao;
  const rodando = status?.estado === 'rodando';
  const post = async (rota: string) => {
    await fetch(`/api${rota}`, { method: 'POST' });
    aoAtualizar();
  };
  const rotulo = { conectado: 'Conectado', aguardando_qr: 'Aguardando QR code', conectando: 'Conectando…', desconectado: 'Desconectado' };
  const cor = { conectado: 'success', aguardando_qr: 'warning', conectando: 'warning', desconectado: 'secondary' };
  const restante = status?.previsao.restanteSegundos;
  const pct = status && status.total > 0 ? Math.round((100 * status.atual) / status.total) : null;

  return (
    <div className="mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        {c && <span className={`badge text-bg-${cor[c.estado]}`}>{rotulo[c.estado]}</span>}
        {c?.estado === 'desconectado' && (
          <button className="btn btn-sm btn-outline-primary" disabled={c.ocupado} onClick={() => post('/conectar')}>
            Conectar
          </button>
        )}
        {c?.estado === 'aguardando_qr' && (
          <button className="btn btn-sm btn-outline-secondary" onClick={() => post('/conectar/cancelar')}>
            Cancelar
          </button>
        )}
        <span className="text-body-secondary small">
          {status?.resumo?.finalizadoEm && !rodando && `Última extração: ${dataHora(status.resumo.finalizadoEm)} · ${status.resumo.ofertasFinais ?? 0} ofertas`}
        </span>
        <button
          className="btn btn-primary ms-auto"
          disabled={c?.estado !== 'conectado' || c.ocupado || qtdFontes === 0}
          onClick={() => post('/extrair')}
        >
          {rodando ? 'Extraindo…' : 'Extrair'}
        </button>
      </div>
      {c?.erro && <div className="alert alert-danger py-2 mt-2 mb-0">{c.erro}</div>}
      {c?.estado === 'aguardando_qr' && (
        <div className="card mt-2">
          <div className="card-body d-flex gap-3 align-items-center">
            <img src={`/api/qr?v=${Date.now()}`} alt="QR code do WhatsApp" width={200} height={200} />
            <p className="mb-0">
              No WhatsApp do número secundário: <b>Aparelhos conectados → Conectar um aparelho</b>.
            </p>
          </div>
        </div>
      )}
      {rodando && (
        <div className="mt-2">
          <div className="small mb-1">
            {status.etapa}
            {status.total > 0 && ` (${status.atual} de ${status.total})`}
            {restante != null && ` · faltam ~${Math.max(1, Math.round(restante / 60))} min`}
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${pct ?? 100}%` }} />
          </div>
        </div>
      )}
      {status?.estado === 'erro' && <div className="alert alert-danger py-2 mt-2 mb-0">{status.etapa}</div>}
    </div>
  );
}

const CUPONS = 'Cupons e serviços';

function TextoComLinks({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(https?:\/\/\S+)/g).map((parte, i) =>
        /^https?:\/\//.test(parte) ? (
          <a key={i} href={parte} target="_blank" rel="noopener noreferrer">
            {parte}
          </a>
        ) : (
          parte
        ),
      )}
    </>
  );
}

function JanelaMensagem({ o, aoFechar }: { o: Oferta; aoFechar: () => void }) {
  return (
    <>
      <div className="modal d-block" tabIndex={-1} onClick={aoFechar}>
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <h6 className="modal-title text-truncate">{o.titulo_produto}</h6>
              <button type="button" className="btn-close" aria-label="Fechar" onClick={aoFechar} />
            </div>
            <div className="modal-body small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <TextoComLinks texto={o.mensagem ?? ''} />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

const IconeOlho = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.17 8a13 13 0 0 1 1.66-2.04C4.12 4.67 5.88 3.5 8 3.5s3.87 1.17 5.17 2.46A13 13 0 0 1 14.83 8q-.09.13-.2.29c-.34.49-.85 1.12-1.46 1.75C11.87 11.33 10.12 12.5 8 12.5s-3.87-1.17-5.17-2.46A13 13 0 0 1 1.17 8" />
    <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0" />
  </svg>
);

function Cartao({ o }: { o: Oferta }) {
  const [falhou, setFalhou] = useState(false);
  const [abrirMensagem, setAbrirMensagem] = useState(false);
  return (
    <div className="col">
      <div className="card h-100">
        <div className="ratio ratio-1x1 bg-body-tertiary">
          {o.imagem && !falhou ? (
            <img src={o.imagem} alt={o.titulo_produto} loading="lazy" className="card-img-top object-fit-cover" onError={() => setFalhou(true)} />
          ) : (
            <div className="d-flex align-items-center justify-content-center text-body-secondary small">sem imagem</div>
          )}
        </div>
        <div className="card-body d-flex flex-column gap-1 p-2">
          <div className="d-flex gap-1 small text-truncate" title={o.variante ? `Palavra-chave "${o.palavra_chave}", pela variante "${o.variante}"` : ''}>
            <span className={`badge ${o.palavra_chave ? 'text-bg-primary' : 'text-bg-warning'}`}>{o.palavra_chave ?? 'sem palavra-chave'}</span>
            {o.variante && o.variante !== o.palavra_chave && <span className="badge text-bg-light border text-truncate">{o.variante}</span>}
          </div>
          <h6 className="card-title text-truncate mb-0" title={o.titulo_produto}>
            {o.titulo_produto}
          </h6>
          <div className="small text-body-secondary text-truncate">{o.loja ?? 'Loja desconhecida'}</div>
          <div className="fw-bold text-success">{o.preco != null ? brl.format(o.preco) : ' '}</div>
          <div className="small text-truncate" title={o.condicao ?? ''}>
            {o.condicao ?? ' '}
          </div>
          <div className="small text-body-secondary text-truncate" title={o.fontes.join(', ')}>
            {o.fontes.length > 1 ? `visto em ${o.fontes.length} fontes` : ' '}
          </div>
          <div className="d-flex gap-1 mt-auto">
            {o.link && o.categoria !== CUPONS ? (
              <a href={o.link} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary flex-grow-1">
                Ver oferta
              </a>
            ) : (
              <button type="button" className="btn btn-sm btn-outline-primary flex-grow-1" disabled>
                Ver oferta
              </button>
            )}
            {o.mensagem && (
              <button type="button" className="btn btn-sm btn-outline-secondary" title="Ver mensagem" aria-label="Ver mensagem" onClick={() => setAbrirMensagem(true)}>
                <IconeOlho />
              </button>
            )}
          </div>
        </div>
      </div>
      {abrirMensagem && <JanelaMensagem o={o} aoFechar={() => setAbrirMensagem(false)} />}
    </div>
  );
}

function AbaOfertas({ versao }: { versao: string | null | undefined }) {
  const [dados, setDados] = useState<RespostaOfertas | null>(null);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const atual = useRef('');

  useEffect(() => {
    atual.current = busca;
    const t = setTimeout(async () => {
      const r = await json<RespostaOfertas>(`/ofertas${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`);
      if (atual.current === busca) setDados(r);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, versao]);

  const visiveis = dados?.categorias.filter((c) => !categoria || c.categoria === categoria) ?? [];
  return (
    <>
      <div className="row g-2 mb-3">
        <div className="col-md-8">
          <input type="search" className="form-control" placeholder="Buscar (ex.: air fryer, whey, Amazon)" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="col-md-4">
          <select className="form-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas as categorias ({dados?.total ?? 0})</option>
            {dados?.categorias.map((c) => (
              <option key={c.categoria} value={c.categoria}>
                {c.categoria} ({c.ofertas.length})
              </option>
            ))}
          </select>
        </div>
      </div>
      {dados && dados.total === 0 && <p className="text-body-secondary">{busca ? 'Nada encontrado.' : 'Nenhuma oferta ainda. Clique em Extrair.'}</p>}
      {visiveis.map((c) => (
        <section key={c.categoria} className="mb-4">
          <h5>
            {c.categoria} <span className="badge text-bg-secondary">{c.ofertas.length}</span>
          </h5>
          <div className="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-lg-5 row-cols-xl-6 g-2">
            {c.ofertas.map((o) => (
              <Cartao key={o.id} o={o} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const lista = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

interface Linha {
  id: number;
  palavra: string;
  categoria: string;
  variantes: string;
  marcas: string;
  ofertas: number;
}
let proximoId = 1;
const paraLinha = (p: PalavraChave): Linha => ({
  id: proximoId++,
  palavra: p.palavra,
  categoria: p.categoria,
  variantes: p.variantes.join(', '),
  marcas: p.marcas.join(', '),
  ofertas: p.ofertas ?? 0,
});

function AbaPalavras({ aoSalvar }: { aoSalvar: () => void }) {
  const [dados, setDados] = useState<RespostaVocabulario | null>(null);
  const [palavras, setPalavras] = useState<Linha[]>([]);
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [alterado, setAlterado] = useState(false);

  const aplicar = (r: RespostaVocabulario) => {
    setDados(r);
    setPalavras(r.palavras.map(paraLinha));
    setCategoria((c) => c || r.categorias[0]);
    setAlterado(false);
  };
  useEffect(() => {
    json<RespostaVocabulario>('/vocabulario').then(aplicar).catch(() => {});
  }, []);

  const mudar = (id: number, campo: Partial<Linha>) => {
    setPalavras((p) => p.map((x) => (x.id === id ? { ...x, ...campo } : x)));
    setAlterado(true);
    setSalvo(false);
  };
  const remover = (id: number) => {
    setPalavras((p) => p.filter((x) => x.id !== id));
    setAlterado(true);
  };
  const [arrastando, setArrastando] = useState<number | null>(null);
  const mover = (origem: number, alvo: number) => {
    if (origem === alvo) return;
    setPalavras((p) => {
      const de = p.findIndex((x) => x.id === origem);
      const para = p.findIndex((x) => x.id === alvo);
      const nova = [...p];
      const [item] = nova.splice(de, 1);
      nova.splice(para, 0, item);
      return nova;
    });
    setAlterado(true);
    setSalvo(false);
  };
  const adicionar = () => {
    setPalavras((p) => [{ id: proximoId++, palavra: '', categoria, variantes: '', marcas: '', ofertas: 0 }, ...p]);
    setAlterado(true);
  };
  const salvar = async () => {
    const corpoEnvio = palavras.map((l) => ({ palavra: l.palavra, categoria: l.categoria, variantes: lista(l.variantes), marcas: lista(l.marcas) }));
    const r = await enviar('/vocabulario', 'PUT', corpoEnvio);
    const corpo = await r.json();
    if (!r.ok) {
      setErros(corpo.erros ?? ['Não foi possível salvar.']);
      return;
    }
    setErros([]);
    setSalvo(true);
    aplicar(corpo);
    aoSalvar();
  };

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of palavras) m.set(p.categoria, (m.get(p.categoria) ?? 0) + 1);
    return m;
  }, [palavras]);

  if (!dados) return <p className="text-body-secondary">Carregando…</p>;

  const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const f = semAcento(filtro.trim());
  const linhas = f
    ? palavras.filter((p) => semAcento(`${p.palavra} ${p.variantes} ${p.marcas}`).includes(f))
    : palavras.filter((p) => p.categoria === categoria);

  return (
    <div className="row g-3">
      <div className="col-lg-3">
        <div className="list-group">
          {dados.categorias.map((c) => (
            <button
              key={c}
              className={`list-group-item list-group-item-action d-flex justify-content-between ${c === categoria && !f ? 'active' : ''}`}
              onClick={() => {
                setCategoria(c);
                setFiltro('');
              }}
            >
              <span className="text-truncate">{c}</span>
              <span className="badge text-bg-secondary">{contagem.get(c) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="card mt-3">
          <div className="card-header">
            Sem categoria <span className="badge text-bg-warning">{dados.semCategoria.length}</span>
          </div>
          <ul className="list-group list-group-flush small">
            {dados.semCategoria.map((t) => (
              <li key={t} className="list-group-item">
                {t}
              </li>
            ))}
            {!dados.semCategoria.length && <li className="list-group-item text-body-secondary">Todas as ofertas têm palavra-chave.</li>}
          </ul>
        </div>
      </div>

      <div className="col-lg-9">
        <div className="d-flex flex-wrap gap-2 mb-2">
          <input type="search" className="form-control w-auto flex-grow-1" placeholder="Buscar palavra-chave, variante ou marca (todas as categorias)" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <button className="btn btn-outline-primary" onClick={adicionar}>
            + Palavra-chave
          </button>
          <button className="btn btn-primary" disabled={!alterado} onClick={salvar}>
            Salvar e reclassificar
          </button>
        </div>
        {erros.length > 0 && (
          <div className="alert alert-danger">
            <ul className="mb-0">
              {erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {salvo && <div className="alert alert-success py-2">Salvo. As ofertas de hoje foram reclassificadas.</div>}
        <p className="small text-body-secondary mb-2">
          Arraste pela alça ⋮⋮ para mudar a ordem; as ofertas aparecem nessa ordem. Variantes e marcas separadas por vírgula, no singular. Marcas só valem quando o título não cita nenhum tipo. Uma palavra não pode se repetir em
          duas palavras-chave.
        </p>
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th />
                <th style={{ width: '18%' }}>Palavra-chave</th>
                <th>Variantes</th>
                <th style={{ width: '20%' }}>Marcas</th>
                <th style={{ width: '16%' }}>Categoria</th>
                <th className="text-end">Ofertas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr
                  key={p.id}
                  className={arrastando === p.id ? 'opacity-50' : ''}
                  onDragOver={(e) => {
                    if (arrastando == null) return;
                    e.preventDefault();
                    mover(arrastando, p.id);
                  }}
                  onDrop={(e) => e.preventDefault()}
                >
                  <td className="text-body-secondary px-1">
                    {!f && (
                      <span
                        draggable
                        role="button"
                        title="Arraste para reordenar"
                        style={{ cursor: 'grab', userSelect: 'none' }}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(p.id));
                          setArrastando(p.id);
                        }}
                        onDragEnd={() => setArrastando(null)}
                      >
                        ⋮⋮
                      </span>
                    )}
                  </td>
                  <td>
                    <input className="form-control form-control-sm" value={p.palavra} onChange={(e) => mudar(p.id, { palavra: e.target.value })} />
                  </td>
                  <td>
                    <textarea className="form-control form-control-sm" rows={1} value={p.variantes} onChange={(e) => mudar(p.id, { variantes: e.target.value })} />
                  </td>
                  <td>
                    <textarea className="form-control form-control-sm" rows={1} value={p.marcas} onChange={(e) => mudar(p.id, { marcas: e.target.value })} />
                  </td>
                  <td>
                    <select className="form-select form-select-sm" value={p.categoria} onChange={(e) => mudar(p.id, { categoria: e.target.value })}>
                      {dados.categorias.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="text-end">{p.ofertas ?? 0}</td>
                  <td>
                    <button className="btn btn-sm btn-outline-danger" aria-label={`Remover ${p.palavra}`} onClick={() => remover(p.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AbaWhatsApp({ status, aoContar, aoAtualizar }: { status: Status | null; aoContar: (n: number) => void; aoAtualizar: () => void }) {
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<string[]>([]);
  const [ausentes, setAusentes] = useState<Fonte[]>([]);
  const [q, setQ] = useState('');
  const [link, setLink] = useState('');
  const c = status?.conexao;

  const aplicar = useCallback((r: { selecionadas: string[]; canaisExtras: string[]; encontradas: Fonte[]; ausentes: Fonte[] }) => {
    setFontes([...r.encontradas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
    setAusentes(r.ausentes ?? []);
    setSel(new Set(r.selecionadas));
    setExtras(r.canaisExtras);
  }, []);
  useEffect(() => {
    json<Parameters<typeof aplicar>[0]>('/fontes').then(aplicar).catch(() => {});
  }, [aplicar, c?.ocupado]);
  useEffect(() => aoContar(fontes.filter((f) => sel.has(f.id)).length), [aoContar, fontes, sel]);

  const salvar = async (corpo: object) => aplicar(await (await enviar('/fontes', 'PUT', corpo)).json());
  const marcar = (ids: string[], valor: boolean) => {
    const nova = new Set(sel);
    ids.forEach((id) => (valor ? nova.add(id) : nova.delete(id)));
    setSel(nova);
    salvar({ selecionadas: [...nova] }).catch(() => {});
  };
  const post = async (rota: string) => {
    await fetch(`/api${rota}`, { method: 'POST' });
    aoAtualizar();
  };
  const visiveis = fontes.filter((f) => !q.trim() || f.nome.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
          <h6 className="mb-0 me-auto">
            Fontes <span className="badge text-bg-secondary">{fontes.filter((f) => sel.has(f.id)).length} de {fontes.length}</span>
          </h6>
          <button className="btn btn-sm btn-outline-secondary" disabled={c?.estado !== 'conectado' || c.ocupado} onClick={() => post('/conectar')}>
            Atualizar lista
          </button>
          {c?.estado === 'conectado' && (
            <button className="btn btn-sm btn-outline-danger" disabled={c.ocupado} onClick={() => confirm('Desconectar este aparelho do WhatsApp?') && post('/desconectar')}>
              Desconectar
            </button>
          )}
        </div>
        {fontes.length === 0 ? (
          <p className="text-body-secondary">Conecte o WhatsApp para listar seus grupos e canais.</p>
        ) : (
          <>
            <div className="d-flex gap-2 mb-2">
              <input type="search" className="form-control form-control-sm" placeholder="Buscar fonte" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => marcar(visiveis.map((f) => f.id), true)}>
                Marcar todos
              </button>
              <button className="btn btn-sm btn-outline-secondary text-nowrap" onClick={() => marcar(visiveis.map((f) => f.id), false)}>
                Desmarcar todos
              </button>
            </div>
            {ausentes.some((f) => sel.has(f.id)) && (
              <div className="alert alert-warning py-2 small">
                Marcadas, mas não vieram na última lista do WhatsApp (não são lidas):
                {ausentes
                  .filter((f) => sel.has(f.id))
                  .map((f) => (
                    <label key={f.id} className="d-flex gap-2 align-items-center mt-1">
                      <input className="form-check-input m-0" type="checkbox" checked onChange={() => marcar([f.id], false)} />
                      <span>{f.nome}</span>
                      <span className="badge text-bg-light border">{f.tipo}</span>
                    </label>
                  ))}
              </div>
            )}
            <div className="list-group overflow-auto mb-3" style={{ maxHeight: 400 }}>
              {visiveis.map((f) => (
                <label key={f.id} className="list-group-item d-flex gap-2 align-items-center">
                  <input className="form-check-input m-0" type="checkbox" checked={sel.has(f.id)} onChange={(e) => marcar([f.id], e.target.checked)} />
                  <span className="text-truncate">{f.nome}</span>
                  <span className="badge text-bg-light border ms-auto">{f.tipo}</span>
                  {f.novo && <span className="badge text-bg-info">novo</span>}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="input-group input-group-sm">
          <input className="form-control" placeholder="Link de um canal que você não segue" value={link} onChange={(e) => setLink(e.target.value)} />
          <button
            className="btn btn-outline-primary"
            onClick={async () => {
              if (!link.trim()) return;
              await salvar({ canaisExtras: [...extras, link.trim()] });
              setLink('');
            }}
          >
            Adicionar canal
          </button>
        </div>
        {extras.map((x) => (
          <span key={x} className="badge text-bg-light border mt-2 me-1">
            {x}{' '}
            <button className="btn-close btn-close-sm align-middle" style={{ fontSize: '0.5rem' }} aria-label={`Remover ${x}`} onClick={() => salvar({ canaisExtras: extras.filter((e) => e !== x) })} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [aba, setAba] = useState<'ofertas' | 'palavras' | 'whatsapp'>('ofertas');
  const [qtdFontes, setQtdFontes] = useState(0);
  const [versao, setVersao] = useState<string | null | undefined>(undefined);

  const atualizar = useCallback(async () => {
    try {
      const s = await json<Status>('/status');
      setStatus(s);
      setVersao(s.estado === 'rodando' ? undefined : (s.resumo?.finalizadoEm ?? null));
    } catch {}
  }, []);

  useEffect(() => {
    atualizar();
    const ativo = status?.estado === 'rodando' || status?.conexao.ocupado || status?.conexao.estado === 'aguardando_qr';
    const t = setInterval(atualizar, ativo ? 1500 : 10000);
    return () => clearInterval(t);
  }, [atualizar, status?.estado, status?.conexao.ocupado, status?.conexao.estado]);

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center mb-3">
        <h4 className="mb-0 me-4">Garimpo</h4>
        <ul className="nav nav-pills">
          {(
            [
              ['ofertas', 'Ofertas'],
              ['palavras', 'Palavras-chave'],
              ['whatsapp', 'WhatsApp'],
            ] as const
          ).map(([id, nome]) => (
            <li key={id} className="nav-item">
              <button className={`nav-link ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>
                {nome}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Topo status={status} qtdFontes={qtdFontes} aoAtualizar={atualizar} />
      <div className={aba === 'ofertas' ? '' : 'd-none'}>
        <AbaOfertas versao={versao} />
      </div>
      {aba === 'palavras' && <AbaPalavras aoSalvar={() => setVersao(String(Date.now()))} />}
      <div className={aba === 'whatsapp' ? '' : 'd-none'}>
        <AbaWhatsApp status={status} aoContar={setQtdFontes} aoAtualizar={atualizar} />
      </div>
    </div>
  );
}
