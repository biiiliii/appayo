# Appayo

Comptador de punts per al **Papayoo** (Gigamic). Web app per al mòbil, sense servidor,
instal·lable a la pantalla d'inici i que funciona sense connexió.

## Com funciona

1. Escriu els noms dels jugadors (de 3 a 8) i tria quantes rondes jugareu.
2. A cada ronda, primer digues **qui s'ha endut el Papayoo** (obligatori, val 40 punts).
3. Posa els punts de cada jugador amb els botons (−10, −5, −, +, +5, +10) o escrivint al camp.
4. L'últim jugador que quedi sense punts rep **la resta fins a 250** automàticament. Qui fa 0 no cal
   tocar-lo: un cop repartits els 250 punts, els que s'han deixat en blanc compten 0.
5. Desa la ronda. Guanya qui té menys punts.
6. Durant la partida hi ha la classificació, una gràfica de l'evolució dels punts i la taula ronda a ronda.
   Si hi ha un error en una ronda ja desada, es toca a la taula "Ronda a ronda" i s'arregla
   (també a les partides de l'historial). La partida es desa a cada tecla: si es tanca l'app o
   s'apaga el mòbil, en tornar-la a obrir continua on era.
7. Les partides acabades queden a "Partides anteriors" (al mateix mòbil), amb classificació, gràfica i taula.
   Cadascú pot esborrar-ne una (obrint-la) o tot l'historial; només s'esborra del seu mòbil.
8. Amb "Comparteix la partida" s'envia per WhatsApp (o el que sigui) un resum amb qui guanya i un
   enllaç que obre la partida sencera. Qui el rep la pot desar a les seves partides. Si l'enllaç no
   li obre l'app (als iPhone passa), pot enganxar-lo a "Partides anteriors".

### Torneig

Per jugar a moltes taules alhora, com el full d'Excel del torneig ("Organitza un torneig", a baix de tot de l'inici):

1. L'organitzador enganxa els noms (un per línia) i tria quantes partides i quantes rondes (per defecte 3 de 5).
2. "Fes el sorteig": l'app fa les taules de totes les partides (de 4 a 6 jugadors) mirant que ningú repeteixi
   company de taula. Si amb pocs jugadors no es pot evitar, ho diu.
3. "Envia a la taula" envia per WhatsApp un enllaç a cada taula. En obrir-lo, la partida surt amb els noms i les
   rondes. La taula juga com sempre i, en acabar, "Envia el resultat a l'organitzador".
4. L'organitzador obre aquest enllaç (o l'enganxa a la pantalla del torneig) i "Afegeix-lo al torneig". També pot
   apuntar una taula al seu mòbil ("Apunta-la aquí").
5. La classificació (menys punts guanya) i els diplomes de l'Excel: campió/ona, cullera de fusta, més rondes a 0,
   més Papayoos i rècord en una ronda. En cas d'empat, el diploma és per a tots. Si hi ha taules de mides
   diferents, els punts de cada taula es passen al que serien en una taula de 5, perquè sigui just.

El torneig només és al mòbil de l'organitzador; no passa per cap servidor.

Regles que aplica l'app: total de 250 punts per ronda, cap valor negatiu, qui té el
Papayoo té com a mínim 40 punts, i la resta com a màxim 210.

## Desenvolupament

No cal instal·lar res. Per provar-ho en local:

```sh
npm start        # serveix la carpeta a http://localhost:4173
npm test         # proves de la lògica (node --test)
```

Fitxers:

- `logic.js` — lògica pura de puntuació (provada a `test/`).
- `app.js` — interfície i desat a `localStorage` (partida en curs i historial de partides).
- `chart.js` — gràfica SVG de punts acumulats (sense dependències).
- `tournament.js` — torneig: sorteig de taules sense repetir companys, enllaços per a cada taula i classificació
  amb diplomes (provat a `test/`).
- `share.js` — compartir una partida: la porta el mateix enllaç, darrere del `#`, i per això no
  arriba mai a cap servidor (provat a `test/`).
- `index.html`, `styles.css`, `fonts/` (Bricolage Grotesque, llicència OFL), `manifest.webmanifest`, `sw.js`, `icons/` — la PWA.

## Publicar

Publicada a **https://appayo.vercel.app** (projecte `appayo` a Vercel, connectat a aquest repo).
Cada push a `main` es publica sol a producció en un minut; les altres branques i els
pull requests tenen la seva pròpia URL de prova. Abans de fer push: `npm test`, i si
canvies fitxers de l'app, puja la versió de la memòria cau a `sw.js` perquè els mòbils
que ja la tenen instal·lada agafin la nova.

És una carpeta estàtica: es pot pujar a Vercel, Netlify, GitHub Pages o qualsevol
servidor. Per instal·lar-la al mòbil cal servir-la per HTTPS: a iPhone, Safari →
Compartir → "Afegeix a la pantalla d'inici"; a Android, Chrome → "Instal·la l'app".
