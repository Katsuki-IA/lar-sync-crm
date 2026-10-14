# Responsável do lead ao assumir uma conversa

Assumir uma conversa no HUB atualiza `crm_leads.crm_assigned_to` para o usuário que assumiu. Uma transferência autorizada atualiza o responsável para o novo atendente. Devolver para a IA mantém o último responsável pelo lead.

A atualização ocorre dentro da mesma transação da RPC de atendimento, após validar usuário, empresa e concorrência. Somente associações ao CRM Hub com empresa correspondente e vínculo direto compatível são atualizadas. IDs de CRMs externos não são tratados como IDs do Hub. O histórico registra a mudança de responsável sem duplicar eventos ao assumir novamente com o mesmo usuário.

O filtro, o detalhe e o Kanban consultam as opções autorizadas da empresa, incluindo usuários de outra empresa que já são responsáveis por seus leads. O endpoint público usa SECURITY INVOKER e encaminha a consulta para uma função privada com validação de autenticação e acesso à empresa. Retorna apenas ID e nome de usuários ativos.

Migrações `sync_conversation_lead_owner` e `protect_lead_assignee_options` aplicadas em Multi-Katsuki. Corrigidos 17 leads com atendimentos humanos atuais, únicos e compatíveis. Conferência posterior encontrou zero divergências. Não houve novos apontamentos no auditor de segurança.

Validação: TypeScript e build; testes transacionais com rollback para assunção, transferência, conflito, devolução, auditoria, superadmin, acesso entre empresas, anônimo, IDs externos e vínculo direto divergente. A consulta pública também foi testada com o papel authenticated. Teste da interface com dados fictícios em larguras de celular e desktop inclui a opção de filtro de um superadmin responsável.
