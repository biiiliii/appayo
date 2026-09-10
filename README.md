# Appayo

Comptador de punts per al **Papayoo** (Gigamic). Web app per al mòbil, sense servidor,
instal·lable a la pantalla d'inici i que funciona sense connexió.

## Com funciona

1. Escriu els noms dels jugadors (de 3 a 8) i tria quantes rondes jugareu.
2. A cada ronda, primer digues **qui s'ha endut el Papayoo** (obligatori, val 40 punts).
3. Posa els punts de cada jugador amb els botons (−10, −5, −, +, +5, +10) o escrivint al camp.
4. L'últim jugador que quedi sense punts rep **la resta fins a 250** automàticament.
5. Desa la ronda. Guanya qui té menys punts.

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
- `app.js` — interfície i desat a `localStorage`.
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/` — la PWA.

## Publicar

És una carpeta estàtica: es pot pujar a Vercel, Netlify, GitHub Pages o qualsevol
servidor. Per instal·lar-la al mòbil cal servir-la per HTTPS: a iPhone, Safari →
Compartir → "Afegeix a la pantalla d'inici"; a Android, Chrome → "Instal·la l'app".
