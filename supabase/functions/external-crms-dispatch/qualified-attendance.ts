// Only the authenticated queue worker may identify an automatic qualification job.
// A tag, qualified status, or browser-supplied toggle never grants continuation.
export function qualifiedDispatchJob(internal: boolean, body: {
  enforceQualificationRule?: boolean; enforceScheduledRule?: boolean; dispatchJobId?: string;
}): string | null {
  if (!internal || body.enforceQualificationRule !== true || body.enforceScheduledRule === true) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.dispatchJobId ?? "")) {
    throw new Error("Envio qualificado sem identificação válida da fila; nenhum CRM foi acionado.");
  }
  return body.dispatchJobId!;
}

export function reusableScheduledReceipt(internal: boolean, scheduled: boolean, provider: string,
  proof: { provider?: string; external_id?: string; external_confirmed?: boolean } | null): boolean {
  // CV and Loft retain their existing visit-update integrations.
  return internal && scheduled && !["cv_crm", "loft"].includes(provider)
    && proof?.provider === provider && proof.external_confirmed === true
    && Boolean(proof.external_id?.trim());
}
