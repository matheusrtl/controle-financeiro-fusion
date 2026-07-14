## Objetivo
Reorganizar o Dashboard para dar largura total ao gráfico de Fluxo de Caixa, mover Alertas para baixo, e tornar as barras clicáveis para filtrar os gráficos de pizza pelo dia selecionado.

## Mudanças

### 1. Layout (uma coluna)
Arquivo: `src/routes/_authenticated/dashboard.tsx`
- Remover o grid 70/30 que envolve o `ComposedChart` e o painel de Alertas.
- Empilhar em coluna única (`space-y-6`), cada seção com `w-full`:
  1. Card do Fluxo de Caixa (100% largura, altura do gráfico mantida ou levemente aumentada).
  2. Card de Alertas (100% largura, layout interno reorganizado em grid responsivo `md:grid-cols-3` para aproveitar a largura extra: Vencidos / Hoje / Amanhã lado a lado).
- Manter responsividade (mobile = coluna única já natural).

### 2. Drill-down por dia
Arquivo: `src/routes/_authenticated/dashboard.tsx`
- Novo estado `selectedBucket: string | null` (chave do bucket clicado — dia/semana/mês conforme granularidade atual).
- Passar `onClick` no `<Bar>` do Recharts capturando `payload.bucket`; toggle se clicar de novo.
- Derivar `drillFilters` combinando os filtros globais existentes com `from`/`to` calculados a partir do bucket selecionado (dia = mesma data; mês = primeiro/último dia; semana/ano análogo).
- Passar `drillFilters` (em vez de `filters`) para todas as queries dos gráficos de pizza e do "Top fornecedores" (`getBreakdown` para centro_custo, conta, fornecedor). KPIs, gráfico principal, alertas e tabela continuam usando `filters` originais.

### 3. Destaque visual + banner
Arquivo: `src/routes/_authenticated/dashboard.tsx`
- No `<Bar>` usar `shape` customizado ou `fillOpacity` dinâmica: barras não selecionadas ganham `opacity: 0.3`; selecionada `opacity: 1` + `stroke` accent.
- Acima da grade de pizzas, quando `selectedBucket` estiver setado, exibir chip:
  `Filtro ativo: <label formatado>` + botão `✕ Limpar filtro` que zera `selectedBucket`.
- Cursor `pointer` nas barras.

### 4. Performance
- Estado 100% client-side; apenas as `useQuery` das pizzas recebem novo `queryKey` com o bucket, disparando refetch isolado. Gráfico principal e KPIs não re-renderizam com dados novos.

## Fora do escopo
- Nenhuma mudança em server functions, schema, importação ou lógica financeira.
- Sem alterações no menu, autenticação ou MCP.

## Critérios de aceitação
Todos os itens da seção 5 do pedido do usuário.
