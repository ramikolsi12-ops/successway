# Centre Formation Manager — Phase 5

Application locale d’administration d’un centre privé en Tunisie, en français. **Les professeurs paient le centre pour l’utilisation de ses salles.** Les montants sont exprimés en DT avec trois décimales et les horaires utilisent Africa/Tunis. Seul l’administrateur se connecte ; les professeurs sont des fiches de gestion.

## Démarrer sous Windows

Prérequis : Node.js 22.12+ sur la branche 22, ou Node.js 24 ; npm ; Docker Desktop démarré en mode conteneurs Linux.

Pour une installation déjà initialisée, ouvrir PowerShell :

```powershell
cd C:\Users\MSI\Downloads\SuccessWay
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Local.ps1
```

Ouvrir **http://localhost:3000** et conserver le terminal ouvert. Identifiant initial par défaut : **administrateur**, avec le mot de passe choisi à l’installation.

Si PostgreSQL est déjà démarré, lancer simplement :

```powershell
npm.cmd run dev
```

Après une mise à jour du projet, appliquer ses migrations avec PostgreSQL démarré, avant de relancer l’application :

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
```

Les neuf migrations existantes sont appliquées à la base locale vérifiée ; la phase 5 réutilise AppSetting et n’ajoute aucune migration. La commande peut être relancée. Pour une première installation :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Initialize-Local.ps1
```

Ajouter -SkipInstall si les dépendances sont déjà installées. Le script crée .env avec des secrets aléatoires, démarre PostgreSQL, applique les migrations et demande un mot de passe administrateur de 12 à 256 caractères, saisi deux fois de façon masquée. Seul son dérivé scrypt est conservé en base. Le seed conserve les comptes et salles existants, sans réinitialiser le mot de passe.

PostgreSQL écoute sur 127.0.0.1:5434 et utilise un volume Docker persistant. Les scripts détectent Docker même s’il est absent de PATH. Arrêter Next.js avec Ctrl+C. Pour arrêter PostgreSQL en conservant les données :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop-Database.ps1
```

Relancer ensuite Start-Local.ps1. Conserver le volume Docker du centre.

## Fonctions disponibles

La navigation contient six entrées : Tableau de bord, Emploi du temps, Salles, Professeurs, Paiements et Paramètres. Les actions sur les séances se font dans l’agenda ; les onglets de consultation des salles et professeurs restent disponibles. Les modules Étudiants, Groupes, Matières et Rapports sont supprimés. Aucune page autonome Séances ni export de rapport n’est proposé.

- Salles : ajout, modification, détails, recherche, filtres, activation et désactivation confirmée. Les réservations futures bloquent la désactivation.
- Professeurs : fiches, recherche, filtres, activation, tarifs datés, séances, paiements et statistiques. L’historique est conservé.
- Agenda horizontal : heures en haut, salles à gauche, précision à la demi-heure, blocs de durée variable, navigation par jour et semaine et création depuis un créneau.
- Programmations fixes hebdomadaires, séances provisoires et exceptions d’occurrence ; modification d’une occurrence dans sa semaine ou de la programmation à une date d’effet.
- Statuts Prévue, En cours, Terminée, Absent et Annulée. Le temps écoulé ne modifie jamais automatiquement un statut.
- Prix par séance : tarif conventionné à la date locale, exception individuelle facultative et confirmation du prix à la finalisation.
- Paiements en espèces : formulaire compact, aperçu serveur, affectation FIFO, règlements partiels ou complets, corrections auditées et historique.
- Tableau de bord mensuel : séances, statuts, salles et professeurs programmés, encaissements et montants restant à encaisser pour le mois sélectionné.

## Paiements et tarification

Un professeur possède un seul tarif applicable à une date donnée, avec bornes inclusives. Ajouter un tarif dans **Professeurs → Tarification** ; si le précédent reste ouvert, sa clôture à la veille du nouveau tarif doit être explicitement choisie. Le tarif ne dépend pas de la durée. Un changement de convention ne recalcule jamais les prix historiques des séances terminées.

Dans l’agenda, **Appliquer un tarif exceptionnel à cette séance** remplace le tarif habituel ; **Rétablir le tarif habituel** retire cette exception. Une exception lors de la création d’une série fixe concerne uniquement sa première occurrence. Un changement de professeur demande une décision explicite lorsqu’une exception existe.

La confirmation **Terminée** fige le prix et sa source dans une seule charge. Sans convention ni exception, la finalisation est refusée. Un tarif modifié entre l’affichage et la confirmation doit être revu. Prévue, En cours, Absent et Annulée ne génèrent aucune charge. Finaliser une séance ne crée aucun encaissement.

- Montant dû au centre = charges valides des séances terminées.
- Montant encaissé = paiements valides réellement reçus du professeur.
- Reste à encaisser = montant dû − montant encaissé ; il ne peut pas être négatif.

Dans **Paiements → Enregistrer un paiement**, renseigner seulement **Professeur**, **Montant reçu (DT)**, **Date du paiement**, et éventuellement **Note**. La date initiale est celle de Tunis ; les dates futures sont refusées. Tous les nouveaux paiements sont enregistrés en espèces côté serveur. Le formulaire, les listes, les filtres et les API ne proposent ni mode ni référence facultative.

L’aperçu présente les nombres de séances payées, partielles et impayées ainsi que le reste après règlement. Le paiement ne peut pas dépasser le reste réel. Sans dette, l’action est désactivée et le serveur répond : « Ce professeur n'a aucun montant à régler. » Les avances et crédits disponibles sont supprimés. Chaque paiement valide est entièrement affecté à des charges existantes.

Le serveur répartit automatiquement les fonds sur les séances terminées les plus anciennes, selon leurs dates réelles et leurs prix historiques. Exemple : une séance à 20 DT réglée par 15 DT reste partiellement payée à hauteur de 5 DT ; un second paiement de 5 DT la règle entièrement. Les deux paiements et leurs dates restent consultables. Un professeur inactif peut régler sa dette.

Les corrections conservent le paiement original invalidé, son éventuel remplacement et les affectations extournées. Une correction de prix terminé conserve ancien montant, nouveau montant et motif, sans mouvement de caisse ni changement du tarif conventionné. Si une correction ferait dépasser les charges par les encaissements, elle est refusée. Annuler une écriture erronée ne représente pas un remboursement réel.

Les écritures sont transactionnelles et sérialisées ; le serveur recalcule le solde avant confirmation. Un aperçu périmé exige une nouvelle confirmation ; une clé d’idempotence empêche les doublons. Une charge nulle est réglée sans encaissement et un paiement doit être strictement positif. Les champs historiques method/reference restent uniquement en base et dans l’audit privé pour préserver les données antérieures.

## Annuler et remplacer une séance

Depuis les détails d’une séance fixe dans **Emploi du temps**, **Annuler la séance** ouvre deux options :

1. **Annuler uniquement cette séance**, sélectionnée par défaut : libère la salle et le professeur pour cette occurrence. Les autres semaines restent inchangées.
2. **Annuler cette séance et toutes les suivantes** : arrête définitivement cette programmation à partir de la séance choisie. Une confirmation explicite est requise. Les réservations futures déjà matérialisées et encore prévues/en cours sont annulées ; les anciennes séances et leurs finances restent intactes.

Un motif facultatif peut être saisi. La présence d’une séance déjà terminée à partir de la date choisie bloque l’arrêt et demande de traiter la situation par le circuit de correction approprié. Une séance terminée ne peut pas être annulée par l’action ordinaire.

Pour une séance provisoire, une confirmation simple libère immédiatement son créneau. Les séances annulées sont masquées par défaut ; **Afficher les séances annulées** ouvre leur historique séparément de la grille active, sans bloquer les créneaux libres.

Après annulation, **Ajouter une séance à ce créneau** préremplit la salle, la date et les deux horaires exacts. Choisir le professeur et le type. Après une annulation unique, Provisoire est suggéré ; après un arrêt définitif, une nouvelle programmation Fixe peut être créée. Le tarif du nouveau professeur est utilisé ; aucune donnée financière ni identité d’occurrence n’est copiée.

Si seule une semaine a été libérée, une nouvelle série fixe qui chevaucherait les semaines suivantes est refusée : « Ce créneau est disponible cette semaine uniquement. Une séance fixe existe encore pour les semaines suivantes. » Les créneaux adjacents restent autorisés ; les contrôles de salle et de professeur sont effectués sur le serveur, y compris en cas de réservations concurrentes.

## Contrôles techniques

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run db:validate
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
node node_modules/prisma/build/index.js migrate status
```

Les tests d’intégration utilisent exclusivement centre_formation_test sur localhost:5435, avec .env.test. La garde refuse la base du centre. Démarrer Docker Desktop et, si nécessaire, le conteneur isolé :

```powershell
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose -f compose.test.yaml up -d --wait
```

La préparation ne vide que la base de test jetable. Aucun test ne crée de faux paiement ou de réservation dans la base du centre. Aucun Playwright, Cypress, Selenium ou test navigateur n’est installé ou exécuté. Les métadonnées de dépendances peuvent citer des intégrations navigateur facultatives ; ces paquets ne sont pas installés.

## Vérification manuelle des règles métier

Ces scénarios créent un historique conservé : les reproduire sur un environnement de vérification distinct du centre. Les scénarios chiffrés sont déjà couverts par les tests isolés.

1. Se connecter et vérifier les six menus, les fiches Salles/Professeurs, leurs filtres et l’absence des modules supprimés.
2. Ouvrir Paiements depuis le menu, une ligne et une fiche professeur : vérifier les trois champs obligatoires, la Note facultative, la date de Tunis et l’absence de mode, référence et crédit.
3. Choisir un professeur sans dette : vérifier le message et le blocage du paiement. Avec un reste de 200 DT, essayer 250 DT : refus ; 200 DT doit être accepté.
4. Pour une séance à 20 DT, enregistrer 15 puis 5 DT et consulter les deux paiements, les affectations, les dates et les statuts partiel puis payé.
5. Dans des situations initiales indépendantes de 20 séances à 20 DT, vérifier 200 DT : 10 payées ; 210 DT : 10 payées, la onzième partielle, reste global 190 DT. Vérifier aussi des prix historiques différents.
6. Corriger puis annuler une écriture avec motif et aperçu : vérifier la conservation de l’original et des anciennes affectations. Essayer une baisse de charge sous le montant déjà reçu : refus explicite, aucun argent supprimé.
7. Dans l’agenda, créer une séance avec exception de prix, rétablir le tarif, puis confirmer la fin. Vérifier la charge unique sans paiement automatique ; les statuts non terminés restent sans charge.
8. Annuler une occurrence fixe uniquement : première option sélectionnée, motif facultatif, semaines précédente et suivante intactes. Le créneau de la salle et du professeur doit être immédiatement disponible.
9. Utiliser **Ajouter une séance à ce créneau** : vérifier salle, date, début et fin exacts, professeur vide, Provisoire suggéré. Choisir un autre professeur et vérifier son tarif sans reprise de l’exception précédente.
10. Après une annulation unique, essayer un remplacement fixe ouvert dans le même créneau : vérifier le refus pour les semaines suivantes. Une réservation provisoire doit réussir.
11. Annuler une occurrence et toutes les suivantes avec confirmation : vérifier les semaines passées conservées, l’arrêt futur et l’annulation des exceptions futures prévues/en cours, y compris déplacées. Essayer ensuite une nouvelle série fixe indépendante au même créneau.
12. Avec une occurrence déjà terminée à partir de la date d’arrêt, vérifier le refus et la conservation exacte des séances, prix, charges, paiements et affectations.
13. Annuler une séance provisoire puis réserver à sa place. Activer **Afficher les séances annulées** : consulter les détails historiques sans gêner la sélection de la grille ni les remplacements actifs.
14. Vérifier conflits de salle/professeur, créneaux adjacents, déplacement d’une occurrence dans sa semaine, navigation, défilements et en-têtes fixes de la grille horizontale.
15. Vérifier les totaux des paiements, fiches et tableau de bord. Une mutation concurrente doit imposer la confirmation du nouvel aperçu ; un nouvel envoi identique ne doit pas créer de doublon.
16. Vérifier manuellement l’absence des anciens avertissements pg et Modal, puis se déconnecter et contrôler la protection des pages/API.

## Tableau de bord et paramètres

Le tableau de bord s’ouvre sur le mois courant à Tunis. **Mois sélectionné**, **Mois précédent**, **Mois suivant** et **Mois actuel** permettent de changer la période. Tous les indicateurs et les deux tableaux concernent ce mois : statuts et dates des séances, salles et professeurs programmés, charges historiques, encaissements et soldes impayés. Le graphique a été supprimé. Chaque séance conserve son lien vers les détails dans l’agenda.

**Encaissements reçus pendant le mois** suit la date des paiements espèces valides. **Reste à encaisser pour les séances du mois** correspond aux charges des séances dont le début local est dans ce mois, diminuées de leurs affectations valides, même reçues avant ou après la période. Les deux valeurs ne se soustraient pas directement : un paiement du mois peut régler une dette plus ancienne. Le formulaire de paiement conserve le solde complet du professeur et le FIFO sur tous les mois, sans modification des historiques.

Dans **Paramètres**, enregistrer le nom du centre, le téléphone, l’adresse et l’e-mail facultatif. Le nom et le logo sont repris dans le menu, la connexion et les zones d’identité. Le logo peut être prévisualisé, importé, remplacé ou supprimé. Formats : PNG, JPEG et WebP, 2 Mo maximum. Le serveur contrôle la signature et le décodage, refuse les images animées et normalise le fichier en WebP. Les octets sont conservés en base PostgreSQL, donc dans son volume persistant.

Configurer ensuite l’ouverture et la fermeture, par pas de 30 minutes, et les jours ouverts. Les nouvelles réservations et déplacements doivent respecter ces règles ; un changement incompatible avec une réservation future est refusé. La plage affichée suit les horaires, tout en s’élargissant pour les anciennes séances. **Journée entière** permet de consulter 00:00–24:00. Avant configuration, tous les jours et toute la journée restent autorisés pour conserver les possibilités des versions antérieures.

La section **Sécurité du compte** vérifie le mot de passe actuel, un nouveau mot de passe de 12 à 256 caractères et sa confirmation. Après succès, toutes les sessions sont révoquées et une nouvelle connexion est requise. Une déconnexion révoque également les sessions de la version courante. Aucun mot de passe ou dérivé n’est transmis dans les API de gestion ou les audits.

Le [guide administrateur en français](docs/GUIDE_ADMIN.md) décrit les douze opérations quotidiennes et la configuration du centre.

## Technologies et structure

Next.js 16 App Router, React 19, TypeScript strict, Ant Design 6, Prisma 7, PostgreSQL 17 et Vitest. La version 0.5.0 déclare sharp explicitement pour les images. Le tableau de bord ne contient aucun graphique.

| Dossier | Rôle |
| --- | --- |
| src/app | Pages, API et limites d’erreur Next.js |
| src/components et src/features | Interface commune et écrans métier |
| src/services | Réservations, tarification, finances, paramètres et sécurité du compte |
| src/validations | Schémas serveur Zod et messages français |
| src/server | Accès PostgreSQL, autorisation, requêtes bornées et configuration |
| src/lib | Dates de Tunis, géométrie, monnaie Decimal, FIFO et fonctions pures |
| prisma | Schéma, neuf migrations historiques et seed idempotent |
| tests | Unitaire et intégration PostgreSQL isolée |
| scripts | Installation et démarrage locaux Windows |
| docs | Architecture, guide, résultats et préparation de la phase 6 |

L’[architecture](docs/ARCHITECTURE.md) décrit l’identité des occurrences fixes, les exceptions, l’arrêt définitif des séries, les contrôles de chevauchement, les charges figées et les corrections FIFO auditées.

## Variables d’environnement

.env.example et .env.test.example contiennent uniquement des exemples. Les fichiers réels .env et .env.test sont ignorés ; conserver leurs valeurs hors du dépôt. Aucun secret n’utilise NEXT_PUBLIC.

| Variable | Utilisation réelle |
| --- | --- |
| DATABASE_URL | Connexion PostgreSQL de Prisma ; obligatoire et validée |
| NEXTAUTH_URL | Origine canonique de l’application, sans chemin ; utilisée aussi pour contrôler les mutations |
| NEXTAUTH_SECRET | Secret aléatoire d’au moins 32 caractères ; la valeur d’exemple est refusée |
| POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT | Conteneur PostgreSQL du Compose local ; port 5434 par défaut |
| ADMIN_IDENTIFIER | Identifiant du premier compte créé par le seed ; administrateur par défaut |
| SEED_ADMIN_PASSWORD | Valeur transitoire utilisée par l’installation initiale, pas un mot de passe enregistré dans .env |
| TZ | Fuseau du processus et du conteneur ; les règles métier utilisent explicitement Africa/Tunis |
| NEXT_TELEMETRY_DISABLED | Désactivation facultative de la télémétrie Next.js |
| TEST_ADMIN_PASSWORD | Compte de fixture des tests, dans .env.test seulement |

En production, NEXTAUTH_URL exige HTTPS pour une origine distante ; l’exécution HTTP sur localhost reste permise pour la vérification locale. Les cookies deviennent Secure avec HTTPS et restent HttpOnly/SameSite=Lax. Les sessions durent huit heures, avec vérification de la version en base pour chaque accès protégé.

Le contrôle des identifiants est temporairement limité après cinq tentatives en quinze minutes. Un plafond global de trente vérifications par minute couvre aussi les identifiants inconnus ; les enregistrements de tentatives périmés sont purgés après 24 heures. Deux dérivations scrypt simultanées maximum par processus évitent une file ou une consommation de mémoire sans borne. La phase 6 devra compléter ces protections au niveau du reverse proxy.

## Compilation et démarrage de production local

Ces commandes vérifient le mode production sur ce poste ; elles ne déploient rien :

```powershell
npm.cmd run build
npm.cmd run start
```

PostgreSQL et .env doivent être disponibles. Arrêter un éventuel serveur de développement utilisant déjà le port 3000 avant start. Les scripts lancent uniquement l’application locale. Pour appliquer des migrations avec Docker dans PATH :

```powershell
docker compose up -d --wait db
npm.cmd run db:migrate
```

Les en-têtes de sécurité incluent nosniff, protection des cadres, Referrer-Policy, Permissions-Policy et CSP avec nonce différent par réponse. Les scripts ne nécessitent ni unsafe-inline ni unsafe-eval en production ; les styles Ant Design conservent unsafe-inline pour compatibilité. Les corps d’authentification sont limités à 16 Ko, les données JSON de gestion à 64 Ko et les logos à 2 Mo, sur les octets réellement lus.

En développement, la CSP reste stable entre les requêtes et autorise les scripts de Fast Refresh ainsi que le WebSocket du serveur local. Les ressources internes /_next/ ne passent pas par le contrôle des pages privées. Après une mise à jour de cette configuration, arrêter le serveur avec Ctrl+C, relancer npm.cmd run dev puis actualiser le navigateur avec Ctrl+F5 pour remplacer les anciens scripts déjà chargés.

## Résultats, vérification manuelle et suite

Les résultats effectivement exécutés figurent dans [VERIFICATION.md](docs/VERIFICATION.md). Le [rapport de phase 5](docs/PHASE5.md) distingue les contrôles réussis, la vérification manuelle restante et les travaux de déploiement non réalisés, avec l’inventaire des fichiers.

En plus des seize étapes métier ci-dessus, vérifier manuellement : le mois courant par défaut, le sélecteur de mois et ses boutons, un mois vide, les cartes et tableaux filtrés sur la période ; les liens agenda et le paiement depuis un débiteur ; le nom/contact du centre ; le logo valide, invalide, remplacé, supprimé et conservé après redémarrage ; les horaires, jours fermés et refus d’un changement incompatible ; l’accès aux anciennes séances ; le changement de mot de passe et le rejet d’une ancienne session ; la déconnexion ; les largeurs 1920×1080, 1366×768, tablette et mobile, les menus réduits, les modales et les défilements.

Aucun navigateur automatisé n’a été utilisé. L’application conserve les réservations sur une journée jusqu’à 24:00 et les déplacements d’occurrence dans sa semaine. Une fenêtre déjà ouverte nécessite une actualisation après une mutation effectuée ailleurs ; il n’existe pas de synchronisation temps réel. Les écrans de détail conservent leur historique consultable ; une volumétrie supérieure à l’usage local prévu devra faire l’objet de mesures avant de revoir leur pagination.

Le déploiement externe, Apache, le domaine, HTTPS/HSTS, la pipeline finale GitLab et les sauvegardes planifiées restent à réaliser selon la [checklist de phase 6](docs/PHASE6_CHECKLIST.md). La phase 6 n’est pas commencée et attend votre approbation. Les rapports des phases précédentes restent des archives ; les règles de la phase 4.1 sur la suppression des avances/crédits sont conservées.
