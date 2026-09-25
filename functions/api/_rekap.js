/**
 * Modul bersama rekap Discord (dipakai /api/terima-data, /api/kirim-rekap, /kartu-laga).
 * Nama file diawali "_" supaya bukan alamat/route tersendiri.
 */
export const KLUB_ID = '438867';
export const LABEL_TIPE = { leagueMatch: 'Liga', playoffMatch: 'Playoff', friendlyMatch: 'Friendly' };
export const KUNCI_REKAP = 'rekap-terkirim';
export const KUNCI_DATA_LAPTOP = 'data-laptop';
export const MAKS_ID_DIINGAT = 300;

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
    const r = await fetch(webhook, { method: 'POST', body: form });
    if (!r.ok) { console.error('Discord menolak gambar —', r.status, await r.text()); return false; }
    return true;
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
  return null;
}

export async function bacaCatatan(env) {
  return (await env.JAGAL_KV.get(KUNCI_REKAP, { type: 'json' })) || { mulai: null, ids: [] };
}
export async function simpanCatatan(env, catatan, sudah) {
  catatan.ids = [...sudah].slice(-MAKS_ID_DIINGAT);
  await env.JAGAL_KV.put(KUNCI_REKAP, JSON.stringify(catatan));
}

// Tinggi gambar kartu laga (px) — dipakai halaman /kartu-laga DAN laptop saat memotret.
export function tinggiKartu(mm) {
  const n = Object.keys(mm.players?.[KLUB_ID] || {}).length || 1;
  return 560 + 44 + n * 54 + 60 + 4; // atas+papan+statistik, kepala tabel, baris pemain, kaki
}
