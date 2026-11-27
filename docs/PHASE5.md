# Rapport final — Phase 5

Version **0.5.0**, le **25/11/2026**, fuseau Africa/Tunis. Travail réalisé dans le projet existant, sans déploiement externe ni mise en œuvre de la phase 6.

## État de la livraison

| Catégorie | État |
| --- | --- |
| Implémenté et vérifié techniquement | Tableau de bord, paramètres persistants, logos sûrs, horaires, sécurité de compte/HTTP, intégrité métier, optimisations ciblées, documentation, compilation et 303 tests |
| Implémenté, vérification manuelle nécessaire | Aspect et usage sur les écrans cibles, logo après redémarrage réel, interactions des modales, graphique et parcours complets dans le navigateur |
| Non implémenté pendant cette phase | Déploiement externe, Dockerfile/Compose de production finaux, Apache, domaine/TLS/HSTS, pipeline GitLab finale, sauvegardes planifiées et exercice complet de restauration |
| Bloqué | Aucun blocage technique restant parmi les contrôles exécutés |
| Accord requis | Démarrage et choix de déploiement de la phase 6 ; aucune opération destructive ou modification financière historique n’a été nécessaire |

## 1. Fonctionnalités implémentées

Le tableau de bord présente l’identité du centre, la date française, cinq indicateurs d’activité, six indicateurs financiers, les séances chronologiques du jour avec lien vers l’agenda, les principaux débiteurs avec paiement direct et un graphique des encaissements semaine/mois/six mois. Les données viennent de PostgreSQL, sans valeurs fictives ni multiplication par le tarif courant.

Paramètres configure identité/contact, logo, jours et horaires, préférences fixes et mot de passe. L’agenda horizontal respecte les horaires et conserve l’accès historique. Les six menus restent Tableau de bord, Emploi du temps, Salles, Professeurs, Paiements et Paramètres. Aucun module supprimé n’est réintroduit.

## 2. Problèmes confirmés et corrigés

- Le dashboard chargeait les graphes complets d’historique financier et une semaine pour un besoin journalier : projection agrégée et lecture du seul jour.
- L’agenda rechargeait l’historique complet par professeur pour les détails de quelques séances : deux lectures limitées aux séances terminées visibles.
- L’identité était codée en dur et Paramètres était statique : lecture/persistance AppSetting et marque commune.
- Les horaires n’encadraient pas les réservations : règles serveur transactionnelles et refus de changements incompatibles.
- Les anciens intervalles traversant minuit pouvaient échapper au contrôle d’un jour fermé : découpage sur les journées effectivement occupées.
- La déconnexion supprimait le cookie sans révoquer une copie du jeton : révocation conditionnelle par version de session.
- Les corps publics NextAuth échappaient au contrôle de taille applicatif : flux borné avant son parseur, avec conservation du contrôle CSRF.
- La limitation par identifiant seul permettait de multiplier compteurs et dérivations : plafond global, purge des compteurs périmés et dérivations simultanées bornées.
- La CSP autorisait eval en production : nonce des scripts, suppression d’eval en production et refus des objets/cadres.
- Des erreurs et états de soumission pouvaient manquer de cohérence : no-store même pour les erreurs, limite globale française et gestion des échecs de déconnexion.

Ces corrections ne modifient aucune donnée financière historique. Les défauts des nouvelles fixtures de test ont été corrigés séparément, sans affaiblir les contraintes de base.

## 3. Tableau de bord

Les séances prévues, en cours et terminées sont comptées selon leur statut explicite. L’occupation actuelle suit les intervalles réels à Tunis, exclut absences/annulations et concerne les salles actives. Les encaissements utilisent les paiements espèces valides selon leur date, sans compter les charges. Les soldes, nombres de séances impayées/partielles et débiteurs utilisent les données historiques et affectations valides centralisées. Le tableau des principaux débiteurs est trié par solde et réutilise PaymentForm. Le SVG propose un tableau accessible des montants.

## 4. Paramètres

AppSetting centre conserve nom, téléphone, adresse, e-mail facultatif et les métadonnées fixes existantes. operatingHours conserve ouverture/fermeture à la demi-heure et jours ouverts. Le défaut 00:00–24:00 sur sept jours préserve les anciennes possibilités jusqu’au premier réglage. Les changements incompatibles avec une réservation future sont refusés sous le verrou partagé.

Le logo PNG/JPEG/WebP est prévisualisé avant enregistrement, contrôlé côté serveur (signature, décodage, pages, pixels et 2 Mo), normalisé en WebP jusqu’à 1024×1024 puis conservé dans centre.logo. Il peut être remplacé/supprimé. Son URL est versionnée par empreinte ; seul le logo normalisé est public. Sa persistance provient du stockage PostgreSQL existant, indépendamment du système de fichiers du conteneur applicatif. Les préférences restent Français, TND et Africa/Tunis.

## 5. Interface et expérience

Le nom/logo apparaissent dans le menu, la connexion, l’en-tête et le pied de page. Le menu conserve ses six entrées, souligne la page active y compris dans une fiche et peut être réduit sur bureau ; le tiroir mobile est conservé. Cartes, tableaux défilants, formulaires de paramètres et graphique utilisent les styles Ant Design et des règles adaptatives cohérentes. Les en-têtes, états vides et erreurs restent français.

La grille de l’agenda reste horizontale, par demi-heures, avec en-têtes fixes, blocs continus, couleurs opérationnelles et indicateurs financiers distincts. Elle suit les horaires, s’étend aux anciennes séances et propose Journée entière. La ligne d’heure courante de Tunis est informative. Les annulations restent masquées dans la grille active et consultables à part, avec remplacement indépendant. Aucun glisser-déposer n’est ajouté. La vérification visuelle demeure à réaliser manuellement.

## 6. Authentification

La solution NextAuth Credentials existante est conservée. Les pages/API revérifient l’administrateur actif et sa version de session en base. Le changement de mot de passe exige le secret actuel, 12–256 caractères et une confirmation identique, puis met à jour atomiquement le dérivé/version vérifiés. Il invalide toutes les anciennes sessions et exige une nouvelle connexion. La déconnexion révoque la version courante ; une copie plus ancienne ne peut pas révoquer une connexion ultérieure.

Les cookies restent HttpOnly/SameSite=Lax, Secure pour HTTPS, avec durée de huit heures. La validation d’environnement exige un secret aléatoire et une origine canonique ; l’exécution locale HTTP reste possible.

## 7. Sécurité

Scrypt N=131072/r=8/p=1 et sel aléatoire sont conservés ; aucun ancien hash n’a été réécrit. Les dérivations sont limitées à deux simultanément par processus. Les compteurs de tentative sont persistants et transactionnels : cinq par compte sur quinze minutes, trente globalement par minute ; les compteurs périmés sont purgés après 24 heures. Ces blocages restent temporaires et les messages publics génériques.

Le serveur valide les nouveaux contrats de paramètres/password et borne les flux réels à 16 Ko pour NextAuth, 64 Ko pour JSON et 2 Mo pour les logos. La protection d’origine des mutations et le CSRF natif NextAuth sont conservés. Les données utilisateur restent rendues comme texte React ; aucun dangerouslySetInnerHTML applicatif n’est ajouté. Les requêtes SQL de projection sont paramétrées.

La CSP utilise un nonce nouveau écrasant les valeurs entrantes ; le rendu racine dynamique permet à Next.js de l’ajouter à ses scripts. Pas d’eval ni de scripts inline non autorisés en production. Styles inline maintenus pour Ant Design, objets/cadres interdits, autres en-têtes conservés. Les erreurs sont françaises, sans traces, chemins ou identifiants de connexion ; les réponses privées et erreurs portent no-store. Les mots de passe, hashes et jetons ne figurent pas dans les audits.

## 8. Intégrité financière

Les règles de phase 4.1 restent intactes : professeurs payant le centre, espèces côté serveur, aucune avance/crédit ni choix de mode/référence, plafond du reste, prix historiques/exceptionnels, affectation FIFO automatique et règlements partiels. Les contraintes et verrous empêchent doublons, dépassements et liens entre professeurs ; corrections/annulations conservent originaux, affectations et audits.

Les 303 tests incluent les scénarios financiers précédents et la parité des nouveaux agrégats avec les lecteurs détaillés. Le contrôle du centre n’a trouvé aucune charge manquante/incohérente, affectation inter-professeur, reçu non affecté, charge suraffectée ou solde incohérent. Les deux paiements, une charge et quatre séances concrètes du centre sont conservés. Les empreintes des tarifs, séances, charges, reçus et affectations sont identiques avant/après.

## 9. Intégrité de planification

Les conflits de salle/professeur, horaires adjacents, versions hebdomadaires, exceptions, annulations occurrence/suite, libération immédiate et remplacements restent protégés sous le verrou 736204. Les horaires sont vérifiés dans les créations/déplacements et avant modification de paramètres. Les séries ouvertes sont contrôlées sans horizon arbitraire ; les exceptions enregistrées suppriment leurs semaines calculées. Les statuts, prix et finances historiques ne changent pas après une modification d’horaires. Une séance terminée à partir d’une date d’arrêt bloque toujours l’annulation de série.

## 10. Performances

Le dashboard utilise trois requêtes financières agrégées en base, sans transfert de tous les paiements/séances/audits. La caisse est regroupée par date sur six mois. L’agenda développe le seul jour sélectionné et ses détails financiers prennent deux requêtes ciblées, zéro en l’absence de séance terminée. Les formateurs financiers sont partagés, sans duplication de la logique d’écriture. La marque du centre est dédupliquée au niveau de la requête React. Aucun cache financier persistant, nouvel index spéculatif ou infrastructure supplémentaire n’est ajouté. Ces améliorations réduisent les graphes chargés ; aucun gain de latence non mesuré n’est annoncé.

## 11. Dépendances

sharp 0.35.5, déjà présent transitivement, est déclaré explicitement pour le contrôle serveur des images. Aucun framework majeur n’est migré, aucun paquet graphique ou navigateur n’est ajouté et aucune dépendance n’est retirée sans preuve d’inutilité. Le lockfile reste cohérent avec la version 0.5.0. L’audit final ne signale aucune vulnérabilité. Aucun audit fix --force ou contournement TLS n’a été exécuté.

## 12. Fichiers créés (37)

- `docs/GUIDE_ADMIN.md`
- `docs/PHASE5.md`
- `docs/PHASE6_CHECKLIST.md`
- `src/app/api/account/password/route.ts`
- `src/app/api/centre/logo/route.ts`
- `src/app/api/settings/centre/route.ts`
- `src/app/api/settings/logo/route.ts`
- `src/app/global-error.tsx`
- `src/components/cash-receipts-chart.tsx`
- `src/components/centre-logo.tsx`
- `src/features/settings/centre-settings.tsx`
- `src/features/settings/password-form.tsx`
- `src/features/settings/settings.module.css`
- `src/lib/dashboard.ts`
- `src/lib/opening-hours.ts`
- `src/server/environment.ts`
- `src/server/request-body.ts`
- `src/server/security-policy.ts`
- `src/services/account-security.ts`
- `src/services/login-protection.ts`
- `src/services/opening-hours.ts`
- `src/services/settings.ts`
- `src/types/settings.ts`
- `src/validations/settings.ts`
- `tests/integration/agenda-opening-hours.test.ts`
- `tests/integration/dashboard.test.ts`
- `tests/integration/settings.test.ts`
- `tests/unit/agenda-financial-details.test.ts`
- `tests/unit/auth-request.test.ts`
- `tests/unit/authorization.test.ts`
- `tests/unit/dashboard.test.ts`
- `tests/unit/environment-security.test.ts`
- `tests/unit/opening-hours.test.ts`
- `tests/unit/password-capacity.test.ts`
- `tests/unit/proxy-security.test.ts`
- `tests/unit/settings-api.test.ts`
- `tests/unit/settings.test.ts`

## 13. Fichiers modifiés (35)

- `.env.example`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/VERIFICATION.md`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `src/app/(admin)/layout.tsx`
- `src/app/(admin)/parametres/page.tsx`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/connexion/page.tsx`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/components/app-shell.tsx`
- `src/components/dashboard-view.tsx`
- `src/components/login-form.tsx`
- `src/components/login-view.tsx`
- `src/features/agenda/agenda-view.tsx`
- `src/features/agenda/agenda.css`
- `src/features/agenda/recurrence-form.tsx`
- `src/features/agenda/session-form.tsx`
- `src/lib/password.ts`
- `src/proxy.ts`
- `src/server/api.ts`
- `src/server/auth-options.ts`
- `src/server/db.ts`
- `src/services/agenda.ts`
- `src/services/authentication.ts`
- `src/services/dashboard.ts`
- `src/services/financial-read.ts`
- `src/services/financial-state.ts`
- `src/types/agenda.ts`
- `src/validations/auth.ts`
- `tests/integration/authentication.test.ts`
- `tests/unit/admin-api.test.ts`

## 14. Fichiers supprimés (0)

Aucun.

L’inventaire compare les empreintes au début de cette phase, hors dépendances, client Prisma généré, .next et utilitaires locaux ignorés. .env.example est ajouté explicitement à la liste des modifications. Les rapports des phases antérieures restent des archives historiques. Aucun dépôt Git n’est présent dans cet espace.

## 15. Schéma Prisma

Aucun changement de modèle, enum, relation, index ou champ n’est nécessaire. Le modèle AppSetting existant persiste identité, horaires et logo. Les colonnes privées historiques method/reference restent conservées sans réintroduire leur fonctionnalité.

## 16. Migrations

Neuf migrations existantes sont appliquées au centre et à la base de test ; aucun écart Prisma. La phase 5 n’en crée ni n’en applique de nouvelle et ne modifie aucune migration antérieure. Aucun reset ni migration destructive n’a été exécuté sur le centre.

## 17. Commandes exécutées

- npm.cmd run typecheck
- npm.cmd run lint
- npm.cmd run db:validate
- npm.cmd test
- npm.cmd run test:integration
- npm.cmd run test:integration -- tests/integration/dashboard.test.ts
- npm.cmd run build
- npm.cmd run start -- --port 3105, puis requêtes HTTP Node sans navigateur et arrêt du serveur temporaire
- npm.cmd audit --json --cache .local/npm-cache
- node node_modules/prisma/build/index.js migrate status
- node node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
- Inspections SQL en lecture seule et comparaison d’empreintes avant/après ; recherches des modules/champs/artefacts obsolètes.

Les tests utilisent exclusivement centre_formation_test sur localhost:5435. Les détails des conditions Windows/certificats et des fixtures corrigées figurent dans [VERIFICATION.md](VERIFICATION.md).

## 18. Résultats réels

**197 tests unitaires dans 26 fichiers et 106 tests PostgreSQL dans 10 fichiers réussissent : 303 tests au total.** TypeScript, ESLint sans avertissement et Prisma réussissent. Audit npm : zéro vulnérabilité signalée. Les tests de nouvelles lectures agrégées retrouvent les résultats financiers centralisés détaillés. Les tests autorisation/CSRF/limites de corps, password/révocation, compteurs et capacité de dérivation réussissent. Aucun test navigateur n’a été exécuté.

## 19. Production locale

La compilation Next.js 16.4.6/Prisma 7.10.1 réussit en version 0.5.0 sans désactiver TypeScript/ESLint. Le démarrage local sur 127.0.0.1:3105 et les contrôles HTTP ont réussi : connexion 200, page privée 307, API privée 401, absence de logo 404, rejet CSRF et corps trop grand 413. Les 23 scripts de la connexion portent le nonce correct. Le serveur temporaire est arrêté. Aucun serveur externe n’a été contacté pour déployer l’application.

## 20. Points de sécurité restants

Aucune vulnérabilité n’est signalée par l’audit final et aucun défaut supplémentaire confirmé n’est resté sans correction dans la revue effectuée. Cela ne constitue pas un test d’intrusion. Les styles inline restent autorisés pour Ant Design. HTTPS/HSTS, limites/délais et filtrage réseau du reverse proxy, suivi des journaux, sauvegardes/restaurations et contrôle des secrets de production restent des travaux de phase 6. Les environnements de production doivent être vérifiés avec leur véritable origine HTTPS.

## 21. Vérification manuelle

Suivre [GUIDE_ADMIN.md](GUIDE_ADMIN.md) et les étapes du [README](../README.md). Vérifier les douze opérations quotidiennes, les scénarios FIFO, les annulations/remplacements, les tarifs et historiques, les graphiques et liens, les paramètres/contact, logos valides/invalides et persistance après redémarrage, les jours fermés/horaires incompatibles, le changement de mot de passe et l’ancienne session révoquée. Contrôler bureau 1920×1080/1366×768, tablette/mobile, réduction du menu, modales et défilement. Ces validations visuelles restent à faire ; aucune réussite visuelle n’est présumée.

## 22. Limites et blocages

Aucun blocage technique restant. L’application conserve une réservation sur une seule journée jusqu’à 24:00, le déplacement d’occurrence dans sa semaine et l’actualisation manuelle des autres fenêtres après mutation. Les détails conservent leur historique ; une forte volumétrie nécessite des mesures avant une pagination serveur plus large. Les tests de persistance du logo utilisent des lecteurs distincts ; un redémarrage réel reste à vérifier manuellement. Aucun navigateur automatisé n’est utilisé. Aucune affirmation de préparation complète à la production n’est faite avant les vérifications manuelles et opérationnelles de phase 6.

## 23. Suite en phase 6

La [checklist de déploiement](PHASE6_CHECKLIST.md) prépare Ubuntu, Dockerfile/Compose de production, volumes PostgreSQL, secrets, migrations et transfert local éventuel, Apache/domaine/HTTPS, GitLab CI/CD, sauvegardes/rétention/restauration, surveillance, santé des conteneurs et retour arrière compatible avec le schéma. Il s’agit de documentation uniquement.

**La phase 5 s’arrête ici. La phase 6 et tout déploiement externe attendent votre approbation.**
