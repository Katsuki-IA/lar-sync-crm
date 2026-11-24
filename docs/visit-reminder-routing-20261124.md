# Visit reminder context and Andrade Ribeiro routing

The visit reminder was stored under the bare phone number, with no company or conversation identity. The service agent's scoped history excluded it. A short reply could consequently invoke broker handoff without seeing the reminder's question.

The shared reminder workflow now resolves the active appointment and its company/lead before sending, checks the destination, channel, date, time and name against that appointment, and records the accepted Meta message in both realtime context and the canonical conversation. Recording is idempotent per Meta message ID. An unsuccessful send is not recorded as an assistant message. No historical bulk import is performed.

For company 19 only, broker handoff reads the current CV record before changing local attendance, stage or distribution. A scheduled visit with an existing broker returns a preservation receipt instead of sending another distribution request. Missing/ambiguous CV data fails closed; a scheduled visit with no identifiable broker also cannot be redistributed automatically. Other companies and non-scheduled leads keep their existing path.

The receipt confirms an existing assignment, not a new handoff. The service agent checks this database receipt for the same execution, company, lead and inbound message, and responds deterministically that the visit and current broker remain in place. No existing lead is manually reassigned by this deployment.

Files: `mcp/visit-reminder-routing.mjs`, `mcp/visit-reminder-routing.test.mjs`, `mcp/publish-visit-reminder-routing.mjs`.

Validation: Node tests with real PostgreSQL semantics in PGlite cover tenant isolation, identity mismatch, replay, missing send acknowledgment, preservation without local lead mutation, and the protected live-workflow branch. Tests can load ignored workflow snapshots using `VISIT_FIX_FIXTURES`. Publication checks the original workflow version, saves a backup, preserves execution order and error handling, and reads back nodes/connections/active state.

Workflow IDs: reminder `Mv0eUkTI8WspBnOR`, broker `K6Ra0NieeLWEFi1w`, service `EYvXhZTBgM9qi2pp`. Apply in service/broker/reminder order. Rollback uses the corresponding ignored `before-publish` snapshots and requires checking for subsequent edits before restoring. No Lovable build or publication is involved in these n8n-only changes.
