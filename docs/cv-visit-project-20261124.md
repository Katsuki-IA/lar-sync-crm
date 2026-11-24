# CV appointment project mapping

The scheduling workflow used `Empreendimentos[0].cv_id_empreendimento` when updating CV after booking or cancellation. The first company catalog entry is unrelated to the selected visit. In the David incident, the visit was Bliss Cuore (local 49 / CV 9), while the first entry was Harmony Gardens (local 62 / CV 10), adding an incorrect interest in CV.

Both expressions now resolve the exact `dados agenda.empreendimento_id` in the company catalog, validate a unique match and positive external mapping, and reject mismatched company IDs when present. Missing mappings stop the CRM request instead of falling back to a different project. Cancellation uses the stored appointment project already provided by `dados agenda`.

This changes the shared direct-CV appointment path only; routing, assignment, message text and other CRM providers are unchanged. No bulk historical repair is included.

Validation: Node tests cover reordered catalogs, cancellation, missing/duplicate mappings and cross-company matches. Replay of David's saved execution verifies both generated payloads use CV ID 9. Publish script checks workflow version before updating, saves a backup, preserves runtime/error settings and verifies the active version after publishing.
