"""Particle and rigid body primitives."""
from __future__ import annotations
from .vector import Vec2


class Particle:
    """
    Point-mass particle for use in constraint and particle-based simulations.
    Supports both Euler and Verlet integration depending on the caller.
    """

    def __init__(
        self,
        position: Vec2,
        mass: float = 1.0,
        radius: float = 5.0,
        *,
        pinned: bool = False,
    ) -> None:
        self.pos: Vec2 = position.copy()
        self.prev_pos: Vec2 = position.copy()   # for Verlet
        self.vel: Vec2 = Vec2.zero()
        self.force: Vec2 = Vec2.zero()
        self.mass: float = mass
        self.inv_mass: float = 0.0 if pinned else (1.0 / mass)
        self.radius: float = radius
        self.pinned: bool = pinned
        self.restitution: float = 0.6
        self.color: tuple[int, int, int] = (200, 200, 200)

    def apply_force(self, f: Vec2) -> None:
        self.force += f

    def integrate_euler(self, dt: float) -> None:
        if self.pinned:
            return
        acc = self.force * self.inv_mass
        self.vel += acc * dt
        self.pos += self.vel * dt
        self.force = Vec2.zero()

    def integrate_verlet(self, dt: float) -> None:
        """Position-Verlet (Störmer–Verlet). Ignores self.vel for stepping."""
        if self.pinned:
            return
        acc = self.force * self.inv_mass
        new_pos = self.pos * 2.0 - self.prev_pos + acc * (dt * dt)
        self.prev_pos = self.pos.copy()
        self.pos = new_pos
        # Approximate velocity for energy / rendering purposes
        self.vel = (self.pos - self.prev_pos) * (1.0 / dt)
        self.force = Vec2.zero()

    def clear_forces(self) -> None:
        self.force = Vec2.zero()


class RigidBody:
    """
    Simple axis-aligned circle rigid body for collision demos.
    Uses symplectic Euler integration.
    """

    def __init__(
        self,
        position: Vec2,
        mass: float = 1.0,
        radius: float = 20.0,
    ) -> None:
        self.pos: Vec2 = position.copy()
        self.vel: Vec2 = Vec2.zero()
        self.force: Vec2 = Vec2.zero()
        self.mass: float = mass
        self.inv_mass: float = 1.0 / mass
        self.radius: float = radius
        self.restitution: float = 0.98   # very elastic by default
        self.color: tuple[int, int, int] = (220, 220, 220)

    def apply_force(self, f: Vec2) -> None:
        self.force += f

    def apply_impulse(self, impulse: Vec2) -> None:
        self.vel += impulse * self.inv_mass

    def integrate(self, dt: float) -> None:
        # Symplectic Euler: update velocity first, then position
        acc = self.force * self.inv_mass
        self.vel += acc * dt
        self.pos += self.vel * dt
        self.force = Vec2.zero()

    def kinetic_energy(self) -> float:
        return 0.5 * self.mass * self.vel.length_sq()
