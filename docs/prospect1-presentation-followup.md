# Follow-up após apresentação — Prospect 1

Aplicado em 06/11/2026 pela migração `prospect1_followups_after_presentation`.

Somente a empresa 35 aguarda uma nova resposta após a apresentação (etapa 4) antes do encaminhamento humano. O comprovante aceito da apresentação ativa a sequência existente de templates `followup_1`, `followup_2` e `followup_3`, em 2h, 23h e 50h. O worker mantém horário comercial, guarda de marketing, intervalo mínimo entre envios e revalidação de estado imediatamente antes do envio.

`kp_schedule_offer_followups` exige apresentação aceita na geração atual, ausência de resposta posterior, campanha habilitada e nenhum atendimento ou encaminhamento humano. Reativa apenas etapas canceladas que nunca foram reservadas ou enviadas. Etapas aceitas e resultados incertos não são repetidos. Uma nova resposta cancela a fila pelo mecanismo existente de geração. `kp_handoff_presented` exige uma geração posterior à apresentação na empresa 35. A empresa 36 conserva o comportamento anterior.

Para recuperar apresentações antigas, o primeiro prazo vencido começa na recuperação e os seguintes mantêm 21h e 48h de distância; o horário comercial ainda pode adiar o envio. Foram recolocados na fila os leads comerciais 13286, 13291 e 13320. Não foram reinseridos contatos em atendimento humano, que recusaram, ou que responderam após a apresentação.

Validação: 16 testes Postgres em PGlite; consulta da fila em produção confirmou três etapas pendentes por contato recuperado e execução da nova função negada a anon/authenticated. Nenhuma mudança de interface ou publicação Lovable é necessária.

Executar testes: `node --test docs/prospect1-followup-tests/followup.test.mjs`.
O arquivo `baseline.json` contém as funções anteriores usadas na montagem do banco isolado; não é um script de implantação.
