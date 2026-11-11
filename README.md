# Garimpo

Lê as promoções dos seus grupos e canais de WhatsApp, extrai cada oferta, remove as repetidas e mostra tudo numa galeria por categoria, com busca.

Roda localmente num único processo: Fastify (API e página), SQLite, Baileys (WhatsApp, só leitura) e Ollama (IA local).

## Requisitos

- Node.js 22+
- [Ollama](https://ollama.com) com os modelos do `.env`

```sh
brew install ollama
brew services start ollama
ollama pull qwen3:8b
ollama pull bge-m3
```

## Uso

```sh
npm install
cp .env.example .env
npm start
```

Abra http://localhost:3000, clique em **Conectar**, escaneie o QR code com o WhatsApp (Aparelhos conectados → Conectar um aparelho), marque as fontes na aba **WhatsApp** e clique em **Extrair**.

## Como funciona

1. **WhatsApp** (`src/whatsapp/`, `src/fontes.ts`): abre a sessão, espera a sincronização, lista grupos e canais e guarda as mensagens de hoje das fontes marcadas, com a imagem de cada uma. O WhatsApp só manda o histórico completo na primeira conexão, por isso toda mensagem recebida fica no banco até a virada do dia. Descarta mensagens sem link ou sem sinal de promoção.
2. **Extração** (`src/pipeline/regras.ts`, `extracao.ts`, `links.ts`): regras leem produto, preço, condição, link e loja; a IA só lê as mensagens fora do padrão. Os links são seguidos até a página final para achar a loja e o ID do produto. Cada título recebe uma palavra-chave do vocabulário.
3. **Deduplicação** (`src/pipeline/dedup.ts`, `imagens.ts`): na dúvida, não une (melhor uma duplicata que um produto escondido). Une quando a loja, o ID do produto e a palavra-chave são iguais. Sem ID num dos lados, une pelo título: mesma loja e palavra-chave, títulos parecidos, medidas compatíveis e preços até 25% distantes. Dois anúncios com IDs diferentes nunca se unem. No Mercado Livre, o ID vem do produto compartilhado na página do link de afiliado. Depois busca na página da loja a imagem das ofertas que ficaram sem.
4. **Categorização** (`src/categorias.ts`): a categoria é a da palavra-chave. Sem palavra-chave, a oferta fica em Sem categoria.
5. **Exibição** (`src/ofertas.ts`, `web/`): grava as ofertas e mostra a galeria, ordenada por palavra-chave, com busca por texto e por significado.

## Palavras-chave

Cada palavra-chave é um tipo de produto (ex.: `celular`), pertence a uma única categoria e tem variantes (`smartphone`, `iphone`, `galaxy`) e marcas (que só valem quando o título não cita nenhum tipo). Vale a variante citada no título; havendo mais de uma, a que ocupa mais palavras e, empatando, a primeira.

O vocabulário fica em `data/vocabulario.json` e é editado na aba **Palavras-chave**. Ao salvar, as ofertas de hoje são reclassificadas. O vocabulário inicial está em `src/vocabulario-padrao.ts`; apague `data/vocabulario.json` para voltar a ele.

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `PORTA` | 3000 | Porta HTTP |
| `FUSO` | America/Maceio | Fuso que define "hoje" |
| `PASTA_DADOS` | ./data | Banco, sessão do WhatsApp, imagens e vocabulário |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Endereço do Ollama |
| `LLM_MODELO` | qwen3:8b | Modelo da extração (plano B) |
| `EMBEDDING_MODELO` | bge-m3 | Modelo de embeddings (deduplicação e busca) |
| `LIMIAR_SIMILARIDADE` | 0.77 | Similaridade mínima de títulos para unir anúncios |
| `BUSCA_LIMIAR` | 0.52 | Similaridade mínima na busca por significado |

## Scripts

| Comando | Descrição |
|---|---|
| `npm start` | Compila a página e sobe o servidor |
| `npm run reprocessar` | Refaz a extração com as mensagens de hoje já guardadas, sem abrir o WhatsApp |
| `npm run palavras-chave` | Lista as ofertas sem categoria e quantas ofertas cada palavra-chave pegou |
| `npm run typecheck` | Verifica os tipos |

## API

| Rota | Descrição |
|---|---|
| `GET /api/status` | Etapa atual, progresso, previsão de término e conexão |
| `POST /api/extrair` | Inicia uma extração |
| `POST /api/conectar` · `/api/conectar/cancelar` · `/api/desconectar` | Conexão com o WhatsApp |
| `GET /api/qr` | QR code pendente |
| `GET /api/fontes` · `PUT /api/fontes` | Fontes encontradas e marcadas |
| `GET /api/ofertas?q=` | Ofertas por categoria |
| `GET /api/imagens/:id` | Imagem da oferta |
| `GET /api/vocabulario` · `PUT /api/vocabulario` | Palavras-chave; salvar valida e reclassifica |

## Estrutura

```
src/
  server.ts            rotas HTTP
  servico.ts           conexão e extração, etapa por etapa
  config.ts  db.ts  tempo.ts
  fontes.ts            fontes marcadas e encontradas
  categorias.ts        vocabulário e atribuição de palavra-chave
  vocabulario-padrao.ts
  ofertas.ts           listagem, busca e reclassificação
  whatsapp/            sessão, coleta, canais e mensagens
  pipeline/            filtro, regras, IA, links, imagens e deduplicação
  llm/ollama.ts
web/                   página (React + Bootstrap)
scripts/               reprocessar e palavras-chave
```
