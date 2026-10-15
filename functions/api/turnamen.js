/**
 * /api/turnamen?id=42  —  HASIL RESMI TOURNAMENT V (vpclubs11.com)
 * ─────────────────────────────────────────────────────────────
 * Mengambil hasil laga resmi dari API publik Tournament V untuk kompetisi di
 * data/kompetisi.json yang punya "tournamentV": <id>. Hanya laga klub peserta
 * (punya "clubId") yang diambil. Hasil disimpan 5 menit di cache Cloudflare —
 * tidak memakai KV sama sekali.
 *
 * Balasan: { waktu, laga: [ { id, ts, klub: [ {id, nama, gol}, {id, nama, gol} ] } ] }
 */
const API = 'https://api.proclubs.tournamentv.com/api/v1/public/tournaments';
const CACHE_DETIK = 300;
const BATAS_MS = 8000;
const MAKS_KLUB = 12;
const MAKS_HALAMAN = 5;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!/^\d{1,7}$/.test(id)) return balas(400, { galat: 'id turnamen tidak valid.' });

  const cache = caches.default;
  const kunci = new Request(`https://cache.jagal.internal/turnamen-v1/${id}`);
  const tersimpan = await cache.match(kunci);
  if (tersimpan) return tersimpan;

  // Hanya turnamen & klub yang terdaftar di data/kompetisi.json yang dilayani.
  let klub = [];
  try {
    const r = await env.ASSETS.fetch(new URL('/data/kompetisi.json', url));
    const j = await r.json();
    const k = (j.kompetisi || []).find(x => String(x.tournamentV || '') === id);
    if (!k) return balas(404, { galat: 'Turnamen ini tidak terdaftar di situs JAGAL.' });
    klub = [...new Set((k.peserta || []).map(p => String(p.clubId || '')).filter(c => /^\d{1,10}$/.test(c)))].slice(0, MAKS_KLUB);
  } catch (e) {
    return balas(500, { galat: 'Gagal membaca data kompetisi.' });
  }
  if (!klub.length) return balas(404, { galat: 'Peserta belum punya clubId.' });

  const semua = new Map();
  try {
    for (const c of klub) {
      for (let hal = 1; hal <= MAKS_HALAMAN; hal++) {
        const j = await ambil(`${API}/${id}/matches?club_id=${c}&per_page=50&page=${hal}`);
        for (const m of j.data || []) {
          const ts = Date.parse(m.matchTimestamp);
          if (!m.id || isNaN(ts) || !Array.isArray(m.clubs) || m.clubs.length !== 2) continue;
          semua.set(m.id, {
            id: m.id,
            ts,
            klub: m.clubs.map(x => ({ id: String(x.clubId), nama: String(x.clubName || '').slice(0, 60), gol: +x.goals || 0 })),
          });
        }
        if (!j.meta || hal >= (j.meta.last_page || 1)) break;
      }
    }
  } catch (e) {
    console.error('Tournament V gagal —', e.message);
    return balas(502, { galat: 'Data Tournament V tidak tersedia saat ini.' });
  }

  const res = balas(200, { waktu: Date.now(), laga: [...semua.values()].sort((a, b) => a.ts - b.ts) },
    { 'Cache-Control': `public, max-age=${CACHE_DETIK}` });
  waitUntil(cache.put(kunci, res.clone()));
  return res;
}

async function ambil(u) {
  const batal = new AbortController();
  const jam = setTimeout(() => batal.abort(), BATAS_MS);
  try {
    const r = await fetch(u, { signal: batal.signal, headers: { Accept: 'application/json', 'User-Agent': 'jagal.fun' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(jam);
  }
}

function balas(status, isi, header = {}) {
  return new Response(JSON.stringify(isi), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...header },
  });
}
