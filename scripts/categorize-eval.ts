/**
 * Adversarial categorization eval (`npm run eval:categorize`). The benchmark's
 * 1.91% review rate is measured on the CURATED seed (100% recognized merchants) —
 * optimistic. This stresses the categorizer with realistic, messy descriptors it
 * has NOT been tuned on, each labeled by hand (an INDEPENDENT ground truth, not
 * the circular merchant-table label), and reports honestly:
 *   • REVIEW      — the app deferred to the triage inbox (safe: the user sorts it)
 *   • AUTO ✓      — auto-filed and it matched the human label
 *   • AUTO ✗      — auto-filed CONFIDENTLY to the WRONG category (the real risk)
 *
 * It surfaces failures, not just successes — incl. the documented "DUKE ENERGY
 * EPAY" → transfer misfire (STATUS #11). Run it; the numbers are reproducible.
 */
import { categorize } from '../src/lib/engine/categorize/pipeline';

// raw bank descriptor → the category a human would honestly assign. `null` label
// = genuinely ambiguous (the RIGHT answer is "send to review"), so it only counts
// toward the review-rate denominator, never as a wrong auto-file.
const CASES: { raw: string; label: string | null }[] = [
  // recognizable national brands (should auto-file correctly)
  { raw: 'STARBUCKS STORE 08321 ATLANTA', label: 'dining' },
  { raw: 'NETFLIX.COM 866-579-7172', label: 'entertainment' },
  { raw: 'SHELL OIL 12345678 DECATUR GA', label: 'fuel' },
  { raw: 'AMZN Mktp US*A1B2C3', label: 'shopping' },
  { raw: 'UBER EATS 8005928996 CA', label: 'food-delivery' }, // leaf added #63; label updated Phase 3a
  { raw: 'CHICK-FIL-A #01776 ATLANTA', label: 'dining' },
  { raw: 'KROGER #401 MARIETTA GA', label: 'groceries' },
  { raw: 'SPOTIFY USA NEW YORK NY', label: 'entertainment' },
  { raw: 'CVS/PHARMACY #08123', label: 'health' },
  // realistic merchants likely NOT in the table (novel → should mostly go to review)
  { raw: 'TST* THE OPTIMIST - ATLANTA', label: 'dining' },
  { raw: 'SQ *LITTLE TART BAKESHOP', label: 'dining' },
  { raw: 'PY *PIEDMONT DRY CLEANERS', label: 'household' },
  { raw: 'GUSTO PAYROLL 9X8Y7Z DIRECT DEP', label: 'income' },
  { raw: 'ADOBE *CREATIVE CLOUD 408-536', label: 'software' },
  { raw: 'GITHUB.COM HTTPSGITHUB CA', label: 'software' },
  { raw: 'PADDLE.NET* OBSIDIAN', label: 'software' },
  { raw: 'PLANET FIT 1234 MEMBERSHIP', label: 'fitness' },
  { raw: 'GEICO *AUTO 800-841-3000', label: 'insurance' },
  { raw: 'DELTA DENTAL OF GA PREMIUM', label: 'dental-insurance' }, // a premium is dental INSURANCE, not a dentist visit (DECISIONS #115)
  { raw: 'DOORDASH*WENDYS 855-973-1040', label: 'food-delivery' }, // leaf added #63; label updated Phase 3a
  { raw: 'PATREON* MEMBERSHIP', label: 'entertainment' },
  // utility/biller forms that trip naive parsers
  { raw: 'DUKE ENERGY EPAY 800-777-9898', label: 'electricity' }, // electric utility → the #154 electricity leaf
  { raw: 'GEORGIA POWER BILLMATRIX', label: 'electricity' }, // an electric power company → electricity, not generic utilities
  { raw: 'COMCAST / XFINITY 800266278', label: 'utilities' },
  // money movement / fees / income (signed amounts matter less for label here)
  { raw: 'INTEREST EARNED', label: 'income' },
  { raw: 'OVERDRAFT FEE', label: 'fees' },
  { raw: 'ATM WITHDRAWAL 24 PEACHTREE', label: 'cash' },
  // "the category word is literally in the name" — the vocabulary tier (abbreviations,
  // space-stripped tokens, bare category words) should auto-file these deterministically
  { raw: 'GLF', label: 'entertainment' }, // abbreviation → golf
  { raw: 'ELECTRICITY', label: 'electricity' },
  { raw: 'ELEC PMT WEB', label: 'electricity' }, // ELEC→ELECTRIC, PMT→PAYMENT
  { raw: 'LIFEINSURANCE', label: 'life-insurance' }, // space-stripped; \bINSURANCE\b can't fire
  { raw: 'WATERBILL AUTOPAY', label: 'water' }, // de-concatenation → WATER BILL
  { raw: 'AUTOINSURANCE PREMIUM', label: 'auto-insurance' },
  { raw: 'SCE 800-655-4555', label: 'electricity' }, // utility acronym, no category word
  { raw: 'PG&E WEB ONLINE', label: 'electricity' },
  { raw: 'NORTHWESTERN MUTUAL', label: 'life-insurance' }, // life insurer brand
  { raw: 'WALMART.COM 8009256278', label: 'shopping' },
  // genuinely ambiguous — the correct behavior is "review", not a guess
  { raw: 'VENMO PAYMENT 1234567890', label: null },
  { raw: 'ZELLE TO ALEX 8675309', label: null },
  { raw: 'SQ *', label: null },
  { raw: 'RANGE', label: null }, // bare "range" is ambiguous (kitchen/gun/driving) → review is correct
];

function main() {
  let review = 0;
  let autoCorrect = 0;
  let autoWrong = 0;
  const wrong: string[] = [];
  const rows: string[] = [];

  for (const c of CASES) {
    const r = categorize({ rawDescriptor: c.raw, amountCents: -1234, date: '2026-06-10', accountId: 'a' });
    let mark: string;
    if (r.needsReview) {
      review++;
      mark = '· review';
    } else if (c.label === null) {
      // auto-filed something we called ambiguous — count it as a wrong commit
      autoWrong++;
      wrong.push(`${c.raw}  →  filed ${r.categoryId} (we said: ambiguous, should review)`);
      mark = 'AUTO ✗';
    } else if (r.categoryId === c.label) {
      autoCorrect++;
      mark = 'AUTO ✓';
    } else {
      autoWrong++;
      wrong.push(`${c.raw}  →  filed ${r.categoryId}  (human label: ${c.label})`);
      mark = 'AUTO ✗';
    }
    rows.push(`  ${mark.padEnd(8)} ${r.categoryId.padEnd(13)} ${c.raw}`);
  }

  const total = CASES.length;
  const autoFiled = autoCorrect + autoWrong;
  console.log('═'.repeat(70));
  console.log('CATEGORIZATION — adversarial eval on messy, mostly-NOVEL descriptors');
  console.log('═'.repeat(70));
  console.log(rows.join('\n'));
  console.log('─'.repeat(70));
  console.log(`Total descriptors      : ${total}`);
  console.log(`Sent to review (safe)  : ${review}  (${((review / total) * 100).toFixed(1)}%)   ← realistic review rate on messy data`);
  console.log(`Auto-filed             : ${autoFiled}`);
  console.log(`  • correct            : ${autoCorrect}`);
  console.log(`  • CONFIDENTLY WRONG  : ${autoWrong}   ← the real risk (a misfile the user may never notice)`);
  console.log(`Auto-file precision    : ${autoFiled === 0 ? 'n/a' : ((autoCorrect / autoFiled) * 100).toFixed(1) + '%'}   (when it commits, how often it's right)`);
  if (wrong.length) {
    console.log('\nConfident misclassifications to investigate:');
    for (const w of wrong) console.log(`  ✗ ${w}`);
  }
  console.log('═'.repeat(70));
  console.log('Honest read: the seed\'s 1.91% review rate reflects curated descriptors;');
  console.log('on novel real-world forms the app defers MORE to review (safe) — and any');
  console.log('AUTO ✗ above is a genuine bug worth a normalize-table fix + a regression test.');
  console.log('═'.repeat(70));
}

main();
