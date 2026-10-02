import { icon } from '../icons.js';
import { t } from '../app/strings.js';

/**
 * Creates a DOM element for the Verification Badge based on the tier.
 *
 * Tiers: 'gold' | 'silver' | 'bronze' (stable ids — display names come from
 * the console dictionary, so the badge follows the active language, and the
 * font is the ACTIVE face rather than the Latin one so Arabic glyphs render
 * in the Arabic typeface).
 */
export function createVerificationBadge(tier = 'bronze') {
  const badge = document.createElement('div');

  // Base styles maintaining design tokens #0B0B0B, #D4AF37
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '4px';
  badge.style.padding = '2px 8px';
  badge.style.borderRadius = '12px';
  badge.style.fontSize = '11px';
  badge.style.fontWeight = 'bold';
  // i18n swaps --font-active between the Latin and Arabic faces.
  badge.style.fontFamily = 'var(--font-active, var(--font-en))';
  badge.style.border = '1px solid';

  let color, bgColor, borderColor;

  switch (String(tier).toLowerCase()) {
    case 'gold':
      color = '#D4AF37'; // var(--gold)
      bgColor = 'rgba(212,175,55,0.12)'; // var(--goldf)
      borderColor = 'rgba(212,175,55,0.2)'; // var(--goldl)
      break;
    case 'silver':
      color = '#edf1ff'; // var(--white)
      bgColor = 'rgba(255,255,255,0.05)';
      borderColor = 'rgba(255,255,255,0.15)';
      break;
    case 'bronze':
    default:
      color = '#ff3820'; // var(--ember)
      bgColor = 'rgba(255,56,32,0.1)'; // var(--emberf)
      borderColor = 'rgba(255,56,32,0.2)';
      break;
  }

  badge.style.color = color;
  badge.style.backgroundColor = bgColor;
  badge.style.borderColor = borderColor;

  const tierKey = `tier.${String(tier).toLowerCase()}`;
  const tierName = t(tierKey);
  const label = tierName !== tierKey ? tierName : String(tier);

  // Add an icon (using check-seal or similar from icons.js if available, else a star)
  badge.appendChild(icon('check-seal', { size: 12, color: color }) || icon('star', { size: 12, color: color }));

  const text = document.createElement('span');
  text.textContent = label;
  badge.appendChild(text);

  return badge;
}
