// The district palette. A cold steel yard at dusk: four greys and one rust-orange accent.
// Six names here mirror the CSS custom properties in index.html; nothing else in the game
// picks a colour, so the whole look can be tuned in one place.
export const PALETTE = {
  canvas: '#101315',
  surface: '#1c2429',
  hairline: '#2b353c',
  ink: '#e2e7e4',
  muted: '#82909a',
  accent: '#e07a2e',
};

export function shade(name) {
  return PALETTE[name];
}
