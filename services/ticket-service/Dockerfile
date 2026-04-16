FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Copier uniquement les requirements en premier
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le reste du code
COPY ./app ./app
COPY ./entrypoint.sh ./entrypoint.sh
COPY ./alembic ./alembic
COPY ./alembic.ini ./alembic.ini

# Rendre le script exécutable
RUN chmod +x ./entrypoint.sh

# Exposer le port interne
EXPOSE 8000

# Utiliser le script d'entrée pour lancer les migrations et le serveur
ENTRYPOINT ["./entrypoint.sh"]
