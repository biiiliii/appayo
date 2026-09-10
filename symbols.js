// Símbol de cada jugador (a més del color) perquè es distingeixin també sense veure bé els colors.
// Els quatre pals de la baralla i quatre formes senzilles més. Dibuixats en una caixa de 24×24.
export const SYMBOLS = [
  { name: 'cor', d: 'M12 21s-7-4.6-9.5-9C.7 8.6 2.6 4.5 6.5 4.5c2 0 3.6 1.1 5.5 3 1.9-1.9 3.5-3 5.5-3 3.9 0 5.8 4.1 4 7.5C19 16.4 12 21 12 21z' },
  { name: 'trèvol', d: 'M12 2a4 4 0 0 0-3.6 5.7A4 4 0 1 0 10.8 14c-.3 2-1 3.5-2.8 5h8c-1.8-1.5-2.5-3-2.8-5a4 4 0 1 0 2.4-6.3A4 4 0 0 0 12 2z' },
  { name: 'pica', d: 'M12 2C9 7 4 9.5 4 13.5c0 2.5 2 4 4 4 1.2 0 2.3-.5 3-1.3-.3 1.8-1 3.3-2.5 4.8h7c-1.5-1.5-2.2-3-2.5-4.8.7.8 1.8 1.3 3 1.3 2 0 4-1.5 4-4C20 9.5 15 7 12 2z' },
  { name: 'diamant', d: 'M12 2l8 10-8 10-8-10z' },
  { name: 'estrella', d: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z' },
  { name: 'flor', d: 'M12 2.5a3.2 3.2 0 0 1 3.1 2.4 3.2 3.2 0 0 1 3.9 1.2 3.2 3.2 0 0 1-.1 4.1 3.2 3.2 0 0 1 0 4.1 3.2 3.2 0 0 1-3.9 1.3A3.2 3.2 0 0 1 12 18a3.2 3.2 0 0 1-3-2.4 3.2 3.2 0 0 1-3.9-1.3 3.2 3.2 0 0 1 0-4.1 3.2 3.2 0 0 1 .1-4.1 3.2 3.2 0 0 1 3.9-1.2A3.2 3.2 0 0 1 12 2.5zm0 5.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM11 18.5h2V22h-2z' },
  { name: 'lluna', d: 'M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5z' },
  { name: 'sol', d: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm-1-6h2v3.5h-2zm0 19.5h2V24h-2zM1 11h3.5v2H1zm19.5 0H24v2h-3.5zM4.2 3l2.5 2.5-1.4 1.4L2.8 4.4zm14.1 14.1l2.5 2.5-1.4 1.4-2.5-2.5zM19.8 3l1.4 1.4-2.5 2.5-1.4-1.4zM5.6 17.1l1.4 1.4-2.5 2.5-1.4-1.4z' },
];

export const symbolName = (i) => SYMBOLS[i % SYMBOLS.length].name;
export const symbolPath = (i) => SYMBOLS[i % SYMBOLS.length].d;

/** Element <svg> inline amb el símbol del jugador i, pintat del color donat. */
export function symbolEl(i, color, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'sym');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', symbolName(i));
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', symbolPath(i));
  path.setAttribute('fill', color);
  svg.append(path);
  return svg;
}
