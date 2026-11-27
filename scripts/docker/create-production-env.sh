#!/usr/bin/env bash
set -euo pipefail
umask 077

if (( $# > 1 )); then
  printf '%s\n' 'Usage : bash scripts/docker/create-production-env.sh [fichier-cible]' >&2
  exit 1
fi

production_env_path="${1:-.env.production}"
if [[ -e "$production_env_path" || -L "$production_env_path" ]]; then
  printf '%s\n' 'Le fichier cible existe déjà : aucun secret existant ne sera remplacé.' >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  printf '%s\n' 'OpenSSL doit être installé pour générer les secrets.' >&2
  exit 1
fi

database_password="$(openssl rand -hex 32)"
authentication_secret="$(openssl rand -hex 48)"

# noclobber also protects against another process creating the target meanwhile.
(
  set -o noclobber
  cat > "$production_env_path" <<EOF
APP_IMAGE_TAG=production
POSTGRES_USER=successway
POSTGRES_DB=successway
POSTGRES_PASSWORD=${database_password}
DATABASE_URL=postgresql://successway:${database_password}@db:5432/successway?schema=public
NEXTAUTH_URL=https://gestion.successway.tn
NEXTAUTH_SECRET=${authentication_secret}
ADMIN_IDENTIFIER=administrateur
EOF
)
chmod 600 "$production_env_path"
unset database_password authentication_secret
printf '%s\n' 'Configuration de production créée avec permissions 600. Les secrets ne sont pas affichés.'
