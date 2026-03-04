"""
Smoothed Particle Hydrodynamics (SPH) Fluid Simulation.

An approximation of the Navier–Stokes equations using particles.
Each particle interacts with neighbours within a smoothing radius h,
computing density, pressure, and viscosity forces.

YouTube inspiration: Sebastian Lague "Coding Adventure: Simulating Fluids",
Ten Minute Physics fluid episode.
"""
from __future__ import annotations
import math
import random
import pygame
import numpy as np
from ..core.vector import Vec2

_BG       = (8, 12, 22)
_TEXT_COL = (160, 160, 210)

# SPH parameters
_H          = 30.0           # smoothing radius (pixels)
_H2         = _H * _H
_REST_DENS  = 300.0          # rest density (particles per kernel volume)
_GAS_CONST  = 2000.0         # gas constant (stiffness)
_NEAR_CONST = 0.5            # near-pressure stiffness
_VISC       = 200.0          # viscosity coefficient
_GRAVITY    = Vec2(0.0, 500.0)
_PARTICLE_MASS = 1.0
_DAMPING    = 0.5


class _Particle:
    __slots__ = ("pos", "vel", "force", "density", "pressure", "near_density", "color")

    def __init__(self, pos: Vec2) -> None:
        self.pos     = pos.copy()
        self.vel     = Vec2(random.uniform(-20, 20), random.uniform(-10, 10))
        self.force   = Vec2.zero()
        self.density = 0.0
        self.pressure= 0.0
        self.near_density = 0.0
        self.color   = (60, 130, 220)


def _poly6(r2: float, h2: float) -> float:
    diff = h2 - r2
    if diff <= 0:
        return 0.0
    return (315.0 / (64.0 * math.pi * (h2 ** 3.5))) * diff * diff * diff


def _spiky_grad(r: float, h: float) -> float:
    if r <= 0 or r >= h:
        return 0.0
    diff = h - r
    return -(45.0 / (math.pi * h ** 6)) * diff * diff


def _visc_lap(r: float, h: float) -> float:
    if r >= h:
        return 0.0
    return (45.0 / (math.pi * h ** 6)) * (h - r)


class FluidSPHSim:
    NAME = "SPH Fluid Simulation"
    DESCRIPTION = (
        "Smoothed Particle Hydrodynamics fluid. "
        "Left-click to add particles. Right-click to apply an outward force."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.particles: list[_Particle] = []
        self.paused = False
        self._lmb   = False
        self._rmb   = False
        self._mouse = Vec2.zero()
        self._spawn_dam()

    def _spawn_dam(self) -> None:
        self.particles.clear()
        cx, cy = self.width * 0.25, self.height * 0.25
        spacing = _H * 0.6
        cols = 16
        rows = 20
        for r in range(rows):
            for c in range(cols):
                pos = Vec2(cx + c * spacing + random.uniform(-2, 2),
                           cy + r * spacing + random.uniform(-2, 2))
                self.particles.append(_Particle(pos))

    def reset(self) -> None:
        self._spawn_dam()

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self.reset()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                self._lmb = True
            elif event.button == 3:
                self._rmb = True
        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1:
                self._lmb = False
            elif event.button == 3:
                self._rmb = False
        elif event.type == pygame.MOUSEMOTION:
            self._mouse = Vec2(*event.pos)

    def update(self, dt: float) -> None:
        if self.paused:
            return
        if self._lmb and len(self.particles) < 600:
            for _ in range(3):
                p = _Particle(Vec2(self._mouse.x + random.uniform(-10, 10),
                                   self._mouse.y + random.uniform(-10, 10)))
                p.vel = Vec2(random.uniform(-30, 30), 50)
                self.particles.append(p)

        parts = self.particles
        n = len(parts)
        if n == 0:
            return

        # 1. Compute density & pressure
        for i in range(n):
            pi = parts[i]
            pi.density = 0.0
            for j in range(n):
                if i == j:
                    continue
                pj = parts[j]
                r2 = (pi.pos - pj.pos).length_sq()
                if r2 < _H2:
                    pi.density += _PARTICLE_MASS * _poly6(r2, _H2)
            pi.density = max(pi.density, 1e-6)
            pi.pressure = _GAS_CONST * (pi.density - _REST_DENS)

        # 2. Compute forces
        for i in range(n):
            pi = parts[i]
            pi.force = _GRAVITY * _PARTICLE_MASS

            if self._rmb:
                d = pi.pos - self._mouse
                dist = d.length()
                if dist < 120 and dist > 1:
                    pi.force += d.normalized() * (500.0 / max(dist, 10))

            for j in range(n):
                if i == j:
                    continue
                pj = parts[j]
                delta = pj.pos - pi.pos
                r2 = delta.length_sq()
                if r2 >= _H2:
                    continue
                r = math.sqrt(r2)
                if r < 1e-6:
                    continue
                n_dir = delta / r

                # Pressure force
                p_force = -(pi.pressure + pj.pressure) / (2.0 * pj.density)
                pi.force += n_dir * (_PARTICLE_MASS * p_force * _spiky_grad(r, _H))

                # Viscosity force
                v_force = _VISC * (pj.vel - pi.vel) / pj.density
                pi.force += v_force * (_PARTICLE_MASS * _visc_lap(r, _H))

        # 3. Integrate (symplectic Euler)
        w, h = self.width, self.height
        for p in parts:
            acc = p.force * (1.0 / _PARTICLE_MASS)
            p.vel += acc * dt
            # Cap velocity
            speed = p.vel.length()
            if speed > 800:
                p.vel = p.vel * (800 / speed)
            p.pos += p.vel * dt

            # Boundary (sticky with damping)
            if p.pos.x < _H * 0.5:
                p.pos.x = _H * 0.5
                p.vel.x *= -_DAMPING
            if p.pos.x > w - _H * 0.5:
                p.pos.x = w - _H * 0.5
                p.vel.x *= -_DAMPING
            if p.pos.y < _H * 0.5:
                p.pos.y = _H * 0.5
                p.vel.y *= -_DAMPING
            if p.pos.y > h - _H * 0.5:
                p.pos.y = h - _H * 0.5
                p.vel.y *= -_DAMPING

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        for p in self.particles:
            speed = p.vel.length()
            t = min(speed / 400.0, 1.0)
            r = int(60  + t * (200 - 60))
            g = int(130 + t * (60  - 130))
            b = int(220 + t * (80  - 220))
            pygame.draw.circle(surface, (r, g, b), p.pos.to_int_tuple(), 5)

        font = pygame.font.SysFont("monospace", 14)
        lines = [
            self.NAME,
            f"Particles: {len(self.particles)}  (max 600)",
            "LMB add fluid   RMB repel   SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
