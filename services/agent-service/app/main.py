import logging
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import bcrypt
import os
from datetime import datetime
from uuid import UUID

logger = logging.getLogger("agent-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

from .database import get_db
from .models import Agent, CashRegister, CashRegisterTransaction, CashTxType
from .schemas import AgentCreate, AgentResponse, ProvisionRequest, AgentUpdate, AgentListResponse, LoginRequest
from .security import create_access_token, get_current_agent_id, verify_admin_key

app = FastAPI(
    title="AGDTech Agent & Cash Service",
    root_path=os.getenv("ROOT_PATH", "")
)

# verify_admin_key et get_current_agent_id importés depuis security.py

from sqlalchemy import func

@app.get("/admin/stats", dependencies=[Depends(verify_admin_key)])
async def get_agent_stats(db: AsyncSession = Depends(get_db)):
    # Total des caissiers actifs
    count_agents_result = await db.execute(select(func.count(Agent.id)))
    count_agents = count_agents_result.scalar() or 0
    
    return {
        "active_agents": count_agents
    }

@app.get("/admin/transactions", dependencies=[Depends(verify_admin_key)])
async def get_all_transactions(skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Liste toutes les transactions de caisse (Reserve au Backoffice)"""
    result = await db.execute(
        select(CashRegisterTransaction, Agent.display_name)
        .join(Agent, CashRegisterTransaction.agent_id == Agent.id)
        .order_by(CashRegisterTransaction.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = result.all()

    transactions = []
    for tx, agent_name in rows:
        transactions.append({
            "id": str(tx.id),
            "agent_id": str(tx.agent_id),
            "agent_name": agent_name,
            "tx_type": tx.tx_type.value,
            "amount": tx.amount,
            "balance_before": tx.balance_before,
            "balance_after": tx.balance_after,
            "reference": tx.reference,
            "description": tx.description,
            "created_at": str(tx.created_at) if tx.created_at else None
        })
    return transactions

@app.get("/admin/{agent_id}", dependencies=[Depends(verify_admin_key)])
async def get_agent_details_admin(agent_id: UUID, db: AsyncSession = Depends(get_db)):
    """Detail d'un agent avec sa caisse (Reserve au Backoffice)"""
    result = await db.execute(
        select(Agent, CashRegister)
        .join(CashRegister, Agent.id == CashRegister.agent_id)
        .where(Agent.id == agent_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    agent, caisse = row
    return {
        "agent": AgentResponse.model_validate(agent),
        "caisse": {
            "balance": caisse.balance,
            "created_at": str(caisse.created_at) if caisse.created_at else None
        }
    }

@app.patch("/admin/{agent_id}", response_model=AgentResponse, dependencies=[Depends(verify_admin_key)])
async def update_agent_admin(agent_id: UUID, update_data: AgentUpdate, db: AsyncSession = Depends(get_db)):
    """Met a jour un agent (Reserve au Backoffice)"""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalars().first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(agent, key, value)
    await db.commit()
    await db.refresh(agent)
    return agent

@app.get("/status", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "agent-service", "timestamp": str(datetime.now())}

# ---------------------------------------------------------
# ROUTE 0 : CRÉER UN AGENT (Register via Admin API Key)
# ---------------------------------------------------------
@app.post("/register", response_model=AgentResponse, dependencies=[Depends(verify_admin_key)])
async def register_agent(agent_in: AgentCreate, db: AsyncSession = Depends(get_db)):
    """Crée un nouveau compte caissier (Réservé au Backoffice via API Key)"""
    # 1. Vérifier si le téléphone existe déjà
    result = await db.execute(select(Agent).where(Agent.phone == agent_in.phone))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Ce numéro de téléphone est déjà utilisé.")
    
    # 2. Hacher le mot de passe
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(agent_in.password.encode('utf-8'), salt).decode('utf-8')
    
    # 3. Créer l'Agent
    new_agent = Agent(
        phone=agent_in.phone,
        display_name=agent_in.display_name,
        password_hash=hashed_password,
        kiosk_name=agent_in.kiosk_name,
        kiosk_location=agent_in.kiosk_location,
        role=agent_in.role
    )
    db.add(new_agent)
    await db.flush() 
    
    # 4. Créer sa Caisse physique
    new_cash_register = CashRegister(
        agent_id=new_agent.id,
        balance=0
    )
    db.add(new_cash_register)
    
    await db.commit()
    await db.refresh(new_agent)
    
    return new_agent

# ---------------------------------------------------------
# ROUTE 1 : CRÉER UN AGENT (Et sa caisse automatique)
# ---------------------------------------------------------
@app.post("/", response_model=AgentResponse, dependencies=[Depends(verify_admin_key)])
async def create_agent(agent_in: AgentCreate, db: AsyncSession = Depends(get_db)):
    # 1. Vérifier si le téléphone existe déjà
    result = await db.execute(select(Agent).where(Agent.phone == agent_in.phone))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Ce numéro de téléphone est déjà utilisé.")
    
    # 2. Hacher le mot de passe (Utilisation directe de bcrypt pour eviter les bugs passlib sur Python 3.12)
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(agent_in.password.encode('utf-8'), salt).decode('utf-8')
    
    # 3. Créer l'Agent
    new_agent = Agent(
        phone=agent_in.phone,
        display_name=agent_in.display_name,
        password_hash=hashed_password,
        kiosk_name=agent_in.kiosk_name,
        kiosk_location=agent_in.kiosk_location,
        role=agent_in.role
    )
    db.add(new_agent)
    await db.flush() # Force l'insertion pour récupérer l'ID généré
    
    # 4. Créer sa Caisse physique (solde initial = 0)
    new_cash_register = CashRegister(
        agent_id=new_agent.id,
        balance=0
    )
    db.add(new_cash_register)
    
    # 5. Valider la transaction (Atomicité garantie)
    await db.commit()
    await db.refresh(new_agent)

    logger.info(f"AGENT_CREATED id={new_agent.id} phone={new_agent.phone} name={new_agent.display_name}")

    return new_agent

# ---------------------------------------------------------
# ROUTE 2 : APPROVISIONNER LA CAISSE D'UN AGENT
# ---------------------------------------------------------
@app.post("/{agent_id}/provision", dependencies=[Depends(verify_admin_key)])
async def provision_cash(agent_id: UUID, req: ProvisionRequest, db: AsyncSession = Depends(get_db)):
    # 1. Chercher la caisse avec un verrouillage de ligne (FOR UPDATE) pour éviter les conflits
    result = await db.execute(
        select(CashRegister).where(CashRegister.agent_id == agent_id).with_for_update()
    )
    caisse = result.scalars().first()
    
    if not caisse:
        raise HTTPException(status_code=404, detail="Caisse introuvable pour cet agent.")
        
    balance_before = caisse.balance
    
    # 2. Déterminer le type de transaction intelligemment si non fourni
    tx_type = req.tx_type
    if not tx_type:
        if req.amount < 0:
            tx_type = CashTxType.PAYOUT
        elif "Vente" in (req.description or ""):
            tx_type = CashTxType.BET_RECEIVED
        else:
            tx_type = CashTxType.PROVISION

    # 3. Vérifier que le solde ne deviendra pas négatif
    if req.amount < 0 and caisse.balance < abs(req.amount):
        raise HTTPException(
            status_code=400,
            detail=f"Solde insuffisant. Solde actuel : {caisse.balance} XAF, débit demandé : {abs(req.amount)} XAF"
        )

    # 4. Mettre à jour le solde
    caisse.balance += req.amount

    # 5. Créer la trace d'audit (Transaction)
    transaction = CashRegisterTransaction(
        cash_register_id=caisse.id,
        agent_id=agent_id,
        tx_type=tx_type,
        amount=req.amount,
        balance_before=balance_before,
        balance_after=caisse.balance,
        description=req.description
    )
    db.add(transaction)

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"PROVISION_FAILED agent={agent_id} amount={req.amount} error={e}")
        raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde de la transaction.")

    logger.info(f"PROVISION agent={agent_id} type={tx_type.value} amount={req.amount} before={balance_before} after={caisse.balance}")

    return {
        "status": "success",
        "message": f"Caisse approvisionnée de {req.amount} XAF",
        "new_balance": caisse.balance
    }


# ---------------------------------------------------------
# ROUTE 3 : LIRE TOUS LES AGENTS (Read)
# ---------------------------------------------------------
@app.get("/", response_model=list[AgentResponse], dependencies=[Depends(verify_admin_key)])
async def get_agents(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).offset(skip).limit(limit))
    agents = result.scalars().all()
    return agents

# ---------------------------------------------------------
# ROUTE 4 : LIRE UN AGENT ET SA CAISSE (Read)
# ---------------------------------------------------------
@app.get("/{agent_id}")
async def get_agent_details(agent_id: UUID, db: AsyncSession = Depends(get_db), current_agent: str = Depends(get_current_agent_id)):
    # On charge l'agent ET sa caisse en une seule requête
    result = await db.execute(
        select(Agent, CashRegister)
        .join(CashRegister, Agent.id == CashRegister.agent_id)
        .where(Agent.id == agent_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Agent introuvable")
        
    agent, caisse = row
    return {
        "agent": AgentResponse.model_validate(agent),
        "caisse": {
            "balance": caisse.balance,
            "created_at": caisse.created_at
        }
    }

# ---------------------------------------------------------
# ROUTE 5 : METTRE À JOUR OU SUSPENDRE UN AGENT (Update / Soft Delete)
# ---------------------------------------------------------
@app.patch("/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: UUID, update_data: AgentUpdate, db: AsyncSession = Depends(get_db), current_agent: str = Depends(get_current_agent_id)):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalars().first()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
        
    # Mise à jour dynamique des champs fournis
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(agent, key, value)
        
    await db.commit()
    await db.refresh(agent)
    
    return agent

# --- AUTHENTIFICATION ---

@app.post("/login")
async def login_agent(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Route pour connecter un caissier via son numéro de téléphone"""
    
    # 1. On vérifie que cet agent existe bien dans la base de données via son téléphone
    result = await db.execute(select(Agent).where(Agent.phone == request.phone))
    agent = result.scalars().first()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable avec ce numéro de téléphone.")
        
    # 1.5 Vérification du mot de passe
    password_bytes = request.password.encode('utf-8')
    hash_bytes = agent.password_hash.encode('utf-8')
    
    if not bcrypt.checkpw(password_bytes, hash_bytes):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Mot de passe incorrect"
        )

    # 2. On génère le token avec l'ID de l'agent stocké dans le champ "sub" (Subject)
    access_token = create_access_token(data={"sub": str(agent.id)})
    
    # 3. On renvoie le token au format standard OAuth2
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "agent_id": str(agent.id),
        "agent_name": agent.display_name 
    }