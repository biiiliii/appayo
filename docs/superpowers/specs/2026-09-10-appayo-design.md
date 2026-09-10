# Appayo — disseny

Comptador de punts per al joc de cartes Papayoo (Gigamic).

## Regles rellevants (PDF oficial 08-2024)
- 3 a 8 jugadors. Es decideix el nombre de rondes al principi (5 és una bona mida).
- Cada carta Payoo val el seu número (1..20 → 210 punts). El Papayoo val 40. Total per ronda: 250.
- Guanya qui té menys punts al final.

## Requisits de la mare
1. Total a repartir 250; l'últim jugador s'assigna sol (resta).
2. Obligatori adjudicar el Papayoo a un jugador.
3. Sumar i restar punts ràpid (botons + camp de text).
4. Mai punts negatius.

## Decisions
- Web app estàtica (HTML/CSS/JS sense build), instal·lable (PWA) i offline. Dades a localStorage.
- Idioma: català.
- Cada jugador introdueix el seu **total** de la ronda (Payoos + 40 si té el Papayoo).
  - Qui té el Papayoo té mínim 40 (el camp s'hi posa sol en assignar-lo).
  - La resta tenen màxim 210.
- El primer jugador que queda sense punts quan tots els altres ja en tenen rep la resta
  automàticament (250 − suma). Es pot tocar per editar-lo a mà.
- Es valida: Papayoo assignat, suma = 250, cap valor negatiu, Papayoo ≥ 40.
- Classificació acumulada, historial de rondes, desfer l'última ronda, partida nova.

## Estructura
- `logic.js`: lògica pura (resolució de ronda, validació, totals). Provada amb `node --test`.
- `app.js`: UI i persistència.
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`.

## Notes d'implementació
- Els camps de punts són `type="text"` amb `inputmode="numeric"` (teclat numèric al mòbil):
  en tocar-los se selecciona tot el contingut, de manera que escriure substitueix el valor
  (també el calculat com a resta). Enter salta al jugador següent.
- El mínim de 40 del Papayoo s'aplica en sortir del camp, no mentre s'escriu.
