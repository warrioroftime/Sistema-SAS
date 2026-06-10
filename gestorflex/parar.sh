#!/usr/bin/env bash
# Para o GestorFlex (mantém os dados do banco no volume).
cd "$(dirname "$0")"

# docker com ou sem sudo
if docker info >/dev/null 2>&1; then DOCKER="docker"
elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then DOCKER="sudo docker"
else echo "❌ Docker não acessível."; exit 1; fi

if $DOCKER compose version >/dev/null 2>&1; then COMPOSE="$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"
else echo "❌ Docker Compose não encontrado."; exit 1; fi

$COMPOSE down
echo "GestorFlex parado. Os dados foram preservados."
echo "Para subir de novo: ./instalar.sh"
