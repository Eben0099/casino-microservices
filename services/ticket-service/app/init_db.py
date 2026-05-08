"""
Bootstrap: cree la base de donnees du service sur l'instance Postgres
si elle n'existe pas encore. Utilise au demarrage avant 'alembic upgrade head'
sur AWS RDS (1 instance partagee + N bases logiques).

Variables attendues:
  DATABASE_URL        - URL de la DB du service (postgresql+asyncpg://...)
  ADMIN_DATABASE_URL  - URL admin pointant sur 'postgres' (DB master)

Si l'une des deux est absente on suppose qu'on tourne en local docker-compose
ou la DB est deja creee par init-databases.sql -> on no-op.
"""
import asyncio
import os
import sys
from urllib.parse import urlparse

try:
    import asyncpg
except ImportError:
    print("[init_db] asyncpg manquant — abandon (ok en build sans deps).")
    sys.exit(0)

RETRY_ATTEMPTS = 30
RETRY_DELAY_SECONDS = 3


def _to_asyncpg(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def main():
    db_url = os.getenv("DATABASE_URL")
    admin_url = os.getenv("ADMIN_DATABASE_URL")
    if not db_url or not admin_url:
        print("[init_db] DATABASE_URL ou ADMIN_DATABASE_URL absent — skip.")
        return

    db_name = urlparse(_to_asyncpg(db_url)).path.lstrip("/")
    if not db_name:
        print(f"[init_db] Nom de DB illisible dans {db_url} — skip.")
        return

    admin_clean = _to_asyncpg(admin_url)

    last_err = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            conn = await asyncpg.connect(admin_clean)
            try:
                exists = await conn.fetchval(
                    "SELECT 1 FROM pg_database WHERE datname = $1", db_name
                )
                if exists:
                    print(f"[init_db] Base '{db_name}' deja presente.")
                else:
                    print(f"[init_db] Creation de la base '{db_name}'...")
                    await conn.execute(f'CREATE DATABASE "{db_name}"')
                    print(f"[init_db] Base '{db_name}' creee.")
            finally:
                await conn.close()
            return
        except Exception as e:
            last_err = e
            print(f"[init_db] tentative {attempt}/{RETRY_ATTEMPTS} echouee: {e}")
            await asyncio.sleep(RETRY_DELAY_SECONDS)

    print(f"[init_db] echec apres {RETRY_ATTEMPTS} tentatives: {last_err}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
