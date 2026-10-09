/**
 * Modul bersama rekap Discord (dipakai /api/terima-data, /api/kirim-rekap, /kartu-laga).
 * Nama file diawali "_" supaya bukan alamat/route tersendiri.
 */
export const KLUB_ID = '438867';
export const LABEL_TIPE = { leagueMatch: 'Liga', playoffMatch: 'Playoff', friendlyMatch: 'Friendly' };
export const KUNCI_REKAP = 'rekap-terkirim';
export const KUNCI_DATA_LAPTOP = 'data-laptop';
export const MAKS_ID_DIINGAT = 300;
export const KUNCI_ARSIP = 'arsip-laga';

/* ── ARSIP LAGA PERMANEN ──
   EA hanya membagikan ±10 laga terakhir per jenis laga. Setiap laga yang pernah
   dikirim laptop disalin (versi ringkas) ke KV 'arsip-laga' supaya tidak hilang.
   Bentuknya tetap sama dengan data EA (clubs & players) supaya situs bisa
   membacanya dengan kode yang sama. */
const FIELD_PEMAIN = ['playername', 'pos', 'archetypeid', 'goals', 'assists', 'shots', 'passesmade', 'passattempts',
  'tacklesmade', 'tackleattempts', 'saves', 'parrySaves', 'punchSaves', 'reflexSaves', 'ballDiveSaves', 'crossSaves',
  'goalsconceded', 'redcards', 'rating', 'mom', 'secondsPlayed'];
export function ringkasLaga(mm, tipe) {
  const clubs = {}; const players = {};
  for (const [cid, c] of Object.entries(mm.clubs || {})) {
    clubs[cid] = { goals: c.goals, winnerByDnf: c.winnerByDnf,
      details: { name: c.details?.name || '', customKit: { crestAssetId: c.details?.customKit?.crestAssetId || '' } } };
  }
  for (const [cid, daftar] of Object.entries(mm.players || {})) {
    players[cid] = {};
    for (const [pid, pl] of Object.entries(daftar || {})) {
      const r = {}; for (const f of FIELD_PEMAIN) if (pl[f] !== undefined) r[f] = pl[f];
      players[cid][pid] = r;
    }
  }
  return { matchId: String(mm.matchId), timestamp: mm.timestamp, _tipe: tipe || mm._tipe || '', clubs, players };
}
/* Penyimpanan arsip (v3) — dipecah per bulan supaya tidak menjadi satu nilai raksasa:
     'arsip-indeks'          → { v:3, mulai, bulan:{ 'YYYY-MM': jumlah }, idBulan:{ matchId:'YYYY-MM' }, tanpaPemain:[ids] }
     'arsip-laga-YYYY-MM'    → { laga:{ matchId: laga } }
   Arsip lama ('arsip-laga', satu nilai) otomatis dipindah sekali saat indeks belum ada;
   kuncinya tidak dihapus (cadangan). Bulan dihitung dalam WIB. */
export const KUNCI_INDEKS_ARSIP = 'arsip-indeks';
const kunciBulan = (b) => `arsip-laga-${b}`;
export const bulanLaga = (mm) => new Date((+mm.timestamp || 0) * 1000 + 7 * 3600 * 1000).toISOString().slice(0, 7);

// pindahkan=true hanya dari jalur tulis (kiriman laptop), supaya pemindahan sekali jalan
// tidak dilakukan bersamaan oleh banyak pengunjung. Jalur baca memakai arsip lama apa adanya.
export async function bacaIndeksArsip(env, pindahkan = false) {
  const idx = await env.JAGAL_KV.get(KUNCI_INDEKS_ARSIP, { type: 'json' });
  if (idx) return idx;
  const lama = await env.JAGAL_KV.get(KUNCI_ARSIP, { type: 'json' });
  const baru = { v: 3, mulai: lama?.mulai || null, bulan: {}, idBulan: {}, tanpaPemain: [] };
  if (!lama?.laga || !Object.keys(lama.laga).length) return baru;
  if (!pindahkan) {
    // Belum dipindah: sajikan arsip lama dari memori.
    for (const [id, mm] of Object.entries(lama.laga)) { const b = bulanLaga(mm); baru.idBulan[id] = b; baru.bulan[b] = (baru.bulan[b] || 0) + 1; }
    baru._lama = lama.laga;
    return baru;
  }
  const perBulan = {};
  for (const [id, mm] of Object.entries(lama.laga)) {
    const b = bulanLaga(mm);
    (perBulan[b] ??= {})[id] = mm;
    baru.idBulan[id] = b;
    if (!Object.keys(mm.players || {}).length) baru.tanpaPemain.push(id);
  }
  for (const [b, laga] of Object.entries(perBulan)) {
    await env.JAGAL_KV.put(kunciBulan(b), JSON.stringify({ laga }));
    baru.bulan[b] = Object.keys(laga).length;
  }
  await env.JAGAL_KV.put(KUNCI_INDEKS_ARSIP, JSON.stringify(baru));
  return baru;
}
async function bacaBulan(env, b, idx) {
  if (idx?._lama) return { laga: Object.fromEntries(Object.entries(idx._lama).filter(([, mm]) => bulanLaga(mm) === b)) };
  return (await env.JAGAL_KV.get(kunciBulan(b), { type: 'json' })) || { laga: {} };
}
// Semua laga di arsip (opsional: hanya bulan tertentu). Satu baca KV per bulan.
export async function bacaLagaArsip(env, daftarBulan = null) {
  const idx = await bacaIndeksArsip(env);
  const bulan = (daftarBulan || Object.keys(idx.bulan || {})).filter((b) => idx.bulan?.[b]);
  const isi = await Promise.all(bulan.map((b) => bacaBulan(env, b, idx)));
  return { indeks: idx, laga: isi.flatMap((x) => Object.values(x.laga || {})) };
}
export async function cariArsip(env, matchId) {
  const idx = await bacaIndeksArsip(env);
  const b = idx.idBulan?.[String(matchId)];
  if (!b) return null;
  return (await bacaBulan(env, b, idx)).laga?.[String(matchId)] || null;
}

// daftar: [{ mm, tipe }] — hanya menulis KV kalau ada laga baru (hemat kuota tulis).
export async function perbaruiArsip(env, daftar) {
  const idx = await bacaIndeksArsip(env, true);
  if (!idx.mulai) idx.mulai = new Date().toISOString();
  const tanpa = new Set(idx.tanpaPemain || []);
  const ubah = {}; // bulan → daftar laga baru
  for (const { mm, tipe } of daftar) {
    const id = String(mm?.matchId || '');
    if (!id || !mm.clubs?.[KLUB_ID]) continue;
    const adaPemain = Object.keys(mm.players || {}).length > 0;
    // Simpan kalau belum ada, atau kalau versi lama belum punya data pemain.
    if (idx.idBulan[id] && !(tanpa.has(id) && adaPemain)) continue;
    const b = idx.idBulan[id] || bulanLaga(mm);
    (ubah[b] ??= []).push([id, ringkasLaga(mm, tipe)]);
    idx.idBulan[id] = b;
    if (adaPemain) tanpa.delete(id); else tanpa.add(id);
  }
  let baru = 0;
  for (const [b, daftarBaru] of Object.entries(ubah)) {
    const isi = await bacaBulan(env, b);
    for (const [id, mm] of daftarBaru) { isi.laga[id] = mm; baru++; }
    idx.bulan[b] = Object.keys(isi.laga).length;
    await env.JAGAL_KV.put(kunciBulan(b), JSON.stringify(isi));
  }
  if (baru) {
    idx.tanpaPemain = [...tanpa];
    await env.JAGAL_KV.put(KUNCI_INDEKS_ARSIP, JSON.stringify(idx));
  }
  return { baru, total: Object.keys(idx.idBulan).length };
}

// Nama pemain di EA (huruf kecil) → Discord User ID. Yang tidak terdaftar ditulis nama EA-nya.
// Cara dapat ID: Discord → Settings → Advanced → Developer Mode → klik kanan orangnya → Copy User ID.
export const DISCORD_ID = {
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
  'pumba_brs': '568838699752882197', // Pumba_brs (Discord: albus1247)
  'yurdyyy': '513550980906745859', // Yurdyyy
};
export function sebut(nama) {
  const id = DISCORD_ID[String(nama || '').trim().toLowerCase()];
  return id ? `<@${id}>` : nama;
}

export async function kirimKeDiscord(webhook, mm) {
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
      description: `**${LABEL_TIPE[mm._tipe] || 'Pro Clubs'}** · ${tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })} · ${tanggal.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).replace('.', ':')} WIB`,
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


// Discord ID pemain JAGAL yang main di laga ini (untuk tag di baris content).
export function idMainDari(mm) {
  return [...new Set(Object.values(mm.players?.[KLUB_ID] || {})
    .map((pl) => DISCORD_ID[String(pl.playername || '').trim().toLowerCase()]).filter(Boolean))];
}

// Kirim gambar kartu laga (PNG) + baris tag pemain ke Discord.
export async function kirimGambarKeDiscord(webhook, mm, png) {
  const kami = mm.clubs?.[KLUB_ID];
  const lawanId = Object.keys(mm.clubs || {}).find((k) => k !== KLUB_ID);
  const lawan = mm.clubs?.[lawanId];
  if (!kami || !lawan) return false;
  const a = +kami.goals || 0, b = +lawan.goals || 0;
  const judul = a > b ? '🟢 **MENANG**' : a < b ? '🔴 **KALAH**' : '🟡 **SERI**';
  const idMain = idMainDari(mm);
  const baris = [`${judul} — JAGAL VFC ${a} – ${b} ${lawan.details?.name || 'Lawan'} · ${LABEL_TIPE[mm._tipe] || 'Pro Clubs'}`];
  if (idMain.length) baris.push(`Line-up: ${idMain.map((id) => `<@${id}>`).join(' ')}`);
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: baris.join('\n'),
    allowed_mentions: { users: idMain },
    attachments: [{ id: 0, filename: 'hasil-laga.png' }],
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'hasil-laga.png');
  try {
    // ?wait=true → Discord membalas data pesan yang dibuat (dipakai untuk memastikan pesannya ada).
    const u = new URL(webhook); u.searchParams.set('wait', 'true');
    const r = await fetch(u.toString(), { method: 'POST', body: form });
    if (!r.ok) { console.error('Discord menolak gambar —', r.status, await r.text()); return false; }
    let pesan = {}; try { pesan = await r.json(); } catch {}
    return { id: pesan.id || null, channel: pesan.channel_id || null, lampiran: (pesan.attachments || []).length };
  } catch (e) {
    console.error('Gagal kirim gambar ke Discord —', e.message);
    return false;
  }
}

// Cari satu laga (lengkap dengan jenis laganya) dari data kiriman laptop di KV.
export async function cariLaga(env, matchId) {
  const semua = await env.JAGAL_KV.get(KUNCI_DATA_LAPTOP, { type: 'json' });
  for (const [kunci, teks] of Object.entries(semua?.entri || {})) {
    if (!kunci.startsWith('clubs-matches__')) continue;
    const tipe = (kunci.match(/matchType-([A-Za-z]+)/) || [])[1] || '';
    let daftar; try { daftar = JSON.parse(teks); } catch { continue; }
    const mm = (Array.isArray(daftar) ? daftar : []).find((x) => String(x?.matchId) === String(matchId));
    if (mm) return { ...mm, _tipe: tipe };
  }
  // Tidak ada di data terbaru → cari di arsip permanen.
  return cariArsip(env, matchId);
}

export async function bacaCatatan(env) {
  return (await env.JAGAL_KV.get(KUNCI_REKAP, { type: 'json' })) || { mulai: null, ids: [] };
}
export async function simpanCatatan(env, catatan, sudah) {
  catatan.ids = [...sudah].slice(-MAKS_ID_DIINGAT);
  await env.JAGAL_KV.put(KUNCI_REKAP, JSON.stringify(catatan));
}

// Info webhook (nama, server & channel tujuan) — untuk diagnosa, tanpa membuka URL rahasianya.
export async function infoWebhook(webhook) {
  try {
    const r = await fetch(webhook);
    if (!r.ok) return { galat: `HTTP ${r.status}` };
    const w = await r.json();
    return { nama: w.name, server: w.guild_id, channel: w.channel_id };
  } catch (e) { return { galat: e.message }; }
}

// Tinggi gambar kartu laga (px) — dipakai halaman /kartu-laga DAN laptop saat memotret.
export function tinggiKartu(mm) {
  const n = Object.keys(mm.players?.[KLUB_ID] || {}).length || 1;
  return 560 + 44 + n * 54 + 60 + 4; // atas+papan+statistik, kepala tabel, baris pemain, kaki
}

/* ── REKAP MINGGUAN (Senin–Minggu, waktu WIB) ── */
export const KUNCI_MINGGUAN = 'rekap-mingguan';
const WIB_MS = 7 * 3600 * 1000;
const HARI_MS = 24 * 3600 * 1000;
// Tanggal Senin (YYYY-MM-DD, WIB) dari minggu yang memuat waktu ms.
export function seninDari(ms) {
  const w = new Date(ms + WIB_MS);
  const hari = (w.getUTCDay() + 6) % 7; // Senin = 0
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - hari)).toISOString().slice(0, 10);
}
// Rentang ms (UTC) untuk minggu yang dimulai Senin 'minggu' (00:00 WIB) s.d. Senin berikutnya.
export function rentangMinggu(minggu) {
  const awal = Date.parse(minggu + 'T00:00:00Z') - WIB_MS;
  return [awal, awal + 7 * HARI_MS];
}

export async function dataMingguan(env, minggu) {
  const [awal, akhir] = rentangMinggu(minggu);
  // Hanya bulan yang tercakup minggu ini (1 atau 2 bulan).
  const bulan = [...new Set([awal, akhir - 1].map((ms) => new Date(ms + WIB_MS).toISOString().slice(0, 7)))];
  const { laga: semua } = await bacaLagaArsip(env, bulan);
  const laga = semua
    .filter((m) => m.timestamp * 1000 >= awal && m.timestamp * 1000 < akhir && m.clubs?.[KLUB_ID])
    .sort((a, b) => a.timestamp - b.timestamp);
  const pemain = {};
  let m = 0, s = 0, k = 0, gol = 0, kemasukan = 0;
  for (const mm of laga) {
    const lawanId = Object.keys(mm.clubs).find((x) => x !== KLUB_ID);
    const a = +mm.clubs[KLUB_ID].goals || 0, b = +mm.clubs[lawanId]?.goals || 0;
    gol += a; kemasukan += b;
    if (a > b) m++; else if (a < b) k++; else s++;
    for (const pl of Object.values(mm.players?.[KLUB_ID] || {})) {
      const nama = pl.playername || 'Pemain';
      const p = (pemain[nama.toLowerCase()] ??= { nama, main: 0, gol: 0, assist: 0, motm: 0, totalRating: 0 });
      p.main++; p.gol += +pl.goals || 0; p.assist += +pl.assists || 0;
      p.motm += String(pl.mom) === '1' ? 1 : 0; p.totalRating += +pl.rating || 0;
    }
  }
  const daftar = Object.values(pemain).map((p) => ({ ...p, rating: p.main ? p.totalRating / p.main : 0 }))
    .sort((x, y) => y.rating - x.rating || y.main - x.main);
  return { minggu, laga, pemain: daftar, ringkas: { main: laga.length, m, s, k, gol, kemasukan } };
}
export function tinggiMingguan(d) {
  return 70 + 130 + 150 + 44 + Math.min(d.laga.length, 12) * 40 + 30 + 44 + Math.min(d.pemain.length, 12) * 46 + 60 + 4;
}
// Minggu lengkap terakhir yang belum dikirim (atau null). Minggu yang sudah berakhir
// sebelum arsip mulai mencatat dilewati, supaya rekapnya tidak setengah-setengah.
export async function mingguPerluDikirim(env) {
  const seninIni = seninDari(Date.now());
  const mingguLalu = new Date(Date.parse(seninIni + 'T00:00:00Z') - 7 * HARI_MS).toISOString().slice(0, 10);
  const catatan = (await env.JAGAL_KV.get(KUNCI_MINGGUAN, { type: 'json' })) || {};
  if (catatan.terakhir && catatan.terakhir >= mingguLalu) return null;
  const idx = await bacaIndeksArsip(env);
  const [, akhirLalu] = rentangMinggu(mingguLalu);
  if (!idx?.mulai || Date.parse(idx.mulai) > akhirLalu) return null;
  const d = await dataMingguan(env, mingguLalu);
  // Minggu tanpa laga: tandai selesai supaya tidak dicek ulang setiap 10 menit.
  if (!d.laga.length) { await tandaiMingguan(env, mingguLalu); return null; }
  return { minggu: mingguLalu, tinggi: tinggiMingguan(d) };
}
export async function tandaiMingguan(env, minggu) {
  await env.JAGAL_KV.put(KUNCI_MINGGUAN, JSON.stringify({ terakhir: minggu, waktu: new Date().toISOString() }));
}
export function labelMinggu(minggu) {
  const [awal] = rentangMinggu(minggu);
  const f = (ms) => new Date(ms + WIB_MS).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(awal)} – ${f(awal + 6 * HARI_MS)} ${new Date(awal + 6 * HARI_MS + WIB_MS).getUTCFullYear()}`;
}

// Kirim gambar rekap mingguan + tag pemain peraih penghargaan.
export async function kirimMingguanKeDiscord(webhook, d, png) {
  const r = d.ringkas;
  const top = (f) => [...d.pemain].sort((a, b) => f(b) - f(a))[0];
  const topGol = top((p) => p.gol), topAssist = top((p) => p.assist);
  const baris = [`📅 **Rekap Mingguan JAGAL VFC** · ${labelMinggu(d.minggu)}`,
    `${r.main} laga · ${r.m} menang, ${r.s} seri, ${r.k} kalah · gol ${r.gol}–${r.kemasukan}`];
  const pujian = [];
  if (topGol?.gol) pujian.push(`⚽ Top skor: ${sebut(topGol.nama)} (${topGol.gol})`);
  if (topAssist?.assist) pujian.push(`🅰️ Top assist: ${sebut(topAssist.nama)} (${topAssist.assist})`);
  if (pujian.length) baris.push(pujian.join(' · '));
  const idTag = [...new Set([topGol, topAssist].filter(Boolean).map((p) => DISCORD_ID[p.nama.toLowerCase()]).filter(Boolean))];
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: baris.join('\n'), allowed_mentions: { users: idTag },
    attachments: [{ id: 0, filename: 'rekap-mingguan.png' }] }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'rekap-mingguan.png');
  try {
    const res = await fetch(webhook, { method: 'POST', body: form });
    if (!res.ok) { console.error('Discord menolak rekap mingguan —', res.status, await res.text()); return false; }
    return true;
  } catch (e) { console.error('Gagal kirim rekap mingguan —', e.message); return false; }
}
