import { describe, expect, it } from 'vitest';
import { actToSat, calcProfileScore, type ScoreInput } from '../lib/utils';
import {
  activityProfileBoost,
  activitySignalFromActivities,
  applyActivityProbabilityBoost,
  normalizeRecommendationGPA,
} from '../lib/recommendation-helpers';

function profile(overrides: Partial<ScoreInput>): ScoreInput {
  return {
    gpa: 0,
    gpa_scale: '4.0',
    sat: 0,
    act: 0,
    ap_offered: 0,
    ap_taken: 0,
    ec_tier: 4,
    leadership_roles: 0,
    major_multiplier: 1,
    is_ed: false,
    is_athlete: false,
    is_legacy: false,
    ...overrides,
  };
}

describe('profile strength score', () => {
  it('smooths the top academic score cliff for weak-EC profiles', () => {
    const score1560 = calcProfileScore(profile({ gpa: 4.0, sat: 1560 })).finalScore;
    const score1570 = calcProfileScore(profile({ gpa: 4.0, sat: 1570 })).finalScore;

    expect(score1560).toBeGreaterThanOrEqual(95);
    expect(score1560).toBeLessThan(99);
    expect(score1570 - score1560).toBeLessThanOrEqual(3);
  });

  it('does not let elite ECs fully erase weak academics', () => {
    const score = calcProfileScore(profile({
      gpa: 3.2,
      sat: 1200,
      ec_tier: 1,
      leadership_roles: 5,
    })).finalScore;

    expect(score).toBeLessThanOrEqual(82);
  });

  it('caps EC-dominant profiles with moderate academics below elite', () => {
    const score = calcProfileScore(profile({
      gpa: 3.7,
      sat: 1400,
      ec_tier: 1,
      leadership_roles: 5,
    })).finalScore;

    expect(score).toBeLessThanOrEqual(92);
  });
});

describe('recommendation normalization helpers', () => {
  it('uses the saved GPA scale before falling back to weighted detection', () => {
    expect(normalizeRecommendationGPA(4.0, '5.0')).toEqual({ gpa: 3.2, wasNormalized: true });
    expect(normalizeRecommendationGPA(4.0, '4.0')).toEqual({ gpa: 4.0, wasNormalized: false });
    expect(normalizeRecommendationGPA(4.6, null)).toEqual({ gpa: 3.7, wasNormalized: true });
  });

  it('uses the same ACT concordance table everywhere', () => {
    expect(actToSat(36)).toBe(1600);
    expect(actToSat(34)).toBe(1500);
    expect(actToSat(30)).toBe(1360);
  });

  it('derives a bounded activity signal from real activities', () => {
    const strongSignal = activitySignalFromActivities([
      { name: 'Robotics', category: 'leadership', role: 'Captain', hours_per_week: 20, start_grade: 9, end_grade: 12, is_current: true },
      { name: 'Research', category: 'academic', role: 'Lead', hours_per_week: 12, start_grade: 10, end_grade: 12, is_current: true },
      { name: 'Tutoring', category: 'community', role: 'Founder', hours_per_week: 8, start_grade: 10, end_grade: 12, is_current: true },
    ]);
    const lightSignal = activitySignalFromActivities([
      { name: 'Club', category: 'other', role: 'Member', hours_per_week: 1, start_grade: 12, end_grade: 12, is_current: true },
    ]);

    expect(strongSignal).toBeGreaterThan(0.85);
    expect(lightSignal).toBeLessThan(0.4);
  });

  it('converts activity signal into fit-score points and probability nudges', () => {
    expect(activityProfileBoost(0.9, 0, true).points).toBe(6);
    expect(activityProfileBoost(0, 88, false).points).toBe(1);
    expect(applyActivityProbabilityBoost(0.3, 20, 0.9)).toBeGreaterThan(0.3);
    expect(applyActivityProbabilityBoost(0.3, 20, 0.3)).toBe(0.3);
  });
});
