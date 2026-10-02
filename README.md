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
- `share.js` — compartir una partida: la porta el mateix enllaç, darrere del `#`, i per això no
  arriba mai a cap servidor (provat a `test/`).
- `index.html`, `styles.css`, `fonts/` (Bricolage Grotesque, llicència OFL), `manifest.webmanifest`, `sw.js`, `icons/` — la PWA.

## Publicar

Publicada a **https://appayo.vercel.app** (projecte `appayo` a Vercel; `vercel --prod` des d'aquesta carpeta torna a desplegar).

És una carpeta estàtica: es pot pujar a Vercel, Netlify, GitHub Pages o qualsevol
servidor. Per instal·lar-la al mòbil cal servir-la per HTTPS: a iPhone, Safari →
Compartir → "Afegeix a la pantalla d'inici"; a Android, Chrome → "Instal·la l'app".
