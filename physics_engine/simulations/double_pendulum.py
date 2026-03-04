"""
Double Pendulum – chaotic motion with RK4 integration.

The equations of motion are derived from the Lagrangian of the system.
Multiple pendulums with slightly different initial conditions reveal
sensitive dependence on initial conditions (chaos).

YouTube inspiration: Veritasium "The Surprising Secret of Synchronization",
Physics Girl, and countless chaos-theory explainers.
"""
from __future__ import annotations
import math
import pygame
from ..core.vector import Vec2

# ── Colours ───────────────────────────────────────────────────────────────────
_TRAIL_COLOURS = [
    (255,  80,  80),
    ( 80, 200, 255),
    (100, 255, 100),
    (255, 200,  50),
    (200,  80, 255),
    (255, 140,   0),
]
_BG        = (10, 10, 20)
_BOB_COL   = (230, 230, 230)
_ROD_COL   = (120, 120, 140)
_TEXT_COL  = (180, 180, 200)


class _Pendulum:
    """State of one double pendulum: (θ₁, ω₁, θ₂, ω₂)."""

    def __init__(self, theta1: float, theta2: float, L1: float, L2: float,
                 m1: float, m2: float, color: tuple) -> None:
        self.theta1 = theta1
        self.omega1 = 0.0
        self.theta2 = theta2
        self.omega2 = 0.0
        self.L1 = L1
        self.L2 = L2
        self.m1 = m1
        self.m2 = m2
        self.color = color
        self.trail: list[tuple[float, float]] = []
        self.max_trail = 600

    # ------------------------------------------------------------------ #
    #  Equations of motion (Lagrangian derivation)                        #
    # ------------------------------------------------------------------ #
    def _derivatives(self, t1: float, w1: float, t2: float, w2: float,
                     g: float) -> tuple[float, float, float, float]:
        L1, L2, m1, m2 = self.L1, self.L2, self.m1, self.m2
        delta = t2 - t1
        sd, cd = math.sin(delta), math.cos(delta)

        denom1 = L1 * (2 * m1 + m2 - m2 * math.cos(2 * delta))
        denom2 = L2 * (2 * m1 + m2 - m2 * math.cos(2 * delta))

        a1 = (
            -g * (2 * m1 + m2) * math.sin(t1)
            - m2 * g * math.sin(t1 - 2 * t2)
            - 2 * sd * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cd)
        ) / denom1

        a2 = (
            2 * sd * (
                w1 * w1 * L1 * (m1 + m2)
                + g * (m1 + m2) * math.cos(t1)
                + w2 * w2 * L2 * m2 * cd
            )
        ) / denom2

        return w1, a1, w2, a2

    def step_rk4(self, dt: float, g: float = 9.81) -> None:
        t1, w1, t2, w2 = self.theta1, self.omega1, self.theta2, self.omega2

        k1 = self._derivatives(t1, w1, t2, w2, g)
        k2 = self._derivatives(t1 + dt/2*k1[0], w1 + dt/2*k1[1],
                                t2 + dt/2*k1[2], w2 + dt/2*k1[3], g)
        k3 = self._derivatives(t1 + dt/2*k2[0], w1 + dt/2*k2[1],
                                t2 + dt/2*k2[2], w2 + dt/2*k2[3], g)
        k4 = self._derivatives(t1 + dt*k3[0], w1 + dt*k3[1],
                                t2 + dt*k3[2], w2 + dt*k3[3], g)

        self.theta1 += dt/6 * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0])
        self.omega1 += dt/6 * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1])
        self.theta2 += dt/6 * (k1[2] + 2*k2[2] + 2*k3[2] + k4[2])
        self.omega2 += dt/6 * (k1[3] + 2*k2[3] + 2*k3[3] + k4[3])

    def bob2_pos(self, pivot: Vec2) -> Vec2:
        x1 = pivot.x + self.L1 * math.sin(self.theta1)
        y1 = pivot.y + self.L1 * math.cos(self.theta1)
        x2 = x1 + self.L2 * math.sin(self.theta2)
        y2 = y1 + self.L2 * math.cos(self.theta2)
        return Vec2(x2, y2)

    def bob1_pos(self, pivot: Vec2) -> Vec2:
        return Vec2(
            pivot.x + self.L1 * math.sin(self.theta1),
            pivot.y + self.L1 * math.cos(self.theta1),
        )


class DoublePendulumSim:
    """
    Visualises multiple double pendulums with very slightly different
    initial angles, showing how quickly they diverge (chaos).
    """

    NAME = "Double Pendulum (Chaos)"
    DESCRIPTION = (
        "Multiple pendulums with nearly identical starting angles diverge "
        "exponentially – a classic demonstration of deterministic chaos."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width = width
        self.height = height
        self.pivot = Vec2(width / 2, height * 0.25)
        self.g = 9.81 * 60.0           # scaled for pixel space
        self.paused = False
        self.pendulums: list[_Pendulum] = []
        self._build()

    def _build(self) -> None:
        self.pendulums.clear()
        n = 6
        base_angle = math.pi * 0.75
        scale = min(self.width, self.height) * 0.18
        for i in range(n):
            delta = i * 0.002           # tiny angle nudge
            p = _Pendulum(
                theta1=base_angle + delta,
                theta2=base_angle * 0.8,
                L1=scale,
                L2=scale * 0.75,
                m1=2.0, m2=1.0,
                color=_TRAIL_COLOURS[i % len(_TRAIL_COLOURS)],
            )
            self.pendulums.append(p)

    def reset(self) -> None:
        self._build()

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self.reset()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused

    def update(self, dt: float) -> None:
        if self.paused:
            return
        # sub-step for accuracy
        sub = 8
        sub_dt = dt / sub
        for _ in range(sub):
            for pend in self.pendulums:
                pend.step_rk4(sub_dt, self.g)
                b2 = pend.bob2_pos(self.pivot)
                pend.trail.append((b2.x, b2.y))
                if len(pend.trail) > pend.max_trail:
                    pend.trail.pop(0)

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        for pend in self.pendulums:
            # Trail
            if len(pend.trail) > 1:
                for k in range(1, len(pend.trail)):
                    alpha = k / len(pend.trail)
                    r, g, b = pend.color
                    fade = (int(r * alpha), int(g * alpha), int(b * alpha))
                    pygame.draw.line(surface, fade,
                                     (int(pend.trail[k-1][0]), int(pend.trail[k-1][1])),
                                     (int(pend.trail[k][0]),   int(pend.trail[k][1])), 1)

        for pend in self.pendulums:
            b1 = pend.bob1_pos(self.pivot)
            b2 = pend.bob2_pos(self.pivot)
            pygame.draw.line(surface, _ROD_COL, self.pivot.to_int_tuple(), b1.to_int_tuple(), 2)
            pygame.draw.line(surface, _ROD_COL, b1.to_int_tuple(), b2.to_int_tuple(), 2)
            pygame.draw.circle(surface, pend.color, b1.to_int_tuple(), 9)
            pygame.draw.circle(surface, pend.color, b2.to_int_tuple(), 7)

        # Pivot
        pygame.draw.circle(surface, _BOB_COL, self.pivot.to_int_tuple(), 5)

        # HUD
        font = pygame.font.SysFont("monospace", 14)
        lines = [
            self.NAME,
            f"Pendulums: {len(self.pendulums)}  |  tiny Δθ = 0.002 rad",
            "SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
