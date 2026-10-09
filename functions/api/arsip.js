/**
 * /api/arsip  —  ARSIP LAGA PERMANEN (dari KV)
 * ─────────────────────────────────────────────────────────────
 * GET /api/arsip          → versi RINGKAS semua laga (hemat data, dipakai halaman utama):
 *   { v:2, mulai, kolom:[...], laga:[ [matchId, timestamp, tipe, golKami, golLawan,
 *        namaLawan, crestLawan, dnf, [[nama,pos,arch,gol,assist,tembakan,passSukses,
 *        passCoba,tekel,tekelCoba,save,kebobolan,merah,rating×10,mom], ...]], ... ] }
 *   Hanya pemain JAGAL; pemain lawan & rincian save tidak ikut.
 * GET /api/arsip?id=XXX   → satu laga LENGKAP (dipakai saat laga lama diklik di situs).
 * Keduanya disimpan sebentar di cache Cloudflare supaya hemat kuota baca KV.
 */
import { KLUB_ID, bacaLagaArsip, cariArsip } from './_rekap.js';

const KOLOM_PEMAIN = ['nama', 'pos', 'arch', 'gol', 'assist', 'tembakan', 'passSukses', 'passCoba',
  'tekel', 'tekelCoba', 'save', 'kebobolan', 'merah', 'rating10', 'mom'];

export async function onRequestGet({ request, env, waitUntil }) {
  const id = new URL(request.url).searchParams.get('id');
  const cache = caches.default;
  const kunci = new Request(`https://cache.jagal.internal/arsip-v2/${id ? 'laga-' + encodeURIComponent(id) : 'ringkas'}`);
  const tersimpan = await cache.match(kunci);
  if (tersimpan) return tersimpan;

  if (!env.JAGAL_KV) return new Response(JSON.stringify({ galat: 'KV belum dipasang.' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  let isi, detik;
  if (id) {
    const mm = await cariArsip(env, id);
    if (!mm) return new Response(JSON.stringify({ galat: 'Laga tidak ada di arsip.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    isi = mm; detik = 3600; // detail laga lama tidak berubah
  } else {
    const { indeks, laga: semua } = await bacaLagaArsip(env);
    const laga = semua.sort((a, b) => b.timestamp - a.timestamp).map(ringkas).filter(Boolean);
    isi = { v: 2, mulai: indeks?.mulai || null, kolom: KOLOM_PEMAIN, laga };
    detik = 120;
  }
  const res = new Response(JSON.stringify(isi), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${detik}` },
  });
  waitUntil(cache.put(kunci, res.clone()));
  return res;
}

function ringkas(mm) {
  const kami = mm.clubs?.[KLUB_ID];
  const lawanId = Object.keys(mm.clubs || {}).find((k) => k !== KLUB_ID);
  const lawan = mm.clubs?.[lawanId];
  if (!kami || !lawan) return null;
  const n = (v) => +v || 0;
  const pemain = Object.values(mm.players?.[KLUB_ID] || {}).map((pl) => [
    pl.playername || 'Pemain', pl.pos || '', pl.archetypeid != null && pl.archetypeid !== '' ? n(pl.archetypeid) : null,
    n(pl.goals), n(pl.assists), n(pl.shots), n(pl.passesmade), n(pl.passattempts),
    n(pl.tacklesmade), n(pl.tackleattempts), n(pl.saves), n(pl.goalsconceded), n(pl.redcards),
    Math.round(n(pl.rating) * 10), String(pl.mom) === '1' ? 1 : 0,
  ]);
  return [String(mm.matchId), mm.timestamp, mm._tipe || '', n(kami.goals), n(lawan.goals),
    lawan.details?.name || 'Lawan', lawan.details?.customKit?.crestAssetId || '',
    kami.winnerByDnf === '1' || lawan.winnerByDnf === '1' ? 1 : 0, pemain];
}
