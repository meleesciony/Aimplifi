/**
 * Doc Extractor v1 engine (AI plan §3.3 reshaped, DECISIONS #247). Acceptance
 * criteria as assertions; expected values hand-verified in EDGE_CASES.md
 * §Doc Extractor. The abstention tests are the majority ON PURPOSE (lesson:
 * context-carrying features are judged by what they abstain on) — every
 * ambiguity must resolve to "human types it", never a plausible wrong prefill.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStatementExtractPrompt,
  EXTRACT_FIELD_IDS,
  groundStatementExtract,
  type LlmFieldSpan,
  parseLlmStatementExtract,
  scrubAccountNumbers,
} from '@/lib/engine/doc-extract/statement';
import { parseManualStatement } from '@/lib/engine/cards/manual-statement';

/** Shorthand: one span claim at 0.9 confidence (9000 bps). */
function span(field: LlmFieldSpan['field'], sourceSpan: string): LlmFieldSpan {
  return { field, sourceSpan, confidenceBps: 9000 };
}

/** Ground one span against a text that contains it verbatim. */
function groundOne(field: LlmFieldSpan['field'], sourceSpan: string) {
  return groundStatementExtract(`prefix\n${sourceSpan}\nsuffix`, [span(field, sourceSpan)]);
}

describe('scrubAccountNumbers', () => {
  it('masks a space-grouped 16-digit card number', () => {
    expect(scrubAccountNumbers('Account number: 4400 1234 5678 9010')).toBe(
      'Account number: [removed]',
    );
  });
  it('masks a dash-separated phone number (11 digits)', () => {
    expect(scrubAccountNumbers('Call 1-800-555-0199 with questions')).toBe(
      'Call [removed] with questions',
    );
  });
  it('masks a bare 9-digit run but keeps an 8-digit run', () => {
    expect(scrubAccountNumbers('ref 123456789')).toBe('ref [removed]');
    expect(scrubAccountNumbers('ref 12345678')).toBe('ref 12345678');
  });
  it('masks double-spaced columnar and line-wrapped card numbers (critic cycle-1 P1-2)', () => {
    expect(scrubAccountNumbers('Acct  4400  1234  5678  9010')).toBe('Acct  [removed]');
    expect(scrubAccountNumbers('Acct 4400 1234\n5678 9010 end')).toBe('Acct [removed] end');
    expect(scrubAccountNumbers('Acct 4400 1234\r\n5678 9010 end')).toBe('Acct [removed] end');
  });
  it('preserves date ranges — the slash and the 3-char " - " gap break the run', () => {
    const s = 'Statement period: 06/15/2026 - 07/14/2026';
    expect(scrubAccountNumbers(s)).toBe(s);
  });
  it('preserves money — comma and dot break the run', () => {
    const s = 'New balance $1,234.56';
    expect(scrubAccountNumbers(s)).toBe(s);
  });
});

describe('parseLlmStatementExtract', () => {
  it('accepts a valid claim and converts confidence to bps', () => {
    const out = parseLlmStatementExtract({
      fields: [{ field: 'statementBalance', sourceSpan: 'New balance $1,234.56', confidence: 0.98 }],
    });
    expect(out).toEqual([
      { field: 'statementBalance', sourceSpan: 'New balance $1,234.56', confidenceBps: 9800 },
    ]);
  });
  it('caps confidence 1.0 at 9900 bps — 10000 is reserved for a human', () => {
    const out = parseLlmStatementExtract({
      fields: [{ field: 'dueDate', sourceSpan: 'Due 08/10/2026', confidence: 1 }],
    });
    expect(out?.[0]?.confidenceBps).toBe(9900);
  });
  it('returns [] for an honestly-empty reply', () => {
    expect(parseLlmStatementExtract({ fields: [] })).toEqual([]);
  });
  it('rejects non-objects and missing/non-array fields', () => {
    expect(parseLlmStatementExtract(null)).toBeNull();
    expect(parseLlmStatementExtract('{"fields":[]}')).toBeNull();
    expect(parseLlmStatementExtract({})).toBeNull();
    expect(parseLlmStatementExtract({ fields: {} })).toBeNull();
  });
  it('rejects a reply whose every claim is invalid (guardrail, not empty)', () => {
    expect(
      parseLlmStatementExtract({
        fields: [{ field: 'previousBalance', sourceSpan: '$980.11', confidence: 0.9 }],
      }),
    ).toBeNull();
  });
  it('drops a malformed claim but keeps valid siblings', () => {
    const out = parseLlmStatementExtract({
      fields: [
        { field: 'minimumPayment', sourceSpan: 'Minimum payment due $35.00', confidence: 0.95 },
        { field: 'apr', sourceSpan: 'APR 24.99%', confidence: '0.9' }, // string confidence
        { field: 'apr' }, // no span
      ],
    });
    expect(out?.map((f) => f.field)).toEqual(['minimumPayment']);
  });
  it('drops a field claimed twice ENTIRELY — conflicting claims abstain', () => {
    const out = parseLlmStatementExtract({
      fields: [
        { field: 'statementBalance', sourceSpan: 'New balance $1,234.56', confidence: 0.9 },
        { field: 'statementBalance', sourceSpan: 'Previous balance $980.11', confidence: 0.8 },
        { field: 'dueDate', sourceSpan: 'Due 08/10/2026', confidence: 0.9 },
      ],
    });
    expect(out?.map((f) => f.field)).toEqual(['dueDate']);
  });
  it('drops empty, whitespace-only, and overlong spans', () => {
    const long = 'x'.repeat(161);
    const out = parseLlmStatementExtract({
      fields: [
        { field: 'apr', sourceSpan: '', confidence: 0.9 },
        { field: 'dueDate', sourceSpan: '   ', confidence: 0.9 },
        { field: 'cycleEnd', sourceSpan: long, confidence: 0.9 },
        { field: 'minimumPayment', sourceSpan: 'Min $35.00', confidence: 0.9 },
      ],
    });
    expect(out?.map((f) => f.field)).toEqual(['minimumPayment']);
  });
  it('drops a label-free span — a bare number gives the reviewer nothing to check the labeling against', () => {
    const out = parseLlmStatementExtract({
      fields: [
        { field: 'statementBalance', sourceSpan: '$980.11', confidence: 0.98 },
        { field: 'dueDate', sourceSpan: '08/10/2026', confidence: 0.9 },
        { field: 'minimumPayment', sourceSpan: 'Minimum payment due $35.00', confidence: 0.9 },
      ],
    });
    expect(out?.map((f) => f.field)).toEqual(['minimumPayment']);
  });
  it('rejects out-of-range and non-finite confidence', () => {
    for (const confidence of [-0.1, 1.1, NaN, Infinity]) {
      expect(
        parseLlmStatementExtract({
          fields: [{ field: 'apr', sourceSpan: 'APR 24.99%', confidence }],
        }),
      ).toBeNull();
    }
  });
});

describe('grounding: span must literally exist in the text the model saw', () => {
  it('abstains when the span is not in the text', () => {
    const out = groundStatementExtract('totally different text', [
      span('statementBalance', 'New balance $1,234.56'),
    ]);
    expect(out.fields).toEqual([]);
    expect(out.abstained).toEqual(['statementBalance']);
  });
  it('abstains on a case mismatch — verbatim means verbatim', () => {
    const out = groundStatementExtract('NEW BALANCE $1,234.56', [
      span('statementBalance', 'New Balance $1,234.56'),
    ]);
    expect(out.abstained).toEqual(['statementBalance']);
  });
});

describe('money derivation (statementBalance / minimumPayment)', () => {
  it('derives from a single $-token: $1,234.56 → "1234.56"', () => {
    const out = groundOne('statementBalance', 'New balance               $1,234.56');
    expect(out.fields).toEqual([
      {
        field: 'statementBalance',
        sourceSpan: 'New balance               $1,234.56',
        confidenceBps: 9000,
        value: '1234.56',
      },
    ]);
  });
  it('a date in the span cannot shadow the $-token', () => {
    const out = groundOne('statementBalance', 'New balance as of 07/14/2026: $1,234.56');
    expect(out.fields[0]?.value).toBe('1234.56');
  });
  it('accepts a whole-dollar $-token: $1,234 → "1234"', () => {
    expect(groundOne('statementBalance', 'Balance $1,234').fields[0]?.value).toBe('1234');
  });
  it('accepts a single bare 2-decimal token: "Minimum payment due 35.00"', () => {
    expect(groundOne('minimumPayment', 'Minimum payment due 35.00').fields[0]?.value).toBe('35.00');
  });
  it('abstains on two $-tokens — which one is the field?', () => {
    expect(groundOne('minimumPayment', 'Pay $35.00 of $1,234.56').abstained).toEqual([
      'minimumPayment',
    ]);
  });
  it('abstains on a bare integer — too easily a date fragment or count', () => {
    expect(groundOne('minimumPayment', 'Minimum payment due 35').abstained).toEqual([
      'minimumPayment',
    ]);
  });
  it('abstains on the recognized negative forms — hyphen, unicode minus, parentheses, CR (critic cycle-1 P1-3)', () => {
    for (const s of [
      'New balance -$45.00',
      'New balance $-45.00',
      'New balance -45.00',
      'New balance −$45.00', // unicode minus (Chase prints this)
      'New balance ($45.00)', // accounting parentheses
      'New balance ( $45.00 )',
      'New balance $45.00 CR', // credit suffix
      'New balance $45.00 credit',
      'Amount due 45.00-', // trailing minus, ledger style (cycle-2 NEW-1)
      'New balance $45.00−', // trailing unicode minus
      'CR $45.00', // CR word immediately before the token
      'CREDIT: $45.00',
    ]) {
      expect(groundOne('statementBalance', s).abstained, s).toEqual(['statementBalance']);
    }
  });
  it('abstains when a $-token and a distinct bare token coexist — cross-tier ambiguity (critic cycle-1 P2-1)', () => {
    expect(groundOne('minimumPayment', 'Pay 35.00 toward $1,234.56').abstained).toEqual([
      'minimumPayment',
    ]);
  });
  it('a bare token INSIDE the $-token is the same candidate, not ambiguity ("$ 35.00")', () => {
    expect(groundOne('minimumPayment', 'Minimum due $ 35.00').fields[0]?.value).toBe('35.00');
  });
  it('abstains on malformed money instead of deriving a truncation (critic cycle-1 P2-1)', () => {
    expect(groundOne('statementBalance', 'Balance $1,234.567').abstained).toEqual([
      'statementBalance',
    ]);
    expect(groundOne('statementBalance', 'Balance $1.234,56').abstained).toEqual([
      'statementBalance',
    ]);
  });
});

describe('date derivation (dueDate; cycleEnd shares the base rule)', () => {
  it('US slash date: 08/10/2026 → 2026-08-10', () => {
    expect(groundOne('dueDate', 'Payment due date          08/10/2026').fields[0]?.value).toBe(
      '2026-08-10',
    );
  });
  it('ISO date passes through', () => {
    expect(groundOne('dueDate', 'Payment due 2026-08-10').fields[0]?.value).toBe('2026-08-10');
  });
  it('month-name dates, full and abbreviated with ordinal', () => {
    expect(groundOne('dueDate', 'Due July 14, 2026').fields[0]?.value).toBe('2026-07-14');
    expect(groundOne('dueDate', 'Due Jul. 14th, 2026').fields[0]?.value).toBe('2026-07-14');
  });
  it('abstains on a two-digit year — ambiguous century, no pivot guessing', () => {
    expect(groundOne('dueDate', 'Due 08/10/26').abstained).toEqual(['dueDate']);
  });
  it('abstains on a non-calendar date (02/30/2026)', () => {
    expect(groundOne('dueDate', 'Due 02/30/2026').abstained).toEqual(['dueDate']);
  });
  it('abstains when the span holds two dates — dueDate has no range rule', () => {
    expect(groundOne('dueDate', 'Period 06/15/2026 - 07/14/2026').abstained).toEqual(['dueDate']);
  });
});

describe('cycleEnd range rule — a period range END is deterministic', () => {
  it('"06/15/2026 - 07/14/2026" → the later date 2026-07-14', () => {
    expect(
      groundOne('cycleEnd', 'Statement period: 06/15/2026 - 07/14/2026').fields[0]?.value,
    ).toBe('2026-07-14');
  });
  it('"to" joins a range the same way', () => {
    expect(groundOne('cycleEnd', 'Period 06/15/2026 to 07/14/2026').fields[0]?.value).toBe(
      '2026-07-14',
    );
  });
  it('a single date still works (exactly-one rule)', () => {
    expect(groundOne('cycleEnd', 'Closing date: 07/14/2026').fields[0]?.value).toBe('2026-07-14');
  });
  it('abstains when the two dates are NOT joined by a range separator', () => {
    expect(groundOne('cycleEnd', 'Closed 07/14/2026 (prev 06/15/2026)').abstained).toEqual([
      'cycleEnd',
    ]);
  });
  it('abstains on a reversed range — not a period', () => {
    expect(groundOne('cycleEnd', 'Period 07/14/2026 - 06/15/2026').abstained).toEqual(['cycleEnd']);
  });
  it('abstains on three dates even with separators', () => {
    expect(
      groundOne('cycleEnd', '06/15/2026 - 07/14/2026 - 08/10/2026').abstained,
    ).toEqual(['cycleEnd']);
  });
});

describe('APR derivation', () => {
  it('a single percent token: "Purchase APR 24.99%" → "24.99"', () => {
    expect(groundOne('apr', 'Purchase APR                 24.99%').fields[0]?.value).toBe('24.99');
  });
  it('a 0.00% promo APR is a real value, not an abstention', () => {
    expect(groundOne('apr', 'Intro APR 0.00%').fields[0]?.value).toBe('0.00');
  });
  it('abstains on a bare number without % — too easily a money figure', () => {
    expect(groundOne('apr', 'Purchase APR 24.99').abstained).toEqual(['apr']);
  });
  it('abstains on two percent tokens', () => {
    expect(groundOne('apr', 'APR 24.99% (was 22.99%)').abstained).toEqual(['apr']);
  });
});

describe('end-to-end: realistic statement → grounded → parseManualStatement', () => {
  // Hand-verified (EDGE_CASES §Doc Extractor): balance 123456¢, minimum 3500¢,
  // close 2026-07-14 (range end), due 2026-08-10, APR 2499 bps,
  // cycleStart = addMonthsClamped(2026-07-14, -1) = 2026-06-14,
  // cycleCloseDayOfMonth 14, dueDayOfMonth 10.
  const STATEMENT_TEXT = [
    'AIMPLIFI BANK                    Account number: 4400 1234 5678 9010',
    'Statement period: 06/15/2026 - 07/14/2026',
    '',
    'Summary of account activity',
    'Previous balance            $980.11',
    'Payments                   -$980.11',
    'New balance               $1,234.56',
    'Minimum payment due          $35.00',
    'Payment due date          08/10/2026',
    '',
    'Interest charge calculation',
    'Purchase APR                 24.99%',
  ].join('\n');

  it('the account number is scrubbed before the model ever sees the text', () => {
    const scrubbed = scrubAccountNumbers(STATEMENT_TEXT);
    expect(scrubbed).not.toContain('4400 1234 5678 9010');
    expect(scrubbed).toContain('Account number: [removed]');
    // Everything the extractor needs survives scrubbing:
    for (const kept of ['$1,234.56', '$35.00', '06/15/2026 - 07/14/2026', '08/10/2026', '24.99%']) {
      expect(scrubbed).toContain(kept);
    }
  });

  it('grounds all five fields and the values pass the manual-statement gate', () => {
    const scrubbed = scrubAccountNumbers(STATEMENT_TEXT);
    const reply = parseLlmStatementExtract({
      fields: [
        { field: 'statementBalance', sourceSpan: 'New balance               $1,234.56', confidence: 0.98 },
        { field: 'minimumPayment', sourceSpan: 'Minimum payment due          $35.00', confidence: 0.97 },
        { field: 'cycleEnd', sourceSpan: 'Statement period: 06/15/2026 - 07/14/2026', confidence: 0.95 },
        { field: 'dueDate', sourceSpan: 'Payment due date          08/10/2026', confidence: 0.96 },
        { field: 'apr', sourceSpan: 'Purchase APR                 24.99%', confidence: 0.9 },
      ],
    });
    expect(reply).not.toBeNull();
    const grounded = groundStatementExtract(scrubbed, reply as LlmFieldSpan[]);
    expect(grounded.abstained).toEqual([]);
    const byField = Object.fromEntries(grounded.fields.map((f) => [f.field, f.value]));
    expect(byField).toEqual({
      statementBalance: '1234.56',
      minimumPayment: '35.00',
      cycleEnd: '2026-07-14',
      dueDate: '2026-08-10',
      apr: '24.99',
    });

    // The byte-identical gate the human's save runs:
    const parsed = parseManualStatement({
      statementBalance: byField.statementBalance,
      minimumPayment: byField.minimumPayment,
      cycleEnd: byField.cycleEnd,
      dueDate: byField.dueDate,
      apr: byField.apr,
    });
    expect(parsed).toEqual({
      ok: true,
      statement: {
        statementBalanceCents: 123456,
        minimumPaymentCents: 3500,
        cycleStart: '2026-06-14',
        cycleEnd: '2026-07-14',
        dueDate: '2026-08-10',
        aprBps: 2499,
        cycleCloseDayOfMonth: 14,
        dueDayOfMonth: 10,
        autopay: null,
      },
    });
  });

  it('a span quoting the UNSCRUBBED account number cannot ground', () => {
    const scrubbed = scrubAccountNumbers(STATEMENT_TEXT);
    const out = groundStatementExtract(scrubbed, [
      span('statementBalance', 'Account number: 4400 1234 5678 9010'),
    ]);
    expect(out.abstained).toEqual(['statementBalance']);
  });
});

describe('prompt', () => {
  it('is deterministic, carries the contract, and embeds the scrubbed text', () => {
    const p = buildStatementExtractPrompt('SCRUBBED TEXT HERE');
    expect(p).toBe(buildStatementExtractPrompt('SCRUBBED TEXT HERE'));
    expect(p).toContain('"sourceSpan"');
    expect(p).toContain('Do not compute, reformat, or paraphrase');
    expect(p).toContain('ONLY a JSON object');
    expect(p.endsWith('SCRUBBED TEXT HERE')).toBe(true);
    for (const id of EXTRACT_FIELD_IDS) expect(p).toContain(id);
  });
});
