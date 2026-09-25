/**
 * /api/kirim-rekap?id=MATCHID  —  KIRIM REKAP LAGA KE DISCORD (dipanggil skrip laptop)
 * ─────────────────────────────────────────────────────────────
 * Body = gambar PNG kartu laga (hasil potret halaman /kartu-laga di laptop).
 * Tambahkan &tes=1 untuk uji coba (boleh kirim ulang laga yang sudah pernah dikirim).
 * Tambahkan &teks=1 (tanpa body) kalau laptop gagal memotret: rekap dikirim
 * dalam bentuk teks seperti biasa.
 * ?mingguan=YYYY-MM-DD → kirim rekap mingguan (body = PNG dari /kartu-mingguan).
 * Header wajib: x-kunci-update (sama dengan env KUNCI_UPDATE).
 */
import { cariLaga, kirimGambarKeDiscord, kirimKeDiscord, bacaCatatan, simpanCatatan, infoWebhook,
  dataMingguan, kirimMingguanKeDiscord, tandaiMingguan } from './_rekap.js';

export async function onRequestPost({ request, env }) {
  if (!env.KUNCI_UPDATE || request.headers.get('x-kunci-update') !== env.KUNCI_UPDATE) return balas(401, { galat: 'Kunci tidak valid.' });
  if (!env.JAGAL_KV) return balas(500, { galat: 'Binding KV JAGAL_KV belum dipasang di Cloudflare.' });
  const webhook = env.DISCORD_WEBHOOK_REKAP;
  if (!webhook) return balas(500, { galat: 'DISCORD_WEBHOOK_REKAP belum diatur.' });

  const url = new URL(request.url);

  // ?mingguan=YYYY-MM-DD → rekap mingguan (body = PNG dari /kartu-mingguan).
  const minggu = url.searchParams.get('mingguan');
  if (minggu) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(minggu)) return balas(400, { galat: 'Format minggu salah.' });
    const png = await request.arrayBuffer();
    const t = new Uint8Array(png.slice(0, 2));
    if (png.byteLength < 1000 || t[0] !== 0x89 || t[1] !== 0x50) return balas(400, { galat: 'Body bukan gambar PNG.' });
    const d = await dataMingguan(env, minggu);
    if (!d.laga.length) return balas(404, { galat: 'Tidak ada laga di minggu itu.' });
    if (!(await kirimMingguanKeDiscord(webhook, d, png))) return balas(502, { galat: 'Discord menolak kiriman.' });
    if (url.searchParams.get('tes') !== '1') await tandaiMingguan(env, minggu);
    return balas(200, { ok: true });
  }

  const id = url.searchParams.get('id');
  if (!id) return balas(400, { galat: 'Parameter id kosong.' });

  // &tes=1 → kirim ulang untuk uji coba: abaikan catatan "sudah dikirim" dan tidak mencatatnya.
  const tes = url.searchParams.get('tes') === '1';
  const catatan = await bacaCatatan(env);
  const sudah = new Set(catatan.ids);
  if (sudah.has(id) && !tes) return balas(200, { ok: true, catatan: 'Laga ini sudah pernah dikirim.' });

  const mm = await cariLaga(env, id);
  if (!mm) return balas(404, { galat: 'Laga tidak ditemukan di data terakhir.' });

  let ok;
  if (url.searchParams.get('teks') === '1') {
    ok = await kirimKeDiscord(webhook, mm);
  } else {
    const png = await request.arrayBuffer();
    const tandaPng = new Uint8Array(png.slice(0, 4));
    if (png.byteLength < 1000 || tandaPng[0] !== 0x89 || tandaPng[1] !== 0x50) return balas(400, { galat: 'Body bukan gambar PNG.' });
    if (png.byteLength > 8 * 1024 * 1024) return balas(413, { galat: 'Gambar terlalu besar (maks 8 MB).' });
    ok = await kirimGambarKeDiscord(webhook, mm, png);
  }
  if (!ok) return balas(502, { galat: 'Discord menolak kiriman.' });

  if (!tes) {
    sudah.add(id);
    await simpanCatatan(env, catatan, sudah);
  }
  if (tes) {
    const w = await infoWebhook(webhook);
    const pesan = typeof ok === 'object' ? ok : {};
    return balas(200, { ok: true, tes, webhook: w, pesan,
      tautan: w.server && pesan.channel && pesan.id ? `https://discord.com/channels/${w.server}/${pesan.channel}/${pesan.id}` : null });
  }
  return balas(200, { ok: true });
}

export function onRequestGet() {
  return balas(405, { galat: 'Method tidak didukung, pakai POST.' });
}

function balas(status, isi) {
  return new Response(JSON.stringify(isi), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
