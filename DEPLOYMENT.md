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

Le fichier est `docker-compose.prod.yml`, le projet Compose est `successway`, le réseau interne est `successway_backend` et le volume persistant est `successway_postgres_data`. Le réseau `backend` est un bridge avec `internal: true`, réservé à PostgreSQL, à l’application et aux opérations. L’application rejoint aussi le bridge `successway_web` pour permettre la publication sur le loopback de l’hôte ; PostgreSQL ne rejoint pas ce réseau et ne publie aucun port. Les images locales sont `successway-app:production` et `successway-tools:production` avec le tag généré par défaut ; `APP_IMAGE_TAG` permet de choisir un autre tag cohérent pour les deux images.

L’image `runner` repose sur Node.js 24 Debian Bookworm et contient la sortie Next.js `standalone`, ses ressources statiques et les dépendances natives Linux nécessaires, dont `sharp`. L’image `tools` conserve séparément la CLI Prisma et les sources d’initialisation. Les deux s’exécutent avec l’UID/GID `1001:1001`. Les dépendances sont installées dans Docker avec le fichier de verrouillage ; les `node_modules` Windows et les sorties `.next` locales ne sont pas réutilisés.

Les workers de construction Next.js sont limités à deux pour limiter les pointes de mémoire. Le système de fichiers des conteneurs d’application et d’outillage est en lecture seule, avec des répertoires temporaires en mémoire. Le cache Next.js est temporaire ; les données durables restent dans PostgreSQL.

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

Le dépôt configuré est `https://github.com/ramikolsi12-ops/successway.git`. Ne pas incorporer de mot de passe ou de jeton d’accès dans son URL ; utiliser l’accès Git configuré pour ce serveur si le dépôt est privé. Publier les fichiers de cette phase dans le dépôt avant de le cloner sur le VPS.

```bash
sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" /opt/successway
git clone https://github.com/ramikolsi12-ops/successway.git /opt/successway
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
| `APP_IMAGE_TAG` | Tag des images locales, `production` par défaut. |
| `TZ` | `Africa/Tunis`, fixé par Compose. |
| `NODE_ENV` | `production`, fixé par Compose. |
| `NEXT_TELEMETRY_DISABLED` | `1`, fixé par Compose. |

Le mot de passe administrateur n’appartient pas au fichier `.env.production`. Sa saisie se fait uniquement lors de l’initialisation, sans valeur passée sur la ligne de commande, dans l’historique Bash ou dans les journaux.

Ne pas afficher le contenu du fichier de secrets. Pour vérifier une configuration Compose, utiliser sa validation silencieuse plutôt qu’un rendu complet qui afficherait les variables interpolées. Ne pas utiliser `set -x` pendant les opérations de configuration. Ne pas modifier les secrets PostgreSQL d’un volume déjà initialisé en éditant simplement le fichier : les variables d’initialisation ne changent pas le mot de passe d’un rôle existant.

Sur la première installation, générer le fichier avec le script fourni. Il utilise `openssl rand -hex 32` pour PostgreSQL et `openssl rand -hex 48` pour l’authentification, écrit directement les valeurs dans le fichier avec un masque `077`, applique `600` et n’affiche aucun secret. Il refuse d’écraser un fichier existant, y compris un lien symbolique. Ne pas copier au préalable le modèle `.env.production.example` vers sa destination : il contient des valeurs d’exemple et empêcherait cette génération.

```bash
cd /opt/successway
set +x
bash scripts/docker/create-production-env.sh
stat -c '%a %U %n' .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

Le résultat de `stat` doit indiquer `600`. Pour une installation déjà configurée, conserver son fichier et ses secrets ; exécuter seulement la vérification des permissions et la validation Compose. La validation silencieuse contrôle le fichier Compose et ses variables requises ; elle ne remplace pas le contrôle de connexion effectué au démarrage.

## Construire et démarrer

Depuis le dépôt configuré :

```bash
(
  set -euo pipefail
  cd /opt/successway
  docker compose --env-file .env.production -f docker-compose.prod.yml build app migrate
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait app
  docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
)
```

La construction produit l’image d’application et l’image d’outillage. La commande de démarrage lance `db`, attend son contrôle de santé, lance `migrate`, puis démarre `app` uniquement si les migrations se terminent avec le code `0`. `migrate` applique `prisma migrate deploy` ; il ne lance ni `migrate reset` ni une suppression des données. Un conteneur `migrate` terminé avec `Exited (0)` est l’état attendu. `--wait` attend la santé des services persistants `app` et `db` ; le service ponctuel `migrate` est validé par sa réussite, pas par un état « running » durable.

Si la construction ou les migrations échouent, arrêter cette procédure et examiner les journaux. Ne pas démarrer manuellement l’application en contournant ses dépendances. Ne pas remplacer ces commandes par le Compose local `compose.yaml`, qui a un autre projet et une autre publication PostgreSQL.

## Premier administrateur

L’outil `node scripts/docker/init-admin.mjs` vérifie d’abord si un administrateur existe déjà. Si c’est le cas, il termine sans demander de mot de passe et sans réinitialiser le compte ou les paramètres existants. Sur une base neuve, il utilise l’initialisation existante pour créer l’administrateur et les salles de référence, avec un mot de passe de 12 à 256 caractères.

Depuis un terminal interactif, l’outil demande deux saisies masquées du mot de passe. Sans terminal interactif, il accepte une seule ligne secrète sur l’entrée standard, avec une taille bornée. Il refuse un mot de passe fourni dans les arguments de commande. La variable transitoire requise par le seed est limitée au processus enfant ; elle n’est pas enregistrée dans le fichier de production.

Exécuter une fois, après la réussite du démarrage et des migrations :

```bash
cd /opt/successway
docker compose --env-file .env.production -f docker-compose.prod.yml --profile tools run --rm --no-deps admin
```

Le mot de passe ne s’affiche pas pendant la saisie. Le résultat attendu sur une base neuve est la confirmation de création du compte et d’initialisation des données de référence. Une exécution ultérieure annonce qu’un administrateur existe et conserve les données. `--no-deps` évite de relancer les migrations pendant que l’application tourne : cette commande suppose donc que le démarrage précédent et ses migrations ont réussi et que PostgreSQL fonctionne encore.

Si le terminal Docker ne permet pas la saisie interactive, cette variante Bash transmet le secret par stdin sans argument ni fichier temporaire. La valeur reste dans une variable non exportée du sous-shell et disparaît à sa sortie :

```bash
(
  set +x
  set -euo pipefail
  cd /opt/successway
  IFS= read -r -s -p 'Nouveau mot de passe administrateur : ' production_admin_password
  printf '\n'
  printf '%s\n' "$production_admin_password" | docker compose --env-file .env.production -f docker-compose.prod.yml --profile tools run --rm --no-deps -T admin
  unset production_admin_password
)
```

Cette variante stdin ne demande pas de confirmation ; utiliser de préférence le terminal interactif à deux saisies. Aucun mot de passe ne doit être ajouté après `admin`, fourni avec `-e`, enregistré dans `.env.production` ou écrit dans une commande Git.

## Vérification de l’étape

Le contrôle attendu est la disponibilité des conteneurs, l’application des migrations, l’initialisation d’un administrateur sur une base neuve et la réponse du contrôle de santé local. Un code HTTP 200 sur ce contrôle ne prouve ni l’accès HTTPS public, ni la configuration d’Apache, ni le fonctionnement d’une sauvegarde.

```bash
cd /opt/successway
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
docker compose --env-file .env.production -f docker-compose.prod.yml port app 3000
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app migrate db
```

Le contrôle HTTP doit répondre `200` avec `{"status":"ok"}`. La commande `port` doit indiquer `127.0.0.1:3000` ; aucun port PostgreSQL ne doit apparaître publié dans `ps`. `app` et `db` doivent être sains et `migrate` terminé sans erreur. Les journaux Docker ont une rotation de trois fichiers de 10 Mo par conteneur. Ne pas joindre de fichier d’environnement, de rendu Compose complet ou d’inspection des variables aux extraits de journaux partagés.

`GET /api/health` vérifie la connexion, la présence de migrations terminées, l’absence de migration inachevée, les tables requises et le fuseau `Africa/Tunis`. En cas d’échec, il répond `503` avec une erreur générique, sans détail de connexion. Il n’exige pas d’authentification, ne modifie aucune donnée et envoie `Cache-Control: no-store`. Le contrôle Docker utilise cet endpoint avec Node.js ; `curl` n’est nécessaire que pour la vérification depuis l’hôte.

Ce contrôle ne compare pas la liste des migrations du dépôt à celle de la base et n’exige pas la présence d’un compte administrateur. La réussite du service `migrate` et l’initialisation du compte restent donc deux vérifications distinctes obligatoires.

L’authentification reste configurée avec l’origine HTTPS canonique et des cookies sécurisés. Ne pas changer cette origine pour contourner l’absence du reverse proxy : la vérification du formulaire de connexion sur le domaine public attend sa configuration lors de l’étape correspondante.

## Arrêt, maintenance et conservation des données

Pour arrêter seulement l’application, ou arrêter les services sans retirer leur volume :

```bash
cd /opt/successway
docker compose --env-file .env.production -f docker-compose.prod.yml stop app
```

```bash
cd /opt/successway
docker compose --env-file .env.production -f docker-compose.prod.yml stop
```

Après un simple arrêt, le redémarrage normal garde le contrôle des migrations :

```bash
cd /opt/successway
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait app
```

Un arrêt de l’application et de PostgreSQL n’exige pas de supprimer leur volume. Conserver le nom du projet Compose et celui du volume lors des mises à jour ; un changement peut faire apparaître une base vide différente de la base existante.

Ne pas lancer `docker compose down --volumes`, `docker volume prune`, `prisma migrate reset` ou une réinitialisation forcée sur ce projet. Ne pas copier `.env.test` vers le serveur et ne pas exécuter les suites d’intégration contre la base de production : leur préparation utilise une base jetable et efface ses fixtures.

Une mise à jour doit construire la nouvelle image, arrêter l’ancienne application avant les migrations, appliquer celles-ci puis redémarrer l’application uniquement après leur réussite. En cas d’échec d’une migration, conserver l’application arrêtée et examiner l’erreur sans supprimer les données ni marquer arbitrairement la migration comme appliquée.

## Mise à jour du dépôt et des conteneurs

Prévoir une fenêtre de maintenance et disposer d’une sauvegarde exploitable avant une mise à jour comportant des migrations sur des données réelles. La création d’un système de sauvegarde est hors de cette phase. Le bloc suivant conserve une référence à l’ancienne image, construit la nouvelle pendant que l’ancienne tourne encore, puis arrête l’application avant toute migration. Son sous-shell s’arrête à la première erreur.

```bash
(
  set -euo pipefail
  cd /opt/successway
  previous_commit="$(git rev-parse HEAD)"
  previous_app_image="$(docker compose --env-file .env.production -f docker-compose.prod.yml images -q app)"
  test -n "$previous_app_image"
  previous_app_tag="successway-app:avant-$(date -u +%Y%m%dT%H%M%SZ)"
  docker image tag "$previous_app_image" "$previous_app_tag"
  printf 'Version précédente : %s\nImage conservée : %s\n' "$previous_commit" "$previous_app_tag"

  git pull --ff-only
  docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
  docker compose --env-file .env.production -f docker-compose.prod.yml build app migrate
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait db
  docker compose --env-file .env.production -f docker-compose.prod.yml stop app
  docker compose --env-file .env.production -f docker-compose.prod.yml up --no-deps --force-recreate --exit-code-from migrate migrate
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait app
  curl --fail --silent --show-error http://127.0.0.1:3000/api/health
  docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
)
```

Conserver les identifiants de version et d’image affichés. Le tag `production` est mutable et ne suffit pas, seul, à préserver la version précédente. La recréation explicite du service `migrate` évite de se fier au succès d’un ancien conteneur de migration. Si cette étape échoue, le sous-shell n’exécute pas le redémarrage de l’application.

Cette procédure conserve PostgreSQL 17 et le volume existant. Un changement de version majeure PostgreSQL ou une reprise de base demande une procédure distincte ; ne pas l’effectuer en modifiant simplement le tag de l’image.

Conserver l’identifiant de la version précédente. Un retour à une ancienne image n’est possible que si elle reste compatible avec le schéma désormais présent ; ce guide ne fournit aucune migration descendante automatique et n’autorise aucune restauration qui supprimerait des écritures réelles.
