export async function fetchCtwaAd(adId: string, token: string, version: string, fetcher = fetch) {
  if (!/^\d+$/.test(adId)) throw new Error('ID de anúncio inválido');
  const url = new URL(`https://graph.facebook.com/${version}/${adId}`);
  url.searchParams.set('fields', 'id,name,account_id,adset{id,name},campaign{id,name}');
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  // Avoid logging Meta messages or URLs that could contain credentials.
  if (!response.ok || data.error) throw new Error(`Consulta Meta falhou (HTTP ${response.status}, código ${data.error?.code ?? 'indisponível'})`);
  if (data.id !== adId || !data.name || !data.adset?.name || !data.campaign?.name) {
    throw new Error('Meta não retornou anúncio, conjunto e campanha completos');
  }
  return {
    meta_ad_name: data.name, meta_adset_id: data.adset.id, meta_adset_name: data.adset.name,
    meta_campaign_id: data.campaign.id, meta_campaign_name: data.campaign.name,
    meta_account_id: data.account_id ?? null,
  };
}
