# APPayo

Comptador de punts per al **Papayoo** (Gigamic), en català. Les partides individuals continuen funcionant al navegador i sense connexió. Els tornejos fan servir un servidor per compartir el sorteig, l'estat de les taules i els resultats.

## Partides individuals

A la pestanya **Nova partida**, escriu els noms de 3 a 8 jugadors i tria les rondes. Les altres pestanyes obren **Torneig** i **Historial**. A cada ronda, marca qui s'ha endut el Papayoo i reparteix exactament 250 punts. L'app calcula la resta si falta un jugador, mostra la classificació i desa la partida al mòbil. Es pot arreglar qualsevol ronda tocant-la a **Ronda a ronda**, tant de la partida en curs com de les acabades i desades; en editar l'última ronda de la partida en curs, també es pot esborrar. Si es tanca l'app enmig d'una partida o d'una correcció, en tornar-la a obrir s'hi continua.

En compartir una partida es desa una còpia al servidor i es genera un enllaç curt `/shared/UUID`. Si es torna a compartir des del mateix navegador, s'actualitza la còpia i es conserva l'enllaç; qui l'havia desada la pot posar al dia amb **Actualitza la meva còpia**. Sense connexió (o si el servidor no respon) s'envia l'enllaç antic `#p=…`, que porta la partida a dins i també s'obre. Qualsevol persona amb l'enllaç pot consultar-ne els resultats. Als iPhone, un enllaç rebut s'obre al Safari, que no comparteix dades amb l'app instal·lada: a **Historial → Enganxa l'enllaç que t'han enviat** es pot obrir i desar dins l'app.

## Tornejos

1. A **Organitza un torneig**, escriu el nom i una contrasenya de l'organitzador (almenys 4 caràcters). Prem **Següent**: el servidor desa el torneig i assigna un codi de cinc consonants (després de cinc col·lisions, prova amb sis i continua augmentant la longitud si cal). A `/tournaments/CODI/configure`, introdueix els jugadors, les partides, les rondes, la mida ideal de cada taula (de 3 a 8, 5 per defecte) i el màxim de taules simultànies. El sorteig ajusta les mides per repartir tots els jugadors. Pots activar o desactivar la ponderació de taules de mides diferents; per defecte està activada i ajusta els punts a la mida de taula més habitual només a la classificació. Prem **Inicia el torneig!** i confirma-ho per generar el sorteig i passar a la fase de partides. Si recarregues aquesta pàgina abans d'iniciar-lo, el torneig continua disponible i les dades del formulari es conserven en aquesta pestanya del navegador. El QR de la configuració obre la pantalla pública del torneig.
2. Envia a cada taula el seu enllaç amb **Comparteix l'enllaç** de la pantalla d'organitzador, o que cada taula toqui la seva a la pantalla pública. L'enllaç conté un token propi de la taula: permet consultar-la i enviar-ne les rondes, però no gestionar el torneig. Si calen més taules que les simultànies configurades, cada partida es divideix en torns successius; les taules en espera s'activen quan acaba el torn anterior. Els codis QR de les taules es podran afegir més endavant a partir d'aquests enllaços.
3. La taula apunta una ronda i la desa. La ronda es guarda primer al mòbil i s'envia al servidor; si no hi ha connexió, es torna a enviar quan n'hi ha. Es poden corregir rondes ja desades fins que comencen els resultats, també quan la taula ja ha acabat. Si dos mòbils apunten la mateixa taula, el servidor no deixa que un esborri les rondes de l'altre: el segon rep les rondes que hi ha i les pot revisar.
4. L'organitzador i la pantalla pública mostren quantes rondes porta cada taula i quantes taules han acabat. La pantalla d'organitzador consulta l'estat cada 5 segons; la pública, cada 30 segons.
5. Quan han acabat totes les taules, l'organitzador obre `/tournaments/CODI/results`: una diapositiva inicial i set premis, en aquest ordre: més punts totals, més Papayoos, més punts en una ronda, més rondes a zero, tercer, segon i primer lloc. Els empats comparteixen el premi. Després del primer lloc apareix `/tournaments/CODI/table`, amb la classificació final. La pantalla pública espera fins que es revela el primer lloc i només mostra la taula completa quan l'organitzador arriba a la seva diapositiva. Els punts i els premis els calcula el servidor.

En crear o gestionar un torneig, aquest navegador desa al `localStorage` el codi, el nom i un token temporal d'organitzador; no hi desa la contrasenya. A **Gestiona un torneig existent → Recents** pots tornar als tornejos d'aquest dispositiu. Si el token ha caducat o obres directament una URL de gestió sense sessió, s'obre **Un altre** amb el codi omplert perquè introdueixis la contrasenya.

Les adreces principals són `/` per preparar una partida, `/game/ID` per veure'n l'estat o els resultats, `/game/ID/points` per entrar punts i `/game/ID/rounds` per consultar les rondes jugades i la gràfica. Els tornejos són a `/tournaments`, `/tournaments/new`, `/tournaments/CODI/configure`, `/tournaments/ID`, `/tournaments/ID/results`, `/tournaments/ID/table`, `/tournaments/spectate/ID`, `/tournaments/spectate/ID/table` i `/tournaments/table/TOKEN`. L'historial de partides individuals és a `/history`, però cada partida desada conserva la seva adreça `/game/ID`. Els enllaços compartits són `/shared/UUID` i `/shared/UUID/rounds`; també es poden recarregar i obrir en un altre dispositiu. Les partides de l'historial només són visibles al navegador on s'han desat. Les antigues adreces `/game` i `/history/ID` es redirigeixen a la nova ruta. Els enllaços anteriors amb `#p=…` continuen funcionant. Els enllaços anteriors `tournament.html#admin=…`, `#view=…` i `#table=…` es redirigeixen al camí corresponent.

Els tornejos de la versió anterior, sense servidor, que hi hagi al mòbil de l'organitzador surten a **Historial → Tornejos de la versió anterior** per consultar-ne la classificació i els diplomes, però no s'hi poden afegir resultats. Els seus enllaços d'invitació `#t=` ja no serveixen per jugar i ho expliquen en obrir-los.

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

La branca `main` es publica a `https://appayo.vercel.app` quan s'hi fa push; les altres branques tenen una previsualització. `appayoo.vercel.app` redirigeix a `appayo.vercel.app` conservant el camí.

Hi ha dues bases de dades PostgreSQL a Neon, creades amb la integració de Neon del Marketplace de Vercel (pla gratuït, regió Frankfurt): `appayo-prod`, connectada només a l'entorn **Production**, i `appayo-preview`, connectada només a **Preview**. La integració dona a cada entorn la seva `DATABASE_URL` (connexió *pooled*, amb TLS); el backend només llegeix aquesta variable. Les funcions també s'executen a Frankfurt (`regions` a `vercel.json`). La cadena de connexió és secreta i no s'ha d'afegir al repositori. El backend crea l'esquema amb `CREATE TABLE IF NOT EXISTS` a la primera petició; els canvis d'esquema futurs necessitaran migracions.

El `package.json` fixa Node.js 24. A Vercel, la funció exigeix `DATABASE_URL`: si falta, respon amb un error i no intenta desar dades en un fitxer temporal. Després de connectar o canviar variables d'entorn, cal fer un desplegament nou. Neon i Vercel tenen límits gratuïts independents.
