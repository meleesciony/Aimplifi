import { describe, expect, it } from 'vitest';
import { checkCronBearer } from '@/lib/cron-auth';

describe('checkCronBearer (constant-time cron gate)', () => {
  it('accepts the exact Bearer secret', () => {
    expect(checkCronBearer('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('rejects a wrong, malformed, missing, or unset secret', () => {
    expect(checkCronBearer('Bearer wrong', 's3cret')).toBe(false);
    expect(checkCronBearer('s3cret', 's3cret')).toBe(false); // no "Bearer " prefix
    expect(checkCronBearer(null, 's3cret')).toBe(false);
    expect(checkCronBearer('Bearer s3cret', undefined)).toBe(false); // secret unset
    expect(checkCronBearer('Bearer s3cret', '')).toBe(false); // secret empty
  });
});
