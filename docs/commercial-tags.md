# Tags comerciais e tags do sistema

Implementação de 27/10/2026. Banco aplicado e validado somente em homologação (`esdqsdwhhihxmubunwvb`), migração `commercial_tags_separate_from_ia`. Produção ainda não alterada.

## Comportamento

- Gestores cadastram nome, cor e uso opcional em Configurações > Tags. Podem editar e arquivar; arquivar preserva associações existentes.
- Corretores marcam ou desmarcam tags comerciais nas oportunidades às quais têm acesso. Não podem cadastrar definições.
- Tags comerciais são isoladas por empresa e não alteram as tags ou regras do atendimento IA.
- Tags do sistema aparecem somente para leitura. Removidas as ações manuais no lead, edição em lote e importação CSV. O banco revoga escrita de `authenticated` em `crm_lead_tags`, preservando as automações de `service_role`.
- Administração global de definições do sistema por superadministrador permanece separada.

## Banco e publicação

SQL: `docs/commercial-tags-candidate.sql`. Cria tabelas, RLS e RPCs com validação de empresa, papel, módulo e acesso à oportunidade. Atualizações de definições usam revisão otimista; associações usam bloqueio da oportunidade e validação atual de acesso.

Na publicação, aplicar primeiro o SQL ao projeto de produção e depois publicar o frontend. A compilação local de validação usou chave fictícia e não deve ser implantada.

## Validação

- 23 testes passaram: oito cenários SQL em PGlite e quinze testes de ações de leads.
- TypeScript, lint dos novos arquivos de implementação e build passaram.
- Ensaio autenticado no banco de homologação: gestor cria; corretor aplica e remove na própria oportunidade; cadastro pelo corretor e associação em oportunidade sem acesso são negados. Dados do ensaio revertidos por rollback.
- Conferência visual local com dados fictícios: cadastro de tag, seleção da cor e aplicação na oportunidade. Prévia reproduzível com `node node_modules/vite/bin/vite.js --config scripts/tags-preview.vite.ts`, em `/scripts/tags-preview.html`.
- Nenhum apontamento dos advisors de segurança de homologação citou as novas tabelas ou funções; há apontamentos preexistentes fora deste escopo.
