# Bilan détaillé — Phase 4

Version livrée : 0.4.0, le 24/11/2026.

## Fonctionnalités livrées

Le panneau Paiements propose les soldes des professeurs, les totaux sur toutes les périodes, la recherche nom/téléphone, les filtres financiers et actif/inactif, le tri et la pagination. Le même formulaire d’encaissement est disponible dans le panneau, chaque ligne et la fiche professeur.

L’administrateur saisit le montant, la date, le mode et éventuellement référence/notes. Un aperçu serveur indique les séances entièrement/partiellement réglées, les restes et le crédit. La confirmation enregistre un seul paiement réel et répartit ses fonds automatiquement. Les dates futures sont refusées, tandis que les paiements historiques et ceux des professeurs inactifs sont autorisés.

L’historique filtre professeur, dates, période rapide, mode et validité ; les totaux de caisse suivent les dates des paiements. Les détails montrent l’auteur, les allocations valides/extournées, les prix réels, le crédit et les corrections. Les fiches affichent l’historique chronologique des séances, source du prix, montant payé, reste, statut, règlement complet et paiements associés, avec lien vers l’agenda.

Dans l’agenda conservé, les formulaires affichent le tarif habituel, autorisent une exception individuelle ou son retrait et demandent une décision au changement de professeur. La finalisation permet d’ajuster/confirmer le prix ; les séances terminées présentent le règlement et permettent la correction auditée du tarif. Les couleurs opérationnelles et les statuts financiers sont distincts.

Le tableau de bord conserve ses statistiques de planification et ajoute encaissements jour/semaine/mois, séances restant à régler, professeurs débiteurs et crédits, avec liste compacte des dettes et derniers paiements.

## Résolution du prix

Il n’existe que deux niveaux configurables : la convention du professeur applicable à la date locale de début de séance, et TeachingSession.priceOverride facultatif. L’exception a priorité. Null supprime l’exception et rétablit l’héritage ; aucune valeur n’est copiée dans une fausse exception. Une série fixe ne porte aucun prix ; une exception initiale ne matérialise que sa première occurrence. La durée ne multiplie jamais le tarif.

La fin explicite fige le prix et sa source dans une charge unique. Sans convention ni exception, elle échoue sans écriture partielle. Si le tarif a changé après affichage de la confirmation, le nouveau montant doit être revu. Ni le passage du temps, ni une série, ni une absence/annulation ne créent de charge ou de paiement.

## Stratégie FIFO, crédit et corrections

Les charges valides sont triées par date/heure réelles de séance puis identifiant. Les paiements valides sont triés par date de réception, horodatage d’enregistrement puis identifiant. Prisma Decimal répartit chaque fonds jusqu’à épuisement, en réglant l’ancienne séance partielle avant la suivante. Les charges nulles sont réglées sans encaissement. Les sommes reçues ne sont jamais divisées par un tarif courant pour compter les séances.

L’excédent reste attaché aux paiements d’origine comme crédit disponible. Une nouvelle finalisation réaffecte ces fonds sans nouveau paiement. Le recalcul FIFO conserve les anciennes affectations comme extournées ; seules les affectations et paiements valides contribuent aux soldes.

Une correction de paiement conserve l’original invalidé et crée son remplacement. Une annulation n’est pas un remboursement réel. Corriger un prix terminé conserve ancien/nouveau montant, motif et date dans l’audit, sans changer de convention ou de paiement réel. Toutes ces opérations sont transactionnelles, sous verrou PostgreSQL commun, avec validation des limites et liens entre professeurs. Les doubles envois retrouvent leur résultat grâce à une clé d’idempotence ; un aperçu périmé impose une nouvelle confirmation.

Les créances et crédits sont calculés par professeur avant agrégation. Les périodes de caisse, dates de séances/finalisations et soldes actuels restent distincts. Les incohérences historiques bloquent l’écriture au lieu d’être réparées silencieusement.

## Prisma et migration

La migration 20261124000700_payments_pricing_and_audited_corrections ajoute priceOverride, PricingSource/pricingSource, recordedById, replacesId et leurs relations/contraintes. Les triggers protègent les paiements d’origine, les charges, les corrections et affectations ; une correction historique doit correspondre à un audit exact avec motif.

Les huit migrations sont appliquées et Prisma ne détecte aucun écart. Aucune ligne ni colonne supprimée, aucune réinitialisation du centre et aucune modification des sept migrations historiques. L’inspection trouve avant/après une séance terminée et sa charge cohérente de 20,000 DT, sans paiement ni affectation. Aucun rapprochement de charge historique n’était nécessaire et aucun paiement de test n’a été créé dans le centre.

## Avertissements signalés

Le problème pg provenait des sous-requêtes relationnelles Prisma partageant une connexion. Le pool sérialise cette connexion jusqu’à drain, sans masquer les avertissements ; erreurs, callbacks et reconnexions sont testés. Le cache HMR invalide une fois les anciens adaptateurs. Les modales utilisent mask.closable à la place de maskClosable.

## Fichiers créés (30)

- `prisma/migrations/20261124000700_payments_pricing_and_audited_corrections/migration.sql`
- `src/app/api/agenda/events/[id]/price-preview/route.ts`
- `src/app/api/agenda/events/[id]/price/route.ts`
- `src/app/api/payments/[id]/cancel/route.ts`
- `src/app/api/payments/[id]/correction/route.ts`
- `src/app/api/payments/[id]/preview/route.ts`
- `src/app/api/payments/[id]/route.ts`
- `src/app/api/payments/preview/route.ts`
- `src/app/api/payments/professors/[teacherId]/route.ts`
- `src/features/agenda/completion-modal.tsx`
- `src/features/agenda/financial-status.tsx`
- `src/features/agenda/price-correction-modal.tsx`
- `src/features/agenda/session-pricing-fields.tsx`
- `src/features/payments/charge-price-history.tsx`
- `src/features/payments/finance-ui.tsx`
- `src/features/payments/payment-detail.tsx`
- `src/features/payments/payment-form.tsx`
- `src/features/payments/payment-history.tsx`
- `src/lib/fifo.ts`
- `src/server/financial-views.ts`
- `src/server/pg-pool.ts`
- `src/services/financial-state.ts`
- `src/services/payments.ts`
- `src/types/payments.ts`
- `src/validations/payments.ts`
- `tests/integration/database-queries.test.ts`
- `tests/integration/payments.test.ts`
- `tests/unit/fifo.test.ts`
- `tests/unit/pg-pool.test.ts`
- `docs/PHASE4.md`

## Fichiers modifiés (27)

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/VERIFICATION.md`
- `package-lock.json`
- `package.json`
- `prisma/schema.prisma`
- `src/app/(admin)/emploi-du-temps/page.tsx`
- `src/app/(admin)/paiements/page.tsx`
- `src/app/api/agenda/events/[id]/status/route.ts`
- `src/app/api/payments/route.ts`
- `src/components/dashboard-view.tsx`
- `src/features/agenda/agenda-view.tsx`
- `src/features/agenda/agenda.css`
- `src/features/agenda/recurrence-form.tsx`
- `src/features/agenda/session-form.tsx`
- `src/features/professors/finance-view.tsx`
- `src/features/professors/payments-overview.tsx`
- `src/features/professors/professor-profile.tsx`
- `src/server/db.ts`
- `src/services/agenda-read.ts`
- `src/services/agenda.ts`
- `src/services/dashboard.ts`
- `src/services/financial-read.ts`
- `src/types/agenda.ts`
- `src/validations/agenda.ts`
- `tests/helpers/test-database.ts`
- `tests/unit/database-cache.test.ts`

## Fichiers supprimés (0)

Aucun fichier source supprimé.

Les fichiers Prisma générés, .next et les utilitaires temporaires ignorés de .local sont exclus de cet inventaire. Aucun nouveau paquet n’a été ajouté ; package.json et son verrou passent à 0.4.0.

## Commandes et résultats

TypeScript, ESLint, validation Prisma et compilation de production réussis. Vitest : 126 tests unitaires (15 fichiers) et 76 tests PostgreSQL (6 fichiers), soit 202 tests réussis. Les contrôles incluent les exemples chiffrés obligatoires, les avances, corrections, annulations, concurrence, rollback, tarifs historiques, avertissement pg et régressions des phases précédentes.

Les commandes exactes et détails sont dans [VERIFICATION.md](VERIFICATION.md). Les tests PostgreSQL utilisent exclusivement la base jetable centre_formation_test sur localhost:5435. Playwright, Cypress, Selenium et toute automatisation navigateur restent exclus ; aucun de ces outils n’a été installé ou exécuté.

## Vérification manuelle et lancement

Ouvrir Docker Desktop puis lancer powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Local.ps1 depuis le projet ; npm.cmd run dev suffit si la base est déjà démarrée. Ouvrir http://localhost:3000, puis Paiements ou Emploi du temps. Le compte administrateur est conservé.

Les 20 étapes de phase 4 de [README.md](../README.md) couvrent les prix, héritages/exceptions, paiements simples et partiels,20séances, avances, filtres, corrections, absence d’avertissements et sécurité. Les étapes de régression des phases précédentes sont conservées. Le contrôle visuel reste manuel.

## Limites et phase 5

Une autre fenêtre déjà ouverte nécessite Actualiser ou un rechargement ; les vues sont invalidées pour les navigations suivantes, sans synchronisation temps réel. Les anciennes limites d’agenda (créneau dans une journée, jusqu’à 24:00, changement de programme à effet le lundi) sont conservées. Les affectations extournées restent stockées, ce qui augmente l’historique.

La correction exceptionnelle d’un état opérationnel terminé et les remboursements réels ne sont pas ajoutés. Les rapports et exports PDF/CSV restent exclus. L’affinage final du tableau de bord et de l’expérience appartient à la phase 5 ; sauvegardes/restaurations validées et déploiement de production restent à convenir et à réaliser.

Les panneaux Salles et Professeurs, l’agenda horizontal et l’authentification sont préservés. Les six menus sont inchangés et aucun panneau Séances autonome n’est recréé. La phase 4 s’arrête ici ; la phase 5 attend votre accord explicite.
