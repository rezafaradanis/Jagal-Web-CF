/**
 * /api/arsip  —  SEMUA LAGA YANG PERNAH TERSIMPAN (arsip permanen di KV)
 * Balasan: { mulai, laga: [ ...match dalam bentuk ringkas seperti data EA ] }
 * Disimpan sebentar di cache Cloudflare supaya hemat kuota baca KV.
 */
import { KUNCI_ARSIP } from './_rekap.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const kunci = new Request('https://cache.jagal.internal/arsip-laga');
  const tersimpan = await cache.match(kunci);
  if (tersimpan) return tersimpan;
  const arsip = env.JAGAL_KV ? await env.JAGAL_KV.get(KUNCI_ARSIP, { type: 'json' }) : null;
  const isi = { mulai: arsip?.mulai || null, laga: Object.values(arsip?.laga || {}).sort((a, b) => b.timestamp - a.timestamp) };
  const res = new Response(JSON.stringify(isi), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' },
  });
  waitUntil(cache.put(kunci, res.clone()));
  return res;
}
