type ReadEnv = (name: string) => string | undefined;

// Keep RD_CLIENT_* assigned to the original app while its connections exist.
// New-app credentials are staged separately; activation only affects new OAuth flows.
export function resolveRdAppCredentials(read: ReadEnv, clientId?: string | null) {
  const legacyId = read("RD_CLIENT_ID")?.trim() || "";
  const nextId = read("RD_MYHUB_CLIENT_ID")?.trim() || "";
  const selectedId = clientId === undefined
    ? (read("RD_MYHUB_ENABLED") === "true" ? nextId : legacyId)
    : (clientId || legacyId);
  const useNext = Boolean(nextId && nextId !== legacyId && selectedId === nextId);
  if (!selectedId || (!useNext && selectedId !== legacyId)) {
    throw new Error("Aplicativo RD não configurado para esta conexão");
  }
  const prefix = useNext ? "RD_MYHUB" : "RD";
  const clientSecret = read(`${prefix}_CLIENT_SECRET`) || "";
  if (!clientSecret) throw new Error(`${prefix}_CLIENT_SECRET não configurado`);
  const redirectUri = useNext
    ? read("RD_MYHUB_REDIRECT_URI")?.trim()
    : read("RD_REDIRECT_URI")?.trim();
  if (useNext && !redirectUri) throw new Error("RD_MYHUB_REDIRECT_URI não configurado");
  return { clientId: selectedId, clientSecret, redirectUri };
}
