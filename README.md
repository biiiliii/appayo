# APPayo

Comptador de punts per al **Papayoo** (Gigamic), en català. Les partides individuals continuen funcionant al navegador i sense connexió. Els tornejos fan servir un servidor per compartir el sorteig, l'estat de les taules i els resultats.

## Partides individuals

A la pestanya **Nova partida**, escriu els noms de 3 a 8 jugadors i tria les rondes. Les altres pestanyes obren **Torneig** i **Historial**. A cada ronda, marca qui s'ha endut el Papayoo i reparteix exactament 250 punts. L'app calcula la resta si falta un jugador, mostra la classificació i desa la partida al mòbil. Es poden corregir rondes. Per compartir una partida cal connexió: es desa una còpia al servidor i es genera un enllaç curt `/shared/UUID`. Si es torna a compartir des del mateix navegador, s'actualitza la còpia i es conserva l'enllaç. Qualsevol persona amb l'enllaç pot consultar-ne els resultats.

## Tornejos

1. A **Organitza un torneig**, escriu el nom, els jugadors, les partides, les rondes i una contrasenya de l'organitzador. El servidor crea el sorteig i un identificador únic.
2. Envia a cada taula el seu enllaç. L'enllaç conté un token propi de la taula: permet consultar-la i enviar-ne les rondes, però no gestionar el torneig. Els codis QR es podran afegir més endavant a partir d'aquests enllaços.
3. La taula apunta una ronda i la desa. La ronda es guarda primer al mòbil i s'envia al servidor; si no hi ha connexió, es torna a enviar quan n'hi ha. Es poden corregir rondes ja desades.
4. L'organitzador i la pantalla pública mostren quantes rondes porta cada taula i quantes taules han acabat. La pantalla d'organitzador consulta l'estat cada 5 segons; la pública, cada 15 segons.
5. Quan han acabat totes les taules, l'organitzador pot revelar el podi en tres passos (tercer, segon i primer lloc) i després la classificació i els diplomes. Els punts i la classificació els calcula el servidor.

Les adreces principals són `/` per preparar una partida, `/game/ID` per veure'n l'estat o els resultats, `/game/ID/points` per entrar punts i `/game/ID/rounds` per consultar les rondes jugades i la gràfica. Els tornejos són a `/tournaments`, `/tournaments/new`, `/tournaments/ID`, `/tournaments/spectate/ID` i `/tournaments/table/TOKEN`. L'historial de partides individuals és a `/history`, però cada partida desada conserva la seva adreça `/game/ID`. Els enllaços compartits són `/shared/UUID` i `/shared/UUID/rounds`; també es poden recarregar i obrir en un altre dispositiu. Les partides de l'historial només són visibles al navegador on s'han desat. Les antigues adreces `/game` i `/history/ID` es redirigeixen a la nova ruta. Els enllaços anteriors amb `#p=…` continuen funcionant. Els enllaços anteriors `tournament.html#admin=…`, `#view=…` i `#table=…` es redirigeixen al camí corresponent.

Els tornejos antics que només hi hagués al `localStorage` no s'importen. Els seus antics enllaços `#t=` deixen de ser vàlids.

## Desenvolupament local

Cal Node.js 24 i npm. No cal Docker ni un compte de Neon per treballar en local.

```sh
npm install
npm start
npm test
```

`npm start` serveix l'app i l'API a `http://localhost:4173`. La base de dades local és SQLite a `.data/appayo.sqlite`; `SQLITE_PATH` permet canviar-ne la ruta. L'esquema inicial es crea automàticament. `npm test` executa les proves de la lògica i de l'API.

## Estructura

- `frontend/`: HTML, CSS, JavaScript, icones i service worker de la PWA. Les crides a `/api/` sempre van a la xarxa; no es guarden a la memòria cau. Els camins del torneig es defineixen a `routes.js`.
- `backend/`: API, sorteig, classificació i persistència. `backend/local.js` serveix l'app i l'API en local.
- `api/index.js`: punt d'entrada de Vercel per al backend.
- `test/`: proves de puntuació, enllaços i API.
- `vercel.json`: publica `frontend/` i envia `/api/v1/*` a la funció de Vercel.

## Desplegament a Vercel i Neon

Les tasques concretes per configurar el projecte existent a Vercel són a [TODO-BIEL.md](TODO-BIEL.md).

Aquest repositori conté el codi de la funció i la configuració de desplegament. **Abans que els tornejos funcionin en un desplegament**, cal crear dues bases de dades PostgreSQL a Neon: una per a producció i una altra per a les previsualitzacions. Connecta-les al projecte de Vercel, cadascuna al seu entorn, perquè les funcions rebin `DATABASE_URL`. La cadena de connexió és secreta i no s'ha d'afegir al repositori. El backend crea l'esquema inicial amb `CREATE TABLE IF NOT EXISTS` a la primera petició.

El `package.json` fixa Node.js 24. A Vercel, la funció exigeix `DATABASE_URL`: si falta, respon amb un error i no intenta desar dades en un fitxer temporal. Després de connectar o canviar variables d'entorn, cal fer un desplegament nou. El servei PostgreSQL i Vercel tenen límits gratuïts independents.

La branca `main` es publica a `https://appayo.vercel.app` quan s'hi fa push. Aquesta branca de treball no canvia producció fins que s'integri a `main`.
