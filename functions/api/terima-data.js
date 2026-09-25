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

const KUNCI_DATA_LAPTOP = 'data-laptop';
const KUNCI_REKAP = 'rekap-terkirim';
const KLUB_ID = '438867';
const LABEL_TIPE = { leagueMatch: 'Liga', playoffMatch: 'Playoff', friendlyMatch: 'Friendly' };
// Saat pertama kali jalan, laga yang lebih lama dari ini tidak dikirim (supaya tidak membanjiri Discord).
const BATAS_LAGA_AWAL_MS = 3 * 60 * 60 * 1000;
const MAKS_ID_DIINGAT = 300;

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
    rekap = await kirimRekapLagaBaru(entri, env);
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

async function kirimRekapLagaBaru(entri, env) {
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
  const catatan = (await env.JAGAL_KV.get(KUNCI_REKAP, { type: 'json' })) || { mulai: null, ids: [] };
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
  if (berubah) {
    catatan.ids = [...sudah].slice(-MAKS_ID_DIINGAT);
    await env.JAGAL_KV.put(KUNCI_REKAP, JSON.stringify(catatan));
  }
  return { dicek: urut.length, terkirim };
}

// Nama pemain di EA (huruf kecil) → Discord User ID. Yang tidak terdaftar ditulis nama EA-nya.
// Cara dapat ID: Discord → Settings → Advanced → Developer Mode → klik kanan orangnya → Copy User ID.
const DISCORD_ID = {
  'keenarok': '1036305251487191070', // KeenArok
  'gee-zoneplay': '558576386529427457', // GEE-ZONEPLAY
  'latern7': '396025684876853249', // laTern7
  'youngcrowheart': '1141025280534781973', // youngcrowheart
  'n0oootz': '396806701199654950', // N0oootz
  'driftking696911': '1088073183531388989', // driftking696911
  'kngsmn21': '275966698782195714', // Kngsmn21
  'doubleh5435': '1200129614283018342', // Doubleh5435
  'donnyalexandro13': '815384898058977301', // donnyalexandro13
  'leoawinz': '346719379125436417', // LeoAwinz
  'xzxgumgum': '306951542924115968', // XzXgumgum
  'fhmdayat': '541098505037414411', // fhmdayat
  'critze07': '216445737880387584', // critze07
};
function sebut(nama) {
  const id = DISCORD_ID[String(nama || '').trim().toLowerCase()];
  return id ? `<@${id}>` : nama;
}

async function kirimKeDiscord(webhook, mm) {
  const kami = mm.clubs?.[KLUB_ID];
  const lawanId = Object.keys(mm.clubs || {}).find((k) => k !== KLUB_ID);
  const lawan = mm.clubs?.[lawanId];
  if (!kami || !lawan) return false;

  const golKami = +kami.goals || 0;
  const golLawan = +lawan.goals || 0;
  const hasil = golKami > golLawan ? 'MENANG' : golKami < golLawan ? 'KALAH' : 'SERI';
  const warna = golKami > golLawan ? 0x2fbf71 : golKami < golLawan ? 0xe0263c : 0xe0b823;
  const emoji = golKami > golLawan ? '🟢' : golKami < golLawan ? '🔴' : '🟡';

  // Nama field sesuai data asli EA (dicek 25 Sep 2026).
  const pemain = Object.values(mm.players?.[KLUB_ID] || {})
    .map((pl) => ({
      nama: pl.playername || 'Pemain',
      gol: +pl.goals || 0,
      assist: +pl.assists || 0,
      tembakan: +pl.shots || 0,
      passSukses: +pl.passesmade || 0,
      passCoba: +pl.passattempts || 0,
      tekel: +pl.tacklesmade || 0,
      save: +pl.saves || 0,
      kartuMerah: +pl.redcards || 0,
      kiper: pl.pos === 'goalkeeper',
      rating: Math.round((+pl.rating || 0) * 10) / 10,
      mom: pl.mom === '1' || pl.mom === 1,
    }))
    .sort((a, b) => b.rating - a.rating);

  const potong = (s) => (s.length > 1024 ? s.slice(0, 1020) + '…' : s) || '-';
  const pencetakGol = potong(pemain.filter((p) => p.gol > 0).map((p) => `⚽ ${sebut(p.nama)} (${p.gol})`).join('\n'));
  const pemberiAssist = potong(pemain.filter((p) => p.assist > 0).map((p) => `🅰️ ${sebut(p.nama)} (${p.assist})`).join('\n'));
  const motm = pemain.find((p) => p.mom);
  const rincian = potong(pemain.map((p) => {
    const bagian = [`**${p.rating.toFixed(1)}**`];
    if (p.gol || p.assist) bagian.push(`${p.gol}G ${p.assist}A`);
    if (p.tembakan) bagian.push(`${p.tembakan} tembakan`);
    if (p.passCoba) bagian.push(`pass ${p.passSukses}/${p.passCoba}`);
    if (p.tekel) bagian.push(`${p.tekel} tekel`);
    if (p.kiper || p.save) bagian.push(`${p.save} save`);
    if (p.kartuMerah) bagian.push('🟥');
    return `${p.mom ? '⭐ ' : ''}${sebut(p.nama)} — ${bagian.join(' · ')}`;
  }).join('\n'));

  const namaLawan = lawan.details?.name || 'Lawan';
  const tanggal = new Date((+mm.timestamp || 0) * 1000);
  const fields = [
    { name: 'Pencetak Gol', value: pencetakGol, inline: true },
    { name: 'Assist', value: pemberiAssist, inline: true },
  ];
  if (motm) fields.push({ name: 'Man of the Match', value: `⭐ ${sebut(motm.nama)} (${motm.rating.toFixed(1)})`, inline: true });
  fields.push({ name: 'Rating & Statistik Pemain', value: rincian, inline: false });

  // Tag di dalam embed tampil sebagai mention tapi TIDAK mengirim notifikasi,
  // jadi pemain yang ikut main dan punya ID juga di-tag di baris 'content'.
  const idMain = [...new Set(pemain.map((p) => DISCORD_ID[p.nama.trim().toLowerCase()]).filter(Boolean))];
  const payload = {
    content: idMain.length ? `Line-up: ${idMain.map((id) => `<@${id}>`).join(' ')}` : undefined,
    allowed_mentions: { users: idMain },
    embeds: [{
      title: `${emoji} ${hasil} — JAGAL VFC ${golKami} – ${golLawan} ${namaLawan}`,
      description: `**${LABEL_TIPE[mm._tipe] || 'Pro Clubs'}** · ${tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}`,
      color: warna,
      fields,
      footer: { text: 'JAGAL VFC · EA SPORTS FC 27 Pro Clubs · jagal.fun' },
      timestamp: tanggal.toISOString(),
    }],
  };

  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error('Discord menolak rekap —', r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('Gagal kirim rekap ke Discord —', e.message);
    return false;
  }
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
