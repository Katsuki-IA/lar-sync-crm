# Funil comercial e destino interno — candidato

Estado em 2026-10-26: implementação local na branch codex/commercial-settings. Não instalada no Multi-Katsuki, não publicada e nenhuma empresa ativada.

## Comportamento

- Configurações > Funil comercial: gestor da própria empresa e super admin podem criar, renomear, ordenar e desativar funis/etapas comerciais. Etapas de IA não são alteradas por essa API.
- Desativação preserva registros e histórico. Etapa em uso exige substituta ativa do mesmo funil; oportunidades e mapeamentos mudam atomicamente. A última etapa ativa não pode ser desativada isoladamente. Funil sem uso pode ser desativado junto com suas etapas; funis referenciados por oportunidades, filas ou destinos são bloqueados.
- Administração global > Envio ao CRM: super admin escolhe funil e etapa para seis situações. Não qualificado é a entrada padrão para situações sem mapeamento específico. Salvar desativado permite preparar as escolhas sem trocar o envio.
- Ativação é por empresa, apenas para destino Katsuki. O dispatcher autenticado chama a operação interna antes de buscar credenciais externas. Configuração ativa inválida gera erro, sem fallback externo.
- Oportunidades existentes no mesmo funil não são movidas nem reatribuídas. Criação idempotente por empresa/lead/funil, com evento de criação. Não importa o histórico do CRM anterior.
- Mantém agendamento, prazo e elegibilidade do envio existente. O worker reconhece a resposta HTTP de sucesso. Não altera n8n nem cria novos gatilhos de envio.
- Empresas com destino interno ativo deixam de criar oportunidades pelo intake automático da fila: o envio cria na etapa mapeada; a fila distribui a oportunidade conforme suas regras e horários. O funil escolhido na fila precisa corresponder ao destino desejado.
- Não grava um envio externo fictício nem muda a etapa IA para “Enviado ao CRM”. O resultado interno fica no evento da oportunidade e no job de envio. O fluxo existente de qualificação pode cancelar jobs de leads já exportados anteriormente; ativação não é uma migração desses leads.

## Instalação e validação antes da ativação

1. Comparar a versão remota de external-crms-dispatch com o arquivo local e preservar mudanças remotas. Este candidato adiciona somente o bloco RPC após a autenticação.
2. Ensaiar docs/commercial-settings-candidate.sql em homologação com esquema atualizado. Depende de distribution-v3-intake.sql e das funções de permissões/auditoria do HUB.
3. Aplicar a migração com todas as empresas desativadas, depois implantar o dispatcher e publicar o frontend via GitHub/Lovable, sem prompts de IA.
4. Conferir permissões reais de gestor/super admin e uma chamada de envio desativado. A instalação do SQL deve preceder o dispatcher: RPC ausente bloqueia o envio por segurança.
5. Revisar os mapeamentos de OY/Marvi com o usuário, incluindo qual funil cada fila atende, e ativar explicitamente uma empresa por vez. Validar com lead fictício e sem acionar avisos reais.
6. Para voltar ao envio externo, desativar a opção interna. Isso não apaga oportunidades criadas; verificar os jobs pendentes antes da troca.

## Validação local

- Suite completa: 229 testes passaram antes da inclusão dos três casos adicionais.
- Suite SQL final: 8 testes passaram, incluindo os três casos adicionais (criação/desativação de funil, fallback e intake suspenso).
- TypeScript sem erros; build de produção concluído com chave pública fictícia exclusivamente para validação. Não publicar esse build local.
- PGlite executa o SQL real sobre um esquema mínimo compatível; isso não substitui o ensaio da migração e dos gatilhos no ambiente remoto.
