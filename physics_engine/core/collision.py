"""Circle-circle collision detection and impulse-based resolution."""
from __future__ import annotations
from .body import RigidBody
from .vector import Vec2


class CollisionDetector:
    """Brute-force O(n²) circle collision resolver for rigid bodies."""

    def resolve_bodies(self, bodies: list[RigidBody]) -> None:
        n = len(bodies)
        for i in range(n):
            for j in range(i + 1, n):
                self._resolve_pair(bodies[i], bodies[j])

    def _resolve_pair(self, a: RigidBody, b: RigidBody) -> None:
        delta = b.pos - a.pos
        dist_sq = delta.length_sq()
        min_dist = a.radius + b.radius

        if dist_sq >= min_dist * min_dist or dist_sq < 1e-10:
            return

        dist = dist_sq ** 0.5
        normal = delta / dist

        # Positional correction – push bodies apart
        overlap = min_dist - dist
        total_inv = a.inv_mass + b.inv_mass
        if total_inv < 1e-10:
            return
        correction = normal * (overlap / total_inv)
        a.pos -= correction * a.inv_mass
        b.pos += correction * b.inv_mass

        # Impulse-based velocity correction
        rel_vel = b.vel - a.vel
        vel_along_normal = rel_vel.dot(normal)
        if vel_along_normal > 0:
            return  # separating

        e = min(a.restitution, b.restitution)
        j = -(1.0 + e) * vel_along_normal / total_inv
        impulse = normal * j
        a.vel -= impulse * a.inv_mass
        b.vel += impulse * b.inv_mass
