#!/bin/sh
# Espera o SQL Server, prepara o banco (idempotente) e inicia a API.
set -e

echo "⏳ Aguardando o SQL Server e preparando o banco..."
ok=0
for i in $(seq 1 40); do
  if node setup-db.js; then ok=1; break; fi
  echo "   ...tentativa $i falhou, aguardando 5s"
  sleep 5
done

if [ "$ok" != "1" ]; then
  echo "❌ O banco de dados não respondeu a tempo."
  exit 1
fi

echo "🚀 Iniciando a API GestorFlex..."
exec node src/app.js
