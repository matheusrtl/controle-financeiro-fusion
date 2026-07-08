# Plano

Três mudanças que se conectam: o dashboard vira 100% "contas a pagar", os filtros de período viram globais, e cada lançamento ganha uma "Sugestão de Vencimento" editável que passa a governar toda a lógica financeira.

## 1. Remover completamente a lógica de "Recebido"

**Backend (`src/lib/dashboard.functions.ts`)**
- Em `getKpis`: remover o bloco `receber` do retorno. Substituir por um novo campo `pago` calculado com base no filtro de período ativo (o mesmo intervalo `from`/`to` usado na query). Ele mostrará a soma de `valor_pago` das transações cuja `pagamento` cai dentro do período. Remover blocos `hoje/amanha/d7/d30` do receber; para o card "Pago" a exibição usará o total do período filtrado.
- Em `getCashflowSeries`: remover `receber` dos buckets. Retornar só `pagar` (barras) e `saldo`. Regra de saldo: começa em `openingBalance` na `openingDate` e **apenas decresce** — `saldo = saldo - pagar` a cada bucket. Nunca soma entradas.
- Em `getAlerts` e `getBreakdown`: remover qualquer agregação que use `valor_pago` como "entrada" — Breakdown passa a somar apenas `valor_aberto` (despesa restante) + despesas pagas (saída de caixa histórica), sem tratá-las como receita.

**Frontend (`src/routes/_authenticated/dashboard.tsx`)**
- Remover o card "Recebido / Pago" e substituir pelo card **"Pago no período"**: um único valor = soma dos `valor_pago` cujo `pagamento` está dentro do filtro global (dia/semana/mês/ano/intervalo). Sem subdivisões hoje/amanhã/7d/30d.
- No gráfico principal: remover a barra verde "Receber". Ficam só a barra "Pagar" (esquerda) e a linha "Saldo" (direita, monotonicamente decrescente).
- Remover a seção "Top 10 a receber" dos alertas (se houver referência).
- Legenda/subtítulo do gráfico: "Despesas (barras) e Saldo projetado (linha)".

## 2. Filtro de período global e sincronizado

- Elevar `granularity` + intervalo `from`/`to` ao nível de filtro global. Um único seletor de período (Dia/Semana/Mês/Ano/Personalizado) no topo, ao lado dos filtros existentes, calcula automaticamente `from` e `to`:
  - Dia = hoje; Semana = semana corrente; Mês = mês corrente; Ano = ano corrente; Personalizado = mantém os inputs de data.
- Remover o `Tabs` de granularidade do header do gráfico; ele passa a refletir o período global.
- Todas as `useQuery` (kpis, series, alerts, breakdown-cc, breakdown-conta, top-fornec, list) já recebem `filters` — garantir que `granularity` também entre no `filters` (ou num objeto `period`) e que **todas** as chaves incluam o mesmo objeto, para que uma troca de período invalide e recarregue tudo simultaneamente.
- Nenhum componente pode manter estado próprio de data/granularidade.

## 3. Coluna "Sugestão Vencimento" editável e usada em toda a lógica

**Banco (migration)**
- Adicionar coluna `sugestao_vencimento DATE NULL` em `public.transactions`.
- Ajustar policies existentes para permitir `UPDATE` apenas dessa coluna (nova policy `UPDATE ... USING (true) WITH CHECK (true)` restrita a authenticated; opcionalmente via `GRANT UPDATE (sugestao_vencimento)` em vez de update total, para blindar as outras colunas).
- Não backfill: `sugestao_vencimento` fica `NULL` até o usuário editar; o código usa `COALESCE(sugestao_vencimento, vencimento)`.

**Backend**
- Novo server function `updateSugestaoVencimento({ id, date | null })` que faz o update pontual.
- Em **toda** a lógica de dashboard (`getKpis`, `getCashflowSeries`, `getAlerts`, `getBreakdown`, filtros `from/to` que hoje batem em `vencimento`): substituir referências a `r.vencimento` por `effectiveVencimento = r.sugestao_vencimento ?? r.vencimento`. O cálculo de status "vencido" também passa a usar esse valor efetivo.
- `listTransactions` retorna o novo campo. Filtro por data `from/to` passa a filtrar pelo vencimento efetivo (via `.or()` no PostgREST cobrindo `sugestao_vencimento` quando presente e `vencimento` quando null).

**Frontend (tabela de Lançamentos)**
- Nova coluna **"Sugestão Vencimento"** ao lado de "Vencimento". Mostra `sugestao_vencimento ?? vencimento`.
- Célula editável: clique abre um `Popover` com o Shadcn Datepicker (com `pointer-events-auto`). Ao salvar, chama `updateSugestaoVencimento` via `useMutation` e invalida `["kpis"], ["series"], ["alerts"], ["breakdown-*"], ["top-fornec"], ["tx"]`.
- Botão "Restaurar" no popover: envia `date: null` para voltar a usar a data original.
- "Vencimento" original permanece visível como referência histórica (não editável).

## Detalhes técnicos

**Ordem de execução**
1. Migration (adiciona coluna + policy/GRANT). Aguardar aprovação do usuário e regeneração dos types antes de tocar no código que lê `sugestao_vencimento`.
2. Editar `dashboard.functions.ts` (remover receber, aplicar vencimento efetivo, novo `updateSugestaoVencimento`).
3. Editar `dashboard.tsx` (novo card "Pago no período", remoção da barra Receber, filtro de período global, coluna editável).

**Impactos fora do dashboard**
- MCP tools em `src/lib/mcp/tools/*` que retornam KPIs precisam do mesmo tratamento (usar vencimento efetivo, remover conceito de receber). Ajustar `get-kpis.ts`, `get-overdue.ts`, `list-transactions.ts`.
- `reports.functions.ts` continua importando `valor_pago` da planilha (é saída de caixa histórica), só muda a semântica na UI/agregações.

**Saldo previsto (regra reforçada)**
- `saldo(t) = openingBalance − Σ pagar(t' ≤ t)` para buckets ≥ `openingDate`.
- O card "Saldo Previsto" atual deixa de somar `pago` como entrada; passa a mostrar `openingBalance − (vencidos + a vencer)` conforme o escopo escolhido.

## Fora de escopo
- Não altero identidade visual, tipografia, cores nem layout geral — apenas remoções/adições pontuais nos cards e coluna nova na tabela.
- Não mexo em Upload, Histórico, Usuários ou Auth.