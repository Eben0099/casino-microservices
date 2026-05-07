#!/bin/sh

set -e

echo "🚀 Démarrage du service Roulette..."

echo "📂 Application des migrations de base de données (Alembic)..."
alembic upgrade head

echo "🔥 Lancement du serveur FastAPI..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
