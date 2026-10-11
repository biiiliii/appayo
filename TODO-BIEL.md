# Desplegament d'APPayo a Vercel i Neon

Aquest document és una tasca per a un altre assistent amb accés al projecte de Vercel i, si cal, a Neon. **Fes els canvis al projecte de Vercel existent que serveix `appayo.vercel.app`; no en creïs un de nou per a l'aplicació principal.** Comprova l'equip, el repositori i el projecte abans de modificar res. No incloguis mai cadenes de connexió ni altres secrets a la resposta, als logs compartits o al repositori.

## Què ja prepara aquest repositori

- `vercel.json` tria el preset `Other`, publica `frontend/` i reescriu `/api/v1/*` cap a `api/index.js`. També resol els camins nets de `/game`, `/history`, `/shared` i `/tournaments` quan es recarrega la pàgina.
- `package.json` fixa Node.js 24 i té la dependència `pg`. El backend llegeix **només `DATABASE_URL`** per connectar-se a PostgreSQL; en local, sense aquesta variable, fa servir SQLite.
- `backend/db.js` crea automàticament l'esquema inicial amb `CREATE TABLE IF NOT EXISTS` a la primera petició de l'API: `tournaments`, `tournament_sessions`, `tournament_tables` i `shared_games`. Per a aquest primer desplegament **no cal executar SQL manualment ni configurar una ordre de migració al build**. Les futures modificacions de l'esquema sí que necessitaran migracions versionades al codi abans de desplegar-les.
- Aquest treball és a la branca `backend`. Si els canvis encara són locals, cal publicar la branca perquè Vercel pugui crear-ne una previsualització. No substitueixis la branca de producció per la de previsualització.

## Tasques a Vercel i Neon

1. [ ] **Revisa el projecte existent.** Confirma que `appayo.vercel.app` pertany al projecte correcte, que apunta al repositori d'aquest codi i que `main` és la branca de Production. El directori arrel del projecte ha de ser l'arrel del repositori. Confirma que la configuració efectiva no anul·la `vercel.json`: preset `Other`, directori de sortida `frontend`, funció de Node.js per a `api/index.js` i Node.js 24. El build pot quedar buit; el frontend és estàtic.
2. [ ] **Prepara dues bases de dades Neon independents**, una de Production i una de Preview. Poden ser dos projectes Neon o dues bases/brànques realment aïllades; la de Preview no ha d'escriure a Production ni exposar-ne les dades. Tria una regió propera a la de les funcions de Vercel. Utilitza la cadena de connexió *pooled* de Neon, amb TLS (`sslmode=require`). Abans de crear recursos nous, comprova si ja existeixen bases adequades i si el pla triat té cost.
3. [ ] **Configura `DATABASE_URL` al projecte de Vercel** amb el valor de Production només a l'entorn **Production**, i el valor diferent de Preview només a **Preview**. Pots fer-ho amb la integració Neon o amb variables d'entorn de Vercel. Si la integració crea noms diferents o amb prefix, assegura igualment que l'aplicació rep exactament `DATABASE_URL` a cada entorn. El desenvolupament amb `npm start` no necessita cap variable de Vercel i ha de continuar usant SQLite. Comprova que no hi ha una variable antiga, global o específica d'una branca que faci que Preview apunti a Production.
4. [ ] **Crea un desplegament Preview nou** de `backend` després de publicar-hi els canvis i de configurar les variables. Els canvis de variables d'entorn només arriben als desplegaments nous. Obre `/tournaments/new` i crea un torneig de prova a Preview; obre després la pantalla d'organitzador, la pública i una taula. Recarrega cada URL i comprova que el torneig persisteix. Comparteix també una partida individual i obre `/shared/UUID` en una finestra privada; comprova que en tornar-la a compartir l'UUID no canvia i les rondes corregides hi apareixen. A Neon Preview han d'aparèixer les quatre taules indicades més amunt.
5. [ ] **Abans de passar a Production**, comprova que Preview fa servir una base diferent de Production. Quan aquesta branca s'integri a `main`, crea un desplegament Production nou. Una petició a `/api/v1/tournaments/aaaaaaaaaaaa/status` ha de respondre `404` (torneig inexistent), i les quatre taules s'han d'haver creat a Neon Production. Un `500` requereix revisar `DATABASE_URL` i els logs de la funció. Comprova també que la pàgina principal, `/history`, `/tournaments/new` i un enllaç `/shared/UUID` carreguen en recarregar-les.
6. [ ] **Revisa els logs i els recursos** després de les proves: errors de connexió, funció `api/index.js`, base de dades i ús dels plans gratuïts. Informa de les URLs de Preview i Production, del resultat de les comprovacions i de qualsevol pas que hagi quedat pendent, sense revelar secrets.

## Opcional: `appayoo.vercel.app` → `appayo.vercel.app`

1. [ ] Comprova a **Project Settings → Domains** si `appayoo.vercel.app` és disponible. Les adreces `vercel.app` s'assignen per ordre d'arribada; no pressuposis que es pot reservar.
2. [ ] Si Vercel permet afegir-la, afegeix-la **al mateix projecte** i configura-hi una redirecció permanent cap a `appayo.vercel.app` des de la configuració del domini. Conserva `appayo.vercel.app` com a adreça principal. No canviïs el nom del projecte ni creïs un segon projecte només per aconseguir l'àlies.
3. [ ] Comprova que `https://appayoo.vercel.app/` i un camí com `/tournaments/new` redirigeixen al mateix camí d'`https://appayo.vercel.app`. Si l'adreça no està disponible o Vercel no permet aquesta configuració, informa'n i deixa el domini principal tal com està.

## Referències de la plataforma

- [Configuració de Vercel amb `vercel.json`](https://vercel.com/docs/project-configuration/vercel-json)
- [Variables per entorn i desplegaments nous](https://vercel.com/docs/environment-variables)
- [Integració Neon a Vercel](https://vercel.com/marketplace/neon/neon)
- [Connexions agrupades de Neon](https://neon.com/docs/connect/connection-pooling)
- [Dominis i redireccions de Vercel](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
