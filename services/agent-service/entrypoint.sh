#!/bin/sh

set -e

echo "🚀 Démarrage du service Agent..."

# Attendre que la base de données soit prête (optionnel, mais propre)
# On pourrait utiliser un outil comme 'nc' ou simplement laisser Alembic échouer et redémarrer (ECS fera le retry)

echo "📂 Application des migrations de base de données (Alembic)..."
alembic upgrade head

echo "🔥 Lancement du serveur FastAPI..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
