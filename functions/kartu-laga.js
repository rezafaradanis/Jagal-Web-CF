/**
 * /kartu-laga?id=MATCHID  —  KARTU HASIL LAGA UNTUK DIPOTRET
 * ─────────────────────────────────────────────────────────────
 * Halaman HTML siap-potret (lebar 1000px, tinggi = tinggiKartu) berisi skor,
 * statistik JAGAL vs lawan, dan tabel pemain JAGAL. Laptop memotret halaman
 * ini lalu mengirim gambarnya ke Discord lewat /api/kirim-rekap.
 * Datanya diambil dari data kiriman laptop di KV, jadi tidak perlu JavaScript.
 */
import { cariLaga, tinggiKartu, KLUB_ID, LABEL_TIPE } from './api/_rekap.js';

const ARCHETYPE_EA = {
  1: 'Shot Stopper', 2: 'Sweeper Keeper', 3: 'Progressor', 4: 'Boss', 5: 'Marauder', 6: 'Disruptor',
  7: 'Recycler', 8: 'Maestro', 9: 'Creator', 10: 'Spark', 11: 'Magician', 12: 'Finisher', 13: 'Target',
};
const logoKlub = (id) => id ? `https://eafc24.content.easports.com/fifa/fltOnlineAssets/24B23FDE-7835-41C2-87A2-F453DFDB2E82/2024/fcweb/crests/256x256/l${id}.png` : '';

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !env.JAGAL_KV) return new Response('Laga tidak ditemukan.', { status: 404 });
  const mm = await cariLaga(env, id);
  if (!mm) return new Response('Laga tidak ditemukan.', { status: 404 });

  const kami = mm.clubs[KLUB_ID];
  const lawanId = Object.keys(mm.clubs).find((k) => k !== KLUB_ID);
  const lawan = mm.clubs[lawanId] || {};
  const a = +kami.goals || 0, b = +lawan.goals || 0;
  const hasil = a > b ? ['MENANG', '#2fbf71'] : a < b ? ['KALAH', '#e0263c'] : ['SERI', '#e0b823'];
  const baca = (raw) => Object.values(raw || {}).map((pl) => ({
    nama: pl.playername || 'Pemain', pos: pl.pos || '', arch: ARCHETYPE_EA[+pl.archetypeid] || '',
    gol: +pl.goals || 0, assist: +pl.assists || 0, tembakan: +pl.shots || 0,
    pass: +pl.passesmade || 0, passCoba: +pl.passattempts || 0,
    tekel: +pl.tacklesmade || 0, tekelCoba: +pl.tackleattempts || 0,
    save: +pl.saves || 0, merah: +pl.redcards || 0,
    rating: +pl.rating || 0, mom: String(pl.mom) === '1',
  })).sort((x, y) => y.rating - x.rating);
  const pk = baca(mm.players?.[KLUB_ID]);
  const pl = baca(mm.players?.[lawanId]);
  const jml = (d, k) => d.reduce((s, x) => s + x[k], 0);
  const persen = (x, y) => (y ? Math.round((x / y) * 100) : 0);

  const stat = [
    ['Tembakan', jml(pk, 'tembakan'), jml(pl, 'tembakan'), ''],
    ['Passing sukses', jml(pk, 'pass'), jml(pl, 'pass'), ''],
    ['Akurasi passing', persen(jml(pk, 'pass'), jml(pk, 'passCoba')), persen(jml(pl, 'pass'), jml(pl, 'passCoba')), '%'],
    ['Tekel sukses', jml(pk, 'tekel'), jml(pl, 'tekel'), ''],
    ['Akurasi tekel', persen(jml(pk, 'tekel'), jml(pk, 'tekelCoba')), persen(jml(pl, 'tekel'), jml(pl, 'tekelCoba')), '%'],
    ['Save kiper', jml(pk, 'save'), jml(pl, 'save'), ''],
  ];
  if (jml(pk, 'merah') || jml(pl, 'merah')) stat.push(['Kartu merah', jml(pk, 'merah'), jml(pl, 'merah'), '']);

  const adaSave = pk.some((p) => p.save > 0);
  const momLawan = pl.find((p) => p.mom);
  const tgl = new Date((+mm.timestamp || 0) * 1000).toLocaleString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  });
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const asal = new URL(request.url).origin;

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Hasil Laga</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1000px;height:${tinggiKartu(mm)}px;overflow:hidden;background:#0b0b0e}
body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#f2f2f5;
  background:radial-gradient(ellipse at 50% -10%,rgba(224,38,60,.35),transparent 60%),linear-gradient(180deg,#141418,#0b0b0e);}
.atas{display:flex;justify-content:space-between;align-items:center;height:70px;padding:0 40px;border-bottom:1px solid rgba(255,255,255,.08)}
.merek{display:flex;align-items:center;gap:12px;font-weight:900;font-size:22px;letter-spacing:.5px}
.merek img{height:34px}.merek i{font-style:normal;color:#e0263c}
.info{font-size:15px;color:#a0a0ad;text-align:right}.info b{color:#f2f2f5}
.papan{display:grid;grid-template-columns:1fr 300px 1fr;align-items:center;height:210px;padding:0 40px}
.tim{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.tim img{width:96px;height:96px;object-fit:contain}.tim span{font-size:22px;font-weight:800;max-width:300px;overflow-wrap:anywhere}
.skor{text-align:center}.skor b{display:block;font-size:84px;font-weight:900;letter-spacing:4px;line-height:1}
.lencana{display:inline-block;margin-top:12px;padding:6px 18px;border-radius:999px;font-weight:900;font-size:16px;letter-spacing:2px;color:#0b0b0e;background:${hasil[1]}}
.stat{width:760px;margin:0 auto;height:280px;display:flex;flex-direction:column;justify-content:center;gap:12px}
.baris .angka{display:flex;justify-content:space-between;font-size:17px}
.baris .angka span{color:#a0a0ad;font-size:14px;text-transform:uppercase;letter-spacing:1px}
.baris .angka b{min-width:70px;font-weight:800;color:#a0a0ad}.baris .angka b:last-child{text-align:right}
.baris .angka b.unggul{color:#fff}
.bar{display:flex;gap:4px;height:7px;margin-top:5px}.bar i{display:block;border-radius:4px;min-width:4px}
.bar .k{background:#ff3b52}.bar .l{background:rgba(255,255,255,.28)}
table{width:920px;margin:0 auto;border-collapse:collapse;font-size:17px}
th{height:44px;text-align:left;font-size:13px;color:#a0a0ad;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,.12)}
td{height:54px;border-bottom:1px solid rgba(255,255,255,.06)}
th:not(:first-child),td:not(:first-child){text-align:center}
td.nama{font-weight:700}td.arch{color:#c9c9d3;font-size:15px}
.mom{color:#f5c542;font-weight:900;font-size:14px;margin-left:8px}
td.rtg b{display:inline-block;min-width:52px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.08);font-weight:900}
td.rtg b.tinggi{background:#2fbf71;color:#0b0b0e}
.bawah{display:flex;justify-content:space-between;align-items:center;height:60px;padding:0 40px;color:#a0a0ad;font-size:15px}
.bawah b{color:#f5c542}
</style></head><body>
<div class="atas">
  <div class="merek"><img src="${asal}/ikon/logo.png" alt="">JAGAL <i>VFC</i></div>
  <div class="info"><b>${e(LABEL_TIPE[mm._tipe] || 'Pro Clubs')}</b> · ${e(tgl)} WIB</div>
</div>
<div class="papan">
  <div class="tim"><img src="${asal}/ikon/logo.png" alt=""><span>JAGAL</span></div>
  <div class="skor"><b>${a} – ${b}</b><span class="lencana">${hasil[0]}</span></div>
  <div class="tim">${lawan.details?.customKit?.crestAssetId ? `<img src="${logoKlub(lawan.details.customKit.crestAssetId)}" alt="" onerror="this.style.visibility='hidden'">` : ''}<span>${e(lawan.details?.name || 'Lawan')}</span></div>
</div>
<div class="stat">${stat.map(([n, x, y, s]) => {
    const t = x + y, p = t ? (x / t) * 100 : 50;
    return `<div class="baris"><div class="angka"><b class="${x > y ? 'unggul' : ''}">${x}${s}</b><span>${n}</span><b class="${y > x ? 'unggul' : ''}">${y}${s}</b></div>
    <div class="bar"><i class="k" style="width:${p}%"></i><i class="l" style="width:${100 - p}%"></i></div></div>`;
  }).join('')}</div>
<table><thead><tr><th>Pemain JAGAL</th><th>Archetype</th><th>Gol</th><th>Assist</th><th>Tembakan</th><th>Passing</th><th>Tekel</th>${adaSave ? '<th>Save</th>' : ''}<th>Rating</th></tr></thead><tbody>
${pk.map((p) => `<tr><td class="nama">${e(p.nama)}${p.mom ? '<span class="mom">★ MOTM</span>' : ''}${p.merah ? ' 🟥' : ''}</td>
<td class="arch">${e(p.arch || '–')}</td><td>${p.gol}</td><td>${p.assist}</td><td>${p.tembakan}</td>
<td>${p.passCoba ? `${p.pass}/${p.passCoba}` : p.pass}</td><td>${p.tekelCoba ? `${p.tekel}/${p.tekelCoba}` : p.tekel}</td>
${adaSave ? `<td>${p.save}</td>` : ''}<td class="rtg"><b class="${p.rating >= 8 ? 'tinggi' : ''}">${p.rating.toFixed(1)}</b></td></tr>`).join('')}
</tbody></table>
<div class="bawah"><span>${momLawan ? `MOTM laga: <b>${e(momLawan.nama)}</b> (${e(lawan.details?.name || 'lawan')})` : ''}</span><span>jagal.fun</span></div>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
