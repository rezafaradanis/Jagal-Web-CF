/**
 * /api/trial  —  FORM TRIAL → DISCORD (Cloudflare Pages Functions)
 * ─────────────────────────────────────────────────────────────
 * Halaman /trial mengirim data form ke sini, lalu fungsi ini meneruskannya
 * ke Discord. URL webhook TIDAK ditulis di kode mana pun — disimpan sebagai
 * variabel rahasia DISCORD_WEBHOOK_TRIAL di Cloudflare Pages:
 *   Settings → Variables and Secrets → Add → Type: Secret
 */

export async function onRequestPost({ request, env }) {
  const webhook = env.DISCORD_WEBHOOK_TRIAL;
  if (!webhook) {
    console.error('DISCORD_WEBHOOK_TRIAL belum diatur di Cloudflare.');
    return balas(500, { galat: 'Form belum terhubung ke Discord — hubungi admin JAGAL VFC.' });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return balas(400, { galat: 'Data form tidak valid.' });
  }

  const baris = (nama, lv) => (nama ? `${nama}${lv ? ' (Lv ' + lv + ')' : ''}` : null);
  const archetypeList =
    [baris(data.archetype1, data.level1), baris(data.archetype2, data.level2), baris(data.archetype3, data.level3)]
      .filter(Boolean)
      .join('\n') || '(tidak diisi)';

  const payload = {
    embeds: [
      {
        title: '📝 Pendaftaran Trial Baru — JAGAL VFC',
        description: 'EA SPORTS FC 27 · Pro Clubs',
        color: 0xe0263c,
        fields: [
          { name: 'Nama Akun', value: teks(data.namaAkun), inline: true },
          { name: 'Platform', value: teks(data.platform), inline: true },
          { name: 'Posisi Utama', value: teks(data.posisiUtama), inline: true },
          { name: 'Posisi Kedua', value: teks(data.posisiKedua, '– tidak ada –'), inline: true },
          { name: 'Username Discord', value: teks(data.discordId), inline: true },
          { name: 'Archetype & Level', value: archetypeList, inline: false },
          { name: 'Klub Sebelumnya', value: teks(data.klubSebelumnya, '(tidak diisi)'), inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error('Discord menolak webhook trial —', r.status, await r.text());
      return balas(502, { galat: 'Discord menolak pengiriman. Coba lagi nanti.' });
    }
    return balas(200, { ok: true });
  } catch (e) {
    console.error('Gagal kirim ke Discord —', e.message);
    return balas(502, { galat: 'Gagal terhubung ke Discord.' });
  }
}

export async function onRequestGet() {
  return balas(405, { galat: 'Method tidak didukung.' });
}

function teks(v, fallback = '-') {
  const s = typeof v === 'string' ? String(v).trim() : '';
  return (s || fallback).slice(0, 1000);
}

function balas(status, isi) {
  return new Response(JSON.stringify(isi), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
