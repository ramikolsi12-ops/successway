# Bilan détaillé — Phase 2

## Fonctionnalités livrées

Gestion des salles avec création, modification, détails, disponibilité par créneau, activation et désactivation confirmée. Les séances planifiées à venir ou en cours bloquent la désactivation, côté service et PostgreSQL.

Gestion des professeurs avec ajout, modification, recherche par nom/téléphone, filtres, désactivation réversible et fiche à cinq onglets. La tarification historique utilise des périodes inclusives, interdit les chevauchements et permet la clôture explicite du prix précédent sans modifier les montants historiques.

Le tableau de bord et les fiches utilisent exclusivement les données stockées. Les profils affichent les statistiques mensuelles et les encaissements réels, ou un état vide. L’emploi du temps et les séances sont consultables avec filtres et pagination. La saisie des séances et des paiements reste réservée aux phases suivantes.

La navigation contient exactement Tableau de bord, Emploi du temps, Salles, Professeurs, Séances, Paiements, Paramètres. Le module Rapports est absent des pages, API, services et liens. Il n’existe aucune gestion d’étudiants, groupes, matières, présences ou salaires. Les professeurs ne disposent pas de comptes.

## Modèle financier corrigé

Les professeurs paient le centre. Les modèles sont Teacher, ProfessorRateAgreement, Classroom, TeachingSession, SessionCharge, ProfessorPayment, PaymentAllocation, AdminUser, LoginAttempt, AuditLog et AppSetting ; RecurrenceSeries est conservé pour la phase 3. Aucun modèle équivalent n’est dupliqué.

La migration 20261122000400_professor_receivables_and_resource_guards renomme les anciens objets, ajoute les garde-fous d’activité, protège la désactivation et conserve l’historique financier. Aucune ligne ni colonne n’a été supprimée. Le registre ancien étant vide, aucune donnée de salaire n’a été réinterprétée. Les anciens fichiers de migration restent inchangés.

Avant/après : compte administrateur (1), salles (6), professeurs, séances et écritures financières (0). La base locale est à jour avec quatre migrations. Prisma ne détecte aucune différence entre la base et le schéma.

Le net est dû moins encaissé ; reste = max(0, net), crédit = max(0, −net). Les affectations décrivent séparément le règlement des séances. Le crédit d’un professeur n’annule pas la dette d’un autre. Tous les calculs utilisent des décimaux et des chaînes monétaires à trois décimales.

## Retrait de Playwright

Les tests navigateur, la configuration, la dépendance directe, les paquets installés, le script npm et les artefacts ont été supprimés. Aucun framework E2E de remplacement n’a été ajouté. Aucun test navigateur n’a été exécuté dans cette phase. Les tests non navigateur existants sont conservés.

Les métadonnées publiées de Next.js/Vitest peuvent toujours mentionner des peers navigateur facultatifs ; aucun paquet correspondant n’est installé. Le verrouillage ne contient plus d’entrée de paquet Playwright. La configuration omit=peer et la déclaration explicite de Vite permettent de conserver Vitest sans installer ces intégrations.

## Fichiers créés

- `.npmrc`
- `docs/PHASE2.md`
- `prisma/classroom-bootstrap.ts`
- `prisma/migrations/20261122000400_professor_receivables_and_resource_guards/migration.sql`
- `src/app/(admin)/emploi-du-temps/page.tsx`
- `src/app/(admin)/paiements/page.tsx`
- `src/app/(admin)/professeurs/[id]/page.tsx`
- `src/app/(admin)/professeurs/page.tsx`
- `src/app/(admin)/seances/page.tsx`
- `src/app/api/classrooms/[id]/route.ts`
- `src/app/api/classrooms/[id]/status/route.ts`
- `src/app/api/classrooms/[id]/upcoming/route.ts`
- `src/app/api/classrooms/available/route.ts`
- `src/app/api/classrooms/route.ts`
- `src/app/api/payments/route.ts`
- `src/app/api/professors/[id]/agreements/route.ts`
- `src/app/api/professors/[id]/route.ts`
- `src/app/api/professors/[id]/status/route.ts`
- `src/app/api/professors/route.ts`
- `src/app/api/sessions/route.ts`
- `src/components/management-ui.tsx`
- `src/features/classrooms/classroom-form.tsx`
- `src/features/classrooms/classroom-management.tsx`
- `src/features/professors/finance-view.tsx`
- `src/features/professors/payments-overview.tsx`
- `src/features/professors/professor-form.tsx`
- `src/features/professors/professor-profile.tsx`
- `src/features/professors/professors-view.tsx`
- `src/features/professors/rate-form.tsx`
- `src/features/sessions/session-explorer.tsx`
- `src/lib/api-client.ts`
- `src/lib/business-error.ts`
- `src/lib/finance.ts`
- `src/lib/management-rules.ts`
- `src/server/api.ts`
- `src/services/classrooms.ts`
- `src/services/financial-read.ts`
- `src/services/management-shared.ts`
- `src/services/pricing.ts`
- `src/services/professors.ts`
- `src/services/sessions.ts`
- `src/types/management.ts`
- `src/validations/locale.ts`
- `src/validations/management.ts`
- `tests/unit/admin-api.test.ts`
- `tests/unit/classroom-bootstrap.test.ts`
- `tests/unit/incoming-finance.test.ts`
- `tests/unit/management-rules.test.ts`
- `tests/unit/management-services.test.ts`
- `tests/unit/management-validation.test.ts`

## Fichiers modifiés

- `.gitignore`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/VERIFICATION.md`
- `eslint.config.mjs`
- `package-lock.json`
- `package.json`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/app/(admin)/parametres/page.tsx`
- `src/app/(admin)/salles/page.tsx`
- `src/app/globals.css`
- `src/components/app-shell.tsx`
- `src/components/dashboard-view.tsx`
- `src/lib/dates.ts`
- `src/lib/format.ts`
- `src/lib/navigation.ts`
- `src/services/dashboard.ts`
- `src/validations/auth.ts`
- `tests/helpers/test-database.ts`
- `tests/integration/foundation.test.ts`
- `tests/sql/foundation.sql`

## Fichiers supprimés

- `playwright.config.ts`
- `src/app/(admin)/[module]/page.tsx`
- `src/components/classrooms-view.tsx`
- `src/components/module-notice.tsx`
- `tests/e2e/foundation.spec.ts`
- `tests/e2e/global-setup.ts`

Les dossiers d’artefacts test-results et .local/previews ont également été supprimés après vérification de leur emplacement dans le projet. Aucun pipeline CI spécifique n’était présent. Les utilitaires partagés avec les tests d’intégration non navigateur sont conservés.

## Vérifications

Les résultats finaux et commandes sont consignés dans [VERIFICATION.md](VERIFICATION.md). Les tests autorisés portent sur les validations, les statuts des salles, les réservations bloquantes, la tarification, l’historique, les calculs d’encaissement et les protections des API. Les tests d’intégration historiques n’ont pas été exécutés, conformément à la vérification unitaire demandée.

## Test manuel et lancement

Démarrer Docker Desktop, puis lancer Start-Local.ps1 ou npm.cmd run dev si PostgreSQL est déjà démarré. Ouvrir http://localhost:3000 et suivre les douze étapes de test manuel dans [README.md](../README.md). Le compte administrateur et son mot de passe sont conservés.

## Travail restant

Phase 3 : calendrier interactif, création/modification/annulation des séances, récurrences et contrôles complets de réservation. Phase 4 : génération des charges à la finalisation explicite, saisie des paiements reçus, affectations, avances et corrections financières auditées. Les sauvegardes/restaurations testées et le Docker de production restent à réaliser. Le module Rapports demeure exclu.

La phase 2 s’arrête ici. La phase 3 attend l’accord explicite de l’administrateur.
