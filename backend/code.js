// Codis curts amb les consonants admeses a les matrícules espanyoles.
import { randomInt } from 'node:crypto';

export const CODE_LETTERS = 'BCDFGHJKLMNPRSTVWXYZ';

export function tournamentCode(length, draw = randomInt) {
  return Array.from({ length }, () => CODE_LETTERS[draw(CODE_LETTERS.length)]).join('');
}

// Cinc intents per longitud; si tots xoquen, s'afegeix una lletra.
export async function reserveTournamentCode(insert, generate = tournamentCode) {
  for (let length = 5; ; length++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generate(length);
      if (await insert(code)) return code;
    }
  }
}
