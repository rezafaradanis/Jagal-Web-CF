/**
 * /api/terima-data  —  PENERIMA DATA EA DARI LAPTOP (Cloudflare Pages Functions)
 * ─────────────────────────────────────────────────────────────
 * Skrip update-ea.mjs di laptop mengambil data dari EA (internet rumah tidak
 * diblokir EA) lalu mengirimkannya ke sini. Fungsi ini:
 *   1. Mengecek kunci rahasia (header x-kunci-update = env KUNCI_UPDATE).
 *   2. Menyimpan SEMUA data kiriman dalam SATU kunci KV ('data-laptop'),
 *      supaya hemat kuota tulis KV gratis (1.000/hari; laptop mengirim tiap
 *      10 menit = 144 tulis/hari).
 *   3. Mengirim rekap laga baru ke Discord (env DISCORD_WEBHOOK_REKAP).
 *      Laga yang sudah dikirim dicatat di kunci KV 'rekap-terkirim'.
 *
 * Binding & variabel (Cloudflare Pages → Settings):
 *   JAGAL_KV               KV namespace
 *   KUNCI_UPDATE           kunci rahasia, sama dengan di update-ea.mjs
 *   DISCORD_WEBHOOK_REKAP  URL webhook channel rekap
 */

import { KUNCI_DATA_LAPTOP, kirimKeDiscord, bacaCatatan, simpanCatatan, tinggiKartu } from './_rekap.js';
// Saat pertama kali jalan, laga yang lebih lama dari ini tidak dikirim (supaya tidak membanjiri Discord).
const BATAS_LAGA_AWAL_MS = 3 * 60 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.KUNCI_UPDATE) return balas(500, { galat: 'KUNCI_UPDATE belum diatur di Cloudflare.' });
  if (request.headers.get('x-kunci-update') !== env.KUNCI_UPDATE) return balas(401, { galat: 'Kunci tidak valid.' });
  if (!env.JAGAL_KV) return balas(500, { galat: 'Binding KV JAGAL_KV belum dipasang di Cloudflare.' });

  let payload;
  try { payload = await request.json(); } catch { return balas(400, { galat: 'Body bukan JSON yang valid.' }); }
  const entri = Array.isArray(payload?.entri) ? payload.entri : null;
  if (!entri || !entri.length) return balas(400, { galat: 'Field "entri" kosong.' });

  const data = {};
  for (const item of entri) {
    const jalur = String(item?.jalur || '').replace(/^\/+/, '');
    if (!jalur || item?.data === undefined) continue;
    const kunci = buatKunciCache(jalur, String(item.pencarian || '').replace(/^\?/, ''));
    data[kunci] = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
  }
  const waktu = Date.now();
  await env.JAGAL_KV.put(KUNCI_DATA_LAPTOP, JSON.stringify({ waktu, entri: data }));

  let rekap;
  try {
    // Skrip laptop versi baru (header x-rekap-gambar: 1) memotret kartu laga sendiri lalu
    // mengirimnya lewat /api/kirim-rekap — di sini cukup dikembalikan daftar laga barunya.
    rekap = await kirimRekapLagaBaru(entri, env, request.headers.get('x-rekap-gambar') === '1');
  } catch (e) {
    console.error('Rekap Discord gagal —', e.message);
    rekap = { galat: e.message };
  }
  return balas(200, { ok: true, tersimpan: Object.keys(data).length, total: entri.length, rekap });
}

// Browser yang membuka alamat ini (GET) cukup diberi tahu cara pakainya.
export function onRequestGet() {
  return balas(405, { galat: 'Method tidak didukung, pakai POST.' });
}

async function kirimRekapLagaBaru(entri, env, modeGambar) {
  const webhook = env.DISCORD_WEBHOOK_REKAP;
  if (!webhook) return { dilewati: 'DISCORD_WEBHOOK_REKAP belum diatur' };

  const laga = new Map();
  for (const item of entri) {
    if (String(item?.jalur || '').replace(/^\/+/, '') !== 'clubs/matches') continue;
    const tipe = new URLSearchParams(String(item.pencarian || '')).get('matchType') || '';
    let daftar;
    try { daftar = typeof item.data === 'string' ? JSON.parse(item.data) : item.data; } catch { continue; }
    for (const mm of Array.isArray(daftar) ? daftar : []) {
      if (mm?.matchId && !laga.has(String(mm.matchId))) laga.set(String(mm.matchId), { ...mm, _tipe: tipe });
    }
  }
  if (!laga.size) return { dicek: 0, terkirim: 0 };

  const urut = [...laga.values()].sort((a, b) => (+a.timestamp || 0) - (+b.timestamp || 0));
  const catatan = await bacaCatatan(env);
  const sudah = new Set(catatan.ids);
  let berubah = false;

  // Pertama kali jalan: tandai laga lama sebagai sudah dikirim, tanpa posting.
  if (!catatan.mulai) {
    for (const mm of urut) {
      if (Date.now() - (+mm.timestamp || 0) * 1000 > BATAS_LAGA_AWAL_MS) sudah.add(String(mm.matchId));
    }
    catatan.mulai = new Date().toISOString();
    berubah = true;
  }

  if (modeGambar) {
    if (berubah) await simpanCatatan(env, catatan, sudah);
    const gambar = urut.filter((mm) => !sudah.has(String(mm.matchId)))
      .map((mm) => ({ id: String(mm.matchId), tinggi: tinggiKartu(mm) }));
    return { dicek: urut.length, gambar };
  }

  let terkirim = 0;
  for (const mm of urut) {
    const id = String(mm.matchId);
    if (sudah.has(id)) continue;
    if (await kirimKeDiscord(webhook, mm)) {
      sudah.add(id);
      terkirim++;
      berubah = true;
    }
  }

  // Satu kali tulis KV saja, dan hanya kalau ada yang berubah.
  if (berubah) await simpanCatatan(env, catatan, sudah);
  return { dicek: urut.length, terkirim };
}

// HARUS sama persis dengan buatKunciCache di /api/ea.
function buatKunciCache(jalur, search) {
  const p = new URLSearchParams(search || '');
  p.delete('_');
  const pasangan = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}-${v}`);
  return `${jalur}__${pasangan.join('_')}`.replace(/[^A-Za-z0-9_.-]/g, '-');
}

function balas(status, isi) {
  return new Response(JSON.stringify(isi, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
