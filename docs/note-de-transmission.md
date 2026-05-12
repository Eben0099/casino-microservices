# Note de transmission

## Game Provider Contract v1 — Demande de validation et conditions d'intégration

| | |
|---|---|
| **Émetteur** | AGD — équipe Jeux |
| **Destinataire** | Plateforme centrale — équipe technique |
| **Objet** | Soumission du contrat d'intégration v1, demande de validation et de décisions techniques |
| **Pièce jointe** | `integration-contract.md` (Game Provider Contract v1, draft 1.0) |
| **Date** | 9 mai 2026 |
| **Statut** | Pour revue |

---

## 1. Contexte

AGD développe une suite de jeux casino destinée à être branchée sur votre plateforme centrale, avec la roulette européenne (Spin & Win) comme premier jeu livré.

Notre rôle est celui d'un **fournisseur de jeux** (game provider) : nous opérons les moteurs de jeu, le RNG, le calcul des gains et la diffusion live. Vous conservez la maîtrise du wallet, des agents, du ticketing et du POS opérateur. Concrètement, vous nous **poussez les paris**, nous vous **renvoyons les résultats** ; aucun argent ni joueur ne transite par nos bases.

Pour cadrer cette intégration et permettre à AGD de travailler de façon autonome jusqu'au branchement final, nous avons rédigé une proposition de contrat technique. Cette note l'accompagne, en explicite les attendus, et formalise ce que nous attendons de votre part pour avancer.

---

## 2. Le document principal

Le contrat joint, intitulé **Game Provider Contract v1**, couvre :

- le vocabulaire commun (round, ticket, bet line, settlement) ;
- l'architecture générale et le sens des appels (REST + WebSocket + Webhooks) ;
- les trois méthodes d'authentification supportées (HMAC-SHA256, OAuth2 Client Credentials, IP whitelist) ;
- les endpoints REST exposés par AGD pour la soumission de tickets, la lecture des rounds et l'annulation ;
- le protocole WebSocket pour l'état live (phases, résultats, statistiques) ;
- les webhooks sortants pour le settlement et les annulations, avec politique de retry ;
- les règles d'idempotence, le multi-devise, les codes d'erreur, le rate limiting, le versionnage ;
- le mécanisme **Provably Fair** (RNG vérifiable) ;
- une annexe complète sur les types de paris de la roulette européenne.

Le contenu est complet pour la roulette. Les modes futurs (auto-play multi-rounds, bonus, side bets, live dealer) sont anticipés mais pas implémentés en v1.

---

## 3. Ce que nous attendons de vous

Pour passer du document à l'implémentation, nous avons besoin de **trois retours distincts** de votre part.

### 3.1 Validation des principes d'architecture

Confirmer ou amender, par écrit :

1. Le **modèle de flux** : la plateforme centrale pousse les paris à AGD, AGD pousse les résultats par webhook (modèle "operator-driven"). Si vous préférez un modèle "seamless wallet" (AGD appelle votre wallet pour debit/credit), il faut le dire maintenant — c'est un changement majeur d'architecture.
2. Le **modèle de ticket** : un ticket = un round, contenant 1 à N bet lines. Le format est inspiré d'un ticket combo sport, restreint à un seul round.
3. Le **canal de notification de résultat** : webhook signé HMAC, avec retry exponentiel (1 → 24h sur 7 tentatives) et endpoint de pull `GET /tickets/{id}` en filet de sécurité.
4. Le **transport live** : WebSocket pour les changements de phase et les résultats, en complément du webhook de settlement.
5. Le **principe Provably Fair** : seed_hash publié avant tirage, server_seed révélé après, vérifiable par tiers via endpoint public.

### 3.2 Réponses aux décisions techniques ouvertes

Le contrat liste **8 points** qui ne peuvent être figés que par vous. Ces décisions conditionnent le code que nous allons écrire.

| # | Décision | Format de réponse attendu |
|---|---|---|
| 1 | Méthode d'authentification retenue parmi les trois | `HMAC` / `OAuth2` / `IP whitelist` |
| 2 | URL de réception webhook côté plateforme centrale | URL HTTPS + structure : un endpoint par event_type ou un endpoint unique avec dispatch sur le champ `event` ? |
| 3 | Devises supportées au lancement | Liste de codes ISO 4217 |
| 4 | Comportement attendu sur erreur `INTERNAL_ERROR` côté AGD à la soumission d'un ticket | retry automatique (combien, quel délai) ou intervention humaine ? |
| 5 | SLA cible pour la réception du webhook `ticket_settled` | Délai max entre `result_revealed` et réception côté plateforme |
| 6 | Politique d'annulation | autorisée ou interdite ? Si autorisée, fenêtre exacte (jusqu'à `NO_MORE_BETS` ou jusqu'à `RESULT`) |
| 7 | Stockage du `external_player_ref` côté AGD | utile (statistiques par joueur, segmentation) ou pass-through uniquement ? |
| 8 | Durée de round paramétrable par opérateur | oui (ex. agence physique 90s, online 30s) ou figée à 60s pour tous ? |

Une réponse synthétique en quelques lignes par point suffit ; nous formaliserons ensuite dans la v1.1 du contrat.

### 3.3 Pré-requis opérationnels à fournir

Pour démarrer l'implémentation et préparer la sandbox, nous avons besoin de :

- **`operator_id`** : l'identifiant unique que votre plateforme utilisera dans le header `X-Operator-Id` (ex. `pb-prod`, `pb-preprod`).
- **Secrets API** : à échanger via canal sécurisé hors-bande (ex. 1Password, Bitwarden Send, ou GPG par email). Selon la méthode d'auth retenue :
  - HMAC : un `api_secret` par environnement (preprod, prod) ;
  - OAuth2 : `client_id` + `client_secret` ;
  - IP whitelist : liste des IPs sources de vos serveurs.
- **Secret webhook** : distinct du secret API, pour signer les notifications sortantes AGD → plateforme.
- **URL webhook** par environnement (preprod et prod).
- **Format de vos identifiants** : pattern attendu pour `external_ticket_id` et `external_player_ref` (longueur max, charset, exemples). Cela nous permet de dimensionner les colonnes et valider en entrée.
- **Plage IP entrante** : si votre infrastructure attend des appels depuis nos webhooks, nous devons vous fournir nos IPs sortantes (et inversement).
- **Contact technique référent** côté plateforme centrale, joignable pendant les phases d'intégration et de tests.

---

## 4. Calendrier indicatif

Une fois vos retours reçus sur les sections 3.1 et 3.2 :

| Étape | Acteur | Durée estimée |
|---|---|---|
| Revue du contrat de votre côté | Plateforme centrale | 1 à 2 semaines |
| Workshop d'alignement final (visio, 90 min) | Les deux équipes | T+2 semaines |
| Publication du contrat v1.1 (figé) | AGD | T+2 semaines + 3 jours |
| Implémentation des endpoints REST + Webhooks côté AGD | AGD | 3 à 5 semaines |
| Mise à disposition de la sandbox AGD | AGD | T+5 à T+7 semaines |
| Implémentation de l'intégration côté plateforme | Plateforme centrale | 2 à 3 semaines parallèles |
| Tests d'intégration end-to-end | Les deux équipes | 1 à 2 semaines |
| Recette + go-live preprod | Les deux équipes | T+10 à T+12 semaines |

Ce calendrier est indicatif et sera ajusté en fonction de vos disponibilités et des décisions prises lors du workshop d'alignement.

---

## 5. Engagements AGD

Pour cette première version, AGD s'engage à livrer :

- **Le moteur roulette européenne** (`ROULETTE_EU`) conforme au Game Module Contract défini dans la spec, avec RNG provably fair (HMAC-SHA256).
- **L'ensemble des endpoints REST** documentés en §4 du contrat.
- **Le canal WebSocket** pour le suivi live des phases et résultats.
- **Les webhooks signés** vers votre plateforme avec politique de retry conforme à §6.3.
- **Une UI embarquable** (iframe avec mode `?embed=1`) que votre POS peut intégrer pour afficher la table de roulette en direct.
- **Un environnement sandbox** dédié, accessible 24/7, avec des rounds raccourcis pour faciliter vos tests.
- **Une documentation technique** (la présente spec) maintenue à jour, avec changelog des évolutions.
- **Un point de contact technique** unique côté AGD pour la durée de l'intégration.

Les éléments hors périmètre v1 (auto-play, bonus, side bets, live dealer, certification GLI-19) sont signalés dans le contrat comme "v2 ready" — leur structure est anticipée mais leur livraison fera l'objet d'avenants ultérieurs.

---

## 6. Mode de fonctionnement avant intégration

AGD travaille avec une architecture qui permet aux jeux de **fonctionner en standalone** durant la phase de développement et pour des démonstrations. Concrètement :

- Tant que la plateforme centrale n'est pas branchée, AGD utilise son propre wallet local (caisses agents simulées) et son propre ticketing interne.
- Au moment du branchement, ces composants locaux sont contournés au profit de votre plateforme via un simple changement de configuration (`WALLET_MODE=remote`).
- Cela signifie que **l'attente de votre validation ne bloque pas notre développement** : nous pouvons faire avancer les jeux en parallèle de la revue du contrat.

Vous pouvez d'ailleurs **demander une démo standalone** à tout moment pendant la phase de revue — l'environnement est déjà déployé et fonctionnel.

---

## 7. Points de contact

| Rôle | Côté AGD | Côté plateforme centrale |
|---|---|---|
| Référent technique | _à compléter_ | _à compléter par vos soins_ |
| Référent projet | _à compléter_ | _à compléter_ |
| Email d'équipe | _à compléter_ | _à compléter_ |
| Canal d'urgence (incident production) | _à définir lors du workshop_ | _à définir_ |

---

## 8. Prochaine action

Merci de nous transmettre **dans un délai de 10 jours ouvrés** :

1. Vos remarques sur le contrat joint (en commentaires sur le `.md`, ou par retour email structuré section par section).
2. Vos réponses aux 8 décisions ouvertes du §3.2.
3. La proposition d'un créneau pour le workshop d'alignement (90 minutes, format visio).

Les pré-requis opérationnels du §3.3 peuvent être communiqués plus tard, au plus tard le jour du workshop.

Sans retour de votre part sous 15 jours, AGD considérera que les principes d'architecture proposés sont implicitement validés et engagera l'implémentation sur cette base, quitte à ajuster ensuite si certains points de détail divergent.

---

## Annexe — Comment lire le contrat joint

Le document `integration-contract.md` est structuré pour permettre une lecture **par profil** :

- **Architecte / lead technique** : §1 (vocabulaire), §2 (architecture générale), §11 (versionnage), §13 (modes futurs). 15 minutes.
- **Développeur intégrateur** : §3 (auth), §4 (endpoints REST), §5 (WebSocket), §6 (webhooks), §7 (idempotence), §8 (codes d'erreur), Annexe C (exemple complet end-to-end). 45 minutes.
- **Responsable conformité / sécurité** : §3 (auth), §10 (Provably Fair), §11 (versionnage), §12 (rate limiting). 20 minutes.
- **Product owner** : §1, §2, §13, et la liste des questions ouvertes. 15 minutes.

Une lecture intégrale prend environ 1h30. Nous recommandons une lecture en deux passes : d'abord scan, puis revue détaillée des sections relevant de votre périmètre.
