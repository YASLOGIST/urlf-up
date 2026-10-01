export function calculateMatch(visionary, capital) {
  if (capital.availableFunds < visionary.requiredCapital) return { isMatch: false, matchScore: 0, synergies: [] };
  let score = 0;
  const synergies = [];
  if (capital.preferredIndustries.includes(visionary.industry)) { score += 40; synergies.push("Industry"); }
  const req = visionary.requiredSkills || [], off = capital.skills || [];
  if (req.length > 0) {
    const matches = req.filter(s => off.includes(s));
    score += (matches.length / req.length) * 60;
    if (matches.length > 0) synergies.push(`Skills: ${matches.join(', ')}`);
  } else { score += 60; }
  return { isMatch: score >= 50, matchScore: Math.round(score), synergies };
}

export function rankMatches(visionary, pool) {
  return pool.map(c => ({ capital: c, ...calculateMatch(visionary, c) }))
             .filter(m => m.isMatch)
             .sort((a, b) => b.matchScore - a.matchScore);
}
