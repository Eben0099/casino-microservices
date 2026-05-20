# Audit de l'infrastructure Casino Microservices

**Date de l'audit :** 2026-05-20
**Périmètre :** infrastructure AWS provisionnée par `infrastructure/*.tf`
**Région cible :** `eu-west-3` (Paris)
**Auteur de l'audit :** revue technique interne

---

## 1. Résumé exécutif

Le projet est une plateforme de casino composée de **5 microservices conteneurisés** déployée sur AWS via Terraform. L'architecture utilise exclusivement des **services managés** (Fargate, RDS, ElastiCache, ALB), ce qui en fait une mise en œuvre techniquement propre **mais largement surdimensionnée et trop coûteuse pour le stade actuel du produit (apprentissage / pré-production)**.

| Indicateur | Valeur |
|---|---|
| Coût mensuel constaté | **~ 100 $ / 7 semaines** (≈ **57 $ / mois lissé**, ≈ **120 $ / mois si laissé allumé 24/7**) |
| Services tournant 24/7 | 7 (5 Fargate + 1 RDS + 1 Redis + 1 ALB) |
| Free Tier mobilisable | quasi nul (cf. §4) |
| Risque sécurité bloquant | **OUI** : secrets en clair dans le Terraform |
| Recommandation principale | **Migrer vers une EC2 unique + Docker Compose** (économie ≈ 85 %) |

---

## 2. Inventaire des ressources déployées

### 2.1 Calcul (ECS Fargate)

Source : `infrastructure/ecs.tf`

| Service | Tâche Fargate | CPU | RAM | Architecture | Réplicas |
|---|---|---|---|---|---|
| Backoffice Web (React/Vite) | `casino-web` | 256 (.25 vCPU) | 512 MB | ARM64 | 1 |
| Agent Web (POS) | `casino-agent-web` | 256 | 512 MB | ARM64 | 1 |
| `agent-service` (API) | `casino-agent-service` | 256 | 512 MB | ARM64 | 1 |
| `game-roulette-service` (API + WebSocket) | `casino-game-roulette-service` | 256 | 512 MB | ARM64 | 1 |
| `ticket-service` (API) | `casino-ticket-service` | 256 | 512 MB | ARM64 | 1 |

**Total :** 5 tasks, 1.25 vCPU et 2.5 GB de RAM en permanence.

### 2.2 Bases de données managées

Source : `infrastructure/databases.tf`

| Ressource | Type | Stockage | Réseau | Free Tier |
|---|---|---|---|---|
| RDS PostgreSQL 15 | `db.t3.micro` | 20 GB | subnet privé, multi-AZ subnet group | uniquement les 12 premiers mois du compte AWS |
| ElastiCache Redis 7 | `cache.t3.micro` | 1 nœud | subnet privé | **non éligible** |

### 2.3 Réseau & Load Balancing

Source : `infrastructure/network.tf`, `infrastructure/alb.tf`

- 1 VPC `10.0.0.0/16`
- 2 subnets publics (`eu-west-3a`, `eu-west-3b`) avec `map_public_ip_on_launch = true`
- 2 subnets privés (`eu-west-3a`, `eu-west-3b`) pour les DB
- 1 Internet Gateway, **pas de NAT Gateway**
- 1 Application Load Balancer public (`casino-alb`) en HTTP/80
- 5 Target Groups (1 par service) avec health checks
- 7 Listener Rules (routing par path)
- **5 IP publiques IPv4** attribuées aux tasks Fargate (`assign_public_ip = true`)

### 2.4 Registry & Observabilité

| Ressource | Détail |
|---|---|
| ECR | 5 dépôts (`agent-service`, `ticket-service`, `game-roulette-service`, `backoffice-web`, `agent-web`), `force_delete = true` |
| CloudWatch Logs | 1 log group `/ecs/casino-microservices`, rétention 7 jours |

---

## 3. Décomposition détaillée du coût mensuel

Tarifs Paris (`eu-west-3`), conditions à la demande, **fonctionnement 24/7** :

| Poste | Détail du calcul | Coût mensuel |
|---|---|---|
| **ECS Fargate ARM** | 5 tasks × (0.25 vCPU × $0.04048/h + 0.5 GB × $0.004445/h) × 730 h | **~ $45** |
| **ALB** | $0.0252/h × 730 h + LCU (~$3) | **~ $22** |
| **RDS db.t3.micro** | $0.018/h × 730 h + 20 GB gp2 × $0.115 | **~ $15** |
| **ElastiCache cache.t3.micro** | $0.020/h × 730 h | **~ $15** |
| **IPv4 publiques** | 5 × $0.005/h × 730 h (facturé depuis fév. 2024) | **~ $18** |
| **CloudWatch Logs / ECR / data transfer** | divers | **~ $3** |
| **TOTAL 24/7** | | **≈ $118 / mois** |

> La facture constatée (~100 $ sur 7 semaines, soit ~57 $/mois) suggère que la stack a été éteinte/détruite par périodes — cohérent avec `force_delete = true` sur les ECR et `skip_final_snapshot = true` sur RDS.

### Coupables principaux

1. **Le ratio "managé / utilisé" est défavorable.** À ce stade, le trafic réel ne justifie ni un ALB, ni du Fargate, ni du RDS multi-AZ-ready.
2. **Rien ne s'éteint automatiquement** : `desired_count = 1` partout → la stack tourne même quand personne ne l'utilise.
3. **Multi-AZ partout** (subnets sur deux zones de disponibilité) → ressources réseau dupliquées sans gain réel à ce stade.
4. **5 IP publiques** alors qu'une seule (sur l'ALB) suffirait architecturalement.

---

## 4. Pourquoi le Free Tier ne sauve pas la facture

| Service | Free Tier ? |
|---|---|
| ECS Fargate | ❌ Aucun |
| ALB | ❌ (uniquement 750 h d'ELB *Classic* dans le Free Tier 12 mois) |
| RDS `db.t3.micro` | ⚠️ 12 mois seulement après création du compte |
| ElastiCache | ❌ Aucun |
| IPv4 publique | ❌ Facturé pour tout le monde depuis février 2024 |
| ECR | ✅ 500 MB / mois pendant 12 mois |
| CloudWatch Logs | ✅ 5 GB ingestion + 5 GB stockage |

---

## 5. Sécurité — points relevés pendant l'audit

### 5.1 Critique — secrets en clair

Fichier : `infrastructure/ecs.tf:11-16`

```hcl
pg_user_pass     = "postgres:SuperSecretPassword2026"
jwt_secret       = "MonSuperSecretCasino2026!NePasPartager"
admin_api_key    = "CleSuperSecreteBackoffice2026"
```

Le mot de passe Postgres apparaît également en clair dans `infrastructure/databases.tf:24`.

**Impact :** ces secrets sont versionnés dans Git et présents dans le `terraform.tfstate` (lui aussi committé, voir §5.4). Toute personne ayant accès au repo (ou au state) a un accès admin complet.

**Recommandation :** déplacer vers **AWS Secrets Manager** ou **SSM Parameter Store**, et injecter dans les tasks via `secrets` (et non `environment`) dans la `container_definitions`.

### 5.2 Élevé — ALB en HTTP simple

`infrastructure/alb.tf:85-94` : un seul listener `port = 80`, pas de TLS, pas de certificat ACM, pas de redirection HTTP→HTTPS. Toutes les requêtes (login JWT, payloads paris) passent en clair.

**Recommandation :** ajouter un certificat ACM + listener HTTPS 443 + redirection 80→443.

### 5.3 Moyen — tasks Fargate exposées en IP publique

`infrastructure/ecs.tf:137,196,258` : `assign_public_ip = true` sur tous les services. Les tasks sont accessibles via leur IP publique si un security group laisse passer (actuellement protégé par le SG `ecs_tasks`, mais le risque architectural reste).

**Recommandation :** placer les tasks en subnets **privés** avec un NAT Gateway *ou* un VPC endpoint pour ECR (plus économique).

### 5.4 Moyen — `terraform.tfstate` committé

Présence de `terraform.tfstate` et `terraform.tfstate.backup` dans `infrastructure/`. Le state contient les secrets et l'état complet de l'infra.

**Recommandation :** déplacer vers un backend distant (S3 + DynamoDB lock) et l'exclure du repo via `.gitignore`.

### 5.5 Bas — security groups permissifs

`infrastructure/alb.tf:26-33` : la règle `alb_to_ecs` autorise **tout port** (`0-65535`) en TCP depuis l'ALB. Mieux vaudrait restreindre aux ports réellement utilisés (5173, 8000).

---

## 6. Robustesse opérationnelle

| Sujet | Constat |
|---|---|
| Sauvegardes RDS | `skip_final_snapshot = true` → **aucune sauvegarde** à la destruction. Pas de configuration de `backup_retention_period`. |
| Haute disponibilité | RDS et ElastiCache en **single-AZ** (1 nœud) malgré 2 subnets configurés. Un incident AZ = downtime. |
| Auto-scaling | Aucun. `desired_count = 1` figé. |
| Health checks | OK sur les target groups (path `/status` ou `/agents/pos/`). |
| Logs | Centralisés sur CloudWatch, rétention 7 jours (faible mais raisonnable au stade actuel). |
| TLS | Aucun (cf. §5.2). |
| Domaine | Aucun nom de domaine configuré, l'accès se fait via le DNS de l'ALB. |
| CI/CD | Aucun fichier CI dans le repo pour le déploiement Terraform. |

---

## 7. Recommandations d'optimisation

### Option A — `terraform destroy` quand inactif *(no-code, immédiat)*
- Détruire chaque soir / week-end, relancer le matin (5–10 min).
- **Économie :** ~ 60–70 % (~ $35–40 / mois).
- **Limite :** pénible, oblige à reseeder les bases, IPs publiques changeantes.

### Option B — Couper Fargate la nuit *(EventBridge + scheduled task)*
- Garder RDS / Redis / ALB allumés, passer `desired_count = 0` sur les services Fargate hors heures de travail.
- **Économie :** ~ $25 / mois.
- Toujours ~ $80–90 / mois.

### Option C — **Une EC2 unique + Docker Compose** *(recommandé)*
Le projet contient déjà un `docker-compose.yml` complet et un dossier `traefik/` configurés et fonctionnels.

- 1× EC2 `t4g.small` (ARM, 2 vCPU, 2 GB RAM) → ~ $12 / mois, ou `t4g.medium` ~ $24 / mois.
- Postgres + Redis comme conteneurs sur le même hôte, volume EBS dédié pour les données.
- Traefik (déjà présent) remplace l'ALB.
- 1 Elastic IP (gratuite tant qu'attachée).
- **Total :** **~ $15 / mois** → **-87 %**.
- **Atout :** zéro changement de code applicatif.

### Option D — VPS hors AWS *(le moins cher)*
- Hetzner CX22 (4 GB / 2 vCPU) : **~ €4.50 / mois**.
- DigitalOcean Droplet 2 GB : ~ $12 / mois.
- Scaleway DEV1-S : ~ €7 / mois.
- Même `docker-compose.yml`. **-95 %**.

### Tableau récapitulatif

| Option | Effort | Coût mensuel cible | Pertes fonctionnelles |
|---|---|---|---|
| A — destroy/apply quotidien | nul | ~ $35 | non, mais friction quotidienne |
| B — scheduler Fargate | faible | ~ $80 | non |
| **C — EC2 + Docker Compose** | **moyen** | **~ $15** | **multi-AZ, autoscaling auto** |
| D — VPS hors AWS | moyen | ~ $5–12 | écosystème AWS complet |

---

## 8. Plan d'action proposé

### Court terme (cette semaine)
1. **Sortir les secrets** du Terraform → AWS Secrets Manager + variables.
2. **Ignorer `terraform.tfstate`** dans Git et migrer vers backend S3.
3. **Ajouter HTTPS** via ACM + listener 443.

### Moyen terme (ce mois)
4. **Choisir une cible d'hébergement** (Option C recommandée).
5. **Écrire un module Terraform `ec2-compose`** : EC2 `t4g.small`, EBS, Elastic IP, security group, user-data qui clone le repo et fait `docker compose up -d`.
6. **Migrer** la stack et **détruire** l'ancienne (`terraform destroy` sur le workspace ECS).

### Long terme (avant mise en production réelle)
7. Réintroduire le multi-AZ et les services managés **uniquement quand le produit a des utilisateurs et un revenu**.
8. Mettre en place une CI/CD (GitHub Actions → ECR/EC2).
9. Activer les sauvegardes RDS (`backup_retention_period = 7`).

---

## 9. Annexes

### A. Fichiers Terraform analysés
- `infrastructure/provider.tf`
- `infrastructure/network.tf`
- `infrastructure/security.tf`
- `infrastructure/alb.tf`
- `infrastructure/ecs.tf`
- `infrastructure/databases.tf`
- `infrastructure/ecr.tf`
- `infrastructure/outputs.tf`

### B. Hypothèses tarifaires
Tarifs publics AWS `eu-west-3` au 2026-05-20, conditions à la demande (On-Demand), pas de Savings Plan ni Reserved Instance souscrits. Calcul base 730 h / mois.

### C. Hors périmètre
- Performance applicative (cf. logs CloudWatch et code des microservices).
- Coût des outils externes éventuels (DNS tiers, monitoring SaaS, CDN).
- Coût Anthropic / OpenAI / autres API si utilisées par les services.

---

# Partie II — Plan de migration exécuté (Option C : EC2 + Docker Compose)

**Date de la migration :** 2026-05-20
**Statut :** infrastructure provisionnée, pipeline CI/CD en place, premier déploiement en cours de validation.

## 10. Décisions stratégiques retenues

| Décision | Choix | Pourquoi |
|---|---|---|
| Cible d'hébergement | **EC2 unique + Docker Compose** (Option C) | -85 à -90 % de coût, zéro changement de code applicatif |
| Compte AWS | **Nouveau compte dédié** (`264787847039`) | Profite du nouveau Free Tier (juillet 2025), isole l'historique |
| Plan AWS | **Free Plan** (provisoire) | Paid Plan recommandé (mêmes crédits, pas d'auto-close à M+6) — à upgrader |
| Région | `eu-west-3` (Paris) | Inchangé, latence locale |
| Instance EC2 | `t4g.small` ARM Graviton2, 2 GB RAM | Gratuit via **T4g Free Trial** jusqu'au 31 décembre 2026 |
| DB | RDS `db.t3.micro` Postgres 15, single-AZ | Couverte par les 200 $ de crédits Free Tier ~6-7 mois |
| Cache | Redis 7 en **conteneur** sur l'EC2 | ElastiCache hors Free Tier → 15 $/mois économisés |
| Registre d'images | **GHCR** (GitHub Container Registry) | Free Tier ECR plafonné à 500 MB → insuffisant. GHCR gratuit pour 500 MB privé puis $0.25/GB/mois |
| Auth CI → AWS | **Access Keys IAM** | OIDC plus sécurisé mais surdimensionné à ce stade — à migrer plus tard |
| Secrets Terraform | `terraform.tfvars` local **gitignored** | Pas de Secrets Manager (0.40 $/secret/mois inutile). SSM Parameter Store envisagé en v2 |
| TLS / HTTPS | **HTTP only** pour l'instant | sslip.io + Let's Encrypt prêts à activer le jour où un domaine est acheté |

## 11. Projection de coût après migration

| Période | Coût mensuel | Couverture |
|---|---|---|
| 2026-05 → 2026-11 (~6-7 mois) | **0 $** | 200 $ de crédits + T4g Free Trial |
| 2026-12 → 2027-08 (~9 mois) | **~3-5 $** | T4g expire (passage à $12/mois) mais RDS encore Free Tier |
| 2027-09+ | **~25 $ managé** ou **~11 $ Postgres conteneurisé** | Tout On-Demand |

Comparé à ~118 $/mois sur l'archi ECS initiale : **-100 % pendant 7 mois, puis -77 à -90 %** ensuite.

## 12. Inventaire de la nouvelle infrastructure

### 12.1 Ressources AWS provisionnées (dossier `infrastructure-ec2/`)

| Type | Identifiant | Détails |
|---|---|---|
| VPC | `casino-vpc` | `10.0.0.0/16` |
| Subnet public | `casino-public` | `10.0.1.0/24`, `eu-west-3a` |
| Subnets privés (RDS) | `casino-private-a` / `casino-private-b` | exigence DB subnet group multi-AZ |
| Internet Gateway | `casino-igw` | accès sortant pour l'EC2 |
| EC2 | `casino-app` (`i-07a311d10083523e1`) | `t4g.small`, Ubuntu 22.04 ARM64, EBS gp3 30 GB chiffré |
| Elastic IP | `13.36.124.253` | persistante, gratuite tant qu'attachée |
| RDS | `casino-db.cz2q6i64ittm.eu-west-3.rds.amazonaws.com` | Postgres 15, `db.t3.micro`, 20 GB chiffré, single-AZ |
| Security Groups | `casino-ec2-sg`, `casino-rds-sg` | 80/443 public, 22 admin-only, 5432 EC2→RDS uniquement |
| IAM user | `casino-github-actions` | policy minimale (sts, ec2:Describe*, logs read, S3 `casino-*`) |
| AWS Budget | `casino-monthly-cost` | seuils 50/80/100 % avec alertes mail |

### 12.2 Fichiers Terraform créés

```
infrastructure-ec2/
├── provider.tf            # AWS provider eu-west-3 + tags par défaut
├── variables.tf           # variables typées, secrets marqués sensitive
├── network.tf             # VPC + subnets + IGW + route tables
├── security.tf            # SG EC2 + SG RDS
├── ec2.tf                 # AMI Ubuntu ARM64, instance, EBS, EIP
├── user-data.sh           # bootstrap Docker + dossier /opt/casino
├── rds.tf                 # Postgres 15, single-AZ, chiffré
├── budgets.tf             # budget mensuel + alertes email
├── github-iam.tf          # IAM user + access keys pour GHA
├── outputs.tf             # IP, endpoint RDS, sslip hostname, checklist
├── terraform.tfvars.example  # template public
└── .gitignore             # exclut tfstate, tfvars, *.bak
```

### 12.3 Fichiers applicatifs créés ou modifiés

- `docker-compose.prod.yml` — compose dédié production : pas de Postgres local, images GHCR, lecture `.env`, plus de `--reload`, plus de volumes de code, restart `unless-stopped`. Le `docker-compose.yml` dev reste inchangé.
- `.github/workflows/deploy.yml` — réécrit. Build matrix ARM64 sur 5 services via QEMU + push GHCR, puis deploy SSH sur EC2 (`docker compose pull && up -d`).
- `docs/infrastructure-audit.md` — ce document (Partie I = audit initial, Partie II = recap migration).

## 13. Configuration runtime sur l'EC2

| Élément | Valeur / contenu |
|---|---|
| Hôte | Ubuntu 22.04 LTS ARM64 |
| User | `ubuntu` (membre du groupe `docker`) |
| Docker | v29.5.1, installé via `get.docker.com` |
| Docker Compose | plugin v5.1.3 |
| Workdir | `/opt/casino/` (owner `ubuntu`) |
| Fichiers | `docker-compose.prod.yml` + `.env` (jamais commité) |
| Variables `.env` | `GHCR_OWNER`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_API_KEY` |

## 14. Pipeline CI/CD

### 14.1 Déclencheurs
- Push sur `main`
- Déclenchement manuel via `workflow_dispatch`

### 14.2 Jobs
- **`build-push`** (matrix sur les 5 services) : checkout → lowercase `IMAGE_PREFIX` (GHCR exige minuscule strict) → setup QEMU + buildx → login GHCR → build ARM64 + push avec cache GHA → tags `:latest` et `:${{ github.sha }}`.
- **`deploy`** (séquentiel, après build) : auth AWS via Access Keys → `aws sts get-caller-identity` (sanity) → SSH dans l'EC2 → `docker login ghcr.io` → `docker compose -f docker-compose.prod.yml pull && up -d` → `docker image prune -f`.

### 14.3 Secrets GitHub (6 secrets)

| Nom | Source |
|---|---|
| `AWS_ACCESS_KEY_ID` | output Terraform `github_actions_access_key_id` |
| `AWS_SECRET_ACCESS_KEY` | output Terraform `github_actions_secret_access_key` |
| `AWS_REGION` | constante `eu-west-3` |
| `EC2_HOST` | EIP `13.36.124.253` |
| `EC2_SSH_KEY` | contenu du `casino-keypair.pem` |
| `GHCR_PULL_TOKEN` | Personal Access Token GitHub (`read:packages`, expire 1 an) |

## 15. Incidents traversés pendant la migration (lessons learned)

| # | Symptôme | Cause | Fix appliqué |
|---|---|---|---|
| 1 | `terraform apply` demande les secrets en interactif | `terraform.tfvars` absent | Création locale avec `openssl rand` + ajout à `.gitignore` |
| 2 | `No valid credential sources found` | Profil `casino` configuré avec un champ non standard (`login_session`) puis `aws_secret_access_key` sans `aws_access_key_id` | Wipe `~/.aws/{config,credentials}` puis `aws configure --profile casino` propre |
| 3 | **Secrets AWS leakés deux fois dans des messages de debug** | Diagnostic verbeux pendant le troubleshooting | Désactivation immédiate des access keys dans IAM + régénération |
| 4 | `creating EC2 Instance ... InvalidKeyPair.NotFound` | Key pair `casino-keypair` jamais créée dans la console | Création manuelle dans EC2 → Key Pairs |
| 5 | `FreeTierRestrictionError: backup retention period exceeds maximum` | Compte sur Free Plan limite la rétention RDS | `backup_retention_period = 0` (à remonter à 7 dès passage en Paid Plan) |
| 6 | `MasterUserPassword is not a valid password. Only printable ASCII besides '/', '@', '"', ' '` | `openssl rand -base64` produit des `/` interdits par RDS | Regénération avec `openssl rand -hex 24` |
| 7 | `ingress.X.description doesn't comply with restrictions` | Tirets cadratin Unicode `—` dans les descriptions de SG | Remplacement par `-` ASCII |
| 8 | `user-data` cloud-init en `error` | Mirror `ports.ubuntu.com` en *Mirror sync in progress* (`File has unexpected size`) | Switch sur le mirror régional AWS `eu-west-3a.clouds.ports.ubuntu.com` + install Docker via `get.docker.com` |
| 9 | `.env` sur l'EC2 sans valeurs (3 secrets vides) | Lignes du `terraform.tfvars` avec 2 espaces de début (copy-paste markdown) → `grep '^pg_password'` ne matchait pas | `sed -i 's/^[ \t]*//'` sur le tfvars + re-extraction + regénération via Python (sans shell quoting) |
| 10 | `terraform.tfvars.bak` (contenant les secrets) sur le point d'être commité | `sed -i.bak` crée un backup avec un suffixe que `.gitignore` ne couvrait pas | `git restore --staged` + `rm` + ajout `*.bak` au `.gitignore` |
| 11 | `failed to build: invalid tag ghcr.io/Eben0099/... must be lowercase` | `github.repository` préserve la casse du owner ; GHCR exige minuscule strict | Step bash en début de job : `echo "IMAGE_PREFIX=${GITHUB_REPOSITORY,,}" >> $GITHUB_ENV` |
| 12 | Job `deploy` en `dial tcp ***:22: i/o timeout` | Security group SSH restreint à l'IP perso ; GHA tourne sur d'autres IPs | `admin_cidr = "0.0.0.0/0"` dans tfvars (acceptable car SSH key-only). Migration future vers SSM `send-command`. |
| 13 | Toutes les routes renvoient 404 alors que tous les containers sont `Up` | Traefik (v2.10, v3.1, v3.4) bundle un client Docker qui négocie API 1.24 ; Docker Engine 29+ refuse les requêtes < API 1.40 sur **tous** les endpoints (y compris `/_ping`), bloquant la négociation. La var `DOCKER_API_VERSION` n'est pas honorée par Traefik. | Bascule du **provider Docker → provider file** : routes définies dans `traefik/dynamic-prod.yml`, plus aucun appel API Docker. Workflow mis à jour pour scp le fichier de routes. |

## 16. Sécurité — état après migration

| Item | Statut | Commentaire |
|---|---|---|
| Secrets sortis du code Terraform | ✅ | tous via variables `sensitive` + `terraform.tfvars` gitignored |
| Rotation des secrets de l'ancienne archi | ✅ (implicite) | l'ancien compte AWS est destiné à être détruit → secrets historiques deviennent caducs |
| `terraform.tfstate` gitignored | ✅ | + à migrer sur backend S3 + DynamoDB lock |
| HTTPS / TLS | ❌ | HTTP-only volontaire au stade actuel — `sslip.io` + Let's Encrypt prêts à activer |
| EBS chiffré | ✅ | root volume chiffré |
| RDS chiffré | ✅ | `storage_encrypted = true` |
| RDS publiquement accessible | ❌ (correct) | reachable uniquement depuis le SG EC2 |
| SSH restreint | ⚠️ | `admin_cidr` configurable, à mettre à `<ton-IP>/32` si encore à `0.0.0.0/0` |
| Sauvegardes RDS automatiques | ❌ | `backup_retention_period = 0` (limite Free Plan) — à activer après upgrade Paid Plan |
| MFA sur l'utilisateur `casino-admin` | ⚠️ à vérifier | recommandé pour tout user IAM avec console access |

## 17. Étapes restantes (TODO)

### Court terme (cette semaine)
- [ ] **Upgrade le compte AWS de Free Plan → Paid Plan** (Billing → Account). Mêmes 200 $ de crédits, pas de fermeture auto à M+6.
- [ ] Une fois Paid Plan : remonter `backup_retention_period` à `7` dans `rds.tf` et appliquer.
- [ ] Vérifier la valeur de `admin_cidr` dans `terraform.tfvars` (doit être ton IP/32, pas `0.0.0.0/0`).
- [ ] Confirmer que les 5 jobs `build-push` passent au vert et que le job `deploy` exécute le compose proprement.
- [ ] Smoke tests : `curl http://13.36.124.253/`, `curl /api/agents/status`, `curl /api/tickets/status`, `curl /api/roulette/status`.

### Moyen terme (ce mois)
- [ ] Migrer `terraform.tfstate` sur un backend S3 + DynamoDB (lock).
- [ ] Acheter un nom de domaine (~10 $/an) puis activer HTTPS via Traefik + Let's Encrypt (le `sslip.io` est utilisable en attendant pour tester).
- [ ] Mettre en place `pg_dump | gzip | aws s3 cp` quotidien (cron sur l'EC2 ou Lambda + EventBridge) avec lifecycle policy Glacier à 7 jours.
- [ ] Activer MFA sur `casino-admin` dans la console IAM.
- [ ] Faire les 4 autres activités du Free Tier bonus (EC2 ✅ déjà fait, RDS ✅ déjà fait, Budget ✅ déjà fait, **manquantes : Lambda hello-world, appel Bedrock**) → +40 $ de crédits.

### Long terme (avant la fin du Free Tier)
- [ ] Mettre une alarme calendrier au **15 novembre 2026** : décision T4g (rester / migrer / réduire) avant la falaise du 31 décembre 2026.
- [ ] Migrer vers OIDC pour l'auth GHA → AWS (suppression des access keys long-lived).
- [ ] Avant août 2027 (fin du Free Tier RDS) : décider entre upgrade payant ou conteneurisation de Postgres sur l'EC2 + EBS dédié.
- [ ] Réintroduire les services managés (RDS multi-AZ, ALB, ECS) **uniquement quand le produit a des utilisateurs réels et un revenu** — pas avant.

## 18. Comment partager cet audit

Ce document est conçu pour être lu de bout en bout par :
- un développeur qui rejoint le projet (vue d'ensemble historique + état actuel),
- un consultant cloud qui doit auditer la facture ou la sécurité,
- un futur toi qui revient sur le projet après plusieurs mois.

Garde-le à jour à chaque migration ou décision structurelle. La **Partie I** est l'audit initial figé (référence historique). La **Partie II** doit évoluer.
