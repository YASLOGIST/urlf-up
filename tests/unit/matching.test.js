import { describe, expect, it } from 'vitest';
import {
  calculateMatch,
  fuzzySkillScore,
  ideaProblem,
  rankIdeasForProfile,
  rankMatches,
} from '../../src/matchingEngine.js';

const idea = {
  id: 'idea-1',
  title: 'Cross-border liquidity rails',
  industry: 'FinTech',
  problem_statement:
    'Small exporters wait days for settlement and lose margin to correspondent banking fees.',
  required_skills: ['payments', 'risk', 'operations'],
};

const builder = {
  id: 'builder-1',
  full_name: 'Maya Builder',
  role_type: 'builder',
  skills: ['payment operations', 'risk modelling', 'react'],
  interests: ['fintech', 'marketplaces'],
  reputation: 34,
};

describe('matching engine', () => {
  it('reads both committed and legacy idea problem fields', () => {
    expect(ideaProblem({ problem_statement: 'schema field' })).toBe('schema field');
    expect(ideaProblem({ problem_solved: 'legacy field' })).toBe('legacy field');
  });

  it('scores fuzzy skill overlap instead of requiring exact string equality', () => {
    expect(fuzzySkillScore('payments', 'payment operations')).toBeGreaterThan(0.55);
    expect(fuzzySkillScore('risk', 'risk')).toBe(1);
    expect(fuzzySkillScore('hardware', 'community')).toBe(0);
  });

  it('returns an explainable, confidence-bearing match without throwing on sparse schema rows', () => {
    const match = calculateMatch(idea, builder);
    expect(match.isMatch).toBe(true);
    expect(match.matchScore).toBeGreaterThanOrEqual(70);
    expect(match.confidence).toBeGreaterThan(0.6);
    expect(match.synergies.join(' ')).toMatch(/Skills|Industry|Role/);
    expect(match.reasons[0]).toHaveProperty('note');
  });

  it('degrades sparse candidates to lower confidence rather than crashing', () => {
    const match = calculateMatch(idea, { id: 'thin-profile' });
    expect(match.matchScore).toBeGreaterThanOrEqual(0);
    expect(match.matchScore).toBeLessThan(60);
    expect(match.confidence).toBeLessThan(0.6);
  });

  it('ranks complementary profiles ahead of same-role profiles', () => {
    const ranked = rankMatches(
      idea,
      [
        { id: 'visionary-2', role_type: 'visionary', skills: ['payments'], interests: ['fintech'] },
        builder,
        {
          id: 'enabler-1',
          role_type: 'enabler',
          skills: ['fundraising'],
          interests: ['fintech'],
          reputation: 60,
        },
      ],
      { includeRejected: true }
    );

    expect(ranked[0].candidate.id).toBe('builder-1');
    expect(ranked.at(-1).candidate.role_type).toBe('visionary');
  });

  it('ranks open ideas for a builder profile using the same scoring contract', () => {
    const ranked = rankIdeasForProfile(builder, [
      idea,
      {
        id: 'idea-2',
        title: 'Offline agriculture marketplace',
        industry: 'AgTech',
        problem_statement: 'Fragmented purchasing for farms.',
        required_skills: ['hardware sales'],
      },
    ]);

    expect(ranked[0].idea.id).toBe('idea-1');
    expect(ranked[0].tier).toMatch(/Match/);
  });
});
