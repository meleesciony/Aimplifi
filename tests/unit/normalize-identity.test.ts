/**
 * Merchant IDENTITY convergence (PULSE_CATEGORIZATION_FIX Phase 3a). The Phase-2
 * baseline measured 50 real merchants fragmenting into 63 pipeline identities —
 * processor prefixes defeating the ^-anchored table ('SQ *STARBUCKS'), brittle
 * suffix anchors ('TARGET T-'), domain forms ('HOMEDEPOT.COM'), and un-stripped
 * 'CITY ST' location suffixes. These lock the fixes: clean-second-chance matching,
 * the city/state strip (with its safety rules), pattern robustifications, the
 * Uber-Eats two-table category drift, and corpus-wide convergence with the
 * exceptions named explicitly (so drift in EITHER direction fails a test).
 */
import { describe, expect, it } from 'vitest';
import { cleanDescriptor, normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { MESSY_MERCHANTS } from '../../scripts/messy-corpus';

const canon = (raw: string) => normalizeMerchant(raw).canonical;

describe('variant convergence — one real merchant, one identity (Phase 3a)', () => {
  it('processor prefix no longer hides a known brand (clean-second-chance)', () => {
    const sq = normalizeMerchant('SQ *STARBUCKS #4471');
    const plain = normalizeMerchant('STARBUCKS 4471 SEATTLE WA');
    expect(sq.canonical).toBe('Starbucks');
    expect(sq).toMatchObject({ known: true, categoryId: 'coffee', confidenceBps: 9600 }); // #163: Starbucks = coffee
    expect(plain.canonical).toBe('Starbucks');
    expect(plain.categoryId).toBe(sq.categoryId); // no more review-vs-silent split
  });

  it('raw-first precedence: specific prefixed entries still win over the cleaned form', () => {
    expect(canon('SQ *BLUE BOTTLE #7')).toBe('Blue Bottle Coffee');
  });

  it('suffix/domain/sub-brand variants hit their widened entries', () => {
    // Target: T-store, bare store number, and .com
    expect(canon('TARGET T-1893 ATLANTA GAUS')).toBe('Target');
    expect(canon('TARGET 00028031 SEATTLE WA')).toBe('Target');
    expect(canon('TARGET.COM * 800-591-3869 MN')).toBe('Target');
    // Home Depot: THE-prefix and domain form
    expect(canon('HOME DEPOT #0121')).toBe('Home Depot');
    expect(canon('THE HOME DEPOT #4712 SEATTLE')).toBe('Home Depot');
    expect(canon('HOMEDEPOT.COM 800-430-3376 GA')).toBe('Home Depot');
    // Shell: OIL and SERVICE STATION forms
    expect(canon('SHELL OIL 57444298100 SEATTLE')).toBe('Shell');
    expect(canon('SHELL SERVICE STATION 4-49 WA')).toBe('Shell');
    // Uber: asterisk and phone forms
    expect(canon('UBER *TRIP HELP.UBER.COM')).toBe('Uber');
    expect(canon('UBER TRIP 8005928996 CA')).toBe('Uber');
    // Kroger sub-banner descriptor
    expect(canon('KROGER QFC 5847')).toBe('Kroger');
    expect(canon('KROGER #401 MARIETTA GA')).toBe('Kroger');
    // T-Mobile: PCS and autopay forms
    expect(canon('T-MOBILE PCS 08221')).toBe('T-Mobile');
    expect(canon('TMOBILE*AUTO PAY 800-937-8997')).toBe('T-Mobile');
  });

  it('Uber Eats drift resolved: both variants → one canonical AND one category', () => {
    const a = normalizeMerchant('UBER *EATS PENDING');
    const b = normalizeMerchant('UBER EATS 8005928996 CA');
    expect(a.canonical).toBe('Uber Eats');
    expect(b.canonical).toBe('Uber Eats');
    expect(a.categoryId).toBe('food-delivery');
    expect(b.categoryId).toBe('food-delivery'); // was dining-vs-food-delivery by variant
  });

  it('new national defaults: DoorDash/Grubhub/Safeway/Chipotle/Patreon', () => {
    expect(normalizeMerchant('DD *DOORDASH WENDYS')).toMatchObject({ canonical: 'DoorDash', categoryId: 'food-delivery' });
    expect(normalizeMerchant('DOORDASH*CHIPOTLE 855-973-1040 CA').canonical).toBe('DoorDash');
    expect(normalizeMerchant('GRUBHUB HOLDINGS').canonical).toBe('Grubhub');
    expect(canon('SAFEWAY #1647 SEATTLE WA')).toBe('Safeway');
    expect(canon('SAFEWAY STORE 00001647')).toBe('Safeway');
    expect(normalizeMerchant('CHIPOTLE 2831 ONLINE')).toMatchObject({ canonical: 'Chipotle', categoryId: 'fast-food' });
    expect(canon('CHIPOTLE ONLINE 1800244626 CA')).toBe('Chipotle');
    expect(normalizeMerchant('PATREON* MEMBERSHIP')).toMatchObject({ canonical: 'Patreon', categoryId: 'entertainment' });
  });

  it('Venmo is an AGGREGATE pseudo-merchant (P2P payees differ) — review, no rules', () => {
    const a = normalizeMerchant('VENMO PAYMENT 1029384756');
    const b = normalizeMerchant('VENMO *PAYMENT 855-812-4430');
    expect(a).toMatchObject({ canonical: 'Venmo', aggregate: true, confidenceBps: 4000 });
    expect(b.canonical).toBe('Venmo');
  });

  it('a municipal LIGHT bill is electricity, not a transfer (DUKE-ENERGY class, STATUS #11 / #154)', () => {
    // "City Light" is a municipal ELECTRIC utility; the split (#154) files it as
    // electricity while preserving the STATUS #11 fix (spend, not a transfer).
    expect(normalizeMerchant('CITY OF SEATTLE LIGHT EPAY')).toMatchObject({
      canonical: 'Electric Bill',
      categoryId: 'electricity',
    });
  });
});

describe('cleanDescriptor city/state strip — convergence with safety rails', () => {
  it('strips "CITY ST" when ≥2 name tokens remain', () => {
    expect(cleanDescriptor('SQ *SEAWOLF BAKERS SEATTLE WA')).toBe('Seawolf Bakers');
    expect(cleanDescriptor('SQ *SEAWOLF BAKERS')).toBe('Seawolf Bakers'); // converges
  });
  it('never eats a real name token: 2-token name + bare state keeps its name', () => {
    expect(cleanDescriptor('OLD NAVY CA')).toBe('Old Navy');
    expect(cleanDescriptor('UN BIEN BALLARD')).toBe('Un Bien Ballard'); // no state → no city strip
  });
  it('never strips into emptiness and ignores non-state tails', () => {
    expect(cleanDescriptor('WSDOT FERRY SEATTLE TERM')).toBe('Wsdot Ferry Seattle Term');
    expect(cleanDescriptor('WA')).toBe('Wa'); // bare state token = the whole name; keep it
  });
  it('scrubs interior processor asterisks', () => {
    expect(cleanDescriptor('VENMO *PAYMENT 855-812-4430')).toBe('Venmo Payment');
    expect(cleanDescriptor('PBP*SEATTLE PARKING 877-727-5457')).toBe('Pbp Seattle Parking');
  });
});

describe('messy-corpus convergence — every merchant one identity, exceptions NAMED', () => {
  // Real-world limits, each converging via trust-on-repeat instead (one tap per side):
  //   Kroger (QFC)       — cross-brand naming ('QFC #...' carries no KROGER token)
  //   Anchorhead Coffee  — feed typo variant ('COFFE')
  //   Walrus & Carpenter — feed truncation ('THE WALRUS AND THE CARPE')
  //   PayByPhone parking — brand abbreviation ('PBP*')
  // (Seattle City Light CONVERGES: both biller forms hit the 'Utility Bill' entry
  //  once LIGHT joined the utility-token list.)
  const EXPECTED_SPLIT = new Set([
    'Kroger (QFC)', 'Anchorhead Coffee', 'Walrus & Carpenter', 'PayByPhone parking',
  ]);

  it('canonical-set size is 1 for every corpus merchant outside the named exceptions', () => {
    const actualSplit: string[] = [];
    for (const m of MESSY_MERCHANTS) {
      const canonicals = new Set(m.variants.map((v) => normalizeMerchant(v).canonical));
      if (canonicals.size > 1) actualSplit.push(m.name);
    }
    expect(actualSplit.sort()).toEqual([...EXPECTED_SPLIT].sort());
  });
});
