#!/bin/sh

set -e

echo "Demarrage du service Jackpot..."

echo "Bootstrap base de donnees (init_db)..."
python -m app.init_db

echo "Application des migrations de base de donnees (Alembic)..."
alembic upgrade head

echo "Lancement du serveur FastAPI..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
