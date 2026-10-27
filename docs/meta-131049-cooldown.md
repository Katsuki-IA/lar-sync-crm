# Pausa de marketing após Meta 131049

O erro 131049 registra uma pausa de 24 horas por empresa e contato, contada do evento original. Callbacks duplicados não prolongam o prazo; uma nova recusa, de outra mensagem, inicia outra pausa. Telefones brasileiros com/sem nono dígito e aliases de identidade compartilham a pausa.

Migração de produção: `20261027141713_meta_131049_marketing_cooldown_24h`. Tabela com RLS e sem acesso de navegadores; RPCs somente para serviço. Triggers capturam callbacks e atualizações de mensagens, inclusive quando o webhook chega antes do registro da mensagem. Recuperados somente erros das últimas 24 horas pelo horário original, sem reenvio.

O envio manual consulta a categoria real da Meta e verifica a pausa antes de reservar/enviar marketing. Templates de utilidade e respostas livres dentro da janela de atendimento mantêm as regras anteriores. A versão 32 de `whatsapp-conversation-send` foi construída sobre a versão 31 em produção, preservando autenticação, empresa, atendente e idempotência de envio que ainda não estavam refletidas no arquivo Git.

Todas as empresas com follow-ups ativos usam v2. `prepare_followup_attempt_v2` adia a tentativa antes de criá-la; a verificação final no worker `zN7vnZZaFRWpTBIk` também impede envio caso um bloqueio apareça durante a preparação. Tentativas impedidas localmente não são registradas como nova recusa 131049 e não consomem o limite de tentativas. Quando voltam à fila, passam novamente pelas validações existentes (resposta do cliente, contexto, cadência e horário). Não há reenvio automático de mensagens já rejeitadas nem liberação de lote acumulado.

O HUB explica a restrição da Meta na mensagem e exibe a data/hora da pausa na seleção de templates, com o envio de marketing desabilitado. O fim da pausa local não garante entrega pela Meta.

Validação: testes isolados com PostgreSQL/PGlite e o handler Edge real com transportes simulados cobrem prazo, duplicação, aliases, isolamento de empresa, permissões, captura síncrona/assíncrona, adiamento, categorias e preservação da janela. Nenhuma mensagem real foi enviada como teste. Advisory de ausência de policies é intencional nesta tabela de serviço (deny-by-default).
