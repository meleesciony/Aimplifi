import { KNOWN_MERCHANTS, normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
const bad: { canonical: string; re: string }[] = [];
for (const m of KNOWN_MERCHANTS) {
  const re = normalizeMerchant(m.canonical).canonical;
  if (re !== m.canonical) bad.push({ canonical: m.canonical, re });
}
console.log('KNOWN_MERCHANTS canonicals that do NOT round-trip through normalizeMerchant(canonical):');
for (const b of bad) console.log(`  "${b.canonical}" -> "${b.re}"`);
console.log('total:', bad.length, 'of', KNOWN_MERCHANTS.length);
