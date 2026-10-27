/**
 * /api/turnamen?id=42  —  HASIL RESMI TOURNAMENT V (vpclubs11.com)
 * ─────────────────────────────────────────────────────────────
 * Mengambil hasil laga resmi dari API publik Tournament V untuk kompetisi di
 * data/kompetisi.json yang punya "tournamentV": <id>. Hanya laga klub peserta
 * (punya "clubId") yang diambil. Hasil disimpan 5 menit di cache Cloudflare —
 * tidak memakai KV sama sekali.
 *
 * Balasan: { waktu, laga: [ { id, ts, klub: [ {id, nama, gol}, {id, nama, gol} ], pemain?: [...] } ] }
 * 'pemain' = statistik pemain JAGAL di laga itu (hanya laga JAGAL).
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
  let klub = [], klubJagal = null;
  try {
    const r = await env.ASSETS.fetch(new URL('/data/kompetisi.json', url));
    const j = await r.json();
    const k = (j.kompetisi || []).find(x => String(x.tournamentV || '') === id);
    if (!k) return balas(404, { galat: 'Turnamen ini tidak terdaftar di situs JAGAL.' });
    klubJagal = String((k.peserta || []).find(p => p.jagal)?.clubId || '') || null;
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

  // Statistik pemain JAGAL per laga (rincian laga; disimpan 1 jam per laga).
  if (klubJagal) {
    const lagaKami = [...semua.values()].filter(m => m.klub.some(x => x.id === klubJagal));
    await Promise.all(lagaKami.map(async m => {
      try { m.pemain = await rincianPemain(cache, waitUntil, id, m.id, klubJagal); } catch (e) { console.error('Rincian laga', m.id, e.message); }
    }));
  }

  const res = balas(200, { waktu: Date.now(), laga: [...semua.values()].sort((a, b) => a.ts - b.ts) },
    { 'Cache-Control': `public, max-age=${CACHE_DETIK}` });
  waitUntil(cache.put(kunci, res.clone()));
  return res;
}

async function rincianPemain(cache, waitUntil, idTurnamen, idLaga, klubJagal) {
  const kunci = new Request(`https://cache.jagal.internal/turnamen-v1/${idTurnamen}/laga/${idLaga}`);
  const ada = await cache.match(kunci);
  if (ada) return ada.json();
  const j = await ambil(`${API}/${idTurnamen}/matches/${idLaga}`);
  const angka = v => +v || 0;
  const pemain = (j.data?.players || []).filter(p => String(p.clubId) === klubJagal).map(p => ({
    nama: String(p.playerName || '').slice(0, 40),
    pos: String(p.position || ''),
    rating: angka(p.rating), gol: angka(p.goals), assist: angka(p.assists), tembakan: angka(p.shots),
    pass: angka(p.passesMade), passCoba: angka(p.passAttempts), tekel: angka(p.tacklesMade), tekelCoba: angka(p.tackleAttempts),
    save: angka(p.saves), merah: angka(p.redCards), mom: !!p.mom, detik: angka(p.secondsPlayed),
  }));
  waitUntil(cache.put(kunci, new Response(JSON.stringify(pemain), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } })));
  return pemain;
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
