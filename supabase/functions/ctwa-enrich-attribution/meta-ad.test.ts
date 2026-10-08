import { describe, expect, it, vi } from 'vitest';
import { fetchCtwaAd } from './meta-ad';

describe('CTWA ad lookup', () => {
  it('requests all names using server authorization and checks the returned ID', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: '123', name: 'Anúncio', account_id: '456', adset: { id: '7', name: 'Conjunto' }, campaign: { id: '8', name: 'Campanha' } }));
    expect(await fetchCtwaAd('123', 'secret', 'v21.0', fetcher)).toMatchObject({ meta_ad_name: 'Anúncio', meta_campaign_name: 'Campanha', meta_adset_name: 'Conjunto' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url.toString()).not.toContain('secret');
    expect(options.headers.Authorization).toBe('Bearer secret');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('retries incomplete or mismatched results instead of marking them complete', async () => {
    for (const payload of [{ id: '123', name: 'Only ad' }, { id: '999', name: 'Wrong ad', adset: { name: 'A' }, campaign: { name: 'C' } }]) {
      await expect(fetchCtwaAd('123', 'secret', 'v21.0', vi.fn().mockResolvedValue(Response.json(payload)))).rejects.toThrow('completos');
    }
  });
  it('does not expose a token in Meta error messages', async () => {
    await expect(fetchCtwaAd('123', 'secret', 'v21.0', vi.fn().mockResolvedValue(Response.json({ error: { code: 190, message: 'secret' } }, { status: 400 })))).rejects.toThrow('HTTP 400, código 190');
  });
  it('rejects malformed IDs without calling Meta', async () => {
    const fetcher = vi.fn();
    await expect(fetchCtwaAd('../me', 'secret', 'v21.0', fetcher)).rejects.toThrow('inválido');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
