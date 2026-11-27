# Préparation de la phase 6 — déploiement

Ce document prépare les décisions et vérifications du futur déploiement. La phase 6 n’est pas réalisée : aucune connexion à un serveur externe, aucun déploiement, aucune configuration Apache, DNS, certificat, tâche de sauvegarde ou pipeline final n’est effectué ici. La mise en production attend l’approbation du propriétaire après validation de la phase 5.

## Serveur Ubuntu et ressources

- [ ] Choisir une version Ubuntu LTS encore prise en charge à la date du déploiement ; définir la maintenance des correctifs et des accès SSH.
- [ ] Dimensionner CPU et mémoire à partir des mesures d’une construction de production et de l’usage simultané de Next.js et PostgreSQL. Pour ce centre à administrateur unique, commencer avec une instance simple, puis garder une marge pour les pointes de compilation, le décodage d’un logo et les sauvegardes ; ces besoins doivent être mesurés avant de choisir une offre.
- [ ] Prévoir un stockage persistant fiable pour PostgreSQL, sa croissance, les journaux et les archives de sauvegarde. Réserver une capacité hors du serveur pour les copies de secours ; un volume Docker sur le même disque ne remplace pas une sauvegarde.
- [ ] Installer Docker et le plugin Compose ; prévoir pare-feu, synchronisation de l’heure et surveillance de l’espace disque. Limiter les accès administratifs et ne pas exposer PostgreSQL à Internet.

## Images Docker et Compose de production à créer

- [ ] Créer et vérifier un Dockerfile de production ; le dépôt n’en fournit pas encore. Utiliser une version Node compatible avec `package.json`, `npm ci` et le fichier de verrouillage, générer Prisma, puis construire Next.js. Séparer les étapes de construction et d’exécution et lancer l’application avec un utilisateur sans privilèges.
- [ ] Inclure les ressources et dépendances d’exécution nécessaires, notamment les modules natifs de `sharp` compatibles avec l’image cible. Ne copier aucun `.env`, mot de passe, sauvegarde ou cache local dans l’image.
- [ ] Prévoir l’exécution des migrations avec la CLI Prisma et le dossier `prisma/migrations`, dans une étape dédiée. Une image minimale ne contenant que les dépendances de production doit garder un chemin explicite pour cette opération.
- [ ] Créer un Compose de production distinct du Compose local, qui ne lance actuellement que PostgreSQL. Définir services application/base, réseau privé, volumes, limites de ressources, redémarrage et contrôles de santé.
- [ ] Adapter la commande d’écoute du conteneur : `npm start` utilise actuellement `127.0.0.1`. Si Apache accède à un port publié du conteneur, l’application devra écouter sur l’interface du conteneur et le port publié devra rester limité à l’hôte ou au réseau privé prévu.
- [ ] Conserver les données PostgreSQL dans un volume persistant. Les paramètres, noms, contacts et logos sont dans `AppSetting` ; le logo n’exige pas de volume d’uploads séparé et fait partie de la sauvegarde de la base.
- [ ] Vérifier la persistance après recréation du conteneur, sur une copie isolée, sans utiliser les données réelles pour des essais destructifs.

## Variables et secrets réellement utilisés

| Variable | Préparation nécessaire |
| --- | --- |
| `DATABASE_URL` | Connexion PostgreSQL de l’application et de Prisma, avec identifiants propres à l’environnement cible et nom de service Docker approprié. |
| `NEXTAUTH_URL` | Origine canonique HTTPS publique, sans chemin. Elle sert aussi aux contrôles d’origine des mutations. |
| `NEXTAUTH_SECRET` | Secret aléatoire d’au moins 32 caractères, distinct de la valeur d’exemple ; à protéger et sauvegarder séparément. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Initialisation du service PostgreSQL Compose ; ne pas conserver les valeurs d’exemple. |
| `POSTGRES_PORT` | Publication locale du Compose actuel ; décider si une publication est nécessaire sur le serveur. |
| `TZ` | Africa/Tunis pour l’environnement système ; le code métier applique aussi explicitement ce fuseau. |
| `NODE_ENV` | `production` pour l’exécution de production. |
| `NEXT_TELEMETRY_DISABLED` | Option existante pour désactiver la télémétrie Next.js. |
| `ADMIN_IDENTIFIER` | Identifiant lu lors de l’initialisation de l’administrateur. |
| `SEED_ADMIN_PASSWORD` | Seulement pour la création initiale d’un administrateur absent ; fournir par un mécanisme temporaire sécurisé, puis retirer. |

- [ ] Utiliser des fichiers ou secrets protégés hors Git, avec permissions minimales. Les variables de test et les données de `.env.test` restent exclusivement locales et jetables.
- [ ] Éviter toute variable publique contenant un secret ; aucune variable `NEXT_PUBLIC_*` n’est nécessaire à cette configuration. Masquer les secrets dans les journaux et les variables GitLab.
- [ ] Vérifier la configuration réelle avant la construction et le démarrage. L’application refuse une origine publique de production sans HTTPS et un secret d’exemple ou trop court.

## Migrations et reprise des données locales

- [ ] Inventorier la version de l’application, le schéma, les migrations appliquées et la version PostgreSQL avant transfert.
- [ ] Effectuer une sauvegarde cohérente de la base locale avec `pg_dump`, conserver une copie intacte et vérifier sa restauration sur une base isolée. L’archive doit comprendre séances, identités des récurrences, tarifs, charges, paiements, affectations, audits, administrateurs et paramètres/logo.
- [ ] Préparer une fenêtre d’arrêt des écritures et une sauvegarde finale pour éviter de perdre des réservations ou paiements entre copie et bascule. Ne transférer aucune donnée réelle sans autorisation.
- [ ] Tester la restauration avec `pg_restore`, les extensions et contraintes requises, les permissions et le compte d’administration. Ne pas réinitialiser un administrateur ou réexécuter une création de compte si la base restaurée en contient déjà un.
- [ ] Relire le SQL des migrations à appliquer et exécuter `npm run db:migrate` (`prisma migrate deploy`) contre la cible explicitement vérifiée, après sauvegarde. Ne jamais utiliser `migrate reset` ou une réinitialisation forcée sur la base réelle.
- [ ] Comparer avant/après les nombres d’écritures et les contrôles financiers : charges valides, encaissements valides, affectations complètes et soldes non négatifs. Contrôler les prix historiques, annulations, séries arrêtées et logos sans réparer silencieusement une anomalie.

## Apache, domaine et HTTPS

- [ ] Choisir le domaine et préparer les enregistrements DNS après accord. Configurer Apache comme reverse proxy vers l’application privée, avec transmission correcte de l’hôte et du protocole d’origine.
- [ ] Installer le certificat HTTPS et son renouvellement ; vérifier redirection HTTP, origine canonique, cookies sécurisés, connexion, déconnexion et rejet des mutations provenant d’une autre origine.
- [ ] Conserver les en-têtes de sécurité de l’application et sa CSP à nonce sans les remplacer par une politique incompatible avec Next.js ou Ant Design. Décider de HSTS après validation durable du domaine et de HTTPS.
- [ ] Fixer des limites de corps et délais compatibles avec l’import d’images de 2 Mo. Vérifier que le logo public reste accessible sur la page de connexion et que les autres API exigent une authentification.

## GitLab CI/CD à préparer

- [ ] Créer ultérieurement un pipeline avec installation reproductible, lint, TypeScript, validation Prisma, tests unitaires, intégration sur base jetable et construction de production. Aucun test ne doit utiliser la base réelle.
- [ ] Construire et identifier une image immuable, analyser les dépendances, puis stocker l’image dans le registre retenu. Prévoir des variables protégées et masquées et des permissions minimales pour le runner et le registre.
- [ ] Exiger une validation manuelle pour la production. Préparer sauvegarde, migrations, démarrage, contrôles après déploiement et conservation de l’image précédente ; ne pas activer ce pipeline pendant la phase 5.

## Sauvegardes, restauration et rétention

- [ ] Définir avec le propriétaire la perte de données maximale acceptable et le délai de restauration attendu. En déduire fréquence et rétention ; prévoir des copies quotidiennes, hebdomadaires ou mensuelles selon ces objectifs, sans supprimer une archive avant vérification de sa remplaçante.
- [ ] Prévoir chiffrement, copie hors serveur, contrôle d’accès, intégrité des archives, suivi de leur taille et alerte d’échec. La conservation doit inclure le logo en base et la protection séparée des secrets nécessaires à la reprise.
- [ ] Rédiger et exécuter sur environnement isolé une procédure de restauration complète : provisionnement, restauration PostgreSQL, configuration des secrets, version applicative compatible, contrôles de connexion et rapprochement des données.
- [ ] Documenter la date, la durée et le résultat des exercices de restauration. Une archive créée sans restauration vérifiée n’établit pas que la reprise fonctionne.

## Surveillance, santé et retour arrière

- [ ] Suivre disponibilité de l’application, erreurs serveur, échecs de connexion, mémoire, CPU, disque, connexions PostgreSQL et exécution des sauvegardes ; éviter les données sensibles dans les journaux et définir leur rotation.
- [ ] Conserver le contrôle PostgreSQL `pg_isready` et définir un contrôle de disponibilité de l’application et de sa connexion à la base. Aucun endpoint de santé dédié n’est fourni actuellement ; sa conception reste à faire sans exposer de secrets ni créer une voie de mutation publique.
- [ ] Tester le redémarrage et l’ordre de disponibilité des conteneurs. Une base accessible ne suffit pas à vérifier l’application, ses migrations ou ses autorisations.
- [ ] Préparer un retour à l’image précédente et vérifier sa compatibilité avec le schéma après migration. Prisma ne fournit pas ici de procédure automatique de migration descendante ; ne pas supposer qu’un changement de schéma est réversible.
- [ ] Prévoir un arrêt contrôlé des écritures avant toute restauration de secours. Une restauration peut perdre les écritures postérieures à l’archive : faire valider ce choix et conserver les éléments nécessaires au rapprochement.
- [ ] Avant autorisation de mise en production, réaliser la vérification manuelle administrateur, confirmer sauvegarde/restauration et retour arrière, puis consigner les limites et alertes restantes.
