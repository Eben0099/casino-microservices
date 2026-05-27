"""Provably-fair RNG for Keno.

Draws exactly 20 unique integers in [1..80] from a ``server_seed`` and
``draw_id`` using iterative HMAC-SHA256 with an incrementing nonce.

The algorithm is intentionally transparent so any third party can audit:

    For nonce = 0, 1, 2, ...:
        h = HMAC-SHA256(key=server_seed, msg=f"{draw_id}:{nonce}")
        candidate = (int(h[:8], 16) % 80) + 1
        if candidate not already in drawn set → accept

Numbers are returned in *generation order* (reveal order).  Callers that
need the sorted-ascending form for ``recentDraws`` must sort separately.

Verification:
    server_seed_hash == SHA256(server_seed)           # pre-committed hash
    draw_numbers(server_seed, draw_id) == numbers     # replay
"""

import hashlib
import hmac
from typing import List


def draw_numbers(server_seed: str, draw_id: int) -> List[int]:
    """Return 20 unique ints in [1..80] drawn provably-fairly.

    Args:
        server_seed: hex string committed before the draw (revealed after).
        draw_id:     monotonic integer round identifier.

    Returns:
        List of 20 integers in [1, 80], in the order they were generated
        (i.e. the ball reveal order for the front-end animation).
    """
    drawn: list[int] = []
    seen: set[int] = set()
    nonce = 0

    key = server_seed.encode("utf-8")

    while len(drawn) < 20:
        msg = f"{draw_id}:{nonce}".encode("utf-8")
        digest = hmac.new(key=key, msg=msg, digestmod=hashlib.sha256).hexdigest()
        # Use first 8 hex chars → 32-bit integer → map to [1..80]
        candidate = (int(digest[:8], 16) % 80) + 1
        if candidate not in seen:
            seen.add(candidate)
            drawn.append(candidate)
        nonce += 1

    return drawn
