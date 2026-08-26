/**
 * Education goal preset — pinned to docs/EDGE_CASES.md §Education goal preset.
 */
import { describe, expect, it } from 'vitest';

import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  EDUCATION_CATEGORY_LABELS,
  EDUCATION_GOAL_PRESET,
  EDUCATION_GOAL_PRESET_ID,
  GIVING_GOAL_PRESET,
  GOAL_PRESET_IDS,
  GOAL_PRESETS,
  goalPresetFields,
} from '@/lib/engine/goals/presets';

describe('goalPresetFields — education (EDGE_CASES §Education goal preset)', () => {
  it('EP1: education fills the name only — no target, no monthly, no kind', () => {
    const fields = goalPresetFields(EDUCATION_GOAL_PRESET_ID);
    expect(fields).toEqual({ name: 'Education' });
    expect(fields).not.toHaveProperty('targetCents');
    expect(fields).not.toHaveProperty('monthlyContributionCents');
    expect(fields).not.toHaveProperty('kind');
    expect(fields).not.toHaveProperty('savedCents');
  });

  it('EP2: the id is `education` — no near-miss invents a name', () => {
    for (const id of ['college', '529', 'tuition', 'student-loan', 'school', '']) {
      expect(goalPresetFields(id), `"${id}" must not resolve`).toBeNull();
    }
  });

  it('EP3: the chip label is the taxonomy label and the string the form submits', () => {
    expect(EDUCATION_GOAL_PRESET.id).toBe('education');
    expect(EDUCATION_GOAL_PRESET.name).toBe(CATEGORY_BY_ID.get('education')?.name);
    expect(COACH_COPY.educationGoalPresetLabel()).toBe(EDUCATION_GOAL_PRESET.name);
    // The labels the hint names come from the taxonomy too, so copy cannot drift.
    expect(EDUCATION_CATEGORY_LABELS.tuition).toBe(CATEGORY_BY_ID.get('tuition')?.name);
    expect(EDUCATION_CATEGORY_LABELS.studentLoan).toBe(CATEGORY_BY_ID.get('student-loan')?.name);
  });

  it('EP4: the registry is unique, ordered, and fills exactly one field per preset', () => {
    expect(GOAL_PRESETS.map((p) => p.id)).toEqual(['giving', 'education']);
    expect(GOAL_PRESET_IDS).toEqual(['giving', 'education']);
    expect(new Set(GOAL_PRESETS.map((p) => p.id)).size).toBe(GOAL_PRESETS.length);
    for (const preset of GOAL_PRESETS) {
      const fields = goalPresetFields(preset.id);
      expect(Object.keys(fields ?? {}), preset.id).toEqual(['name']);
      expect(fields?.name.trim(), preset.id).toBeTruthy();
      expect(fields?.name, preset.id).toBe(preset.name);
    }
  });
});

describe('education goal preset copy', () => {
  it('test_regression__education_goal_preset_does_not_invent_an_amount', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).toMatch(/you type the dollars/i);
    expect(hint).not.toMatch(/\$\d/);
    expect(hint).not.toMatch(/\d%/);
    expect(hint).not.toMatch(/per (year|month|semester)/i);
    const fields = goalPresetFields('education')!;
    expect(Object.keys(fields).sort()).toEqual(['name']);
  });

  /**
   * The deepest constraint in this slice. /reports renders a GIVING figure
   * (#520) and renders NO education figure, so Giving's "a lens, not a grade"
   * clause here would describe a surface the app does not have.
   */
  it('test_regression__education_goal_preset_does_not_claim_a_reports_lens', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).not.toMatch(/lens, not a grade/i);
    expect(hint).not.toMatch(/so far this year/i);
    expect(hint).not.toMatch(/\bYTD\b/i);
    expect(hint).not.toMatch(/\breports?\b/i);
  });

  it('test_regression__education_goal_preset_names_the_student_loan_as_a_debt', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).toContain(EDUCATION_CATEGORY_LABELS.studentLoan);
    expect(hint).toMatch(/is a debt, not this envelope/i);
    // …and the loan is named to be excluded, never offered as an envelope.
    expect(goalPresetFields('student-loan')).toBeNull();
    expect(GOAL_PRESETS.some((p) => /loan/i.test(p.name))).toBe(false);
  });

  it('test_regression__education_goal_preset_gives_no_account_or_tax_advice', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).not.toMatch(/\b529\b/);
    expect(hint).not.toMatch(/\b(ESA|IRA|Coverdell|UTMA|UGMA)\b/);
    expect(hint).not.toMatch(/\btax(-|\s)?(free|advantaged|deferred|deduction)\b/i);
    expect(hint).not.toMatch(/\bscholarship|financial aid|FAFSA\b/i);
    expect(hint).not.toMatch(/\bshould\b/i);
  });

  it('test_regression__education_goal_preset_does_not_rank_against_retirement', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).not.toMatch(/\bretirement\b/i);
    expect(hint).not.toMatch(/\b(before|after|instead of|priorit\w*)\b/i);
    expect(hint).not.toMatch(/\bCoast\b/);
  });

  it('test_regression__education_goal_preset_names_what_the_envelope_pays', () => {
    const hint = COACH_COPY.educationGoalPresetHint();
    expect(hint).toContain(EDUCATION_CATEGORY_LABELS.education);
    expect(hint).toContain(EDUCATION_CATEGORY_LABELS.tuition);
  });
});

/**
 * EP5 — the registry grew in #522. #521 shipped a live production probe
 * (scripts/p21-live-deploy-check.mjs) that greps the Giving hint for four
 * exact phrases; a future edit that "tidies" the shared copy would break the
 * deploy proof with no local signal. This is that signal.
 */
describe('EP5 — growing the registry leaves the shipped Giving preset alone', () => {
  it('test_regression__adding_a_preset_does_not_change_the_giving_one', () => {
    expect(goalPresetFields('giving')).toEqual({ name: 'Giving' });
    expect(GIVING_GOAL_PRESET.name).toBe('Giving');
    expect(COACH_COPY.givingGoalPresetLabel()).toBe('Giving');

    const hint = COACH_COPY.givingGoalPresetHint();
    for (const phrase of [/Gifts/, /Charity & Donations/, /you type the dollars/i, /lens, not a grade/i]) {
      expect(hint, `the #521 live probe greps ${phrase}`).toMatch(phrase);
    }
    expect(hint).not.toMatch(/\b(tithe|10%|should give|generously|Coast)\b/i);
  });
});
