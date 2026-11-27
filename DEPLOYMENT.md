# SuccessWay — exécution Docker de production

Ce guide prépare l’installation dans `/opt/successway` sur le VPS Contabo Ubuntu 24.04 prévu pour l’application : 4 vCPU, 8 Go de RAM et 100 Go de stockage. Docker Engine et le plugin Docker Compose doivent déjà être installés. Les commandes ci-dessous sont des commandes **Bash à exécuter sur ce serveur**, après relecture de leur cible ; elles n’ont pas été exécutées sur le VPS pendant cette phase.

L’origine canonique prévue est `https://gestion.successway.tn`. Cette phase prépare uniquement les conteneurs. Elle ne configure ni Apache, ni DNS, ni certificat TLS, ni sauvegarde Google Drive, ni pipeline GitLab CI/CD. Le domaine HTTPS ne devient donc pas accessible par la seule exécution de ce guide. La vérification de cette étape s’effectue localement sur le serveur avec `http://127.0.0.1:3000/api/health`.

## Organisation et persistance

- `app` exécute la compilation Next.js de production avec un utilisateur non privilégié. Le processus écoute sur `0.0.0.0:3000` dans son conteneur ; seul `127.0.0.1:3000` est publié sur le VPS.
- `db` utilise PostgreSQL 17. Son port n’est pas publié sur l’hôte. Les services communiquent par leur réseau Docker ; l’application utilise le nom de service `db`, pas `localhost`, pour joindre PostgreSQL.
- `migrate` applique les migrations Prisma dans un conteneur ponctuel distinct. L’application attend la disponibilité de PostgreSQL et la réussite des migrations avant de démarrer.
- `admin`, dans le profil `tools`, sert uniquement à l’initialisation contrôlée du premier administrateur. Il ne s’exécute pas à chaque démarrage.
- Le volume PostgreSQL contient les professeurs, réservations, récurrences, tarifs historiques, paiements, affectations, audits, comptes et paramètres. Le logo du centre est stocké dans `AppSetting`, dans cette même base ; aucun répertoire d’uploads séparé n’est nécessaire.
- Le fuseau métier et les conteneurs utilisent `Africa/Tunis`. Les montants restent en dinars tunisiens avec trois décimales.

Une recréation des conteneurs conserve le volume nommé. Le volume reste néanmoins sur le disque du VPS : il ne remplace pas une sauvegarde. Les sauvegardes, leur stockage extérieur et la restauration feront l’objet d’une étape séparée.

## Préparer le dépôt

Utiliser un compte autorisé à administrer Docker. Vérifier les outils disponibles :

```bash
docker version
docker compose version
git --version
openssl version
curl --version
```

Si Git, OpenSSL ou curl manquent, les installer avec les paquets Ubuntu correspondants avant de continuer. Aucun Node.js ni PostgreSQL installé directement sur le VPS n’est nécessaire pour exécuter les conteneurs.

Le dépôt Git n’a pas encore d’URL fournie. **Remplacer `URL_DU_DEPOT_GIT` par l’URL réelle du dépôt avant d’exécuter la commande `git clone`.** Ne pas y incorporer de mot de passe ou de jeton d’accès ; utiliser l’accès Git configuré pour ce serveur.

```bash
sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" /opt/successway
git clone URL_DU_DEPOT_GIT /opt/successway
cd /opt/successway
```

Cette installation prévoit une base de production neuve. Elle n’importe aucune donnée depuis le poste local et ne synchronise pas ses fichiers `.env`. La reprise d’une base existante nécessite une procédure et une autorisation séparées, avec inventaire, sauvegarde et restauration vérifiée ; ne pas la remplacer par une initialisation ou un effacement du volume.

## Variables et secrets

La configuration de production doit rester dans `/opt/successway/.env.production`, hors Git, avec les permissions `600`. Elle ne doit pas être copiée dans l’image ou son contexte de construction. Les secrets sont fournis aux conteneurs au démarrage, jamais par un argument de construction Docker ou une variable `NEXT_PUBLIC_*`.

| Variable | Utilisation |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB` | Compte et base initialisés par PostgreSQL lors de la première création du volume. |
| `POSTGRES_PASSWORD` | Secret aléatoire propre à cette base de production. |
| `DATABASE_URL` | Connexion interne à `db:5432`, cohérente avec les trois variables PostgreSQL. |
| `NEXTAUTH_URL` | `https://gestion.successway.tn`, sans chemin. |
| `NEXTAUTH_SECRET` | Secret aléatoire distinct du mot de passe PostgreSQL, d’au moins 32 caractères. |
| `ADMIN_IDENTIFIER` | Identifiant du premier administrateur, utilisé par l’outil d’initialisation. |
| `TZ` | `Africa/Tunis`. |
| `NODE_ENV` | `production` pour l’application. |
| `NEXT_TELEMETRY_DISABLED` | `1`. |

Le mot de passe administrateur n’appartient pas au fichier `.env.production`. Sa saisie se fait uniquement lors de l’initialisation, sans valeur passée sur la ligne de commande, dans l’historique Bash ou dans les journaux.

Ne pas afficher le contenu du fichier de secrets. Pour vérifier une configuration Compose, utiliser sa validation silencieuse plutôt qu’un rendu complet qui afficherait les variables interpolées. Ne pas utiliser `set -x` pendant les opérations de configuration. Ne pas modifier les secrets PostgreSQL d’un volume déjà initialisé en éditant simplement le fichier : les variables d’initialisation ne changent pas le mot de passe d’un rôle existant.

## Vérification de l’étape

Le contrôle attendu est la disponibilité des conteneurs, l’application des migrations, l’initialisation d’un administrateur sur une base neuve et la réponse du contrôle de santé local. Un code HTTP 200 sur ce contrôle ne prouve ni l’accès HTTPS public, ni la configuration d’Apache, ni le fonctionnement d’une sauvegarde.

L’authentification reste configurée avec l’origine HTTPS canonique et des cookies sécurisés. Ne pas changer cette origine pour contourner l’absence du reverse proxy : la vérification du formulaire de connexion sur le domaine public attend sa configuration lors de l’étape correspondante.

## Arrêt, maintenance et conservation des données

Un arrêt de l’application et de PostgreSQL n’exige pas de supprimer leur volume. Conserver le nom du projet Compose et celui du volume lors des mises à jour ; un changement peut faire apparaître une base vide différente de la base existante.

Ne pas lancer `docker compose down --volumes`, `docker volume prune`, `prisma migrate reset` ou une réinitialisation forcée sur ce projet. Ne pas copier `.env.test` vers le serveur et ne pas exécuter les suites d’intégration contre la base de production : leur préparation utilise une base jetable et efface ses fixtures.

Une mise à jour doit construire la nouvelle image, arrêter l’ancienne application avant les migrations, appliquer celles-ci puis redémarrer l’application uniquement après leur réussite. En cas d’échec d’une migration, conserver l’application arrêtée et examiner l’erreur sans supprimer les données ni marquer arbitrairement la migration comme appliquée.

Conserver l’identifiant de la version précédente. Un retour à une ancienne image n’est possible que si elle reste compatible avec le schéma désormais présent ; ce guide ne fournit aucune migration descendante automatique et n’autorise aucune restauration qui supprimerait des écritures réelles.
