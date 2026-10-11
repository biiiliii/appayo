// La icona i el nom comparteixen el mateix tractament a totes les pantalles.
export function brand() {
  const mark = document.createElement('span');
  mark.className = 'brand';
  mark.setAttribute('aria-hidden', 'true');

  const icon = document.createElement('img');
  icon.className = 'brand-icon';
  icon.src = '/icons/icon-header.svg';
  icon.alt = '';

  const word = document.createElement('span');
  word.className = 'brand-word';
  for (const [part, className] of [
    ['APP', 'brand-app'], ['a', 'brand-a'], ['y', 'brand-y'], ['∞', 'brand-infinity'],
  ]) {
    const letter = document.createElement('span');
    letter.className = className;
    letter.textContent = part;
    word.append(letter);
  }

  mark.append(icon, word);
  return mark;
}

// Són enllaços entre seccions, no pestanyes ARIA dins d'una sola pàgina.
export function navigation(active) {
  const nav = document.createElement('nav');
  nav.className = 'main-tabs';
  nav.setAttribute('aria-label', 'Seccions de l’APPayo');
  for (const [id, label, href] of [
    ['new', 'Nova partida', '/'],
    ['tournament', 'Torneig', '/tournaments'],
    ['history', 'Historial', '/history'],
  ]) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (id === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}
