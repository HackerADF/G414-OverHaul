"""
NumPy-accelerated particle system for sparks, trails, and burst effects.

All particle data lives in pre-allocated contiguous numpy arrays so
update is fully vectorized; only the draw loop remains in Python
(pygame circle drawing cannot be batched).
"""
from __future__ import annotations
import math
import random
import numpy as np
import pygame

MAX = 3000  # hard cap on live particles

# Gravity applied to particles (px/s²)
_GRAV_Y = 280.0


class ParticleSystem:
    """Pre-allocated pool of up to MAX simultaneous particles."""

    def __init__(self) -> None:
        # Position
        self.px  = np.zeros(MAX, dtype=np.float32)
        self.py  = np.zeros(MAX, dtype=np.float32)
        # Velocity
        self.vx  = np.zeros(MAX, dtype=np.float32)
        self.vy  = np.zeros(MAX, dtype=np.float32)
        # Color (float 0-255 for easy lerp)
        self.r   = np.zeros(MAX, dtype=np.float32)
        self.g   = np.zeros(MAX, dtype=np.float32)
        self.b   = np.zeros(MAX, dtype=np.float32)
        # Lifetime
        self.life     = np.zeros(MAX, dtype=np.float32)
        self.max_life = np.ones(MAX,  dtype=np.float32)
        # Display size (radius in pixels)
        self.size = np.zeros(MAX, dtype=np.float32)

        self._count = 0  # number of live particles

    # ------------------------------------------------------------------ #
    #  Emission                                                            #
    # ------------------------------------------------------------------ #
    def emit(
        self,
        x: float, y: float,
        vx: float, vy: float,
        color: tuple[int, int, int],
        life: float,
        size: float,
        count: int = 1,
    ) -> None:
        """Spawn *count* identical particles (with small random spread)."""
        slots = min(count, MAX - self._count)
        if slots <= 0:
            return
        i = self._count
        j = i + slots
        self.px[i:j]       = x
        self.py[i:j]       = y
        spread             = 20.0
        self.vx[i:j]       = vx + np.random.uniform(-spread, spread, slots)
        self.vy[i:j]       = vy + np.random.uniform(-spread, spread, slots)
        self.r[i:j]        = color[0]
        self.g[i:j]        = color[1]
        self.b[i:j]        = color[2]
        self.life[i:j]     = life + np.random.uniform(-life * 0.2, life * 0.2, slots)
        self.max_life[i:j] = self.life[i:j]
        self.size[i:j]     = size
        self._count        = j

    def emit_burst(
        self,
        x: float, y: float,
        color: tuple[int, int, int],
        count: int = 12,
        speed: float = 220.0,
        life: float = 0.45,
        size: float = 2.5,
    ) -> None:
        """Radial burst – sparks fly outward in all directions."""
        slots = min(count, MAX - self._count)
        if slots <= 0:
            return
        i = self._count
        j = i + slots
        angles = np.random.uniform(0, 2 * math.pi, slots)
        speeds = np.random.uniform(speed * 0.5, speed * 1.4, slots)
        self.px[i:j]       = x
        self.py[i:j]       = y
        self.vx[i:j]       = np.cos(angles) * speeds
        self.vy[i:j]       = np.sin(angles) * speeds
        self.r[i:j]        = color[0]
        self.g[i:j]        = color[1]
        self.b[i:j]        = color[2]
        self.life[i:j]     = life + np.random.uniform(-life * 0.25, life * 0.25, slots)
        self.max_life[i:j] = self.life[i:j]
        self.size[i:j]     = size
        self._count        = j

    def emit_victory(
        self,
        x: float, y: float,
        count: int = 60,
        speed: float = 300.0,
        life: float = 1.2,
    ) -> None:
        """Rainbow victory burst."""
        slots = min(count, MAX - self._count)
        if slots <= 0:
            return
        i = self._count
        j = i + slots
        angles = np.random.uniform(0, 2 * math.pi, slots)
        speeds = np.random.uniform(speed * 0.4, speed * 1.3, slots)
        hues   = np.linspace(0, 1, slots, endpoint=False)
        # Convert HSV (hue, 1, 1) → RGB via simple formula
        h6     = hues * 6.0
        q      = h6.astype(int) % 6
        f      = h6 - np.floor(h6)
        p      = np.zeros(slots); v = np.ones(slots); t = f; s_inv = 1 - f
        rs     = np.select([q==0,q==1,q==2,q==3,q==4,q==5], [v, s_inv, p, p, t, v])
        gs     = np.select([q==0,q==1,q==2,q==3,q==4,q==5], [t, v, v, s_inv, p, p])
        bs     = np.select([q==0,q==1,q==2,q==3,q==4,q==5], [p, p, t, v, v, s_inv])
        self.px[i:j]       = x
        self.py[i:j]       = y
        self.vx[i:j]       = np.cos(angles) * speeds
        self.vy[i:j]       = np.sin(angles) * speeds
        self.r[i:j]        = rs * 255
        self.g[i:j]        = gs * 255
        self.b[i:j]        = bs * 255
        self.life[i:j]     = life + np.random.uniform(-0.2, 0.2, slots)
        self.max_life[i:j] = self.life[i:j]
        self.size[i:j]     = 3.5
        self._count        = j

    # ------------------------------------------------------------------ #
    #  Update                                                              #
    # ------------------------------------------------------------------ #
    def update(self, dt: float) -> None:
        if self._count == 0:
            return
        n = self._count
        # Physics
        self.vy[:n] += _GRAV_Y * dt
        self.px[:n] += self.vx[:n] * dt
        self.py[:n] += self.vy[:n] * dt
        self.life[:n] -= dt

        # Compact dead particles (boolean mask compaction)
        alive = self.life[:n] > 0.0
        k = int(alive.sum())
        if k == n:
            return
        if k == 0:
            self._count = 0
            return
        for arr in (self.px, self.py, self.vx, self.vy,
                    self.r,  self.g,  self.b,
                    self.life, self.max_life, self.size):
            arr[:k] = arr[:n][alive]
        self._count = k

    # ------------------------------------------------------------------ #
    #  Draw                                                                #
    # ------------------------------------------------------------------ #
    def draw(self, surface: pygame.Surface) -> None:
        if self._count == 0:
            return
        # Draw to an additive overlay surface for glow
        overlay = pygame.Surface(surface.get_size(), pygame.SRCALPHA)
        n = self._count
        for idx in range(n):
            t    = self.life[idx] / self.max_life[idx]   # 1 → 0 as particle ages
            alpha = int(t * 220)
            sz   = max(1, int(self.size[idx] * t))
            cr   = int(self.r[idx])
            cg   = int(self.g[idx])
            cb   = int(self.b[idx])
            x    = int(self.px[idx])
            y    = int(self.py[idx])
            pygame.draw.circle(overlay, (cr, cg, cb, alpha), (x, y), sz)
        surface.blit(overlay, (0, 0), special_flags=pygame.BLEND_ADD)

    @property
    def count(self) -> int:
        return self._count
