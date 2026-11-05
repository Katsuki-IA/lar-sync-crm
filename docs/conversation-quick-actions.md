# Atalhos na conversa

Dois botões no cabeçalho da conversa permitem alterar o estágio da oportunidade no CRM comercial e abrir o editor de tarefa com o lead fixado. A mudança usa hub_move_opportunity autenticado e a versão atual da oportunidade, preservando controle de acesso e concorrência. Mais de uma oportunidade exige seleção explícita. Sem oportunidade, gestores e administradores podem abrir o formulário existente de criação, limitado ao lead atual. Não altera estágios IA. Tarefas preservam permissões, idempotência e validação de empresa existentes.

A janela é desmontada ao trocar lead/empresa. Dados são consultados apenas ao abrir e sempre limitados ao contexto atual. Falhas mantêm o formulário aberto e permitem repetir a consulta. Botões usam área de 44px e ficam em linha própria no celular.

Migration allow_admin_own_commercial_tasks permite somente ao próprio super_admin ativo atribuir a si uma tarefa. Não permite atribuição a administradores alheios. Casos anteriores de gestores/corretores permanecem iguais. SQL aplicado está em task-admin-self-assignment.sql.

Validação: TypeScript passou. Testes transacionais com rollback confirmaram tarefa da própria Ana e criação/movimentação da oportunidade sem persistir dados de teste. Playwright com dados simulados passou em 320px e 390px: janelas dentro da tela, lead fixado, responsável inicial e seleção de estágio comercial. As janelas usam o conjunto de estágios comerciais cadastrado na empresa; não cria um estágio Perdido automaticamente.
