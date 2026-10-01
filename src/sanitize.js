export function stripEmoji(input) {
  if (!input) return '';
  return input
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // country flags
    .replace(/[\u{FE0F}\u{200D}]/gu, '') // variation selector + ZWJ
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function safeName(input, max = 60) {
  return stripEmoji(input).slice(0, max);
}
