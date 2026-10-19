// 12in12.co otomatik içerik güncellemesi (Serhat, 19.10.2026: yeni Part ve uzun videolar yayınlandıkça haber vermeden güncelle).
//
// Kaynak: sosyal-orkestra kayıt dosyası (yalnız okunur). 12in12-youtube'da durumu "yayinda" ve post_id'si olan
// "Part N" ve "Uzun N" içerikleri siteye eklenir; Yakında ve Sırada listelerinden yayınlananlar düşer, planlananlar eklenir.
// Değişiklik varsa: kapak indir → index.html'deki JSON bloğunu yaz → vite derlemesi → commit → push (push = Netlify yayını).
// Kayıtta adı geçen girişim sitede yoksa (yeni şirket) o Part eklenmez; tanıtım metni gerektiği için bildirim verilir.
//
// Çalıştırma: node scripts/site-guncelle.mjs   (Windows görevi: 12in12-Site-Guncelle, saatte bir)
// Ortam: ORKESTRA_KAYIT=<kayıt yolu>  SITE_GONDER=0 (git pull/commit/push yok; test)  SITE_BILDIRIM_KAPALI=1
//        SITE_SIMDI=<ISO tarih> (test saati)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KAYIT = process.env.ORKESTRA_KAYIT || 'C:/Users/Serhat/Desktop/12in12/sosyal-orkestra/kayit/icerikler.json';
const GONDER = process.env.SITE_GONDER !== '0';
const SIMDI = process.env.SITE_SIMDI ? new Date(process.env.SITE_SIMDI) : new Date();
const HESAP = '12in12-youtube';
const KAPAK_BEKLEME_SA = 6; // dikey kapak hazır değilse bu kadar saat bekle, sonra YouTube kapağıyla ekle
const LOG_KLASOR = path.join(KOK, 'loglar');
const DURUM = path.join(LOG_KLASOR, 'site-guncelle-durum.json');
const SAYFA = path.join(KOK, 'index.html');
const JSON_BLOK = /(<script type="application\/json" id="icerik">\r?\n)([\s\S]*?)(\r?\n\s*<\/script>)/;

fs.mkdirSync(LOG_KLASOR, { recursive: true });
function log(m) {
  const satir = `${new Date().toISOString()} ${m}`;
  console.log(satir);
  fs.appendFileSync(path.join(LOG_KLASOR, 'site-guncelle.log'), satir + '\n');
}
const jsonOku = (y, v) => { try { return JSON.parse(fs.readFileSync(y, 'utf8')); } catch { return v; } };

// Windows bildirimi (sosyal-orkestra/scripts/bildirim.mjs ile aynı yöntem; metin ortam değişkeniyle geçer)
function bildir(baslik, metin) {
  if (process.env.SITE_BILDIRIM_KAPALI === '1') { log(`(bildirim) ${baslik} — ${metin}`); return; }
  const komut = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; " +
    "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); " +
    "$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode($env:BILDIRIM_BASLIK)) > $null; $x.Item(1).AppendChild($t.CreateTextNode($env:BILDIRIM_METIN)) > $null; " +
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))";
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut],
    { env: { ...process.env, BILDIRIM_BASLIK: baslik, BILDIRIM_METIN: String(metin).slice(0, 240) }, windowsHide: true });
}
// Aynı uyarıyı günde bir kez ver (saatlik görev her turda tekrarlamasın)
function gunlukUyari(anahtar, baslik, metin) {
  const d = jsonOku(DURUM, {});
  const gun = SIMDI.toISOString().slice(0, 10);
  if (d[anahtar] === gun) return;
  d[anahtar] = gun;
  fs.writeFileSync(DURUM, JSON.stringify(d, null, 2));
  bildir(baslik, metin);
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: KOK, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const norm = (s) => String(s).toLocaleLowerCase('tr').replace(/[^a-zçğıöşü0-9]/g, '');
const ilkBuyuk = (s) => s ? s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) : s;
function kisalt(s, n = 70) {
  if (s.length <= n) return s;
  const k = s.slice(0, n);
  return k.slice(0, k.lastIndexOf(' ') > 30 ? k.lastIndexOf(' ') : n).replace(/[\s,.:;—–-]+$/, '') + '…';
}

// Kayıttaki başlık: "12in12 · Part 14 (VetBrain: geliştirme)" | "12in12 · Uzun 01 · <başlık>"
function cozumle(ic) {
  const b = String(ic.baslik || '');
  const p = b.match(/Part\s+(\d+)\s*\(([^:)]+)(?::\s*([^)]+))?\)/i);
  if (p && /seri/i.test(ic.tur || '')) return { tip: 'part', no: Number(p[1]), girisim: p[2].trim(), alt: (p[3] || '').trim() };
  const u = b.match(/Uzun\s+(\d+)/i);
  if (u && /uzun video/i.test(ic.tur || '')) return { tip: 'uzun', no: Number(u[1]) };
  return null;
}

async function youtubeBaslik(id) {
  // oEmbed yalnız herkese açık (ya da liste dışı) videoda cevap verir; özel/işlenmemiş videoda hata → sonraki tura kalır
  const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  return (await r.json()).title || '';
}

function ffmpegYolu() {
  for (const aday of ['ffmpeg', 'C:/ffmpeg/bin/ffmpeg.exe']) {
    if (spawnSync(aday, ['-version'], { windowsHide: true }).status === 0) return aday;
  }
  return null;
}

// Dikey (Shorts) kapağı → public/img/v/<id>.webp (360x640). Başarılıysa yolu döner.
async function dikeyKapak(id) {
  const hedef = path.join(KOK, 'public', 'img', 'v', `${id}.webp`);
  if (fs.existsSync(hedef)) return hedef;
  const ff = ffmpegYolu();
  if (!ff) { log('ffmpeg bulunamadı; kapak indirilemedi'); return null; }
  const r = await fetch(`https://i.ytimg.com/vi/${id}/oar2.jpg`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 10000) return null;
  const gecici = path.join(LOG_KLASOR, `kapak-${id}.jpg`);
  fs.writeFileSync(gecici, buf);
  const s = spawnSync(ff, ['-v', 'error', '-y', '-i', gecici, '-vf', 'scale=360:640:force_original_aspect_ratio=increase,crop=360:640', '-q:v', '78', '-c:v', 'libwebp', hedef], { windowsHide: true });
  fs.rmSync(gecici, { force: true });
  return s.status === 0 && fs.existsSync(hedef) ? hedef : null;
}

async function main() {
  if (!fs.existsSync(KAYIT)) { log(`kayıt yok: ${KAYIT}`); return; }

  if (GONDER) {
    const durum = git('status', '--porcelain');
    if (!durum.ok) { log('git status hatası: ' + durum.err); return; }
    if (durum.out) {
      log('sitede commit edilmemiş değişiklik var; bu tur atlandı');
      gunlukUyari('kirli', '12in12.co otomatik güncelleme bekliyor', 'Site klasöründe gönderilmemiş elle değişiklik var. Commit edilince yeni videolar kendiliğinden eklenir.');
      return;
    }
    const cek = git('pull', '--ff-only', '-q');
    if (!cek.ok) { log('git pull olmadı (ağ ya da çakışma): ' + cek.err); return; }
    // Önceki turda gönderilemeyen commit varsa önce onu gönder
    const ileri = git('rev-list', '--count', 'origin/main..HEAD');
    if (ileri.ok && Number(ileri.out) > 0) {
      const p = git('push', '-q', 'origin', 'main');
      log(p.ok ? `bekleyen ${ileri.out} commit gönderildi` : 'bekleyen commit gönderilemedi: ' + p.err);
    }
  }

  const html = fs.readFileSync(SAYFA, 'utf8');
  const m = html.match(JSON_BLOK);
  if (!m) { log('index.html içinde içerik JSON bloğu bulunamadı'); return; }
  const eski = JSON.parse(m[2]);
  const ic = structuredClone(eski);
  ic.uzun ||= [];
  ic.sirada ||= [];

  const kayit = (jsonOku(KAYIT, {}).icerikler || []).filter((i) => i.marka === '12in12');
  const sitedekiPart = new Set(ic.girisimler.flatMap((g) => g.bolumler.map((b) => b.part)));
  const sitedekiUzun = new Set(ic.uzun.map((u) => u.no));
  const girisimBul = (ad) => ic.girisimler.find((g) => norm(g.ad).startsWith(norm(ad)) || norm(ad).startsWith(norm(g.ad)));
  const eklenen = [];
  const yeniKapaklar = [];

  // 1) Yayınlananları ekle (Part sırasıyla)
  const yayinda = kayit.map((i) => ({ i, c: cozumle(i), yt: (i.paylasimlar || []).find((p) => p.hesap === HESAP && p.durum === 'yayinda' && p.post_id) }))
    .filter((x) => x.c && x.yt)
    .sort((a, b) => (a.c.tip === b.c.tip ? a.c.no - b.c.no : a.c.tip === 'part' ? -1 : 1));
  for (const { c, yt } of yayinda) {
    const id = yt.post_id;
    if (c.tip === 'part' && sitedekiPart.has(c.no)) continue;
    if (c.tip === 'uzun' && sitedekiUzun.has(c.no)) continue;
    let baslik;
    try { baslik = await youtubeBaslik(id); } catch (e) { log(`YouTube'a ulaşılamadı (${e.message}); sonraki tura`); return; }
    if (baslik === null) { log(`${c.tip} ${c.no} (${id}) henüz herkese açık değil; sonraki tura`); continue; }

    if (c.tip === 'part') {
      const g = girisimBul(c.girisim);
      if (!g) {
        log(`Part ${c.no} "${c.girisim}" girişimine ait ama sitede bu girişim yok; eklenmedi`);
        gunlukUyari(`yeni-girisim-${c.no}`, '12in12.co: yeni girişim tanıtımı gerekiyor', `Part ${c.no} "${c.girisim}" için yayında ama sitede bu girişimin bölümü yok. Claude Code'dan ekletebilirsin.`);
        continue;
      }
      const kapak = await dikeyKapak(id).catch(() => null);
      const saat = (SIMDI - new Date(yt.ts || yt.guncelleme || SIMDI)) / 36e5;
      if (!kapak && saat < KAPAK_BEKLEME_SA) { log(`Part ${c.no} kapağı hazır değil; sonraki tura`); continue; }
      if (kapak) yeniKapaklar.push(kapak);
      const temiz = baslik.replace(/^.*?Part\s*\d+\s*[—–:-]\s*/i, '').split('|')[0].trim();
      const ad = kisalt(temiz && temiz !== baslik.trim() ? temiz : (c.alt ? ilkBuyuk(c.alt) : baslik));
      g.bolumler.push({ id, part: c.no, ad });
      g.bolumler.sort((a, b) => a.part - b.part);
      g.yakinda = (g.yakinda || []).filter((y) => y.part !== c.no);
      sitedekiPart.add(c.no);
      eklenen.push(`Part ${c.no}`);
    } else {
      ic.uzun.push({ id, no: c.no, ad: kisalt(baslik, 100) });
      ic.uzun.sort((a, b) => a.no - b.no);
      sitedekiUzun.add(c.no);
      eklenen.push(`Uzun ${String(c.no).padStart(2, '0')}`);
    }
  }

  // 2) Planlananları Yakında/Sırada'ya ekle, yayınlananları düşür
  const planli = kayit.map((i) => ({ c: cozumle(i), plan: (i.planlar || []).find((p) => p.hesap === HESAP && p.durum === 'planli') }))
    .filter((x) => x.c && x.plan)
    .sort((a, b) => String(a.plan.zaman).localeCompare(String(b.plan.zaman)));
  for (const { c } of planli) {
    if (c.tip !== 'part' || sitedekiPart.has(c.no)) continue;
    const g = girisimBul(c.girisim);
    if (!g) continue;
    g.yakinda ||= [];
    if (!g.yakinda.some((y) => y.part === c.no)) {
      g.yakinda.push({ part: c.no, ad: ilkBuyuk(c.alt || 'yeni bölüm') });
      g.yakinda.sort((a, b) => a.part - b.part);
    }
  }
  ic.sirada = ic.sirada.filter((s) => !(s.part && sitedekiPart.has(s.part)) && !(s.uzun && sitedekiUzun.has(s.uzun)));
  for (const { c } of planli) {
    // Sitede bölümü olmayan (henüz duyurulmamış) girişimin adı Sırada'ya yazılmaz
    if (c.tip === 'part' && girisimBul(c.girisim) && !sitedekiPart.has(c.no) && !ic.sirada.some((s) => s.part === c.no)) {
      ic.sirada.push({ kod: `PART ${c.no}`, baslik: c.alt ? `${c.girisim}: ${c.alt}` : `Part ${c.no}`, alt: '', part: c.no });
    }
    if (c.tip === 'uzun' && !sitedekiUzun.has(c.no) && !ic.sirada.some((s) => s.uzun === c.no)) {
      ic.sirada.push({ kod: `UZUN ${String(c.no).padStart(2, '0')}`, baslik: 'Yeni uzun video', alt: "YouTube'da, yatay ve uzun.", uzun: c.no });
    }
  }
  const sira = (s) => (s.sabit ? 3e6 : s.uzun ? 2e6 + s.uzun : s.part || 1e6);
  ic.sirada.sort((a, b) => sira(a) - sira(b));

  if (JSON.stringify(ic) === JSON.stringify(eski)) { log('değişiklik yok'); return; }

  // 3) Yaz, derlemeyle doğrula
  const yeniHtml = html.replace(JSON_BLOK, (_, a, __, c) => a + JSON.stringify(ic, null, 2) + c);
  JSON.parse(yeniHtml.match(JSON_BLOK)[2]);
  fs.writeFileSync(SAYFA, yeniHtml);
  const vite = path.join(KOK, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(vite)) {
    const d = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'error'], { cwd: KOK, encoding: 'utf8', windowsHide: true, timeout: 180000 });
    if (d.status !== 0) {
      fs.writeFileSync(SAYFA, html);
      yeniKapaklar.forEach((k) => fs.rmSync(k, { force: true }));
      log('derleme hatası, değişiklik geri alındı: ' + (d.stderr || d.stdout).slice(0, 500));
      gunlukUyari('derleme', '12in12.co otomatik güncelleme hatası', 'Derleme başarısız oldu; değişiklik geri alındı. Ayrıntı: loglar/site-guncelle.log');
      return;
    }
  }
  const ozet = eklenen.length ? `${eklenen.join(', ')} eklendi` : 'Yakında/Sırada listesi güncellendi';
  log(`değişti: ${ozet}`);
  if (!GONDER) return;

  // 4) Commit + push (= Netlify yayını)
  const ekle = git('add', 'index.html', ...yeniKapaklar.map((k) => path.relative(KOK, k).replaceAll('\\', '/')));
  const com = ekle.ok && git('commit', '-q', '-m', `Site: ${ozet} (otomatik)`, '-m', 'Kaynak: sosyal-orkestra kaydı · scripts/site-guncelle.mjs');
  if (!com || !com.ok) { log('commit olmadı: ' + (com ? com.err : ekle.err)); return; }
  const p = git('push', '-q', 'origin', 'main');
  if (!p.ok) { log('push olmadı, sonraki turda yeniden denenecek: ' + p.err); return; }
  log('gönderildi');
  if (eklenen.length) bildir('12in12.co güncellendi', `${ozet}. Netlify birkaç dakikada yayınlar.`);
}

main().catch((e) => { log('beklenmeyen hata: ' + (e.stack || e.message)); process.exitCode = 1; });
