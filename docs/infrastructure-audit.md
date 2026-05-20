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
