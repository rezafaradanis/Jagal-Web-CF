/**
 * /kartu-mingguan?minggu=YYYY-MM-DD  —  KARTU REKAP MINGGUAN UNTUK DIPOTRET
 * Lebar 1000px, tinggi = tinggiMingguan(). Data dari arsip laga permanen di KV.
 */
import { dataMingguan, tinggiMingguan, labelMinggu, KLUB_ID, LABEL_TIPE } from './api/_rekap.js';

export async function onRequestGet({ request, env }) {
  const minggu = new URL(request.url).searchParams.get('minggu') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(minggu) || !env.JAGAL_KV) return new Response('Minggu tidak valid.', { status: 400 });
  const d = await dataMingguan(env, minggu);
  const r = d.ringkas;
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const asal = new URL(request.url).origin;
  const winRate = r.main ? Math.round((r.m / r.main) * 100) : 0;

  const top = (f, syarat = () => true) => d.pemain.filter(syarat).sort((a, b) => f(b) - f(a) || b.rating - a.rating)[0];
  const minMain = Math.max(1, Math.ceil(r.main / 3));
  const penghargaan = [
    ['⚽ Top Skor', top((p) => p.gol), (p) => `${p.gol} gol`, (p) => p.gol > 0],
    ['🅰️ Top Assist', top((p) => p.assist), (p) => `${p.assist} assist`, (p) => p.assist > 0],
    ['📈 Rating Terbaik', top((p) => p.rating, (p) => p.main >= minMain), (p) => `${p.rating.toFixed(1)} · ${p.main} laga`, () => true],
    ['⭐ MOTM Terbanyak', top((p) => p.motm), (p) => `${p.motm}x MOTM`, (p) => p.motm > 0],
  ];

  const baris = d.laga.slice(-12).reverse().map((mm) => {
    const lawanId = Object.keys(mm.clubs).find((x) => x !== KLUB_ID);
    const a = +mm.clubs[KLUB_ID].goals || 0, b = +mm.clubs[lawanId]?.goals || 0;
    const warna = a > b ? '#2fbf71' : a < b ? '#e0263c' : '#e0b823';
    const hari = new Date(mm.timestamp * 1000).toLocaleString('id-ID', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
    return `<div class="laga"><i style="background:${warna}"></i><span class="hari">${e(hari)}</span>
      <span class="lawan">${e(mm.clubs[lawanId]?.details?.name || 'Lawan')}</span><span class="tipe">${e(LABEL_TIPE[mm._tipe] || '')}</span><b>${a} – ${b}</b></div>`;
  }).join('');

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Rekap Mingguan</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1000px;height:${tinggiMingguan(d)}px;overflow:hidden;background:#0b0b0e}
body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#f2f2f5;
  background:radial-gradient(ellipse at 50% -10%,rgba(224,38,60,.35),transparent 60%),linear-gradient(180deg,#141418,#0b0b0e)}
.atas{display:flex;justify-content:space-between;align-items:center;height:70px;padding:0 40px;border-bottom:1px solid rgba(255,255,255,.08)}
.merek{display:flex;align-items:center;gap:12px;font-weight:900;font-size:22px}.merek img{height:34px}.merek i{font-style:normal;color:#e0263c}
.judul{text-align:right}.judul b{display:block;font-size:18px;letter-spacing:2px}.judul span{font-size:14px;color:#a0a0ad}
.kpi{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;height:130px;padding:24px 40px}
.kpi div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.kpi b{font-size:34px;font-weight:900;line-height:1}.kpi span{font-size:12px;color:#a0a0ad;text-transform:uppercase;letter-spacing:1px;margin-top:6px}
.kpi .m b{color:#2fbf71}.kpi .k b{color:#ff3b52}.kpi .s b{color:#e0b823}
.award{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;height:150px;padding:10px 40px 20px}
.award div{background:linear-gradient(180deg,rgba(224,38,60,.18),rgba(255,255,255,.03));border:1px solid rgba(224,38,60,.35);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0}
.award span{font-size:13px;color:#c9c9d3;font-weight:700}.award b{font-size:20px;font-weight:900;overflow-wrap:anywhere}.award i{font-style:normal;font-size:14px;color:#a0a0ad}
h2{height:44px;display:flex;align-items:flex-end;padding:0 40px 8px;font-size:13px;color:#a0a0ad;text-transform:uppercase;letter-spacing:1.5px}
.laga{display:flex;align-items:center;gap:14px;height:40px;margin:0 40px;border-bottom:1px solid rgba(255,255,255,.06);font-size:16px}
.laga i{width:6px;height:24px;border-radius:3px}.laga .hari{width:120px;color:#a0a0ad;font-size:14px}
.laga .lawan{flex:1;font-weight:700}.laga .tipe{color:#a0a0ad;font-size:13px;width:80px;text-align:right}.laga b{width:80px;text-align:right;font-size:18px}
.jarak{height:30px}
table{width:920px;margin:0 auto;border-collapse:collapse;font-size:16px}
th{height:44px;text-align:left;font-size:12px;color:#a0a0ad;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,.12)}
td{height:46px;border-bottom:1px solid rgba(255,255,255,.06)}th:not(:first-child),td:not(:first-child){text-align:center}
td.nama{font-weight:700}td b{display:inline-block;min-width:50px;padding:3px 8px;border-radius:8px;background:rgba(255,255,255,.08)}
.bawah{display:flex;justify-content:flex-end;align-items:center;height:60px;padding:0 40px;color:#a0a0ad;font-size:15px}
</style></head><body>
<div class="atas"><div class="merek"><img src="${asal}/ikon/logo.png" alt="">JAGAL <i>VFC</i></div>
  <div class="judul"><b>REKAP MINGGUAN</b><span>${e(labelMinggu(minggu))}</span></div></div>
<div class="kpi"><div><b>${r.main}</b><span>Laga</span></div><div class="m"><b>${r.m}</b><span>Menang</span></div>
  <div class="s"><b>${r.s}</b><span>Seri</span></div><div class="k"><b>${r.k}</b><span>Kalah</span></div>
  <div><b>${r.gol}–${r.kemasukan}</b><span>Gol · Win ${winRate}%</span></div></div>
<div class="award">${penghargaan.map(([judul, p, teks, syarat]) => `<div><span>${judul}</span>${p && syarat(p) ? `<b>${e(p.nama)}</b><i>${e(teks(p))}</i>` : '<b>–</b>'}</div>`).join('')}</div>
<h2>Hasil Laga${d.laga.length > 12 ? ` (12 terakhir dari ${d.laga.length})` : ''}</h2>${baris}
<div class="jarak"></div>
<table><thead><tr><th>Pemain</th><th>Main</th><th>Gol</th><th>Assist</th><th>MOTM</th><th>Rating rata-rata</th></tr></thead><tbody>
${d.pemain.slice(0, 12).map((p) => `<tr><td class="nama">${e(p.nama)}</td><td>${p.main}</td><td>${p.gol}</td><td>${p.assist}</td><td>${p.motm || '–'}</td><td><b>${p.rating.toFixed(1)}</b></td></tr>`).join('')}
</tbody></table>
<div class="bawah">jagal.fun</div>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
