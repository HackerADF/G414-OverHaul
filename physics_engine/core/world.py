"""Generic physics world that manages particles and rigid bodies."""
from __future__ import annotations
from .vector import Vec2
from .body import Particle, RigidBody
from .collision import CollisionDetector
from .constraint import DistanceConstraint, SpringConstraint


class World:
    """
    Manages a collection of particles and rigid bodies, applies gravity,
    solves constraints, and resolves collisions each step.
    """

    def __init__(
        self,
        gravity: Vec2 | None = None,
        bounds: tuple[int, int] = (800, 600),
    ) -> None:
        self.gravity: Vec2 = gravity if gravity is not None else Vec2(0.0, 980.0)
        self.bounds: tuple[int, int] = bounds
        self.particles: list[Particle] = []
        self.bodies: list[RigidBody] = []
        self.distance_constraints: list[DistanceConstraint] = []
        self.spring_constraints: list[SpringConstraint] = []
        self.collision_detector = CollisionDetector()
        self.constraint_iterations: int = 10
        self.use_verlet: bool = False

    # ------------------------------------------------------------------ #
    #  Object management                                                   #
    # ------------------------------------------------------------------ #
    def add_particle(self, p: Particle) -> Particle:
        self.particles.append(p)
        return p

    def add_body(self, b: RigidBody) -> RigidBody:
        self.bodies.append(b)
        return b

    def add_distance_constraint(self, c: DistanceConstraint) -> None:
        self.distance_constraints.append(c)

    def add_spring(self, s: SpringConstraint) -> None:
        self.spring_constraints.append(s)

    def clear(self) -> None:
        self.particles.clear()
        self.bodies.clear()
        self.distance_constraints.clear()
        self.spring_constraints.clear()

    # ------------------------------------------------------------------ #
    #  Simulation step                                                     #
    # ------------------------------------------------------------------ #
    def step(self, dt: float) -> None:
        # 1. Apply gravity
        for p in self.particles:
            if not p.pinned:
                p.apply_force(self.gravity * p.mass)
        for b in self.bodies:
            b.apply_force(self.gravity * b.mass)

        # 2. Apply spring forces
        for s in self.spring_constraints:
            s.apply()

        # 3. Integrate
        if self.use_verlet:
            for p in self.particles:
                p.integrate_verlet(dt)
        else:
            for p in self.particles:
                p.integrate_euler(dt)
        for b in self.bodies:
            b.integrate(dt)

        # 4. Solve distance constraints (iterative relaxation)
        for _ in range(self.constraint_iterations):
            for c in self.distance_constraints:
                c.solve()

        # 5. Boundary containment for particles
        w, h = self.bounds
        for p in self.particles:
            if p.pinned:
                continue
            if p.pos.x - p.radius < 0:
                p.pos.x = p.radius
                if not self.use_verlet:
                    p.vel.x *= -p.restitution
                else:
                    p.prev_pos.x = p.pos.x + (p.pos.x - p.prev_pos.x) * p.restitution
            if p.pos.x + p.radius > w:
                p.pos.x = w - p.radius
                if not self.use_verlet:
                    p.vel.x *= -p.restitution
                else:
                    p.prev_pos.x = p.pos.x + (p.pos.x - p.prev_pos.x) * p.restitution
            if p.pos.y - p.radius < 0:
                p.pos.y = p.radius
                if not self.use_verlet:
                    p.vel.y *= -p.restitution
                else:
                    p.prev_pos.y = p.pos.y + (p.pos.y - p.prev_pos.y) * p.restitution
            if p.pos.y + p.radius > h:
                p.pos.y = h - p.radius
                if not self.use_verlet:
                    p.vel.y *= -p.restitution
                else:
                    p.prev_pos.y = p.pos.y + (p.pos.y - p.prev_pos.y) * p.restitution

        # 6. Boundary containment & collision for rigid bodies
        for b in self.bodies:
            if b.pos.x - b.radius < 0:
                b.pos.x = b.radius
                b.vel.x = abs(b.vel.x) * b.restitution
            if b.pos.x + b.radius > w:
                b.pos.x = w - b.radius
                b.vel.x = -abs(b.vel.x) * b.restitution
            if b.pos.y - b.radius < 0:
                b.pos.y = b.radius
                b.vel.y = abs(b.vel.y) * b.restitution
            if b.pos.y + b.radius > h:
                b.pos.y = h - b.radius
                b.vel.y = -abs(b.vel.y) * b.restitution

        self.collision_detector.resolve_bodies(self.bodies)
