/**
 * Number formatting. Kept separate so the engine stays free of display concerns.
 *
 * Bias throughout: whole dollars, no cents. Nobody learning this lesson needs
 * to see 47 cents, and the extra digits make big numbers harder to read.
 */

/** $1,234 — full precision with separators, for headline and table values. */
export function money(n) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return sign + '$' + Math.abs(rounded).toLocaleString('en-US');
}

/** $1.2M / $802K / $940 — for axis ticks and labels riding a mark. */
export function moneyCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** "15%" — allocation sliders move in half-percent steps. */
export function percent(fraction, decimals = 0) {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** "25.8x" — how far an early dollar stretches. */
export function multiple(n) {
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)}x`;
}

/**
 * Turns a big number into something a teenager can actually picture.
 * Used under the hero figure, where "$188,431" alone doesn't land.
 */
export function plainEnglishAmount(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `about ${(abs / 1_000_000).toFixed(1)} million dollars`;
  if (abs >= 1_000) return `about ${Math.round(abs / 1_000)} thousand dollars`;
  return `about ${Math.round(abs)} dollars`;
}
