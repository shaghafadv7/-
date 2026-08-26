// اختبار دائم لاتجاه النص العربي داخل PDF — يمنع أي انعكاس/انعكاس مزدوج مستقبلاً
// يتحقق من مواضع الرسمات الفعلية (وليس النص المستخرج) على مستوى الكلمة والحرف
const fs = require('fs');
const { execSync } = require('child_process');
const { ArabicPDF, visualTokenOrder } = require('../lib/pdf');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };

(async () => {
  console.log('== 1) وحدة الترتيب البصري (لا انعكاس مزدوج) ==');
  ok(visualTokenOrder('سند بيع وحدة') === 'وحدة بيع سند', 'عكس ترتيب الكلمات مرة واحدة فقط');
  ok(visualTokenOrder('صفحة 1 من 4') === '4 من 1 صفحة', 'الأرقام جزر محفوظة الترتيب');
  ok(visualTokenOrder('مشروع Bayat Al-Akna 101 النزهة') === 'النزهة Bayat Al-Akna 101 مشروع', 'الجزر اللاتينية لا تنعكس داخليًا');
  ok(visualTokenOrder('BAYAT ALAKENA') === 'BAYAT ALAKENA', 'اللاتيني الصرف يبقى كما هو (صفر معالجة)');

  console.log('== 2) التحقق بمواضع الرسمات داخل PDF حقيقي ==');
  const p = new ArabicPDF({ settings: { company_name_ar: 'شركة بيات الأكنة', site_name: 'منصة الأكنة', phone_main: '0543537870', email: 'info@bayatalkenna.com' }, title: 'سند بيع وحدة', subtitle: 'مشروع Bayat Al-Akna 101 — الوحدة A-102', user: { name: 'مدير النظام' }, docNo: 'DOC-D1' });
  p.text('سند بيع وحدة', { size: 14, y: 150 });
  p.text('صفحة 1 من 4', { size: 12, y: 200 });
  p.text('مشروع Bayat Al-Akna 101 النزهة', { size: 12, y: 250 });
  fs.writeFileSync('/tmp/dirtest.pdf', await p.buffer());

  const trace = execSync('mutool draw -F trace /tmp/dirtest.pdf 2>/dev/null').toString();
  const rows = {};
  for (const m of trace.matchAll(/<g unicode="([^"]*)"[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"/g)) {
    const y = Math.round(+m[3] / 20) * 20;
    (rows[y] = rows[y] || []).push({ x: +m[2], ch: m[1] });
  }
  // متوسط موضع كلمة على سطر (بأحرفها المعروضة)
  const wordX = (yKey, word) => {
    const row = (rows[yKey] || []).slice().sort((a, b) => a.x - b.x);
    // نحول الكلمة لأحرفها المعروضة (معكوسة) ونبحث عن تتابع مطابق متجاور
    const chars = [...word];
    for (let i = 0; i + chars.length <= row.length; i++) {
      const seg = row.slice(i, i + chars.length);
      if (seg.every((g, k) => g.ch === chars[k])) {
        return seg.reduce((a, g) => a + g.x, 0) / seg.length;
      }
    }
    return null;
  };
  // سطر «سند بيع وحدة»: يتوقع بصريًا [وحدة][بيع][سند] يسار→يمين
  const yTitle = Object.keys(rows).find(y => wordX(+y, [...'ةدحو'].join('')) !== null && wordX(+y, [...'دنس'].join('')) !== null && wordX(+y, [...'عيب'].join('')) !== null);
  ok(!!yTitle, 'وُجد سطر «سند بيع وحدة» في المستند');
  if (yTitle) {
    const xSell = wordX(+yTitle, 'دنس');   // سند معروضة
    const xBay  = wordX(+yTitle, 'عيب');   // بيع معروضة
    const xUnit = wordX(+yTitle, 'ةدحو');  // وحدة معروضة
    ok(xSell > xBay && xBay > xUnit, `ترتيب الكلمات صحيح RTL: سند(${xSell?.toFixed(0)}) > بيع(${xBay?.toFixed(0)}) > وحدة(${xUnit?.toFixed(0)})`);
    // ترتيب الحروف داخل الكلمة: أول حرف منطقي (س) يجب أن يكون أقصى يمين كلمته
    const row = rows[+yTitle].slice().sort((a, b) => b.x - a.x);
    ok(row[0].ch === 'س', `أول حرف من «سند» هو الأقصى يمينًا (وجد: ${row[0].ch})`);
  }
  // «صفحة 1 من 4»: بصريًا [4][من][1][صفحة]
  const yPage = Object.keys(rows).find(y => wordX(+y, 'ةحفص') !== null);
  ok(!!yPage, 'وُجد سطر ترقيم الصفحة');
  if (yPage) {
    const row = rows[+yPage].slice().sort((a, b) => b.x - a.x); // يمين→يسار
    const seq = row.map(g => g.ch).join('').replace(/\s/g, '');
    ok(/صفحة1من\d+/.test(seq), `ترقيم الصفحة يُقرأ «صفحة i من N» بالترتيب الصحيح (وجد: ${(seq.match(/صفحة1من\d+/) || ['—'])[0]})`);
  }
  // المختلط: «مشروع» يجب أن تكون أقصى اليمين و«النزهة» أقصى اليسار
  const yMix = Object.keys(rows).find(y => wordX(+y, 'عورشم') !== null);
  ok(!!yMix, 'وُجد السطر المختلط');
  if (yMix) {
    const xMash = wordX(+yMix, 'عورشم');
    const xNazh = wordX(+yMix, 'ةهزنلا');
    ok(xMash > xNazh, `«مشروع» يمين «النزهة» في السطر المختلط (${xMash?.toFixed(0)} > ${xNazh?.toFixed(0)})`);
  }

  console.log(`\n===== الاتجاه: ${pass} نجح / ${fail} فشل =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
