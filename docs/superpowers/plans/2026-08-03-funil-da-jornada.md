# Funil da Jornada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os três relatórios removidos por um Funil da jornada que mede, para a empresa e período ativos, os leads recebidos, engajados com a IA, quentes, enviados ao CRM externo e com visita agendada.

**Architecture:** Manter a página de relatórios como ponto de orquestração das consultas ao Supabase e concentrar o cálculo dos cinco indicadores em uma função pura reutilizável. A função recebe os dados já carregados, deduplica por lead e torna as regras de negócio testáveis sem depender da interface.

**Tech Stack:** React, TanStack Router, TypeScript, Supabase, Vitest, Tailwind/shadcn existentes.

## Global Constraints

- O funil é de coorte: `crm_leads.created_at` dentro do período define os leads recebidos; os demais eventos podem ocorrer depois do fim do período.
- Todos os dados usam a empresa ativa. O filtro atual de agente continua a limitar somente a coorte de leads quando aplicável.
- Um lead é contado no máximo uma vez em cada linha. As etapas não são exclusivas e as porcentagens usam `Leads recebidos` como denominador.
- Engajamento exige pelo menos uma mensagem `human` na sessão normalizada do lead; uma mensagem inicial da IA não conta.
- O envio ao CRM externo reconhece o evento `external_crm_sent` e o texto legado já usado pela lista de leads.
- Visita agendada é um agendamento ativo (`deleted_at IS NULL`) ligado ao `lead_id` legado de `crm_leads`, não ao id interno do CRM.

---

### Task 1: Criar o cálculo puro e sua cobertura automatizada

**Files:**
- Create: `src/lib/journey-funnel.ts`
- Create: `src/lib/journey-funnel.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Adicionar o runner de testes.**

  Execute:

  ```powershell
  & 'C:\Program Files\nodejs\npm.cmd' install --save-dev vitest
  & 'C:\Program Files\nodejs\npm.cmd' pkg set scripts.test="vitest run"
  ```

- [ ] **Step 2: Escrever primeiro os testes do contrato de cálculo.**

  Cobrir em `journey-funnel.test.ts` uma coorte de quatro leads que prove:

  - somente mensagens `human` tornam um lead engajado;
  - mensagens `ai` isoladas não o tornam engajado;
  - números com DDI usam as variantes completa e dos últimos 11 dígitos para localizar a sessão;
  - `lead_quente`, evento de envio, descrição legada e agendamento ativo são contados corretamente;
  - eventos repetidos não duplicam um lead.

- [ ] **Step 3: Executar o teste e confirmar que falha antes da implementação.**

  Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- journey-funnel.test.ts`

  Expected: falha porque o módulo `journey-funnel` ainda não existe.

- [ ] **Step 4: Implementar `src/lib/journey-funnel.ts`.**

  Exportar:

  ```ts
  export function createJourneySessionIds(phone: string | null | undefined, empresaId: number): string[]
  export function calculateJourneyFunnel(input: JourneyFunnelInput): JourneyFunnelCounts
  ```

  A normalização deve remover caracteres não numéricos e devolver a sessão completa e, quando o número tiver mais de 11 dígitos, uma segunda variante com os últimos 11 dígitos, ambas concatenadas ao id da empresa. A função deve formar conjuntos de sessões humanas, leads enviados e ids legados agendados; em seguida, contar uma vez cada lead da coorte em cada métrica.

- [ ] **Step 5: Rodar os testes do helper.**

  Run: `& 'C:\Program Files\nodejs\npm.cmd' test -- journey-funnel.test.ts`

  Expected: todos os casos passam.

- [ ] **Step 6: Revisar a alteração antes do commit.**

  Run: `git diff --check`

  Expected: nenhuma saída.

- [ ] **Step 7: Criar um commit isolado da base de cálculo.**

  ```powershell
  git add package.json package-lock.json src/lib/journey-funnel.ts src/lib/journey-funnel.test.ts
  git commit -m "feat: adiciona calculo do funil da jornada"
  ```

### Task 2: Carregar os eventos e exibir o novo painel em Relatórios

**Files:**
- Modify: `src/routes/_authenticated/relatorios.tsx`

- [ ] **Step 1: Ler a implementação atual de `relatorios.tsx` e preservar o painel por empreendimento.**

  Identificar e manter as dependências que o painel `EmpreendimentoPanel` usa. Remover somente os três painéis solicitados: `FunnelPanel`, `ChannelPanel` e `ClosingTimePanel`, além de buscas e imports que ficarem sem uso.

- [ ] **Step 2: Carregar as fontes do funil depois de obter a coorte.**

  Para os leads já filtrados por empresa, período e agente:

  - gerar os ids de sessão com `createJourneySessionIds` e buscar `n8n_chat_conversas` em lotes por `numero`, selecionando `numero,type`;
  - buscar `crm_lead_activities` por `lead_id` do CRM, selecionando `lead_id,metadata,descricao`;
  - buscar `agendamento` pelo `id_empresa` ativo e pelos `lead_id` legados não nulos, filtrando `deleted_at IS NULL` e selecionando `id_lead`.

  Tratar arrays vazios sem enviar consultas `.in()` vazias ao Supabase. Preservar o tratamento de erro e estado de carregamento da página.

- [ ] **Step 3: Converter os resultados para o helper.**

  Chamar `calculateJourneyFunnel` com os campos mínimos da coorte e os dados de mensagens, atividades e agendamentos. Em `metadata`, extrair `event` somente quando for um objeto; manter a comparação de texto legado sem distinção entre maiúsculas/minúsculas.

- [ ] **Step 4: Criar `JourneyFunnelPanel` na própria página.**

  Exibir um card “Funil da jornada”, subtítulo “Consolidado do período” e as cinco linhas nesta ordem:

  1. Leads recebidos
  2. Engajaram com a IA
  3. Leads quentes
  4. Enviados ao corretor / CRM
  5. Visitas agendadas

  Cada linha mostra `quantidade · percentual` à direita e uma barra proporcional ao total recebido. Se não houver recebidos, mostrar `0 · 0,0%` sem divisão por zero. Usar as cores de destaque da referência: laranja para as três primeiras linhas e verde para envio e visita. Acrescentar um texto discreto explicando que os eventos posteriores são avaliados na coorte do período.

- [ ] **Step 5: Ajustar a grade de Relatórios.**

  Colocar o novo painel onde hoje ficam o funil de estágios e canais. Remover da renderização o funil de conversão entre estágios, o painel de canal e o tempo médio de fechamento; deixar o painel de empreendimentos visível no layout restante.

- [ ] **Step 6: Verificar o build de produção.**

  Run: `& 'C:\Program Files\nodejs\npm.cmd' run build`

  Expected: exit code 0. Avisos antigos não bloqueantes devem ser registrados, mas não alterados neste escopo.

- [ ] **Step 7: Revisar o diff e commitar a interface.**

  ```powershell
  git diff --check
  git add src/routes/_authenticated/relatorios.tsx
  git commit -m "feat: substitui relatorios pelo funil da jornada"
  ```

### Task 3: Verificação final e publicação

**Files:**
- Verify: `src/lib/journey-funnel.ts`
- Verify: `src/lib/journey-funnel.test.ts`
- Verify: `src/routes/_authenticated/relatorios.tsx`

- [ ] **Step 1: Rodar novamente os testes específicos e o build.**

  ```powershell
  & 'C:\Program Files\nodejs\npm.cmd' test -- journey-funnel.test.ts
  & 'C:\Program Files\nodejs\npm.cmd' run build
  ```

- [ ] **Step 2: Conferir que somente arquivos do sistema entram no envio.**

  Run: `git status --short`

  Expected: não adicionar `.codex/`, `mcp/`, `leads_teste_50.csv`, `.gitignore` ou `src/routeTree.gen.ts` se aparecerem como alterações locais não relacionadas.

- [ ] **Step 3: Publicar os commits na branch conectada ao Lovable.**

  Run: `git push origin main`

  Expected: os commits do funil ficam disponíveis em `Katsuki-IA/lar-sync-crm`, branch `main`.

## Plan Review

- [ ] O plano respeita a coorte definida pelo usuário e não mistura leads criados fora do período.
- [ ] O vínculo de visita usa o id legado correto e evita o falso relacionamento com `crm_leads.id`.
- [ ] O critério de engajamento exige mensagem humana, atendendo tanto entrada do cliente quanto resposta a uma abordagem inicial da IA.
- [ ] Os testes isolam a regra de negócio antes da interface e o build valida a integração TypeScript.
