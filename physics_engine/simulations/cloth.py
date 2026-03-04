"""
Cloth / Soft-Body Simulation using Verlet integration and distance constraints.

A grid of particles connected by structural, shear, and bend springs.
The cloth tears when constraints are stretched too far (optional).

YouTube inspiration: Sebastian Lague "Coding Adventure: Cloth & Soft Bodies",
Ten Minute Physics cloth episodes.
"""
from __future__ import annotations
import math
import pygame
from ..core.vector import Vec2
from ..core.body import Particle
from ..core.constraint import DistanceConstraint

_BG          = (15, 15, 25)
_CLOTH_COL   = (90, 140, 220)
_CLOTH_SHADE = (50,  80, 160)
_PIN_COL     = (255, 180,  60)
_TEXT_COL    = (180, 180, 200)

_GRAVITY     = Vec2(0.0, 1200.0)
_DAMPING     = 0.98
_ITERATIONS  = 15
_TEAR_DIST   = 2.5     # multiplier of rest length before constraint breaks


class ClothSim:
    NAME = "Cloth Simulation"
    DESCRIPTION = (
        "Verlet-integrated cloth with structural, shear, and bend constraints. "
        "Left-click to grab and drag – right-click to tear."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width   = width
        self.height  = height
        self.cols    = 40
        self.rows    = 28
        self.spacing = 18
        self.paused  = False
        self.wind    = Vec2(0, 0)
        self.particles: list[Particle]           = []
        self.constraints: list[DistanceConstraint] = []
        self.grab_particle: Particle | None = None
        self._build()

    def _build(self) -> None:
        self.particles.clear()
        self.constraints.clear()
        self.grab_particle = None

        cols, rows, sp = self.cols, self.rows, self.spacing
        ox = (self.width  - (cols - 1) * sp) / 2
        oy = self.height  * 0.08

        # Create particles
        grid: list[list[Particle]] = []
        for r in range(rows):
            row_list = []
            for c in range(cols):
                pos = Vec2(ox + c * sp, oy + r * sp)
                p = Particle(pos, mass=1.0, radius=3.0)
                p.prev_pos = pos.copy()   # no initial velocity
                p.color = _CLOTH_COL
                row_list.append(p)
                self.particles.append(p)
            grid.append(row_list)

        # Pin top row
        for c in range(0, cols, 4):
            grid[0][c].pinned    = True
            grid[0][c].inv_mass  = 0.0
            grid[0][c].color     = _PIN_COL

        # Add constraints
        for r in range(rows):
            for c in range(cols):
                p = grid[r][c]
                if c + 1 < cols:   # horizontal
                    self._add_con(p, grid[r][c + 1])
                if r + 1 < rows:   # vertical
                    self._add_con(p, grid[r + 1][c])
                if r + 1 < rows and c + 1 < cols:   # shear \
                    self._add_con(p, grid[r + 1][c + 1], stiffness=0.6)
                if r + 1 < rows and c - 1 >= 0:     # shear /
                    self._add_con(p, grid[r + 1][c - 1], stiffness=0.6)
                if c + 2 < cols:   # bend horizontal
                    self._add_con(p, grid[r][c + 2], stiffness=0.4)
                if r + 2 < rows:   # bend vertical
                    self._add_con(p, grid[r + 2][c], stiffness=0.4)

    def _add_con(self, a: Particle, b: Particle, stiffness: float = 1.0) -> None:
        self.constraints.append(
            DistanceConstraint(a, b, stiffness=stiffness)
        )

    def reset(self) -> None:
        self._build()

    def _screen_to_particle(self, mx: int, my: int) -> Particle | None:
        best: Particle | None = None
        best_d = 20.0
        mp = Vec2(mx, my)
        for p in self.particles:
            d = p.pos.distance_to(mp)
            if d < best_d:
                best_d = d
                best = p
        return best

    def _tear_near(self, mx: int, my: int, radius: float = 25.0) -> None:
        mp = Vec2(mx, my)
        self.constraints = [
            c for c in self.constraints
            if c.a.pos.distance_to(mp) > radius and c.b.pos.distance_to(mp) > radius
        ]

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self.reset()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused
            elif event.key == pygame.K_w:
                self.wind = Vec2(random.uniform(200, 600) * (1 if random.random() > 0.5 else -1), 0)
            elif event.key == pygame.K_c:
                self.wind = Vec2(0, 0)
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                self.grab_particle = self._screen_to_particle(*event.pos)
                if self.grab_particle:
                    self.grab_particle.pinned = True
                    self.grab_particle.inv_mass = 0.0
            elif event.button == 3:
                self._tear_near(*event.pos)
        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1 and self.grab_particle:
                self.grab_particle.pinned = False
                self.grab_particle.inv_mass = 1.0 / self.grab_particle.mass
                self.grab_particle = None
        elif event.type == pygame.MOUSEMOTION:
            if self.grab_particle:
                self.grab_particle.pos = Vec2(*event.pos)
                self.grab_particle.prev_pos = Vec2(*event.pos)

    def update(self, dt: float) -> None:
        if self.paused:
            return
        # Apply gravity + wind to each particle
        g = _GRAVITY
        for p in self.particles:
            if p.pinned:
                continue
            acc = g
            if self.wind.length_sq() > 0:
                acc = acc + self.wind
            new_pos = (
                p.pos * (1.0 + _DAMPING)
                - p.prev_pos * _DAMPING
                + acc * (dt * dt)
            )
            p.prev_pos = p.pos.copy()
            p.pos = new_pos

        # Solve constraints
        to_remove = []
        for _ in range(_ITERATIONS):
            for c in self.constraints:
                delta = c.b.pos - c.a.pos
                dist  = delta.length()
                if dist < 1e-8:
                    continue
                # Check tear
                if dist > c.rest_length * _TEAR_DIST:
                    to_remove.append(c)
                    continue
                diff = (dist - c.rest_length) / dist
                total_inv = c.a.inv_mass + c.b.inv_mass
                if total_inv < 1e-10:
                    continue
                corr = delta * (diff * c.stiffness / total_inv)
                c.a.pos += corr * c.a.inv_mass
                c.b.pos -= corr * c.b.inv_mass

        for c in to_remove:
            if c in self.constraints:
                self.constraints.remove(c)

        # Floor collision
        for p in self.particles:
            if p.pos.y > self.height - 5:
                p.pos.y = self.height - 5
                p.prev_pos.y = p.pos.y

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        for c in self.constraints:
            pygame.draw.line(surface, _CLOTH_COL,
                             c.a.pos.to_int_tuple(), c.b.pos.to_int_tuple(), 1)

        for p in self.particles:
            if p.pinned and p is not self.grab_particle:
                pygame.draw.circle(surface, _PIN_COL, p.pos.to_int_tuple(), 4)

        if self.grab_particle:
            pygame.draw.circle(surface, (255, 80, 80), self.grab_particle.pos.to_int_tuple(), 6)

        font = pygame.font.SysFont("monospace", 14)
        lines = [
            self.NAME,
            f"Particles: {len(self.particles)}  Constraints: {len(self.constraints)}",
            "LMB grab   RMB tear   W wind   C calm   SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))


import random  # noqa: E402 – needed for wind direction
