/**
 * /api/ea/*  —  JEMBATAN DATA EA (Cloudflare Pages Functions)
 * ─────────────────────────────────────────────────────────────
 * Situs memanggil /api/ea/members/stats?..., /api/ea/clubs/matches?..., dst.
 *
 * Urutan sumber data:
 *   1. Data kiriman laptop (disimpan di Cloudflare KV oleh /api/terima-data).
 *      Kalau umurnya < 30 menit, langsung dipakai.
 *   2. Kalau tidak ada / sudah lama: coba ambil langsung dari EA. Hasil sukses
 *      disimpan sebentar di Cache API Cloudflare (gratis, tidak memakai kuota KV).
 *   3. Kalau EA menolak: pakai data laptop terakhir berapa pun umurnya.
 *   4. Kalau semua gagal: balas 502, halaman memakai data cadangan bawaan.
 *
 * Setiap balasan sukses membawa header X-Data-Waktu (kapan data diambil dari EA),
 * dipakai label "Data EA · diperbarui ..." di situs.
 *
 * Binding yang dibutuhkan (Settings → Bindings di Cloudflare Pages):
 *   JAGAL_KV  → KV namespace
 */

const EA = 'https://proclubs.ea.com/api/fc';
const BATAS_MS = 8000;
const LAPTOP_SEGAR_MS = 30 * 60 * 1000;
const CACHE_EA_DETIK = 180;
const KUNCI_DATA_LAPTOP = 'data-laptop';
const CACHE_SIAP_DETIK = 60; // data laptop di-cache 60 detik → 1 baca KV per menit, bukan per pengunjung
const KLUB_ID = '438867';
const PLATFORM = 'common-gen5';
const NAMA_KLUB = 'JAGAL';
const TIPE_LAGA = ['leagueMatch', 'playoffMatch', 'friendlyMatch'];
// Jalur EA yang boleh, beserta parameter yang wajib cocok.
const JALUR_IZIN = {
  'members/stats': (q) => q.get('clubId') === KLUB_ID,
  'allTimeLeaderboard/search': (q) => (q.get('clubName') || '').toUpperCase() === NAMA_KLUB,
  'clubs/matches': (q) => q.get('clubIds') === KLUB_ID && TIPE_LAGA.includes(q.get('matchType'))
    && (!q.get('maxResultCount') || +q.get('maxResultCount') <= 50),
};

function cekIzin(jalur, q) {
  const cek = JALUR_IZIN[jalur];
  if (!cek) return 'Jalur EA ini tidak dilayani.';
  if (q.get('platform') !== PLATFORM) return 'Platform tidak dilayani.';
  const boleh = new Set(['platform', 'clubId', 'clubIds', 'clubName', 'matchType', 'maxResultCount', '_']);
  for (const k of q.keys()) if (!boleh.has(k)) return `Parameter "${k}" tidak dilayani.`;
  if (!cek(q)) return 'Hanya data klub JAGAL VFC yang dilayani.';
  return null;
}

export async function onRequestGet({ request, params, env, waitUntil }) {
  const masuk = new URL(request.url);
  const jalur = (Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')).replace(/^\/+/, '');
  if (!jalur) return balas(400, { galat: 'Jalur EA tidak disebutkan.' });

  // Hanya jalur & klub yang dipakai situs ini. Mencegah /api/ea dipakai orang lain
  // sebagai proxy EA gratis (yang menghabiskan kuota Cloudflare).
  const izin = cekIzin(jalur, masuk.searchParams);
  if (izin) return balas(403, { galat: izin });

  const kunci = buatKunciCache(jalur, masuk.search);

  // 0) Cache API: balasan siap pakai beberapa puluh detik terakhir (hemat baca KV).
  const cache = caches.default;
  const kunciSiap = new Request(`https://cache.jagal.internal/siap/${kunci}`);
  const siap = await cache.match(kunciSiap);
  if (siap) return siap;

  // 1) Data kiriman laptop
  let laptop = null;
  try {
    const semua = env.JAGAL_KV ? await env.JAGAL_KV.get(KUNCI_DATA_LAPTOP, { type: 'json' }) : null;
    const teks = semua?.entri?.[kunci];
    if (teks) laptop = { teks, waktu: semua.waktu };
  } catch (e) {
    console.error('Gagal baca KV —', e.message);
  }
  if (laptop && Date.now() - laptop.waktu < LAPTOP_SEGAR_MS) {
    const res = jsonDariTeks(laptop.teks, { 'X-Sumber-Cache': 'laptop', 'X-Data-Waktu': String(laptop.waktu),
      'Cache-Control': `public, max-age=${CACHE_SIAP_DETIK}` });
    waitUntil(cache.put(kunciSiap, res.clone()));
    return res;
  }

  // 2) Cache API (hasil ambil langsung dari EA beberapa menit terakhir)
  const kunciCache = new Request(`https://cache.jagal.internal/${kunci}`);
  const tersimpan = await cache.match(kunciCache);
  if (tersimpan) return tersimpan;

  // 3) Coba EA langsung
  let percobaan = null;
  try {
    const r = await ambil(`${EA}/${jalur}${masuk.search}`);
    const teks = await r.text();
    const awal = teks.trim().charAt(0);
    if (r.ok && (awal === '{' || awal === '[')) {
      const res = jsonDariTeks(teks, {
        'X-Sumber-Cache': 'ea',
        'X-Data-Waktu': String(Date.now()),
        'Cache-Control': `public, max-age=${CACHE_EA_DETIK}`,
      });
      waitUntil(cache.put(kunciCache, res.clone()));
      return res;
    }
    percobaan = { status: r.status, teks };
  } catch (e) {
    percobaan = { status: 0, teks: e.message };
  }

  // 4) Data laptop lama lebih baik daripada kosong
  if (laptop) {
    return jsonDariTeks(laptop.teks, { 'X-Sumber-Cache': 'laptop-lama', 'X-Data-Waktu': String(laptop.waktu) });
  }

  return balas(502, {
    galat: 'Data EA tidak tersedia saat ini.',
    status: percobaan?.status ?? null,
    kunciCache: kunci,
    catatan: (percobaan?.teks || '').includes('Access Denied')
      ? 'Ditolak Akamai (403) — jalankan skrip update di laptop supaya data terisi.'
      : String(percobaan?.teks || '').slice(0, 200),
  });
}

// HARUS sama persis dengan buatKunciCache di /api/terima-data.
function buatKunciCache(jalur, search) {
  const p = new URLSearchParams(search || '');
  p.delete('_');
  const pasangan = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}-${v}`);
  return `${jalur}__${pasangan.join('_')}`.replace(/[^A-Za-z0-9_.-]/g, '-');
}

async function ambil(url) {
  const batal = new AbortController();
  const jam = setTimeout(() => batal.abort(), BATAS_MS);
  try {
    return await fetch(url, {
      signal: batal.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://www.ea.com/',
        Origin: 'https://www.ea.com',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } finally {
    clearTimeout(jam);
  }
}

function jsonDariTeks(teks, header = {}) {
  return new Response(teks, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...header } });
}

function balas(status, isi) {
  return new Response(JSON.stringify(isi, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
