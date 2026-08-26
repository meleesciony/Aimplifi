/**
 * Giving goal preset — pinned to docs/EDGE_CASES.md §Giving goal preset.
 */
import { describe, expect, it } from 'vitest';

import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { GIVING_CATEGORY_LABELS } from '@/lib/engine/reports/giving-ytd';
import {
  GIVING_GOAL_PRESET,
  GIVING_GOAL_PRESET_ID,
  goalPresetFields,
} from '@/lib/engine/goals/presets';

describe('goalPresetFields (EDGE_CASES §Giving goal preset)', () => {
  it('GP1: giving fills the name only — no target, no monthly, no kind', () => {
    const fields = goalPresetFields(GIVING_GOAL_PRESET_ID);
    expect(fields).toEqual({ name: 'Giving' });
    expect(fields).not.toHaveProperty('targetCents');
    expect(fields).not.toHaveProperty('monthlyContributionCents');
    expect(fields).not.toHaveProperty('kind');
    expect(fields).not.toHaveProperty('savedCents');
  });

  it('GP2: an unknown id invents nothing', () => {
    expect(goalPresetFields('college')).toBeNull();
    expect(goalPresetFields('tithe')).toBeNull();
    expect(goalPresetFields('')).toBeNull();
  });

  it('GP3: the chip label is the same string the form would submit as name', () => {
    expect(GIVING_GOAL_PRESET.id).toBe('giving');
    expect(GIVING_GOAL_PRESET.name).toBe('Giving');
    expect(COACH_COPY.givingGoalPresetLabel()).toBe(GIVING_GOAL_PRESET.name);
  });
});

describe('giving goal preset copy', () => {
  it('test_regression__giving_goal_preset_does_not_invent_an_amount', () => {
    const hint = COACH_COPY.givingGoalPresetHint();
    expect(hint).toMatch(/you (type|pick) the (dollars|amount)/i);
    expect(hint).not.toMatch(/\$\d/);
    expect(hint).not.toMatch(/\b10%\b/);
    expect(hint).not.toMatch(/\btithe\b/i);
    expect(hint).not.toMatch(/should give/i);
    expect(hint).not.toMatch(/\bgenerously\b/i);
    expect(hint).not.toMatch(/\bCoast\b/i);
    const fields = goalPresetFields('giving')!;
    expect(Object.keys(fields).sort()).toEqual(['name']);
  });

  it('test_regression__giving_goal_preset_is_a_lens_not_a_grade', () => {
    const hint = COACH_COPY.givingGoalPresetHint();
    expect(hint).toMatch(/lens, not a grade/i);
    expect(hint).toContain(GIVING_CATEGORY_LABELS.gifts);
    expect(hint).toContain(GIVING_CATEGORY_LABELS.charity);
  });

  it('test_regression__giving_goal_preset_intro_does_not_claim_a_catalog', () => {
    expect(COACH_COPY.givingGoalPresetIntro()).not.toMatch(/presets?/i);
  });
});
