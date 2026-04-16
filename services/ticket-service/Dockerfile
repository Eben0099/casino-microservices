FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# Copier uniquement les requirements en premier
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le reste du code
COPY ./app ./app

# Exposer le port interne
EXPOSE 8000

# Lancer Uvicorn (sera écrasé par le docker-compose en dev)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
