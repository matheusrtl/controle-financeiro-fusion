## Diagnóstico

Rodei os checks e o que está acontecendo hoje:

1. **Menu superior já existe** no `AppShell` (Dashboard / Upload / Histórico / Usuários / Sair), mas os itens **Upload** e **Usuários** só aparecem para admin. Isso está correto — o problema é que a conta que você está usando (`matheusjustino@fusion.log.br`) **não tem role admin** no banco. Só `admin@fusion.log.br` tem.
2. **Bloqueio de upload**: a mensagem "somente administradores podem importar" vem do servidor. Quem não é admin não consegue mesmo — inclusive `matheusjustino`. Precisamos (a) dar acesso admin também ao `matheusjustino` (ou deixar isso claro), e (b) fazer a página `/upload` mostrar um bloqueio visual amigável antes de tentar enviar, em vez de deixar o usuário selecionar arquivo e receber erro.
3. **Planilha `base_pagamentos.xlsx`** conferida: os 16 cabeçalhos batem **exatamente** com o que o parser já espera (Documento, Fornecedor - Nome, Emissão, Vencimento, Pagamento, Valor, Multa, Juros, Desconto, Valor Pago, Valor em Aberto, Valor Total do Título, Centro de Custo, Observação da Parcela, Observação do Lançamento, Conta). O parser vai ler sem ajuste de mapeamento.
4. **Falta CSV** no dropzone (você pediu `.xlsx`, `.xls`, `.csv`) e falta validação de colunas obrigatórias antes de importar.
5. **Deduplicação**: hoje cada upload arquiva o relatório anterior e insere tudo de novo — não gera duplicata "real", mas dentro do mesmo arquivo linhas idênticas entram duas vezes. Vou deduplicar pela combinação `Documento + Fornecedor + Vencimento + Valor` dentro do lote.

## O que vou implementar

### 1. Permissões
- Promover `matheusjustino@fusion.log.br` a admin (insert em `user_roles`) para você conseguir usar a conta que já está logada.
- Manter `admin@fusion.log.br` também como admin.
- Nenhuma mudança em RLS/policies — quem não é admin continua bloqueado no server.

### 2. Menu superior (sem redesenho)
- Manter o `AppShell` atual (já é fixo no topo, com logo, relatório ativo e navegação).
- Ajuste pequeno: itens `Upload` e `Usuários` aparecem em estado desabilitado com tooltip "Somente administradores" para não-admins, em vez de sumirem — assim fica claro que existem.

### 3. Tela `/upload`
- Aceitar também `.csv` no dropzone (`text/csv`) além de `.xlsx` e `.xls`.
- Gate visual: se `isCurrentUserAdmin` retornar `false`, mostrar card "Acesso restrito – somente administradores" com botão "Voltar ao dashboard", sem dropzone.
- Skeleton enquanto a role carrega (evita flash).
- Após parse: validar cabeçalhos obrigatórios (`Documento`, `Fornecedor - Nome`, `Vencimento`, `Valor`); se faltar, mostrar toast com a lista exata de colunas ausentes e não enviar.
- Toast de sucesso com contagem de linhas + período detectado.

### 4. Server fn `importReport`
- Aceitar payload `base64` para `.xlsx/.xls` (já faz) e `csvText` para `.csv` (novo caminho — usa `XLSX.read(csv, { type: "string" })`).
- Validar presença dos cabeçalhos obrigatórios; se faltar, `throw` com mensagem clara.
- Deduplicar linhas do mesmo lote por `Documento|Fornecedor|Vencimento|Valor`.
- Continuar arquivando o relatório ativo antes de inserir o novo (comportamento atual está correto para "substituir base").

### 5. Nada de mudança em dashboard, histórico, gráficos, layout ou temas.

## Detalhes técnicos

**Arquivos alterados:**
- `src/components/AppShell.tsx` — mostrar itens admin desabilitados com tooltip quando não-admin.
- `src/routes/_authenticated/upload.tsx` — gate visual admin, aceitar CSV, validar colunas no cliente antes de mandar, mensagens.
- `src/lib/reports.functions.ts` — novo input `{ filename, base64?, csvText? }`, validação de colunas obrigatórias, dedupe por chave composta, mensagens de erro melhores.
- Migration (data-only via `supabase--insert`): promover `matheusjustino@fusion.log.br` a admin.

**Fora de escopo:** redesign, novos gráficos, mudanças em RLS/schema, novas rotas.

## Testes que farei ao final
- Login com `matheusjustino@fusion.log.br` → menu superior com todos os itens ativos → abrir Upload → arrastar `base_pagamentos.xlsx` → ver toast de sucesso com contagem → Dashboard/Histórico refletindo o novo relatório.
- Login com um usuário não-admin (criado via tela Usuários) → itens Upload/Usuários desabilitados → tentativa direta em `/upload` mostra card "Acesso restrito".
