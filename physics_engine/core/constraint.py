"""Distance and spring constraints between particles."""
from __future__ import annotations
from .body import Particle
from .vector import Vec2


class DistanceConstraint:
    """
    Positional constraint that maintains a fixed rest length between two particles.
    Solved iteratively via projection (XPBD-style without compliance).
    """

    def __init__(
        self,
        a: Particle,
        b: Particle,
        rest_length: float | None = None,
        stiffness: float = 1.0,
    ) -> None:
        self.a = a
        self.b = b
        self.rest_length = rest_length if rest_length is not None else (b.pos - a.pos).length()
        self.stiffness = max(0.0, min(1.0, stiffness))

    def solve(self) -> None:
        delta = self.b.pos - self.a.pos
        dist = delta.length()
        if dist < 1e-10:
            return
        diff = (dist - self.rest_length) / dist
        total_inv = self.a.inv_mass + self.b.inv_mass
        if total_inv < 1e-10:
            return
        correction = delta * (diff * self.stiffness / total_inv)
        self.a.pos += correction * self.a.inv_mass
        self.b.pos -= correction * self.b.inv_mass


class SpringConstraint:
    """
    Hooke's law spring with optional damping, applied as a force each frame.
    """

    def __init__(
        self,
        a: Particle,
        b: Particle,
        rest_length: float | None = None,
        stiffness: float = 200.0,
        damping: float = 5.0,
    ) -> None:
        self.a = a
        self.b = b
        self.rest_length = rest_length if rest_length is not None else (b.pos - a.pos).length()
        self.stiffness = stiffness
        self.damping = damping

    def apply(self) -> None:
        delta = self.b.pos - self.a.pos
        dist = delta.length()
        if dist < 1e-10:
            return
        direction = delta / dist
        extension = dist - self.rest_length

        # Relative velocity along spring axis (damping)
        rel_vel = self.b.vel - self.a.vel
        damp_force = self.damping * rel_vel.dot(direction)

        force_mag = self.stiffness * extension + damp_force
        force = direction * force_mag
        self.a.apply_force(force)
        self.b.apply_force(-force)
