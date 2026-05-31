import { scoreActivityImpact, type Activity } from './profile-insights';

export function normalizeRecommendationGPA(rawGPA: number, gpaScale?: string | null): { gpa: number; wasNormalized: boolean } {
  if (rawGPA <= 0) return { gpa: 0, wasNormalized: false };

  if (gpaScale === '5.0') {
    return {
      gpa: Math.round(Math.min(rawGPA / 5.0, 1.0) * 4.0 * 100) / 100,
      wasNormalized: true,
    };
  }

  if (rawGPA <= 4.0) return { gpa: rawGPA, wasNormalized: false };

  const unweighted = Math.min(4.0, Math.max(2.0, rawGPA * 0.75 + 0.25));
  return { gpa: Math.round(unweighted * 100) / 100, wasNormalized: true };
}

export function activitySignalFromActivities(activities: Activity[]): number {
  if (activities.length === 0) return 0;
  const scores = activities
    .map(activity => scoreActivityImpact(activity).score)
    .sort((a, b) => b - a);
  const top = scores.slice(0, 3);
  const weighted = top.reduce((sum, score, index) => {
    const weight = index === 0 ? 0.5 : index === 1 ? 0.3 : 0.2;
    return sum + score * weight;
  }, 0);
  return Math.max(0, Math.min(1, weighted / 10));
}

export function activityProfileBoost(
  activitySignal: number,
  finalScore: number,
  hasActivitySignal: boolean,
): { points: number; reason: string | null } {
  if (hasActivitySignal) {
    if (activitySignal >= 0.85) return { points: 6, reason: 'High-impact activity profile' };
    if (activitySignal >= 0.70) return { points: 4, reason: 'Strong activity profile' };
    if (activitySignal >= 0.55) return { points: 2, reason: 'Solid activity profile' };
    return { points: 0, reason: null };
  }

  if (finalScore >= 85) return { points: 1, reason: 'Strong holistic profile' };
  return { points: 0, reason: null };
}

export function applyActivityProbabilityBoost(admitProb: number, acceptRate: number, activitySignal: number): number {
  if (activitySignal < 0.55) return admitProb;

  const maxMultiplier = acceptRate < 10 ? 1.04
    : acceptRate < 25 ? 1.06
    : acceptRate < 40 ? 1.05
    : acceptRate < 60 ? 1.03
    : 1.01;
  const strength = (activitySignal - 0.55) / 0.45;
  const multiplier = 1 + (maxMultiplier - 1) * Math.max(0, Math.min(1, strength));
  return Math.min(0.95, admitProb * multiplier);
}
