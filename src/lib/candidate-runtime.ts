// No environment reads at module load; Cloudflare binds values at request time.
export function candidateRuntimeReady(env:Record<string,string|undefined>,expectedUrl:string,expectedPublicKey:string) {
 return env.SUPABASE_URL?.trim().replace(/\/+$/,'')===expectedUrl
  && env.SUPABASE_PUBLISHABLE_KEY?.trim()===expectedPublicKey
  && Boolean((env.SUPABASE_SERVICE_ROLE_KEY||env.APP_SUPABASE_SERVICE_ROLE_KEY)?.trim());
}

