## Authorization boundaries
- Route IA-stage and tag-definition mutations through authenticated server functions that verify the existing database-derived current role before invoking user-scoped RPCs; lead-tag associations and commercial CRM operations stay separate to preserve normal lead workflows.

## Settings presentation
- Reuse config-presentation primitives and scoped config-page/config-form/config-dialog styles for company, module and secretary settings; keep visual consistency separate from permissions and data operations.