# Bilan détaillé — Phase 4.1

Version livrée : **0.4.1**, le **25/11/2026**, fuseau Africa/Tunis.

## 1. Corrections livrées

La saisie d’un paiement contient professeur, montant reçu, date et Note facultative. Les nouveaux encaissements sont automatiquement en espèces côté serveur. Le mode, la référence facultative, les avances et le crédit disponible sont supprimés des formulaires, listes, filtres, fiches, tableaux de bord, aperçus, DTO publics et calculs courants.

Le montant est limité à la dette réelle de séances terminées, contrôlée sur le client puis recalculée dans la transaction. Sans dette, le paiement est bloqué. Chaque reçu valide est intégralement affecté à des charges existantes, sans montant réservé pour l’avenir. La tarification flexible, les paiements partiels, le FIFO, les corrections et l’historique sont conservés.

La modale d’annulation d’une fixe propose l’occurrence seule par défaut ou la séance et toutes les suivantes, un motif facultatif et une confirmation explicite d’arrêt de série. Une provisoire utilise une confirmation simple. La salle et le professeur sont libérés immédiatement ; l’action de remplacement préremplit le créneau exact. Les annulations restent dans un historique facultatif, séparé de la grille active.

Les six menus, les fiches Salles/Professeurs, l’authentification, les tarifs et la disposition horizontale restent en place. Aucun module Rapports ni panneau séparé Séances n’a été recréé.

## 2. Fichiers créés et modifiés

Inventaire par empreintes SHA-256 par rapport au début de cette phase, hors fichiers générés, dépendances, .next et utilitaires locaux ignorés. Aucun dépôt Git n’est disponible dans cet espace.

### Créés (7)

- `docs/PHASE41.md`
- `prisma/migrations/20261124000800_cash_settlements_without_overpayments/migration.sql`
- `src/app/api/agenda/events/[id]/cancel/route.ts`
- `src/features/agenda/cancellation-modal.tsx`
- `src/features/agenda/replacement-draft.ts`
- `tests/integration/agenda-cancellation.test.ts`
- `tests/unit/agenda-replacement.test.ts`

### Modifiés (33)

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/VERIFICATION.md`
- `package-lock.json`
- `package.json`
- `prisma/schema.prisma`
- `src/app/globals.css`
- `src/components/dashboard-view.tsx`
- `src/features/agenda/agenda-view.tsx`
- `src/features/agenda/agenda.css`
- `src/features/agenda/completion-modal.tsx`
- `src/features/agenda/price-correction-modal.tsx`
- `src/features/agenda/recurrence-form.tsx`
- `src/features/agenda/session-form.tsx`
- `src/features/payments/finance-ui.tsx`
- `src/features/payments/payment-detail.tsx`
- `src/features/payments/payment-form.tsx`
- `src/features/payments/payment-history.tsx`
- `src/features/professors/finance-view.tsx`
- `src/features/professors/payments-overview.tsx`
- `src/lib/fifo.ts`
- `src/lib/finance.ts`
- `src/services/agenda.ts`
- `src/services/financial-state.ts`
- `src/services/payments.ts`
- `src/types/management.ts`
- `src/types/payments.ts`
- `src/validations/agenda.ts`
- `src/validations/payments.ts`
- `tests/integration/foundation.test.ts`
- `tests/integration/payments.test.ts`
- `tests/unit/fifo.test.ts`
- `tests/unit/incoming-finance.test.ts`

## 3. Fichiers supprimés (0)

Aucun.

La suppression fonctionnelle a été réalisée dans les composants, types, validations et services existants. Les rapports des phases 2, 3 et 4 restent des archives historiques ; les règles de phase 4.1 remplacent leurs anciennes règles d’avance/crédit.

## 4. Schéma et données

ProfessorPayment.method reçoit désormais le défaut ESPECES. Aucun modèle en double n’a été ajouté. method/reference et les anciennes valeurs d’enum restent en base pour préserver les métadonnées historiques ; elles ne sont plus exposées dans les fonctionnalités de saisie ou les réponses financières publiques. Les identifiants internes, liens, paiements et affectations restent conservés. Aucun champ exclusivement dédié au crédit n’existait : il s’agissait de valeurs calculées, maintenant retirées.

L’inspection préalable en lecture seule n’a trouvé aucun encaissement excédentaire ou non affecté : aucune intervention sur de l’argent reçu n’a été nécessaire. Aucun enregistrement financier existant n’a été supprimé ou réécrit.

| Repère du centre | Avant | Après |
| --- | ---: | ---: |
| Paiements conservés | 2 | 2 |
| Paiements historiques hors espèces | 0 | 0 |
| Références facultatives historiques | 0 | 0 |
| Professeurs avec excédent/non-affecté | 0 | 0 |
| Séances concrètes | 3 | 3 |
| Charges | 1 | 1 |
| Séries fixes | 2 | 2 |
| Audits | 24 | 25 |

La ligne d’audit supplémentaire documente la migration de simplification. Les tests n’ont ajouté aucun faux paiement ou réservation dans le centre.

## 5. État des migrations

La migration additive **20261124000800_cash_settlements_without_overpayments** est appliquée au centre et à la base de test. Neuf migrations sont présentes et appliquées ; Prisma ne détecte aucun écart entre base et schéma. Aucune migration antérieure n’a été modifiée et aucune table, colonne ou ligne n’a été supprimée par cette phase.

La migration fixe le défaut espèces et ajoute une garde BEFORE INSERT refusant un autre mode ou une référence facultative. Des contraintes DEFERRABLE INITIALLY DEFERRED sur ProfessorPayment, PaymentAllocation et SessionCharge vérifient à la fin de transaction le plafond des encaissements et l’affectation intégrale de chaque paiement valide aux charges terminées du même professeur. La vérification différée autorise le reçu et ses affectations dans une seule transaction et les corrections auditées. Les protections précédentes des historiques et le verrou commun sont conservés.

## 6. Paiements, FIFO et corrections

Le serveur impose ESPECES et une référence nulle aux nouveaux reçus et aux remplacements créés par correction. Les schémas stricts refusent les paramètres de mode/référence fournis par un client. L’audit public utilise une liste de champs autorisés ; les originaux privés restent intacts.

Les charges sont triées par date/heure réelles de séance puis identifiant, et les reçus par date de paiement, date d’enregistrement puis identifiant. Prisma Decimal conserve les trois décimales sans division par le tarif courant. Chaque reçu est épuisé sur les charges existantes, en finissant les anciennes séances partielles avant les suivantes. Une charge nulle est réglée sans encaissement.

La finalisation crée uniquement une charge et ne consomme aucun fonds anticipé. Les corrections de reçu ou de prix simulent la nouvelle situation avant toute écriture ; une correction créant un trop-perçu est refusée. Les originaux et anciennes affectations extournées restent consultables. Les aperçus périmés imposent une nouvelle confirmation et les clés d’idempotence empêchent les doubles envois.

Le verrou transactionnel PostgreSQL commun 736204 protège la lecture du solde puis l’écriture contre les paiements concurrents. Les contrôles de base renforcent les validations applicatives. Les périodes d’encaissement restent distinctes du solde actuel sur toutes les périodes.

## 7. Stratégie d’annulation des récurrences

POST /api/agenda/events/[id]/cancel reçoit scope OCCURRENCE ou FOLLOWING, reason facultatif, confirm true et une clé UUID d’idempotence. OCCURRENCE matérialise ou modifie uniquement l’exception choisie en Annulée ; les semaines voisines, notes et prix restent inchangés.

FOLLOWING arrête la série à la date locale réelle de la séance sélectionnée. Les versions chevauchantes sont closes la veille et les futures versions sont marquées remplacées. Les occurrences futures déjà stockées et encore prévues/en cours sont annulées, y compris les exceptions déplacées. Les absences, annulations et séances historiques sont conservées. La série n’est pas supprimée ni désactivée globalement, pour conserver la lecture des anciennes semaines.

Un audit permanent FIN_PROGRAMMATION_PAR_ANNULATION empêche de réactiver la même série par une modification ou un nouvel arrêt. Aucun ensemble infini d’annulations n’est créé. L’ancienne action Arrêter la programmation utilise la même protection. Toute séance déjà terminée à partir de la date d’effet bloque l’opération avant modification des données financières.

## 8. Conflits et remplacement

Les annulations sont exclues des réservations actives. Une exception enregistrée supprime l’occurrence calculée de sa semaine, donc son créneau est réellement libéré. Après l’arrêt d’une série, ses versions ne réservent plus les dates suivantes. L’intersection conserve la règle début existant < fin proposée ET fin existante > début proposé ; les séances adjacentes restent autorisées.

Une seule semaine libérée permet une provisoire ou un déplacement. Une nouvelle fixe qui entrerait en conflit ultérieurement est refusée avec : « Ce créneau est disponible cette semaine uniquement. Une séance fixe existe encore pour les semaines suivantes. » Les comparaisons de séries ouvertes ne reposent pas sur un horizon arbitraire. Les créations et annulations partagent les contrôles serveur et le verrou de réservation.

Après succès, Ajouter une séance à ce créneau ouvre le formulaire avec salle, date et début/fin exacts, y compris 24:00. Le professeur, le prix et les identifiants financiers ne sont pas copiés. Provisoire est suggéré pour une annulation unique ; une nouvelle fixe indépendante est proposée après l’arrêt définitif. Les annulées sont masquées par défaut ; leur historique séparé ne bloque pas les clics ou les séances de remplacement.

## 9. Commandes exécutées

- npm.cmd run typecheck
- npm.cmd run lint
- npm.cmd run db:validate
- npm.cmd test
- npm.cmd run test:integration
- npm.cmd run build
- npm.cmd run db:migrate
- node node_modules/prisma/build/index.js migrate status
- node node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
- Inspection SQL en lecture seule avant/après et recherches des contrats/champs obsolètes et paquets navigateur.

Le conteneur PostgreSQL isolé a été démarré avec compose.test.yaml, sans modification du conteneur du centre.

## 10. Résultats effectifs

**131 tests unitaires dans 16 fichiers et 91 tests PostgreSQL dans 7 fichiers réussissent : 222 tests au total.** TypeScript, ESLint, validation Prisma et compilation Next.js de production réussissent en version 0.4.1. Les neuf migrations sont à jour et la comparaison de schéma est vide.

La couverture inclut les scénarios FIFO chiffrés, dépassements et absence de dette, reçus espèces et contrats stricts, corrections refusant un excédent, concurrence/idempotence/rollback, les deux portées d’annulation, historique financier inchangé, exceptions déplacées et remplacements. Les régressions des phases antérieures restent exécutées. Aucun navigateur automatisé n’a été utilisé. Voir [VERIFICATION.md](VERIFICATION.md) pour les résultats et conditions d’exécution.

## 11. Vérification manuelle et lancement

Le [README.md](../README.md) contient les commandes PowerShell de lancement, première installation, migration et arrêt ainsi que seize étapes manuelles. Elles couvrent les champs/formulaires, paiements 15+5 et 200/210, plafonds, corrections, annulations, historique facultatif, préremplissage, conflits et régressions visuelles. Les essais créant un historique doivent être réalisés dans un environnement de vérification distinct du centre.

Pour démarrer l’installation locale initialisée, ouvrir PowerShell dans le dossier du projet et lancer :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Local.ps1
```

Ouvrir ensuite http://localhost:3000. Le mot de passe est celui choisi lors de l’installation.

## 12. Limites et suite

La validation visuelle et les interactions restent manuelles ; aucune réussite visuelle n’est présumée. Aucun Playwright, Cypress, Selenium ou outil E2E navigateur n’a été installé, écrit ou exécuté. Les pages déjà ouvertes dans d’autres fenêtres nécessitent une actualisation ; pas de synchronisation temps réel. Les créneaux restent dans une seule journée jusqu’à 24:00 et une occurrence déplacée reste dans sa semaine.

Les champs historiques method/reference restent privés en base pour éviter une suppression destructive et préserver l’historique. Il ne reste aucune fonctionnalité d’avance/crédit. Aucun blocage technique connu après les contrôles exécutés.

**La phase 5 n’a pas été commencée et attend votre approbation.**
