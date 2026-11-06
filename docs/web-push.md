# Notificações Web Push do Hub

Disponível por usuário/aparelho no sino: ativar, enviar teste e desativar. Android em navegador compatível; iPhone/iPad a partir de 16.4 precisam abrir o Hub adicionado à Tela de Início. Cada origem possui sua própria instalação e inscrição. Não há cache offline de páginas autenticadas.

Eventos: encaminhamentos Katsuki ao destinatário configurado; ofertas comerciais pendentes ao corretor destinatário em qualquer empresa; avisos administrativos conforme a visibilidade existente do sino. Não envia todo o histórico, nem notificações de todas as empresas a todos os usuários. Tarefas vencidas e mensagens comuns de conversas não são fontes de push nesta versão.

Servidor: Edge Function hub-web-push, autenticação de usuário validada com getUser; worker autenticado por chave própria. A função usa JWT gateway desligado porque valida o JWT do usuário ou a chave do worker no corpo, inclusive para chaves publicáveis modernas. RPC hub_push_service somente service_role; tabelas privadas com RLS sem acesso de clientes. Chaves VAPID inicializadas uma vez no primeiro opt-in, guardadas no servidor. Cron a cada minuto, até 30 envios por execução, 4 tentativas máximas, 404/410 desabilitam a inscrição. Endpoints de provedores permitidos explicitamente; redirects bloqueados.

Mensagem push não contém telefone nem conteúdo de conversa. O service worker valida usuário local e origem do destino. Ao sair pelo Hub, desativa/desinscreve o aparelho. Acesso aos dados segue RLS e login; links selecionam a empresa somente dentre as permitidas. Ofertas/respostas resolvidas ou acesso suspenso antes da próxima reserva deixam de ser elegíveis.

Validação: TypeScript/build; testes de endpoints e chaves; testes SQL com rollback (recipiente, broadcast, duplicidade, aparelho desativado, inscrição expirada, privilégios); criptografia/decriptografia Web Push e service worker em Chromium local com viewport móvel. Worker publicado respondeu HTTP 200. Entrega real Android/iPhone ainda requer o usuário autorizar no próprio aparelho e usar Enviar teste. Modo Foco, permissões e conectividade podem atrasar/silenciar a entrega.

Projeto correto de publicação do Hub: 49e843b7-5b71-4684-91bf-93d45886e53a. Banco: tswdxgefmhjvjwafaxjl.

Advisory de RLS sem policies nas três tabelas privadas é intencional: nenhum acesso de clientes, somente service_role com privilégios específicos. Não adicionar policy pública para remover esse aviso. Referência: https://supabase.com/docs/guides/database/postgres/row-level-security
