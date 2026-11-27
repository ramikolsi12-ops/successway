# Architecture — Phase 5

Centre Formation Manager est un monolithe Next.js App Router en TypeScript strict, avec Ant Design en français et PostgreSQL 17 dans Docker. Les horaires utilisent Africa/Tunis ; les montants sont des Decimal(14,3) en DT, transmis au navigateur comme chaînes.

## Périmètre et sécurité

L’administrateur est le seul utilisateur authentifié. Les professeurs paient le centre pour leurs séances ; ils n’ont ni compte ni mot de passe. Les modules étudiants, groupes, matières, présences, salaires et Rapports sont exclus.

Les six sections sont Tableau de bord, Emploi du temps, Salles, Professeurs, Paiements et Paramètres. Les panneaux Salles et Professeurs de phase 2 sont conservés. Toutes les mutations de séances passent par l’agenda ; les fiches gardent leurs tableaux de consultation.

Auth.js Credentials conserve les sessions chiffrées, HttpOnly, SameSite=Lax et les mots de passe dérivés avec scrypt. Chaque page privée vérifie l’administrateur ; chaque API revérifie son existence, son activité et sa version de session. Les mutations exigent l’origine canonique NEXTAUTH_URL. LoginAttempt limite les essais persistants. Les audits sont append-only.

## Structure

- `src/features/agenda` : grille horizontale, formulaires, tiroir et styles spécifiques.
- `src/lib/scheduling.ts` : dates, semaines, récurrences bornées, géométrie, intervalles et transitions pures.
- `src/validations/agenda.ts` : validation des créations, exceptions, statuts, annulations et versions.
- `src/services/agenda-read.ts` : expansion sans écriture, DTO et réservations bloquantes.
- `src/services/agenda.ts` : transactions de réservation, exceptions, annulation, programmation et finalisation.
- `src/services/financial-state.ts` : projection centrale des charges, paiements, affectations, statuts et incohérences historiques.
- `src/services/payments.ts` : aperçus, encaissements, corrections, annulations et réaffectations transactionnelles.
- `src/lib/fifo.ts` : calcul déterministe de répartition des fonds avec Prisma Decimal.
- `src/features/payments` : formulaire réutilisable, aperçus, historiques, détails et audits lisibles.
- `src/server/pg-pool.ts` : sérialisation des requêtes d’une même connexion, sans désactiver les avertissements du pilote.
- `src/app/api/agenda` : API administrateur protégée.
- Les services existants de salles, professeurs et tableau de bord réutilisent ces projections.
- `tests/unit` et `tests/integration` : tests sans navigateur ; la seconde suite refuse toute base autre que la base jetable sur localhost:5435.

## Récurrences et identité

RecurrenceSeries conserve l’identité d’une programmation fixe. RecurrenceSchedule contient ses versions : professeur, salle, jour ISO 1–7, minutes de début/fin, dates inclusives, notes et horodatages. Les périodes non remplacées d’une même série ne peuvent pas se chevaucher. `supersededAt` conserve les versions futures remplacées ou arrêtées avant leur début, sans suppression.

TeachingSession reste l’occurrence concrète, avec professeur, salle, début/fin exacts et statut. Pour une séance fixe, `recurrenceId` et `occurrenceWeek` (lundi) forment une clé unique ; `originalDate` et `isException` gardent l’origine et la nature de la modification. Cette même ligne conserve déplacements, annulations, absences ou statuts opérationnels. Une seconde table d’exceptions équivalente n’est pas nécessaire.

Une occurrence fixe possède l’identifiant public stable `seriesId@lundi`, avant et après sa matérialisation. Le champ DTO `sessionId` contient son UUID concret quand elle est enregistrée. Une occurrence provisoire utilise son UUID et n’a pas de série.

La lecture développe uniquement les jours demandés et n’insère aucune ligne. Toute occurrence concrète supprime le calcul de l’occurrence normale de la même série et semaine, même si elle a été déplacée à un autre jour. Une modification individuelle est limitée à sa semaine. Les autres semaines ne changent pas.

Modifier une programmation prend effet un lundi à venir. Les versions chevauchant cette frontière sont clôturées ; les versions futures remplacées sont marquées, jamais supprimées. Cette modification conserve les occurrences déjà enregistrées, y compris les exceptions futures. Les versions antérieures permettent toujours de consulter les semaines passées.

L’API `POST /api/agenda/events/[id]/cancel` reçoit une portée, une confirmation explicite, une clé UUID d’idempotence et un motif facultatif. Elle retourne l’AgendaEvent avec son identité publique habituelle. Deux portées sont disponibles pour une séance fixe :

- `OCCURRENCE` matérialise ou met à jour uniquement la séance choisie en Annulée. La programmation et les autres semaines restent inchangées.
- `FOLLOWING` annule la séance choisie et arrête définitivement sa série à la date réelle locale de cette séance, même si elle a été déplacée ou si cette date n’est pas un lundi. Les versions chevauchantes se terminent la veille ; les versions commençant à partir de cette date sont marquées `supersededAt`. Les occurrences concrètes prévues ou en cours à partir de la semaine choisie sont annulées, y compris les exceptions déplacées. Les absences et annulations déjà enregistrées sont conservées.

L’arrêt vérifie d’abord qu’aucune séance de la série n’est terminée à partir de la date d’effet. Sinon, toute l’opération est refusée sans changement de séance, tarif, charge, paiement ou affectation. Une séance terminée ne peut pas être annulée individuellement. Les anciennes séances et les semaines virtuelles antérieures restent consultables ; la série reste active pour permettre cette lecture historique.

L’audit permanent `FIN_PROGRAMMATION_PAR_ANNULATION`, attaché à la RecurrenceSeries, conserve la date d’effet, les versions et les occurrences concernées. Il empêche toute réactivation par modification ou nouvel arrêt de la même série. L’ancienne API de fin de programmation utilise le même arrêt protégé, avec une date d’effet un lundi. Aucun arrêt ne supprime de ligne ni ne produit une suite infinie d’exceptions.

Une provisoire accepte uniquement `OCCURRENCE`. Le motif d’annulation est conservé dans l’audit ; les notes et prix de la séance restent intacts. Les annulations sont masquées dans l’agenda actif par défaut et restent accessibles avec « Afficher les séances annulées ». Elles ne bloquent pas les clics sur les créneaux libérés. L’action de remplacement préremplit salle, date et horaires, avec sélection indépendante du professeur et de son tarif.

## Réservations et concurrence

Les intervalles sont semi-ouverts `[début, fin)` : fin à 10:00 puis début à 10:00 est autorisé. Prévue, En cours et Terminée bloquent le créneau réservé ; Annulée et Absent le libèrent.

Chaque mutation d’agenda prend le verrou transactionnel PostgreSQL `pg_advisory_xact_lock(736204)` avant de lire les conflits. Les changements d’activité et de tarif prennent ce verrou dans le même ordre, puis les verrous des ressources. Les triggers de mutation prennent aussi le verrou avant les lignes. Ce choix sérialise les écritures critiques de cette application locale à administrateur unique.

Une réservation provisoire ou déplacée est comparée aux occurrences réelles et calculées du jour. Une programmation fixe est comparée aux autres versions hebdomadaires et aux occurrences concrètes, avec leurs exceptions. Les conflits de séries ouvertes sont recherchés mathématiquement, sans horizon arbitraire : seuls un nombre fini d’exceptions peut supprimer les premières semaines en conflit. Les contraintes GiST PostgreSQL renforcent les conflits entre occurrences concrètes ; une clé unique empêche la double matérialisation.

Une annulation libère immédiatement salle et professeur. Après `OCCURRENCE`, une nouvelle provisoire ou un déplacement peut occuper le créneau libéré, mais une nouvelle fixe reste refusée si elle chevauche les semaines suivantes de l’ancienne série : « Ce créneau est disponible cette semaine uniquement. Une séance fixe existe encore pour les semaines suivantes. » Après `FOLLOWING`, une nouvelle programmation indépendante peut réserver ce créneau sans reprendre les identifiants, prix exceptionnels ou écritures financières de la série arrêtée. Ces vérifications et l’annulation utilisent le même verrou pour protéger les remplacements concurrents.

Salles et professeurs inactifs refusent les nouvelles réservations. Les annulations, absences et finalisations historiques restent possibles après désactivation du professeur. La matérialisation intermédiaire et l’état final sont dans la même transaction ; aucun état intermédiaire n’est visible ou validé seul.

La disponibilité des salles inclut les programmations et les exceptions. La désactivation vérifie les occurrences prévues/en cours concrètes ainsi que la prochaine occurrence effective de chaque version fixe. Un trigger PostgreSQL applique aussi cette protection. La liste de refus présente toutes les occurrences concrètes concernées et une prochaine occurrence par programmation, plutôt qu’une liste infinie.

## Statuts et charges

Prévue peut devenir En cours, Terminée, Absent ou Annulée ; En cours peut devenir Terminée, Absent ou Annulée. Une répétition du même statut est idempotente. Les états terminaux ne peuvent pas être réouverts par les actions ordinaires. Aucun changement de statut ne dépend automatiquement de l’horloge.

Les horodatages de début confirmé, fin, absence et annulation sont enregistrés séparément. La finalisation choisit d’abord `priceOverride` s’il existe, puis le tarif actif couvrant la date locale de début de séance. Elle fige `rateAgreementId`, `rateSnapshot` et la source du prix, puis crée une SessionCharge unique. Le statut, le snapshot, la charge et l’audit sont dans une transaction unique. La finalisation ne réaffecte aucun paiement existant. L’absence de tarif et d’exception refuse toute la transaction ; aucun zéro implicite n’est utilisé. Le prix attendu transmis par la confirmation est comparé au prix courant pour refuser une convention devenue obsolète entre affichage et validation.

Les triggers protègent les références des séances terminées et des charges historiques, ainsi que la suppression des séances, séries, versions, écritures financières et audits. Un changement de prix historique n’est admis que si le contexte transactionnel désigne un audit de correction correspondant aux anciens/nouveaux montants, à la charge et au motif. Les états opérationnels terminaux restent protégés contre les modifications ordinaires.

## Finances et intégration

Teacher reste le modèle de fiche professeur ; ProfessorRateAgreement utilise des dates inclusives sans chevauchement. Modifier un prix crée une nouvelle convention et peut clôturer explicitement la précédente, sans réécrire un snapshot passé.

SessionCharge est une dette envers le centre, ProfessorPayment un encaissement reçu et PaymentAllocation son affectation à une ou plusieurs charges. La finalisation ne crée jamais de paiement.

Il existe seulement deux niveaux configurables : la convention du professeur et l’exception individuelle `TeachingSession.priceOverride`. Une valeur null rétablit l’héritage, sans copier le tarif courant. Les séries fixes ne portent aucun prix. Une exception initiale matérialise uniquement la première occurrence. Changer de professeur avec une exception nécessite une décision explicite de conservation ou de rétablissement. La durée ne multiplie jamais le prix par séance.

Par professeur : dû = charges valides de séances terminées, encaissé = paiements valides, reste = dû − encaissé. Le modèle impose `0 ≤ encaissé ≤ dû`, sans fonds destinés à des séances futures ni solde restant négatif. Les affectations déterminent séparément le statut payé/partiel/non payé. Les calculs utilisent Prisma Decimal ; les montants et dettes de deux professeurs ne se compensent pas.

Le tableau de bord inclut les occurrences fixes et concrètes du mois sélectionné, les cinq statuts et les nombres de salles/professeurs programmés, ainsi que les charges, encaissements et soldes mensuels. Les profils et détails de salle montrent les 100 dernières occurrences concrètes et les occurrences fixes non matérialisées des 90 prochains jours. L’agenda permet la consultation d’autres dates.

## Répartition et corrections financières

Le formulaire d’encaissement contient professeur, montant reçu, date et note facultative. La date proposée est le jour courant en Africa/Tunis. L’interface et les API n’acceptent aucun choix de mode de paiement ni référence facultative. Le serveur attribue systématiquement `ESPECES` et une référence nulle aux nouveaux encaissements, y compris aux remplacements créés par correction. Chaque encaissement crée un seul ProfessorPayment avec montant, date, auteur et clé d’idempotence. Les identifiants internes sont conservés.

Le montant doit être strictement positif et inférieur ou égal au reste à encaisser des séances terminées existantes ; les dates futures sont refusées. Le frontend applique cette limite et le backend recalcule le solde sous verrou dans la transaction d’écriture. Un dépassement est refusé avec le montant maximal en DT à trois décimales. Sans dette, la saisie est bloquée avec « Ce professeur n’a aucun montant à régler. » L’activité du professeur n’interdit pas le règlement d’une dette historique.

FIFO trie les charges par date et heure réelles de séance puis identifiant. Les paiements sont triés par date de paiement, horodatage d’enregistrement puis identifiant. Chaque paiement est entièrement affecté aux charges les plus anciennes avant de passer aux suivantes ; une charge nulle est déjà réglée. Une charge peut être partiellement payée, mais aucun montant reçu valide ne reste sans affectation.

Un nouvel encaissement ou une correction recalculent la répartition globale du professeur. Les anciennes affectations sont extournées avec date et motif, puis les liens valides sont recréés. Une clé unique sur chaque paire paiement/charge valide et des triggers PostgreSQL empêchent les doublons, les montants non positifs, les dépassements et les liens entre professeurs différents. Une correction de prix ou de paiement qui laisserait les encaissements supérieurs aux charges est refusée avant toute écriture.

Les aperçus utilisent exactement le même allocateur que l’écriture. Leur empreinte représente l’état financier et les données de l’opération. Le serveur relit l’état sous le verrou transactionnel commun : en cas de changement, il retourne un nouvel aperçu avec conflit 409 et exige une nouvelle confirmation. Les requêtes répétées retrouvent le résultat dans un audit identifié par la clé d’idempotence ; une réutilisation pour une autre opération est refusée. Les erreurs de sérialisation ou interblocage réessayables ont un nombre de reprises borné.

Une correction de paiement invalide l’original avec motif et crée son remplacement (`replacesId` unique), sans réécrire montant, date ni métadonnées historiques d’origine. Les anciennes valeurs de mode et de référence restent dans la base privée et dans les audits nécessaires à leur conservation ; elles ne sont plus des fonctions de saisie, recherche, affichage ou DTO financier. Une annulation est une correction d’écriture, pas un remboursement. Les paiements et affectations invalidés sont conservés et exclus des totaux valides. Le prix terminé est corrigé dans l’agenda, avec ancien/nouveau montant dans l’audit et source exceptionnelle ; les paiements réels restent inchangés.

Les nombres de séances payées, partielles et non payées sont dérivés des allocations valides par charge. Le formulaire montre ces nombres et le reste à encaisser avant saisie, puis les séances réglées ou partiellement réglées et le solde après paiement dans l’aperçu. Une période d’encaissement suit `paymentDate`, une période de charges suit la fin confirmée ; le reste à encaisser est calculé sur toutes les périodes et par professeur avant agrégation. Les charges manquantes ou incohérentes, les montants reçus non affectés et les liens historiques entre professeurs sont signalés ; les écritures sont bloquées jusqu’au rapprochement, sans réparation silencieuse à la migration.

Les détails exposent les paiements associés, les affectations valides/extournées et les corrections de prix (ancien montant, nouveau montant, date, motif). Les pages financières concernées sont invalidées après validation de la transaction ; les formulaires rechargent leur vue et les autres pages se recalculent à la prochaine navigation.

## Compatibilité PostgreSQL et Ant Design

Prisma peut paralléliser les lectures de relations sur une même connexion transactionnelle. Le pool sérialise chaque connexion jusqu’à l’événement public `drain` de pg, y compris après une erreur SQL ; les connexions indépendantes restent concurrentes. Les promesses, callbacks, objets Query, erreurs terminales et reconnexions sont conservés. Les tests reproduisent la requête relationnelle responsable sans filtrer les avertissements.

Le cache de développement vérifie le constructeur Prisma, l’URL et une version de l’adaptateur. Les anciens clients sans sérialisation sont ainsi remplacés au premier rechargement. Les fenêtres Ant Design utilisent `mask.closable` ; la propriété dépréciée `maskClosable` est retirée.

## Migrations et limites

Les migrations antérieures restent inchangées. `20261124000700_payments_pricing_and_audited_corrections` ajoute les métadonnées de prix et de paiements ainsi que les protections des corrections et affectations. La migration additive `20261124000800_cash_settlements_without_overpayments` fixe le défaut `ESPECES`, refuse les nouveaux encaissements avec un autre mode ou une référence facultative et ajoute les contraintes différées sur paiements, charges et affectations.

Ces contraintes sont vérifiées en fin de transaction pour permettre la création atomique d’un encaissement avec ses affectations ou une réaffectation auditée. Elles imposent que chaque paiement valide soit entièrement affecté à des charges valides de séances terminées du même professeur et que le total reçu ne dépasse pas ces charges. La migration ajoute aussi un audit de simplification. Elle ne supprime ni colonne, ni ligne, ni montant, ni métadonnée historique et ne réécrit aucun ancien mode de paiement. L’inspection préalable et les contrôles après application ont confirmé la conservation des encaissements et de leurs affectations existantes, sans modification financière nécessaire.

L’interface accepte les créneaux d’une journée, par pas de 30 minutes, jusqu’à 24:00. La durée de deux heures n’est qu’une valeur initiale. Les consultations par intervalle sont limitées à 369 jours par requête ; l’agenda ne limite pas la navigation de semaine en semaine.

Le tableau de bord, les paramètres et les contrôles de sécurité de phase 5 sont implémentés ; leurs contrôles réels et limites sont consignés dans VERIFICATION.md. Les sauvegardes/restaurations testées et le déploiement Docker de production restent à réaliser. Playwright et toute automatisation navigateur demeurent exclus.

## Tableau de bord et lectures ciblées

Le tableau de bord développe uniquement le mois sélectionné via le paramètre month=AAAA-MM, avec le mois courant de Tunis par défaut. readMonthlyFinancialOverview réutilise les agrégats globaux et contrôles d’intégrité de readFinancialOverview, puis ajoute un agrégat des charges des séances dont le début local est dans la période. Le solde global reste disponible uniquement pour le formulaire de paiement et le FIFO complet. Aucun audit ni graphe détaillé de paiements n’est chargé pour les cartes.

Le graphique et ses helpers/styles ont été supprimés. Les encaissements du mois somment les paiements espèces valides selon paymentDate. Le reste des séances du mois utilise leurs charges historiques diminuées de toutes leurs affectations valides, indépendamment du mois des reçus ; soustraire simplement la caisse du mois serait incorrect lorsque le FIFO règle des dettes antérieures. Les montants restent numeric/Prisma Decimal puis chaînes. Les statuts sont explicites ; salles/professeurs programmés excluent absences et annulations. Les séances sont classées par début et présentées avec leur date et lien vers l’agenda.

Les bornes temporelles sont construites avec atTunis puis liées comme paramètres Date par Prisma, comme les écritures et filtres ORM existants. Cela conserve le même périmètre que les dates affichées malgré le codec de l’adaptateur PostgreSQL installé sous une session non UTC. Une construction indépendante des bornes en SQL ne donne pas les mêmes résultats aux frontières du mois. Les tests vérifient cette concordance sans réécrire d’horaires ou modifier le fuseau des connexions.

L’agenda charge les charges et audits des seules séances terminées affichées via readSessionFinancialDetails : deux requêtes indépendamment du nombre de professeurs, aucune en l’absence de séance terminée. Les formateurs de charge, affectation et audit sont partagés avec readFinancialState ; le circuit complet de contrôle des écritures financières reste intact.

## Paramètres persistants et horaires

Les clés AppSetting existantes centre et operatingHours stockent l’identité/contact et les horaires. Les métadonnées fixes du seed sont conservées. Avant configuration, les sept jours et la plage 00:00–24:00 préservent les possibilités de réservation précédentes. Le lecteur échoue explicitement pour une configuration enregistrée invalide ; il ne substitue pas silencieusement des soldes ou réservations vides.

Le logo est stocké dans AppSetting centre.logo, normalisé en WebP et servi par /api/centre/logo ; seul ce contenu public est accessible avant connexion. La marque (nom/URL du logo) bénéficie d’une déduplication limitée à la requête React. Import/remplacement/suppression passent par les API administrateur avec origine canonique. Le serveur borne les octets à 2 Mo, vérifie signature, format décodé, nombre de pages et limites de pixels, puis réencode en retirant les métadonnées. Ni fichier temporaire éphémère ni accès à un stockage externe n’est requis. Les audits gardent taille/dimensions/empreinte, sans recopier l’image.

Les créations et déplacements contrôlent jours ouverts et bornes de demi-heure dans la transaction de réservation. Les changements de paramètres prennent le même verrou 736204 et refusent toute incompatibilité avec les séances concrètes futures/en cours ou la prochaine occurrence effective des versions fixes. Chaque exception stockée supprime sa semaine calculée ; la recherche a donc une borne liée au nombre fini d’exceptions, sans horizon arbitraire. Les intervalles historiques traversant minuit sont contrôlés sur chaque journée effectivement occupée, avec borne de fin exclusive.

La lecture et les statuts/annulations historiques ne sont pas soumis aux nouveaux horaires. L’affichage suit les horaires actuels et s’étend aux séances historiques visibles. Un indicateur de l’heure de Tunis est informatif ; la géométrie horizontale reste exacte et les jours fermés interdisent les nouveaux créneaux.

## Sécurité de compte et HTTP

Le hachage existant scrypt N=131072, r=8, p=1, sel aléatoire de 32 octets et comparaison constante est conservé. Ces paramètres correspondent à la [recommandation scrypt OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). La dérivation est limitée à deux opérations simultanées par processus, sans file non bornée.

LoginAttempt réserve les tentatives sous verrou avant vérification. Un bucket global de trente tentatives par minute précède celui du compte (cinq par quinze minutes), empêchant de contourner la protection par rotation des identifiants. La purge ne concerne que les compteurs périmés de plus de 24 heures ; aucun audit financier n’est supprimé. Les blocages sont temporaires et les erreurs de connexion restent génériques.

Le changement de mot de passe vérifie le secret courant côté serveur, valide 12–256 caractères et la confirmation puis compare atomiquement le hash/version vérifiés avant de remplacer le dérivé et d’incrémenter sessionVersion. L’audit indique l’opération et la révocation, sans secret ni hash. Les tentatives de vérification du secret courant sont limitées. La déconnexion NextAuth révoque la version du jeton ; la condition sur la version empêche un ancien jeton de révoquer une connexion plus récente.

NEXTAUTH_URL et NEXTAUTH_SECRET sont validés côté serveur ; HTTP est accepté localement, HTTPS requis pour une origine de production distante. Les cookies NextAuth sont HttpOnly, SameSite=Lax et Secure pour HTTPS ; l’expiration reste de huit heures. Les pages et API protégées vérifient toujours l’activité et la version du compte en base.

En production, le proxy remplace tout nonce fourni par le client par une valeur aléatoire et transmet la CSP à Next.js et au navigateur. Le layout racine lit les en-têtes pour un rendu dynamique avec nonce sur les scripts du framework. En développement, le nonce entrant est supprimé et une politique stable autorise les scripts inline/eval de Fast Refresh et le WebSocket du serveur local. L’origine WebSocket est explicite car [connect-src self ne couvre pas ce protocole dans tous les navigateurs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src). Les chemins internes /_next/ sont exclus du proxy d’autorisation. Les styles inline restent permis pour Ant Design. Les politiques incluent object-src none, frame-ancestors none, base-uri self et form-action self, avec nosniff et les autres en-têtes de next.config.ts. HSTS et l’infrastructure TLS restent en phase 6.

Le lecteur partagé request-body.ts borne le flux réel, indépendamment du Content-Length : 16 Ko avant le parseur public NextAuth, 64 Ko pour le JSON de gestion et 2 Mo pour les logos. Le wrapper NextAuth conserve les contrôles CSRF natifs et reconstruit la requête sans changer les cookies ni le contexte. Les API de gestion exigent l’origine canonique et retournent des erreurs françaises non techniques avec no-store, y compris en cas d’échec. La limite globale d’erreur remplace une exception du layout par un message français et une action de reprise.
