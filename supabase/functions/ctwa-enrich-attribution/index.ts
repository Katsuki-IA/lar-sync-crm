import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { fetchCtwaAd } from './meta-ad.ts';

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('META_HEALTH_CRON_SECRET');
  if (!secret || req.headers.get('x-meta-health-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: jobs, error } = await admin.rpc('ctwa_claim_enrichment');
    if (error) throw error;
    let enriched = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      try {
        const { data: connection, error: connectionError } = await admin.from('crm_meta_connections')
          .select('user_access_token').eq('id_empresa', job.id_empresa).eq('active', true).maybeSingle();
        if (connectionError || !connection?.user_access_token) throw new Error('Integração Meta indisponível');
        const { data: cached, error: cacheError } = await admin.from('crm_lead_attribution')
          .select('meta_ad_name,meta_adset_id,meta_adset_name,meta_campaign_id,meta_campaign_name,meta_account_id')
          .eq('id_empresa', job.id_empresa).eq('meta_ad_id', job.ad_id).is('meta_enrichment_error', null)
          .gt('meta_enriched_at', new Date(Date.now() - 86400000).toISOString())
          .not('meta_ad_name', 'is', null).not('meta_adset_name', 'is', null).not('meta_campaign_name', 'is', null)
          .order('meta_enriched_at', { ascending: false }).limit(1).maybeSingle();
        if (cacheError) throw new Error('Falha ao consultar cache do anúncio');
        const details = cached?.meta_ad_name && cached?.meta_adset_name && cached?.meta_campaign_name
          ? cached : await fetchCtwaAd(job.ad_id, connection.user_access_token, Deno.env.get('META_GRAPH_VERSION') ?? 'v21.0');
        const finished = await admin.rpc('ctwa_finish_enrichment', {
          p_company: job.id_empresa, p_ad: job.ad_id, p_lease: job.lease, p_details: details,
        });
        if (finished.error || finished.data !== true) throw new Error('Falha ao concluir enriquecimento');
        enriched++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : 'Falha ao enriquecer anúncio';
        const retry = await admin.rpc('ctwa_finish_enrichment', {
          p_company: job.id_empresa, p_ad: job.ad_id, p_lease: job.lease, p_error: message,
        });
        if (retry.error) console.error('Falha ao reagendar enriquecimento CTWA');
      }
    }
    return Response.json({ checked: jobs?.length ?? 0, enriched, failed });
  } catch {
    return Response.json({ error: 'Falha no processamento CTWA' }, { status: 500 });
  }
});
