# Guide — Simulateur réaliste & load testing

Trois outils sous `tools/` pour générer du trafic et tester le système :

| Outil | Rôle |
|---|---|
| `tools/load_test_tickets.py` | Bootstrap des kiosques de test + stress brut |
| `tools/realistic_simulator.py` | Simulation réaliste de production (caissiers qui vendent pendant les fenêtres Betting) |
| `tools/cashout_tester.py` | Décaissement des tickets WON produits par la simulation |

---

## 0. Pré-requis (une seule fois)

```bash
docker compose up -d
```

```bash
python3 -m venv /tmp/loadtest-venv
```

```bash
/tmp/loadtest-venv/bin/pip install httpx PyJWT redis websockets
```

---

## 1. Bootstrap des kiosques de test

Crée N comptes `LoadTest Kiosk` et alimente chaque caisse à 50 000 000 XAF. **Idempotent** : tu peux le relancer pour ajouter des caissiers, ceux qui existent déjà sont préservés.

> **Important** : le simulateur exige que `--kiosks-max ≤ nombre de caissiers seedés`. Si tu veux simuler jusqu'à 500 kiosques par round, tu dois en seeder au moins 500 avant.

### Petite simulation (~100 kiosques max)

```bash
/tmp/loadtest-venv/bin/python3 tools/load_test_tickets.py --agents 100 --total 50 --concurrency 10
```

### Charge moyenne (~500 kiosques max) — ~1 min

```bash
/tmp/loadtest-venv/bin/python3 tools/load_test_tickets.py --agents 500 --total 50 --concurrency 10
```

### Charge lourde (~5000 kiosques max) — ~5 min (bcrypt par compte)

```bash
/tmp/loadtest-venv/bin/python3 tools/load_test_tickets.py --agents 5000 --total 50 --concurrency 10
```

---

## 2. Lancer le simulateur réaliste

> Vérifie d'abord que tu as **assez** de caissiers seedés (étape 1). Le simulateur exige `--kiosks-max ≤ caissiers seedés`.

### Démo douce — 30-60 kiosques (~2 min) — nécessite 100 caissiers seedés

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --rounds 2 --kiosks-min 30 --kiosks-max 60 --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 3
```

### Journée standard — 80-200 kiosques (~10 min) — nécessite 200 caissiers seedés

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --rounds 10 --kiosks-min 80 --kiosks-max 200 --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 4
```

### Pic de charge — 300-500 kiosques (~5 min) — nécessite 500 caissiers seedés

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --rounds 5 --kiosks-min 300 --kiosks-max 500 --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 5
```

### Megatest — 500-5000 kiosques (~20 min) — nécessite 5000 caissiers seedés

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --rounds 20 --kiosks-min 500 --kiosks-max 5000 --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 5
```

### Scénario sur mesure

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --rounds 5 --kiosks-min 100 --kiosks-max 300 --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 5
```

**Pendant l'exécution**, ouvre dans le navigateur :

- http://localhost/dashboard — CA, GGR, tickets en live
- http://localhost/transactions — table qui se remplit en direct
- http://localhost/jackpots — cagnottes qui montent
- http://localhost/agents — balances des caissiers qui bougent

Le badge **LIVE** vert en haut à droite confirme que le WebSocket est connecté.

---

## 3. Décaisser les tickets gagnants

Une fois le simulateur terminé, il affiche le chemin du dossier de sortie (ex : `simulator-runs/20260513-130000/`).

### Voir qui a gagné (sans payer)

```bash
/tmp/loadtest-venv/bin/python3 tools/cashout_tester.py simulator-runs/20260513-130000/tickets.jsonl --dry-run
```

### Cash-out de tous les WON

```bash
/tmp/loadtest-venv/bin/python3 tools/cashout_tester.py simulator-runs/20260513-130000/tickets.jsonl
```

> Remplace `20260513-130000` par le timestamp réel affiché en fin de simulation.

---

## Options du simulateur

| Option | Défaut | Description |
|---|---|---|
| `--rounds` | 3 | Nombre de fenêtres Betting à simuler |
| `--kiosks-min` | 50 | Min de caissiers actifs par round |
| `--kiosks-max` | 200 | Max de caissiers actifs par round |
| `--tickets-per-kiosk-min` | 1 | Min de tickets par caissier par round |
| `--tickets-per-kiosk-max` | 5 | Max de tickets par caissier par round |
| `--output-dir` | `simulator-runs/<ts>` | Dossier de sortie |

Aide complète :

```bash
/tmp/loadtest-venv/bin/python3 tools/realistic_simulator.py --help
```

---

## Stop / clean

- **Arrêter en cours** : `Ctrl+C` — les tickets déjà créés restent dans `tickets.jsonl`, rien n'est perdu.
- **Caissiers de test** : ils restent en base avec le préfixe `LoadTest Kiosk`, mais n'interfèrent pas avec les vrais kiosques.

---

## Piège classique : copier-coller sur plusieurs lignes

Si tu tombes dans le **REPL Python (`>>>`)** après un copier-coller, c'est que ton terminal a perdu un `\` de continuation de ligne.

**Solution** : tape `exit()` pour sortir, et utilise toujours les commandes ci-dessus **en une seule ligne**. Elles sont conçues pour ça.
