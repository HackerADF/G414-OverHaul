"""
N-Body Gravitational Simulation.

Demonstrates orbital mechanics, the three-body problem, galaxy formation,
and Lagrange points. Uses symplectic Euler (leapfrog) for long-term
energy conservation.

YouTube inspiration: ScienceClic, PBS Space Time, "The Three Body Problem".
"""
from __future__ import annotations
import math
import random
import pygame
from ..core.vector import Vec2

_BG         = (5, 5, 15)
_TEXT_COL   = (160, 160, 200)
_TRAIL_LEN  = 300


class _Body:
    def __init__(self, pos: Vec2, vel: Vec2, mass: float, color: tuple) -> None:
        self.pos   = pos.copy()
        self.vel   = vel.copy()
        self.mass  = mass
        self.color = color
        self.trail: list[tuple[int, int]] = []
        self.radius = max(3, int(mass ** 0.4))

    def add_trail(self) -> None:
        self.trail.append(self.pos.to_int_tuple())
        if len(self.trail) > _TRAIL_LEN:
            self.trail.pop(0)


class NBodySim:
    NAME = "N-Body Gravity"
    DESCRIPTION = (
        "Gravitational simulation with configurable scenarios: "
        "binary star, solar system, three-body problem, and galaxy collision."
    )

    SCENARIOS = ["Binary Star", "Solar System", "Three-Body Chaos", "Galaxy Collision"]

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.G      = 6.674e-2     # scaled gravitational constant
        self.paused = False
        self.scenario_idx = 0
        self.bodies: list[_Body] = []
        self._build()

    # ------------------------------------------------------------------ #
    #  Scenarios                                                           #
    # ------------------------------------------------------------------ #
    def _build(self) -> None:
        self.bodies.clear()
        name = self.SCENARIOS[self.scenario_idx % len(self.SCENARIOS)]
        cx, cy = self.width / 2, self.height / 2

        if name == "Binary Star":
            d = 160.0
            v = math.sqrt(self.G * 3000 / (2 * d)) * 0.9
            self.bodies = [
                _Body(Vec2(cx - d, cy), Vec2(0,  v), 3000, (255, 180,  60)),
                _Body(Vec2(cx + d, cy), Vec2(0, -v), 3000, (100, 180, 255)),
            ]

        elif name == "Solar System":
            sun = _Body(Vec2(cx, cy), Vec2.zero(), 20000, (255, 200, 50))
            self.bodies = [sun]
            planets = [
                (70,  10,  (200, 200, 255)),
                (110, 15,  ( 80, 180,  80)),
                (160, 12,  ( 80, 120, 255)),
                (230, 20,  (200, 100,  50)),
                (340, 40,  (200, 160, 100)),
                (450, 28,  (180, 220, 255)),
            ]
            for r, m, col in planets:
                v = math.sqrt(self.G * sun.mass / r)
                self.bodies.append(_Body(Vec2(cx + r, cy), Vec2(0, v), m, col))

        elif name == "Three-Body Chaos":
            # Figure-8 three-body solution (Chenciner & Montgomery 2000)
            # Scaled to pixel space
            scale = 120.0
            vscale = 2.6
            m = 1200.0
            bodies_data = [
                (( 0.9700, -0.2430), (-0.9324, -0.8647)),
                ((-0.9700,  0.2430), (-0.8647,  0.9324)),  # approx figure-8
                (( 0.0000,  0.0000), ( 1.7971, -0.0677)),
            ]
            colors = [(255, 80, 80), (80, 255, 130), (80, 160, 255)]
            for (px, py), (vx, vy), col in zip(
                    [d[0] for d in bodies_data],
                    [d[1] for d in bodies_data],
                    colors):
                self.bodies.append(
                    _Body(Vec2(cx + px * scale, cy + py * scale),
                          Vec2(vx * vscale, vy * vscale), m, col))

        elif name == "Galaxy Collision":
            self.bodies.clear()
            self._make_galaxy(Vec2(cx - 200, cy), Vec2(0.4, 0.15), 4000, 35, (255, 200, 100))
            self._make_galaxy(Vec2(cx + 200, cy), Vec2(-0.4, -0.1), 4000, 35, (100, 200, 255))

    def _make_galaxy(self, center: Vec2, bulk_vel: Vec2,
                     core_mass: float, n_stars: int,
                     color: tuple) -> None:
        core = _Body(center, bulk_vel, core_mass, color)
        self.bodies.append(core)
        for _ in range(n_stars):
            r = random.uniform(30, 160)
            angle = random.uniform(0, math.tau)
            pos = Vec2(center.x + r * math.cos(angle),
                       center.y + r * math.sin(angle))
            v_mag = math.sqrt(self.G * core_mass / r) * random.uniform(0.8, 1.2)
            perp = Vec2(-math.sin(angle), math.cos(angle))
            vel = Vec2(bulk_vel.x + perp.x * v_mag, bulk_vel.y + perp.y * v_mag)
            star_mass = random.uniform(5, 20)
            self.bodies.append(_Body(pos, vel, star_mass, color))

    # ------------------------------------------------------------------ #
    #  Simulation                                                          #
    # ------------------------------------------------------------------ #
    def _compute_forces(self) -> list[Vec2]:
        forces = [Vec2.zero() for _ in self.bodies]
        n = len(self.bodies)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = self.bodies[i], self.bodies[j]
                delta = b.pos - a.pos
                dist_sq = delta.length_sq()
                if dist_sq < 100.0:          # softening
                    dist_sq = 100.0
                dist = math.sqrt(dist_sq)
                f_mag = self.G * a.mass * b.mass / dist_sq
                f = delta * (f_mag / dist)
                forces[i] += f
                forces[j] -= f
        return forces

    def update(self, dt: float) -> None:
        if self.paused:
            return
        sub = 4
        sub_dt = dt / sub
        for _ in range(sub):
            forces = self._compute_forces()
            for body, force in zip(self.bodies, forces):
                acc = force * (1.0 / body.mass)
                body.vel += acc * sub_dt
                body.pos += body.vel * sub_dt
                body.add_trail()

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self._build()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused
            elif event.key == pygame.K_RIGHT:
                self.scenario_idx += 1
                self._build()
            elif event.key == pygame.K_LEFT:
                self.scenario_idx -= 1
                self._build()

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        for body in self.bodies:
            if len(body.trail) > 1:
                for k in range(1, len(body.trail)):
                    alpha = k / len(body.trail)
                    r, g, b = body.color
                    col = (int(r * alpha * 0.6), int(g * alpha * 0.6), int(b * alpha * 0.6))
                    pygame.draw.line(surface, col, body.trail[k-1], body.trail[k], 1)

        for body in self.bodies:
            pos = (int(body.pos.x), int(body.pos.y))
            pygame.draw.circle(surface, body.color, pos, body.radius)

        font = pygame.font.SysFont("monospace", 14)
        scenario_name = self.SCENARIOS[self.scenario_idx % len(self.SCENARIOS)]
        lines = [
            f"Scenario: {scenario_name}  |  Bodies: {len(self.bodies)}",
            "← → change scenario   SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
