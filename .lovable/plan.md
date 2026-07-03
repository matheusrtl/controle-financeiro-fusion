# Plano — Fusion Logística: Dashboard de Fluxo de Caixa

## Stack adaptada
- **Frontend/Backend**: TanStack Start (React + TS + Tailwind v4 + shadcn) — equivalente ao Next.js.
- **Banco/Auth/Storage**: Lovable Cloud (Postgres + Auth + Storage) — equivalente a NestJS+Prisma+Postgres+JWT.
- **Parser XLSX**: SheetJS (`xlsx`) rodando em server function.
- **Gráficos**: Recharts. **Tabela**: TanStack Table. **Formulários**: React Hook Form + Zod.

## Identidade visual
Paleta Fusion aplicada como tokens semânticos em `src/styles.css` (oklch): `--primary #1565C0`, `--primary-dark #0D47A1`, `--success #2E7D32`, `--danger #D32F2F`, `--warning #F9A825`, superfícies `#F5F7FA / #E4E7EB / #FFFFFF`. Cards arredondados, sombras suaves, tipografia Inter/Manrope, animações discretas (framer-motion).

Logo Fusion: crio SVG inline (dois losangos azuis entrelaçados, wordmark "FUSION / LOGÍSTICA").

## Autenticação
- Lovable Cloud Auth (email/senha).
- Seed via migration: usuário `admin@fusion.log.br` / senha `admin@fusion.log.br` + role `admin` (tabela `user_roles` + enum + `has_role` security-definer).
- Tela `/auth` fiel ao mockup: logo centralizada, card branco, campos "Login/Senha", botão azul "Entrar", rodapé "© 2026 Fusion Logística".
- Após login → `/dashboard`. Todas as rotas do app sob `_authenticated/`.
- Página `/usuarios` (só admin) para criar novas contas via server function com `supabaseAdmin`.

## Modelo de dados (migrations)
```
reports              -- metadados do upload
  id, filename, uploaded_at, uploaded_by, row_count,
  status ('active'|'archived'), period_start, period_end
transactions         -- linhas da planilha
  id, report_id (FK), documento, fornecedor, emissao, vencimento,
  pagamento, valor, multa, juros, desconto, valor_pago,
  valor_aberto, valor_total, centro_custo, obs_parcela,
  obs_lancamento, conta, status (derivado: pago/aberto/vencido)
user_roles           -- padrão Lovable (admin/user)
```
- Índices em `report_id`, `vencimento`, `fornecedor`, `centro_custo`, `conta`, `status`.
- RLS: authenticated pode SELECT; INSERT/DELETE só via server functions (admin).
- Constraint: apenas um `reports.status='active'` (unique parcial).

## Upload / Importação
- Rota `/upload` com dropzone. Envio para server function `importReport`:
  1. Valida extensão/tamanho (máx 20MB).
  2. Parseia com SheetJS, mapeia as 16 colunas exatas.
  3. Normaliza datas (dd/mm/aaaa) e valores BR (`1.234,56`).
  4. Deriva `status` por linha (pago/aberto/vencido).
  5. Numa transação: marca relatório ativo como `archived`, deleta suas transações, cria novo `reports` ativo, insere transações em lote (chunks de 1000).
- Progresso via streaming/polling. Toast "Relatório atualizado com sucesso" + `router.invalidate()`.

## Dashboard `/dashboard`
Layout (estilo THOR, moderno):

### Cabeçalho
Logo · nome empresa · período do relatório ativo · nome do arquivo · última atualização · botões (Novo Upload, Histórico, Usuários se admin, Logout).

### Linha 1 — Cards KPI
Receber (verde) | Pagar (vermelho) | Saldo Projetado (azul) | Em Aberto | Pago | Vencidos (qtd+valor). Cada card de Receber/Pagar mostra: Hoje, Amanhã, 7d, 30d, Total.

### Linha 2 — Gráfico principal + Painel de Alertas
- **Gráfico combinado** (Recharts ComposedChart): barras verdes (Receber) + vermelhas (Pagar) + linha azul (saldo acumulado). Toggle Dia/Semana/Mês/Ano. Tooltip com Receber/Pagar/Saldo/Diferença/Qtd títulos.
- **Painel lateral de alertas**: vencidos, vencem hoje, vencem amanhã, top 10 maiores a pagar, top 10 maiores a receber, dias em atraso.

### Linha 3 — Grid de gráficos secundários
Fluxo diário (linha) · Fluxo semanal · Fluxo mensal · Pizza por Centro de Custo · Pizza por Conta · Top 10 Fornecedores (barras horizontais) · Receber x Pagar (comparativo) · Heatmap Calendário Financeiro.

### Linha 4 — Tabela
TanStack Table com todas as colunas especificadas, pesquisa global, filtros por coluna, ordenação, paginação server-side, seleção. Botões Exportar Excel (SheetJS) e Exportar PDF (jsPDF + autotable). Clique na linha abre modal com todos os detalhes.

### Filtros globais (topo da tela)
Período, Fornecedor, Centro de Custo, Conta, Status, Documento, faixa de Valor. Aplicam a todos os gráficos e à tabela (via URL search params + server functions).

## Server functions (backend)
Todas com `requireSupabaseAuth`, cálculos no servidor:
- `importReport({file})`
- `getActiveReport()` — metadados
- `getKpis(filters)` — todos os cards
- `getCashflowSeries({granularity, filters})` — gráfico principal
- `getAlerts()` — painel lateral
- `getBreakdown({dimension, filters})` — pizzas / top fornecedores
- `getHeatmap(filters)`
- `listTransactions({filters, page, sort})`
- `exportTransactions({format, filters})`
- `listReports()` — histórico
- `createUser({email, password})` — só admin

Cache com TanStack Query (`ensureQueryData` + `useSuspenseQuery`).

## Páginas
- `/auth` — login
- `/dashboard` — principal
- `/upload` — nova importação
- `/historico` — lista de relatórios (metadados)
- `/usuarios` — gestão de contas (admin)

## Performance
- Todos os agregados calculados via SQL (GROUP BY por dia/semana/mês/dimensão).
- Índices adequados; paginação server-side na tabela.
- Suporta 100k+ registros sem carregar tudo no cliente.

## Ordem de execução
1. Enable Lovable Cloud + configurar auth (email/senha).
2. Migrations: enum roles, `user_roles`, `has_role`, `reports`, `transactions`, índices, RLS, seed do admin.
3. Design system (tokens Fusion) + tela `/auth`.
4. Layout autenticado + header + rota `/dashboard` placeholder.
5. Upload + parser + persistência.
6. Server functions de agregação.
7. KPIs, gráfico principal, alertas.
8. Gráficos secundários + heatmap.
9. Tabela + filtros + modal + exportações.
10. Histórico + gestão de usuários.
11. Responsividade + polish + validação end-to-end com a planilha real.

## Aguardando
Antes de iniciar a implementação vou aguardar você anexar **a planilha Excel real** para eu confirmar o mapeamento exato de colunas, formatos de data e valores antes de codar o parser.
