# Vérification de la phase 5 — 25/11/2026

## Mise à jour : tableau de bord entièrement mensuel

Le graphique, son composant, ses styles et ses helpers sont supprimés. Le tableau de bord utilise un mois sélectionné (AAAA-MM dans l’URL), avec le mois courant à Tunis par défaut et des commandes précédent/suivant/actuel. Toutes les cartes et les deux tableaux suivent ce mois. Les séances sont classées par date/heure de début, avec les occurrences fixes calculées sur cette seule période.

Les encaissements correspondent aux paiements espèces valides datés du mois ; le reste à encaisser correspond aux charges des séances du mois moins toutes leurs affectations valides, y compris issues de reçus d’autres mois. Le formulaire de paiement conserve le solde complet et le FIFO global. Aucun historique ou paramètre de connexion à la base n’est modifié.

Contrôles réellement exécutés : **219 tests unitaires dans 26 fichiers et 110 tests PostgreSQL dans 10 fichiers réussis, soit 329 tests**. TypeScript, ESLint et compilation de production réussissent. Les sept scénarios PostgreSQL du tableau de bord couvrent tarifs historiques, charge nulle, paiements annulés, FIFO entre mois, distinction entre encaissement et affectation, limites locales de février bissextile et d’anciens mois avec heure d’été, occurrences fixes, statuts, mois vide et signalement des charges manquantes. Les 26 tests unitaires des helpers couvrent validation de période, changement d’année, mois bissextile et fuseau de Tunis.

Les tests aux limites du mois ont révélé que les dates construites directement en SQL différaient des dates normalisées par l’adaptateur Prisma sous une session PostgreSQL non UTC. Les filtres utilisent désormais des paramètres Date typés, avec le même codec que les écritures et recherches ORM. Les lectures de contrôle ont confirmé la concordance des identifiants sélectionnés ; aucun horaire stocké n’a été réécrit. Les tests de tri comparent les débuts des séances, sans imposer un ordre artificiel entre deux séances commençant à la même heure.

Vérification visuelle restante : mois courant par défaut, sélection d’un autre mois, retour au mois actuel, pagination des séances, absence de graphique et aperçu du paiement depuis un solde mensuel. Aucun navigateur automatisé ni test dans la base réelle du centre.

## Correctifs après livraison : graphique et rafraîchissement de développement

Les titres SVG des barres du graphique reçoivent une seule chaîne de texte, pour éviter l’avertissement React et l’erreur d’hydratation constatés dans le journal de développement. Le rendu React sans navigateur de ce titre a été vérifié.

La CSP utilise désormais des nonces uniquement en production. En développement, elle reste identique entre les requêtes, autorise les scripts de Fast Refresh et le WebSocket local ; les chemins internes /_next/ sont exclus du proxy. Les règles d’accès aux pages et API privées restent en place.

Contrôles exécutés pour ce correctif : TypeScript et ESLint ciblé réussis ; 15 tests de proxy, configuration et requêtes d’authentification réussis. Deux requêtes réelles à la connexion retournent 200 avec la même CSP de développement ; l’API de session retourne 200 avec du JSON valide. Le WebSocket de développement reste connecté pendant le contrôle de 15 secondes avec les messages de synchronisation attendus. La validation visuelle de l’arrêt des clignotements nécessite un rechargement du navigateur après remplacement des scripts déjà ouverts. Aucun navigateur automatisé ni accès en écriture aux données du centre.

Version : **0.5.0**. Tous les contrôles ci-dessous ont réellement été exécutés. Les résultats des phases antérieures restent archivés dans leurs rapports.

## Résultats

| Commande/contrôle | Résultat final |
| --- | --- |
| npm.cmd run typecheck | Réussi |
| npm.cmd run lint | Réussi, sans avertissement |
| npm.cmd run db:validate | Schéma valide |
| npm.cmd test | 197 tests réussis, 26 fichiers, 23,85 s |
| npm.cmd run test:integration | 106 tests réussis, 10 fichiers, 52,48 s |
| npm.cmd run build | Production compilée ; génération Prisma et contrôle TypeScript réussis |
| npm.cmd audit --json --cache .local/npm-cache | 0 vulnérabilité signalée, 711 dépendances analysées |
| prisma migrate status | Neuf migrations à jour |
| prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | Aucun écart détecté |
| Inspection SQL en lecture seule du centre | Aucune incohérence financière ; empreintes des enregistrements identiques avant/après |
| npm.cmd run start -- --port 3105 puis requêtes HTTP Node | Démarrage de production local et contrôles de protection réussis ; serveur temporaire arrêté |

Total : **303 tests dans 36 fichiers**. Aucun Playwright, Cypress, Selenium ou test navigateur n’a été installé, écrit ou exécuté. Les requêtes de contrôle HTTP utilisent Node et aucun navigateur ; elles ne créent ni paiement, ni professeur, ni réservation.

## Couverture

- Les régressions précédentes de tarification, FIFO 15+5 et 200/210, historiques, corrections, annulations, concurrence, idempotence et rollback restent incluses.
- Les horaires contrôlent jours fermés, bornes, créneaux adjacents, créations/modifications fixes, déplacements refusés et conservation des anciens créneaux/prix/statuts. Les helpers couvrent les exceptions supprimant une semaine, les séries sans horizon et les anciens intervalles traversant minuit.
- Le lecteur financier ciblé de l’agenda partage les formateurs historiques, conserve les allocations extournées/audits publics et n’interroge aucune finance sans séance terminée affichée.
- Les agrégats du tableau de bord sont comparés avec financialLedger/getProfessorFinance, dont charges nulles et impayées. Les encaissements annulés sont exclus ; les dates de caisse, graphiques et totaux restent cohérents. Une incohérence de charge manquante est détectée dans une transaction volontairement annulée.
- Les tests de dates/occupation couvrent minuit de Tunis, changement d’année, mois bissextile, millimes, montants limites, salles inactives, annulations, absences et fin exclusive sans mutation de statut.
- Les paramètres sont persistés avec leurs métadonnées, les changements incompatibles sont refusés, et une réservation concurrente est relue après acquisition du verrou partagé. Le logo est décodé/normalisé, conservé entre lecteurs, remplacé et retiré ; les audits ne contiennent pas ses octets. Les entrées invalides et corps trop volumineux sont rejetés.
- La sécurité couvre accès anonyme, activité/version des sessions, origine des mutations, limites des flux JSON et d’authentification, erreurs non techniques, nonce/CSP, validation d’environnement, vérification du mot de passe courant, révocation et absence de secrets dans les audits.
- Le plafond de trente tentatives par minute reste effectif lorsque l’identifiant change, et la limite de deux dérivations scrypt libère sa capacité après réussite comme après erreur.

## Vérification HTTP de production

Le serveur compilé a été lancé uniquement sur 127.0.0.1:3105 puis arrêté. Résultats observés : connexion 200, page privée 307 vers /connexion, API privée 401, logo public 404 en l’absence de logo configuré, endpoint CSRF 200, cookies HttpOnly/SameSite=Lax, refus du callback sans jeton CSRF, corps d’authentification trop grand 413. Les 23 balises script de la page de connexion portaient le nonce de la CSP, différent à chaque réponse, sans unsafe-eval en production. X-Content-Type-Options, X-Frame-Options et no-store ont été vérifiés.

Ces requêtes n’établissent pas une vérification visuelle des composants ou du rendu adaptatif. Aucune connexion réussie avec un faux compte n’a été créée dans la base du centre.

## Données et migrations

Le centre contient, lors du contrôle de cette phase, quatre séances concrètes, une charge et deux paiements. Les empreintes SHA-256 des lignes de ProfessorRateAgreement, TeachingSession, SessionCharge, ProfessorPayment et PaymentAllocation sont identiques avant/après. Il n’existe aucune séance terminée sans charge, charge au prix/professeur incohérent, affectation entre professeurs, reçu non affecté, charge suraffectée ou solde professeur incohérent.

Aucune migration de phase 5 n’est nécessaire : AppSetting existant suffit. Aucune migration antérieure, aucun montant ou historique n’est réécrit. Les neuf migrations de la base du centre et de la base isolée sont appliquées ; Prisma ne détecte aucun écart. Aucun reset de la base du centre n’a été exécuté.

Les fixtures sont exclusivement dans centre_formation_test sur localhost:5435, avec garde de destination avant nettoyage. Les paramètres temporaires et le mot de passe de fixture sont restaurés, sans diminuer la version des sessions.

## Incidents de vérification résolus

Le bac à sable Windows empêchait tsx de lire le profil système pendant le seed de test (uv_os_get_passwd ENOMEM). Le passage autorisé hors bac à sable a réussi, avec la même garde de base isolée. Ce message n’a pas été traité comme une défaillance applicative.

Deux fixtures du nouveau tableau de bord omettaient rateOverrideReason, exigé par la contrainte historique d’une finalisation exceptionnelle. Elles ont été corrigées ; les trois tests ciblés puis le passage complet de 106 tests réussissent. Les protections de la base ont été conservées.

L’audit npm échouait initialement sur la chaîne de certificats locale. Il a été exécuté avec NODE_EXTRA_CA_CERTS pointant sur une copie ignorée des certificats racines publics approuvés par Windows. Aucune vérification TLS n’a été désactivée et aucun audit fix --force n’a été utilisé. Les paramètres système/npm globaux n’ont pas été modifiés. [Documentation Node sur les certificats supplémentaires](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

## Vérifications manuelles restantes

Le [guide administrateur](GUIDE_ADMIN.md) et le [README](../README.md) décrivent les opérations à vérifier : écrans 1920×1080 et 1366×768, tablette/mobile, navigation réduite, logo sur connexion/menu après redémarrage, horaires/jours et historique, défilements et sélection de créneau, confirmations d’annulation/remplacement, formulaires financiers, graphiques, changement de mot de passe et rejet d’une ancienne session. Ces essais visuels n’ont pas été déclarés réussis sans observation.

HTTPS/HSTS externe, sauvegarde/restauration complète, serveur Ubuntu, Docker de production, Apache, domaine et GitLab CI/CD restent à préparer/exécuter en phase 6 selon [la checklist](PHASE6_CHECKLIST.md). Aucun déploiement externe n’a eu lieu.

## Phase 6.2 — validation Docker locale du 27 novembre 2026

Cette section actualise la préparation Docker citée dans la phase précédente. Le VPS n’a pas été contacté. Les commandes Ubuntu et l’inventaire des variables sont dans [DEPLOYMENT.md](../DEPLOYMENT.md).

Fichiers créés ou adaptés pour cette étape :

| Ensemble | Fichiers |
| --- | --- |
| Images et services | `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `next.config.ts` |
| Configuration protégée | `.env.production.example`, `.gitignore`, `.gitattributes`, `scripts/docker/create-production-env.sh` |
| Opérations et disponibilité | `scripts/docker/init-admin.mjs`, `scripts/docker/init-admin.d.mts`, `scripts/docker/validate-production.mjs`, `src/app/api/health/route.ts`, `src/proxy.ts` |
| Erreurs de production | `src/server/auth-options.ts`, `src/server/db.ts` |
| Régressions | `tests/unit/docker-initialization.test.ts`, `tests/unit/health.test.ts`, `tests/unit/auth-options.test.ts`, `tests/unit/proxy-security.test.ts`, `tests/integration/production-operations.test.ts` |
| Documentation | `DEPLOYMENT.md`, `README.md`, `docs/PHASE6_CHECKLIST.md`, `docs/VERIFICATION.md` |

`next-env.d.ts` a aussi été régénéré automatiquement par `next typegen` pour référencer les types de production. Aucun schéma Prisma, migration historique, calcul métier ou composant d’interface n’a été modifié.

Résultats observés :

- **237 tests unitaires dans 29 fichiers et 112 tests d’intégration dans 11 fichiers réussis**, soit 349 tests. Lint, TypeScript et validation du schéma Prisma réussis. Les intégrations restent limitées par leur garde à la base jetable `centre_formation_test` sur `127.0.0.1:5435`.
- `npm audit --omit=dev` : aucune vulnérabilité signalée. Aucun paquet ni fichier de verrouillage modifié.
- Compose validé avec Docker Engine 24.0.5 et Compose 2.20.2. Les deux cibles Docker `runner` et `tools` ont réellement été construites pour Linux. L’image finale d’application fait environ **301 Mio**, utilise Node.js **24.22.3** et l’UID/GID `1001:1001` ; elle ne contient ni fichier `.env`, ni secret d’exécution dans sa configuration, ni CLI Prisma, tsx, TypeScript, ESLint, Vitest ou outils de développement Next.js. Les assertions de packaging chargent Prisma, son compilateur WASM, pg et Sharp.
- Le Compose de production a été résolu avec des secrets de test distincts sous le projet **`successway-validation-7f6cd244`**. Seul son port d’application a été remplacé par `127.0.0.1:3116` pour préserver le port local 3000. Son volume `successway-validation-7f6cd244_postgres_data` et ses réseaux sont distincts des ressources du centre. PostgreSQL ne publie aucun port ; il reste uniquement sur son réseau interne, tandis que l’application rejoint aussi son bridge de publication locale.
- Les **neuf migrations** ont été appliquées sur une base neuve par `prisma migrate deploy`, avec le fuseau de session `Africa/Tunis`. L’application a attendu leur réussite. Le compte de test a été créé depuis stdin, sans mot de passe dans les arguments, l’environnement Compose ou les journaux ; une seconde initialisation sans stdin n’a modifié aucun compte, salle, paramètre ou migration. Les six salles de référence ont été créées par le seed existant.
- Les dix contrôles du script HTTP Node ont réussi : santé publique 200, API anonyme 401, CSRF et connexion valide, cookies `Secure`/`HttpOnly`/`SameSite=Lax` et préfixes sécurisés, session administrateur, paramètres et professeurs accessibles après connexion, mutation d’une autre origine refusée avec 403, logo public et révocation d’un cookie copié après déconnexion. Les en-têtes simulent la future terminaison HTTPS ; ils ne valident ni un certificat ni un navigateur.
- Un PNG de fixture a été envoyé à l’API sur cette seule base isolée et normalisé en WebP par Sharp Linux. Le logo public, le HTML de connexion, sa CSP avec nonce et un fichier JavaScript statique ont été servis correctement sous le système de fichiers en lecture seule.
- La recréation des conteneurs PostgreSQL et application a conservé les empreintes des comptes, salles, paramètres/logo et lignes de migrations, ainsi que le marqueur de persistance isolé.
- Une commande de migration volontairement terminée avec le code 17 a empêché l’application de démarrer. La commande normale a ensuite été restaurée, les migrations relancées sans changement et l’application remise en état sain.
- Une seconde installation sur un volume neuf a validé le Compose final, avec un port local de fixture distinct : la sonde PostgreSQL TCP (`pg_isready -h 127.0.0.1`) a attendu la fin de l’initialisation, puis les migrations ont terminé avec le code 0 et l’application a répondu 200. La sonde TCP évite de confondre le serveur temporaire sur socket Unix avec le serveur final prêt pour les autres conteneurs.
- L’arrêt du seul PostgreSQL isolé a produit une santé HTTP 503 et une erreur de connexion administrateur générique. Après son redémarrage sans retrait du volume, l’application s’est reconnectée et sa santé est revenue à 200. Le client du premier essai a réutilisé un socket HTTP expiré ; le même contrôle avec de nouvelles connexions HTTP a réussi, puis les contrôles de connexion ont été repassés.
- Les secrets aléatoires PostgreSQL, NextAuth et administrateur de validation sont absents des journaux contrôlés. Les diagnostics Prisma détaillés sont désactivés en production. Une régression passant par les vrais handlers NextAuth confirme qu’une exception de base ne divulgue ni chaîne de connexion ni requête SQL dans l’URL d’erreur publique.
- Le générateur Bash de configuration a été exécuté dans un conteneur sans réseau : permissions `600`, secrets distincts de longueurs attendues, cohérence du mot de passe dans `DATABASE_URL`, origine HTTPS, absence de mot de passe administrateur et refus d’écraser un fichier ou un lien symbolique vérifiés.

Docker Desktop local, limité à 2 Gio, est devenu non réactif après le premier build. Son redémarrage a été autorisé explicitement par le propriétaire et n’a supprimé aucun volume. Le build final avec deux workers et les contrôles ci-dessus ont ensuite réussi. La base locale existante a été retrouvée saine sur son port habituel `127.0.0.1:5434` ; aucune commande de préparation, migration ou seed de production ne l’a ciblée.

Aucun test Playwright, navigateur automatisé ou déploiement distant n’a été lancé. Les piles de validation ont été arrêtées après leurs contrôles ; leurs seuls volumes isolés sont conservés. Les fichiers et secrets de fixture restent sous `.local/`, ignoré par Git et exclu du contexte Docker. L’accès public HTTPS, Apache, les certificats, les sauvegardes/restaurations et GitLab CI/CD restent hors de cette étape. Les changements doivent être publiés dans le dépôt avant de suivre le guide sur le VPS.
