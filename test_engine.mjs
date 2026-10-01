// 1. THE ENGINE (V1 - Strict)
function calculateMatch(visionary, capital) {
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
function rankMatches(visionary, pool) {
  return pool.map(c => ({ capital: c, ...calculateMatch(visionary, c) })).filter(m => m.isMatch).sort((a, b) => b.matchScore - a.matchScore);
}

// 2. THE MARKET DATA
const ahmedVisionary = { industry: "AI", requiredCapital: 250000, requiredSkills: ["Scale", "GoToMarket"] };
const marketPool = [
    { name: "Investor A (The Whale)", availableFunds: 1000000, preferredIndustries: ["AI"], skills: ["Scale", "GoToMarket"] },
    { name: "Investor B (The Real Estate Guy)", availableFunds: 3000000, preferredIndustries: ["Real Estate"], skills: ["Operations"] },
    { name: "Investor C (The Broke Noise)", availableFunds: 50000, preferredIndustries: ["AI"], skills: ["Scale"] }
];

// 3. EXECUTE
console.log("⚡ Executing Elite Matching Engine V1 (Isolated Mode)...\n");
console.table(rankMatches(ahmedVisionary, marketPool).map(r => ({ Investor: r.capital.name, Score: r.matchScore + "%", Synergies: r.synergies.join(" + ") })));
