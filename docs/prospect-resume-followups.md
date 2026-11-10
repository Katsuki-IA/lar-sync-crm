# Retomada manual de follow-ups

Disponível somente nas conversas das empresas Katsuki Prospecção 1 e 2. O botão separado abre uma janela com as etapas restantes e data/hora de Brasília. Confirmar libera o atendimento humano e agenda a cadência em uma transação autenticada. Devolver para IA isoladamente continua sem reativar follows.

O primeiro envio restante usa a data escolhida, ajustada para o próximo horário permitido. Etapas seguintes preservam pelo menos os intervalos da cadência original (21h entre 1/2, 27h entre 2/3; 48h entre 1/3 se 2 já enviado), com ajuste para dias úteis, 08:00–18:50. O worker existente continua responsável pelo envio e pela validação final. Uma resposta ou nova tomada humana cancela os pendentes. Não reenvia abertura/apresentação nem etapas aceitas pela Meta.

A API verifica usuário ativo, empresa, perfil e posse da conversa para corretores; revalida geração e dados sob trava. Gestores e administradores seguem os poderes da ação existente de liberar atendimento. Bloqueia opt-out, recusa classificada, revisão, envio incerto/em andamento, campanha pausada e falta de template. Requisições possuem UUID e replay idempotente. Registra atividade no lead; não altera oportunidade, estágio comercial ou dono comercial. Uma resposta posterior à retomada pode reabrir o aviso existente da Ana.

Tabela `private.kp_resume_requests`: RLS ativado, sem políticas, sem acesso direto de anon/authenticated por intenção. O registro só é acessado pela função privada que verifica a identidade autenticada; wrapper público SECURITY INVOKER. O aviso do advisor sobre ausência de políticas é esperado neste registro interno fechado.

Validação: 13 testes SQL reais com PGlite (sem transporte externo), TypeScript, build, janela real em Chromium com RPC simulado a 320/390px, data passada bloqueada e fuso independente do aparelho. Nenhuma mensagem foi enviada nem contato real reativado durante a implementação.
