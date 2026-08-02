/**
 * Category Fixed override action fences (DECISIONS #376 / #381 critic P1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';

const userId = vi.hoisted(() => ({ current: 'user-test-fixed' }));

vi.mock('@/server/authz', () => ({
  requireUserId: async () => userId.current,
  auditLog: async () => undefined,
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

import { setCategoryFixed } from '@/server/category-fixed-actions';

describe('setCategoryFixed', () => {
  beforeEach(() => {
    userId.current = 'user-test-fixed';
  });

  it('test_regression__set_category_fixed_refuses_shared_demo', async () => {
    userId.current = DEMO_USER_ID;
    const res = await setCategoryFixed('dining', true);
    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
  });
});
