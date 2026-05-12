# Système de Jackpots — Spécification fonctionnelle

> Document de référence pour l'implémentation du moteur de jackpots multi-niveaux de la plateforme AGDTech.
> Toutes les valeurs numériques citées (intervalles, contributions) sont des **exemples** — chaque paramètre est configurable dans le back-office admin.

---

## 1. Vue d'ensemble

Chaque ticket vendu sur la plateforme alimente **simultanément** plusieurs cagnottes (« pots »).
Chaque cagnotte possède un **seuil cible secret** tiré aléatoirement dans un intervalle `[min, max]` paramétré par l'admin. Dès que la cagnotte atteint son seuil, le jackpot **tombe** : un gagnant est désigné, la prime est versée, le pot redémarre et un nouveau seuil est tiré.

Trois familles de jackpots tournent en parallèle :

| Famille | Périmètre | Nombre d'instances | Paliers |
|---|---|---|---|
| **Jackpot Général** | Tous les tickets de tous les jeux de tous les kiosques | 1 (réseau entier) | 1 seul niveau |
| **Jackpot Jeu (principal)** | Tous les tickets d'un jeu, tous kiosques | 1 par jeu | 1 seul niveau (sans tier) |
| **Jackpot Jeu (paliers)** | Tous les tickets d'un jeu, tous kiosques | 3 par jeu | Bronze / Argent / Or |
| **Jackpot Local** | Tickets d'un jeu sur un kiosque donné | 3 par couple (jeu × kiosque) | Bronze / Argent / Or |

> **Différence entre Bronze / Argent / Or** : uniquement l'intervalle du seuil. Bronze tombe souvent pour de petites cagnottes, Or tombe rarement pour des cagnottes plus grosses. La mécanique est identique aux 3 paliers.

### Schéma de contribution d'un ticket

```
Ticket [Jeu X · Kiosque K · Mise M]
    │
    ├──► Jackpot Général                   [1 seuil]                  → contrib_general
    │
    ├──► Jackpot Jeu X · Bronze            [1 seuil]                  ┐
    ├──► Jackpot Jeu X · Argent            [1 seuil]                  │  contrib_game (×3 paliers)
    ├──► Jackpot Jeu X · Or                [1 seuil]                  ┘
    │
    ├──► Jackpot Local Jeu X @ K · Bronze  [1 seuil]                  ┐
    ├──► Jackpot Local Jeu X @ K · Argent  [1 seuil]                  │  contrib_local (×3 paliers)
    └──► Jackpot Local Jeu X @ K · Or      [1 seuil]                  ┘
```

---

## 2. Identité des kiosques — code court public

Chaque kiosque physique possède **deux identifiants** :

| Identifiant | Format | Usage | Visible |
|---|---|---|---|
| `id` interne | UUID v4 | Communication inter-services (FK, jointures DB) | Backend seulement |
| `kiosk_code` | **4 caractères** alphanumériques | Alias public lisible humainement | Caissier + Unity + supports physiques |

### Règles du `kiosk_code`

- **Format** : 4 caractères tirés d'un alphabet sans ambigus (pas de `0/O`, pas de `1/I/L`), ex. alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` → ~923 000 combinaisons.
- **Génération** : **automatique** à la création du kiosque/agent, garantie unique en base (`UNIQUE INDEX`).
- **Affichage** :
  - **Dashboard caissier** (`agent-web`) — badge en haut, à côté du nom du kiosque, pour qu'on retrouve facilement son identifiant en cas de support.
  - **Backoffice admin** (`backoffice`) — colonne dédiée dans la table des caissiers/kiosques.
  - **Étiquette physique** sur la machine.
- **Régénération** : possible par l'**admin** uniquement, depuis le back-office (action explicite avec confirmation). L'ancien code est invalidé immédiatement.
  > ⚠️ Régénérer un code force une mise à jour de la configuration du frontend Unity du kiosque concerné.
- **Stabilité hors régénération** : un code n'est jamais réutilisé tant qu'il appartient à un kiosque actif. Après suppression d'un kiosque, le code peut être recyclé (ou non — choix opérationnel, cf §11).

### Usage par le frontend Unity

Le frontend Unity tournant sur l'écran d'un kiosque possède le `kiosk_code` en configuration locale (saisi à l'installation, ou fourni par QR-code). Il l'utilise à chaque appel d'amorçage :

```
GET /api/kiosks/by-code/{code}
    → { agent_id, kiosk_code, kiosk_name, kiosk_location, is_active }
```

À partir de là, Unity peut s'abonner aux flux temps réel (WebSocket) et récupérer les jackpots actifs pour son kiosque :

```
GET /api/jackpots/by-kiosk/{code}
    → [
        { scope: "GLOBAL", current_amount: ... },
        { scope: "GAME",  game: "spin2win", tier: "BRONZE", current_amount: ... },
        ...
        { scope: "LOCAL", game: "spin2win", tier: "GOLD",   current_amount: ... },
      ]
```

> Cette API est **publique** (pas d'authentification) car les écrans Unity sont des appareils non interactifs en zone client. Aucune donnée sensible n'est exposée (pas de hash, pas de téléphone, pas de solde de caisse).

---

## 3. Mécanique du seuil aléatoire (modèle « Must-Hit-By »)

Chaque pot suit le même cycle de vie :

1. **Initialisation** — un seuil cible `S` est tiré uniformément dans `[seuil_min, seuil_max]`. Ce seuil reste **secret** (jamais exposé côté client).
2. **Alimentation** — chaque ticket éligible ajoute `contribution(ticket)` au pot.
3. **Hit** — dès qu'un ticket fait franchir le seuil au pot (`pot_courant + contribution ≥ S`), ce ticket déclenche le jackpot.
4. **Versement** — le gagnant est désigné selon le mode configuré (cf §4), reçoit le montant du pot, l'évènement est journalisé.
5. **Reset** — le pot redémarre selon le mode configuré (cf §5) et un nouveau seuil `S'` est tiré pour le cycle suivant.

> Le seuil est ré-tiré **à chaque cycle** — jamais réutilisé.

---

## 4. Paramètres admin (back-office)

Chaque jackpot expose les mêmes paramètres configurables :

### 4.1 Activation
- `enabled` (bool) — activer/désactiver le jackpot.

### 4.2 Contribution par ticket *(modes configurables — cf §5.2)*
- `contribution_mode` ∈ { `PERCENT`, `FIXED` }
- `contribution_percent` (float, ex. `0.5` pour 0.5 % de la mise) — utilisé si mode `PERCENT`
- `contribution_fixed` (int, en XAF) — utilisé si mode `FIXED`

### 4.3 Intervalle du seuil cible
- `threshold_min` (int, XAF)
- `threshold_max` (int, XAF)

> Exemples indicatifs :
> - **Bronze** : `[50 000 ; 200 000]` XAF
> - **Argent** : `[200 000 ; 1 000 000]` XAF
> - **Or** : `[1 000 000 ; 10 000 000]` XAF

### 4.4 Reset après gain *(modes configurables — cf §5.3)*
- `reset_mode` ∈ { `ZERO`, `SEED` }
- `seed_amount` (int, XAF) — montant de redémarrage si mode `SEED`

### 4.5 Désignation du gagnant *(modes configurables — cf §5.1)*
- `winner_mode` ∈ { `TRIGGER_TICKET`, `RANDOM_RECENT` }
- `recent_window_minutes` (int) — fenêtre de tickets éligibles si mode `RANDOM_RECENT` (ex. 60 minutes)

### 4.6 Cap optionnel
- `max_payout` (int, XAF, optionnel) — plafonne le versement. Si le pot dépasse, le surplus est conservé pour le cycle suivant (anti-runaway).

---

## 5. Les trois modes configurables

### 5.1 Mode de désignation du gagnant

| Mode | Comportement |
|---|---|
| `TRIGGER_TICKET` | Le ticket qui fait franchir le seuil **est** le gagnant. Simple, lisible, classique pour les jackpots locaux. |
| `RANDOM_RECENT` | Un ticket est tiré aléatoirement parmi ceux **éligibles dans une fenêtre récente** (`recent_window_minutes`). Recommandé pour les très gros jackpots (Or, Général) afin qu'un petit joueur ait sa chance, et pour décorréler le hit du timing exact. |

**Éligibilité d'un ticket** : avoir contribué au pot concerné dans la fenêtre, et ne pas être annulé/refundé.

### 5.2 Mode de contribution

| Mode | Comportement |
|---|---|
| `PERCENT` | La contribution est un pourcentage de la **mise totale du ticket** : `contribution = total_wager × contribution_percent / 100`. Équitable, s'adapte naturellement aux gros tickets. |
| `FIXED` | Chaque ticket éligible ajoute le **même montant fixe** au pot, indépendamment de la mise. Simple à communiquer (« 100 XAF par ticket vers le jackpot »). |

### 5.3 Mode de reset

| Mode | Comportement |
|---|---|
| `ZERO` | Après un hit, le pot redémarre à `0`. La cagnotte affichée chute brutalement à zéro. |
| `SEED` | Après un hit, le pot redémarre à `seed_amount` (somme garantie issue de la maison ou prélevée sur le pot précédent). Évite l'effet « jackpot vide » et garde une visibilité attractive. |

---

## 6. Modèle de données (suggéré)

### Table `jackpot_pots`
Une ligne par cagnotte vivante.

| Champ | Type | Description |
|---|---|---|
| `id` | uuid | PK |
| `scope` | enum | `GLOBAL`, `GAME`, `LOCAL` |
| `game_code` | string nullable | obligatoire si scope ≠ GLOBAL |
| `kiosk_id` | uuid nullable | obligatoire si scope = LOCAL — résolvable depuis Unity via `kiosk_code` (cf §2) |
| `tier` | enum nullable | `BRONZE`, `SILVER`, `GOLD` — null pour GLOBAL |
| `enabled` | bool | |
| `contribution_mode` | enum | `PERCENT`, `FIXED` |
| `contribution_percent` | numeric(6,4) | |
| `contribution_fixed` | bigint | |
| `threshold_min` | bigint | |
| `threshold_max` | bigint | |
| `reset_mode` | enum | `ZERO`, `SEED` |
| `seed_amount` | bigint | |
| `winner_mode` | enum | `TRIGGER_TICKET`, `RANDOM_RECENT` |
| `recent_window_minutes` | int | |
| `max_payout` | bigint nullable | |
| `current_amount` | bigint | montant actuel du pot |
| `current_threshold` | bigint | **secret** — seuil cible du cycle en cours |
| `cycle_number` | int | nombre de cycles complétés |
| `started_at` | timestamptz | début du cycle courant |
| `updated_at` | timestamptz | dernière contribution |

**Contrainte d'unicité** : `(scope, game_code, kiosk_id, tier)` doit être unique parmi les pots actifs.

### Table `jackpot_contributions`
Trace d'audit (pour reconstituer un pot en cas d'incident).

| Champ | Type | Description |
|---|---|---|
| `id` | uuid | |
| `pot_id` | uuid → `jackpot_pots.id` | |
| `ticket_id` | uuid | |
| `amount` | bigint | contribution ajoutée |
| `pot_amount_after` | bigint | snapshot du pot après ajout |
| `created_at` | timestamptz | |

### Table `jackpot_wins`
Historique des jackpots tombés.

| Champ | Type | Description |
|---|---|---|
| `id` | uuid | |
| `pot_id` | uuid | |
| `cycle_number` | int | |
| `trigger_ticket_id` | uuid | ticket qui a fait franchir le seuil |
| `winner_ticket_id` | uuid | gagnant désigné (= trigger en mode `TRIGGER_TICKET`) |
| `winner_agent_id` | uuid | |
| `threshold_hit` | bigint | seuil tiré pour ce cycle, révélé a posteriori |
| `payout_amount` | bigint | montant versé |
| `seed_carryover` | bigint | montant remis pour le cycle suivant (0 si reset ZERO) |
| `paid_at` | timestamptz | |

---

## 7. Flux d'un ticket (vue séquentielle)

```
[1] Caissier valide la vente d'un ticket sur Jeu X au Kiosque K, mise M

[2] ticket-service crée le ticket → publie évènement "ticket.created"

[3] jackpot-service consomme l'évènement et :
    pour chaque pot éligible (cf §1 schéma) :
       a. calcule contribution = f(M, mode, params)
       b. transaction atomique :
              pot.current_amount += contribution
              insère une ligne dans jackpot_contributions
       c. si pot.current_amount >= pot.current_threshold :
              déclenche le HIT (cf §8)

[4] Le ticket reçoit dans sa réponse les contributions effectuées
    (pour affichage éventuel "Vous participez à 7 jackpots actifs !")
```

---

## 8. Flux d'un HIT

```
[1] Pot P atteint son seuil → HIT détecté en transaction.

[2] Désigner le gagnant :
       - mode TRIGGER_TICKET → winner = ticket courant
       - mode RANDOM_RECENT  → SELECT random parmi tickets contribué dans
                               [now() - recent_window_minutes, now()]
                               sur le même pot

[3] Calculer le payout :
       payout = min(pot.current_amount, max_payout ?? pot.current_amount)
       carryover = pot.current_amount - payout  (devient seed du cycle suivant)

[4] Verser : attacher le gain au ticket gagnant (status "JACKPOT_WON",
             gain ajouté au payout du ticket). Le client encaisse au
             guichet comme un gain classique. Aucun crédit direct caisse.

[5] Enregistrer dans jackpot_wins.

[6] Démarrer un nouveau cycle :
       pot.cycle_number++
       pot.current_amount = (reset_mode==ZERO ? 0 : seed_amount) + carryover
       pot.current_threshold = uniform_random(threshold_min, threshold_max)
       pot.started_at = now()

[7] Émettre évènement "jackpot.won" pour :
       - notifier l'écran caissier en temps réel
       - mettre à jour les afficheurs publics (display-service futur)
       - audit / compta
```

---

## 9. UI / UX

### 9.1 Back-office admin (nouvelle page « Jackpots »)
- Tableau listant tous les pots actifs avec leur scope/jeu/kiosque/tier
- Montant courant en temps réel
- Bouton « Configurer » → modale avec les paramètres §4
- Onglet « Historique » → table des `jackpot_wins`
- Indicateur de santé : pots inactifs, contribution `=0`, intervalles incohérents

### 9.2 Caissier (agent-web)
- **Badge `kiosk_code`** affiché en permanence en haut de l'écran (utile pour identifier le kiosque lors d'un support)
- Bandeau discret affichant les pots en cours pour le kiosque/jeu sélectionné (montants seulement, jamais le seuil)
- Animation/notification si un jackpot tombe sur un ticket vendu sur place

### 9.3 Affichage public (Unity sur écran du kiosque)
- Démarrage : Unity lit son `kiosk_code` local, appelle `GET /api/kiosks/by-code/{code}` puis `GET /api/jackpots/by-kiosk/{code}`
- Compteur live des cagnottes les plus visibles (Or, Général)
- Animation « JACKPOT! » lors d'un hit
- Reconfiguration sans réinstallation : si l'admin régénère le code, l'opérateur saisit/scanne le nouveau code dans l'app Unity

---

## 10. Garanties techniques

- **Atomicité** : toute contribution + détection de hit doit s'exécuter dans une transaction (Postgres `SELECT ... FOR UPDATE` sur le pot, ou commande Lua/transaction Redis si pot mis en cache).
- **Idempotence** : un même `ticket_id` ne doit contribuer **qu'une seule fois** à un pot donné. Contrainte `UNIQUE (pot_id, ticket_id)` sur `jackpot_contributions`.
- **Annulation de ticket** : rollback complet de toutes les contributions du ticket en transaction atomique. Décrémente les `pot.current_amount` correspondants, supprime les lignes `jackpot_contributions`. Cas d'erreur : si le ticket a déjà déclenché un HIT payé, l'annulation est refusée.
- **Provably-fair (optionnel)** : exposer un hash du seuil au démarrage du cycle, puis révéler le seuil dans `jackpot_wins.threshold_hit` pour vérification ex post.
- **Tirage aléatoire** : utiliser le même RNG HMAC-SHA256 que la roulette pour le tirage du seuil — garantit auditabilité.

---

## 11. Décisions arrêtées

| # | Sujet | Décision |
|---|---|---|
| 1 | **Versement du gain** | **Attaché au ticket** comme un gain classique. Le client encaisse au guichet via le flux ticket existant. Aucun crédit direct caisse — audit et UX identiques au gain de roulette classique. |
| 2 | **Annulation de ticket** | **Rollback complet de la contribution.** Toutes les lignes `jackpot_contributions` du ticket sont supprimées et les `pot.current_amount` correspondants sont décrémentés en transaction atomique. Si un HIT a déjà eu lieu sur ce ticket, l'annulation devient impossible (un jackpot payé ne se reverse pas). |
| 3 | **Endpoint Unity** | **Livré dès la Phase 1 backend.** Le frontend Unity est déjà développé, il consomme `GET /api/jackpots/by-kiosk/{code}` avec son `kiosk_code` local. C'est un livrable bloquant pour la mise en service visuelle. |
| 4 | **Cap `max_payout`** | **Opt-in, désactivé par défaut.** Pas de plafond à la création d'un pot ; l'admin peut l'activer ponctuellement (ex. avant un week-end festif). Si activé et dépassé, le surplus est carryover sur le cycle suivant. |
| 5 | **Seuil initial** | **Tiré dès la création du pot.** `current_threshold` est rempli à l'insertion de la ligne `jackpot_pots`, le pot est immédiatement prêt à recevoir le premier ticket. |
| 6 | **Recyclage `kiosk_code`** | **Définitivement brûlé.** Un code utilisé reste dans l'historique et n'est jamais ré-attribué, même après suppression du kiosque. Garantit la traçabilité absolue des `jackpot_wins` et `jackpot_contributions` historiques. |

---

## 12. Étapes d'implémentation

### Phase 0 — Pré-requis kiosque *(bloquant pour tout le reste)*
- Colonne `kiosk_code` sur l'entité kiosque/agent (4 chars, unique, indexé)
- Génération automatique à la création + endpoint admin de régénération
- Endpoint public `GET /api/kiosks/by-code/{code}` (consommé par Unity à l'amorçage)
- Affichage badge dans `agent-web` (dashboard caissier) + colonne dans `backoffice`
- Migration Alembic avec backfill des kiosques existants

### Phase 1 — Backend jackpot
- Créer `jackpot-service` (nouveau microservice) **ou** module dans `ticket-service` (à trancher selon volume attendu)
- Schéma Postgres : `jackpot_pots`, `jackpot_contributions`, `jackpot_wins` (cf §6)
- API CRUD admin pour les pots (configuration des 6 paramètres §4)
- **Endpoint Unity** `GET /api/jackpots/by-kiosk/{code}` → liste les pots actifs (global + game tous tiers + local tous tiers) avec leurs `current_amount`
- Tirage automatique du `current_threshold` à la création de chaque pot

### Phase 2 — Intégration tickets
- Hook sur `ticket.created` :
  - Calcule les contributions pour tous les pots éligibles
  - Transaction atomique : `current_amount +=`, détection de HIT
  - Si HIT → désignation gagnant (`TRIGGER_TICKET` ou `RANDOM_RECENT`) + reset cycle
- Hook sur `ticket.cancelled` :
  - Rollback atomique de toutes les `jackpot_contributions` du ticket
  - Décrémentation des `current_amount` correspondants
  - Refus si un HIT a déjà été payé sur ce ticket
- Hook sur `ticket.payout` (gain encaissé) :
  - Inclut la prime jackpot s'il y a eu HIT (status `JACKPOT_WON` sur le ticket)

### Phase 3 — Back-office UI
- Page « Jackpots » : tableau live de tous les pots avec leur amount, filtres scope/jeu/kiosque/tier
- Modale de configuration (les 6 paramètres §4)
- Onglet « Historique » : table des `jackpot_wins` avec filtres
- Indicateurs de santé : pots inactifs, contributions à 0, intervalles incohérents

### Phase 4 — Caissier UI
- Bandeau discret en bas/haut affichant les pots en cours pour le kiosque + jeu actif (montants seulement, **jamais** les seuils)
- Notification visuelle/sonore lors d'un HIT sur le kiosque
- Affichage du `kiosk_code` permanent dans le header

### Phase 5 — Unity (live)
- WebSocket temps réel pour `current_amount` (push à chaque contribution)
- Animations « JACKPOT! » à la réception d'un évènement `jackpot.won`
TK-20260512-U4OTW3