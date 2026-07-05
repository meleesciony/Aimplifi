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
import { MESSY_MERCHANTS } from './messy-corpus';
import { NOVEL_CASES } from './categorize-benchmark-corpus';

// raw bank descriptor → the category a human would honestly assign. `null` label
// = genuinely ambiguous (the RIGHT answer is "send to review"), so it only counts
// toward the review-rate denominator, never as a wrong auto-file.
const CASES: { raw: string; label: string | null }[] = [
  // recognizable national brands (should auto-file correctly)
  { raw: 'STARBUCKS STORE 08321 ATLANTA', label: 'coffee' }, // #163 leaf precision: Starbucks = coffee shop
  { raw: 'NETFLIX.COM 866-579-7172', label: 'entertainment' },
  { raw: 'SHELL OIL 12345678 DECATUR GA', label: 'fuel' },
  { raw: 'AMZN Mktp US*A1B2C3', label: 'shopping' },
  { raw: 'UBER EATS 8005928996 CA', label: 'food-delivery' }, // leaf added #63; label updated Phase 3a
  { raw: 'CHICK-FIL-A #01776 ATLANTA', label: 'fast-food' }, // #163: counter-service chain
  { raw: 'KROGER #401 MARIETTA GA', label: 'groceries' },
  { raw: 'SPOTIFY USA NEW YORK NY', label: 'entertainment' },
  { raw: 'CVS/PHARMACY #08123', label: 'pharmacy' }, // #163: drugstores file to the pharmacy leaf
  // realistic merchants likely NOT in the table (novel → should mostly go to review)
  { raw: 'TST* THE OPTIMIST - ATLANTA', label: 'dining' },
  { raw: 'SQ *LITTLE TART BAKESHOP', label: 'dining' },
  { raw: 'PY *PIEDMONT DRY CLEANERS', label: 'personal-care' }, // #163: dry cleaning = personal care (Mint: Laundry)
  { raw: 'GUSTO PAYROLL 9X8Y7Z DIRECT DEP', label: 'paycheck' }, // #163: payroll = the paycheck leaf
  { raw: 'ADOBE *CREATIVE CLOUD 408-536', label: 'software' },
  { raw: 'GITHUB.COM HTTPSGITHUB CA', label: 'software' },
  { raw: 'PADDLE.NET* OBSIDIAN', label: 'software' }, // #163: Paddle processor prior
  { raw: 'GOOGLE *ONE g.co/helppay', label: 'software' }, // #161 owner-reported miss
  { raw: 'ROUND1 AM #0142 ATLANTA', label: 'entertainment' }, // #161 owner-reported miss (arcade)
  { raw: 'PLANET FIT 1234 MEMBERSHIP', label: 'fitness' },
  { raw: 'GEICO *AUTO 800-841-3000', label: 'auto-insurance' }, // #163: the *AUTO product line
  { raw: 'DELTA DENTAL OF GA PREMIUM', label: 'dental-insurance' }, // a premium is dental INSURANCE, not a dentist visit (DECISIONS #115)
  { raw: 'DOORDASH*WENDYS 855-973-1040', label: 'food-delivery' }, // leaf added #63; label updated Phase 3a
  { raw: 'PATREON* MEMBERSHIP', label: 'entertainment' },
  // utility/biller forms that trip naive parsers
  { raw: 'DUKE ENERGY EPAY 800-777-9898', label: 'electricity' }, // electric utility → the #154 electricity leaf
  { raw: 'GEORGIA POWER BILLMATRIX', label: 'electricity' }, // an electric power company → electricity, not generic utilities
  { raw: 'COMCAST / XFINITY 800266278', label: 'internet' }, // #163: cable ISP = internet leaf
  // money movement / fees / income (signed amounts matter less for label here)
  { raw: 'INTEREST EARNED', label: 'interest-income' }, // #163: precise income leaf
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

interface EvalCase { raw: string; label: string | null; amountCents?: number }

interface CorpusStats {
  name: string;
  total: number;
  review: number;
  autoCorrect: number;
  autoWrong: number;
  wrong: string[];
}

function runCorpus(name: string, cases: readonly EvalCase[], verbose: boolean): CorpusStats {
  let review = 0;
  let autoCorrect = 0;
  let autoWrong = 0;
  const wrong: string[] = [];
  const rows: string[] = [];

  for (const c of cases) {
    const amount = c.amountCents ?? -1234;
    const r = categorize({ rawDescriptor: c.raw, amountCents: amount, date: '2026-06-10', accountId: 'a' });
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
    rows.push(`  ${mark.padEnd(8)} ${r.categoryId.padEnd(15)} ${c.raw}`);
  }
  if (verbose) console.log(rows.join('\n'));
  return { name, total: cases.length, review, autoCorrect, autoWrong, wrong };
}

function report(s: CorpusStats) {
  const autoFiled = s.autoCorrect + s.autoWrong;
  console.log('─'.repeat(70));
  console.log(`[${s.name}]`);
  console.log(`  Total descriptors      : ${s.total}`);
  console.log(`  Sent to review (safe)  : ${s.review}  (${((s.review / s.total) * 100).toFixed(1)}%)`);
  console.log(`  Auto-filed             : ${autoFiled}`);
  console.log(`    • correct            : ${s.autoCorrect}`);
  console.log(`    • CONFIDENTLY WRONG  : ${s.autoWrong}   ← the real risk (a misfile the user may never notice)`);
  console.log(`  Auto-file precision    : ${autoFiled === 0 ? 'n/a' : ((s.autoCorrect / autoFiled) * 100).toFixed(1) + '%'}`);
  if (s.wrong.length) {
    console.log('  Confident misclassifications:');
    for (const w of s.wrong) console.log(`    ✗ ${w}`);
  }
}

function main() {
  const verbose = process.argv.includes('--verbose');

  // Corpus 2: every messy-corpus variant, scored against the INDEPENDENT
  // human label (deliberately not copied from KNOWN_MERCHANTS — table-vs-human
  // drift is measured, not hidden).
  const messyCases: EvalCase[] = MESSY_MERCHANTS.flatMap((m) =>
    m.variants.map((v) => ({
      raw: v,
      label: m.intended,
      amountCents: m.inflow ? m.amountCents[0] : -m.amountCents[0],
    })),
  );

  console.log('═'.repeat(70));
  console.log('CATEGORIZATION EVAL — three corpora, human-labeled ground truth');
  console.log('═'.repeat(70));
  const tuned = runCorpus('tuned regression (43 hand-labeled adversarial cases)', CASES, verbose);
  const messy = runCorpus('messy 60-day corpus (80 variants, independent labels)', messyCases, verbose);
  const novel = runCorpus(`NOVEL benchmark (${NOVEL_CASES.length} realistic feed descriptors incl. adversarial traps)`, NOVEL_CASES, verbose);
  for (const st of [tuned, messy, novel]) report(st);

  const total = tuned.total + messy.total + novel.total;
  const review = tuned.review + messy.review + novel.review;
  const correct = tuned.autoCorrect + messy.autoCorrect + novel.autoCorrect;
  const wrongN = tuned.autoWrong + messy.autoWrong + novel.autoWrong;
  const filed = correct + wrongN;
  console.log('═'.repeat(70));
  console.log(`OVERALL: ${total} descriptors | review ${review} (${((review / total) * 100).toFixed(1)}%) | auto-filed ${filed} | correct ${correct} | wrong ${wrongN} | precision ${filed === 0 ? 'n/a' : ((correct / filed) * 100).toFixed(1) + '%'}`);
  console.log('═'.repeat(70));
  console.log("Honest read: 'wrong' includes defensible taxonomy disagreements the");
  console.log('per-user learned rules (#161) personalize away (e.g. streaming =');
  console.log('entertainment vs subscriptions). Any brand-level misfile is a bug worth');
  console.log('a normalize-table fix + a regression test.');
  console.log('═'.repeat(70));
}

main();
