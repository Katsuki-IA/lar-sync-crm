## Authorization boundaries
- Route IA-stage and tag-definition mutations through authenticated server functions that verify the existing database-derived current role before invoking user-scoped RPCs; lead-tag associations and commercial CRM operations stay separate to preserve normal lead workflows.

## Settings presentation
- Reuse config-presentation primitives and scoped config-page/config-form/config-dialog styles for company, module and secretary settings; keep visual consistency separate from permissions and data operations.
## Secretary text interpretation (phase 1)
- Free-text secretary messages are orchestrated by src/lib/secretary-engine.ts with injected deps; AI output is validated strictly in src/lib/secretary-interpreter.ts (enum listar/aceitar/recusar/desconhecido only), legacy ACEITAR/RECUSAR+code keeps precedence, and identity comes only from the server-validated channel/phone. OpenAI credentials/model stay server-only (src/lib/secretary-ai.server.ts); DB objects for this phase live in docs/secretary-ai-fase1-candidato.sql and are not applied yet.
