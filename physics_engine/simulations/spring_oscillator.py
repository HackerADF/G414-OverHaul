"""
Spring Oscillator – simple and coupled harmonic oscillators.

Demonstrates resonance, normal modes, energy transfer between coupled
oscillators, and the effect of damping.

YouTube inspiration: Veritasium "Surprising Harmonic Resonance",
amazing coupled pendulum/spring demonstrations.
"""
from __future__ import annotations
import math
import pygame
from ..core.vector import Vec2

_BG        = (12, 12, 22)
_TEXT_COL  = (170, 170, 210)
_SPRING_COL = (80, 160, 255)
_MASS_COL   = (220, 100, 60)
_TRAIL_COL  = (60, 180, 120)

_MODES = ["Single Spring", "Coupled Oscillators", "Driven Resonance"]


class _Mass1D:
    """1-D spring-mass with position, velocity, and applied force."""

    def __init__(self, x0: float, mass: float = 1.0) -> None:
        self.x    = x0
        self.x0   = x0     # equilibrium
        self.vel  = 0.0
        self.mass = mass
        self.trail: list[float] = []

    def add_trail(self) -> None:
        self.trail.append(self.x)
        if len(self.trail) > 400:
            self.trail.pop(0)

    def step(self, force: float, dt: float, damping: float = 0.0) -> None:
        acc = (force - damping * self.vel) / self.mass
        self.vel += acc * dt
        self.x   += self.vel * dt
        self.add_trail()


class SpringOscillatorSim:
    NAME = "Spring Oscillator"
    DESCRIPTION = (
        "Simple harmonic motion, coupled oscillators showing normal modes, "
        "and driven resonance. Arrows adjust stiffness and drive frequency."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width   = width
        self.height  = height
        self.time    = 0.0
        self.mode    = 0
        self.paused  = False
        self.k       = 50.0       # spring constant
        self.damping = 0.5
        self.drive_f = 0.0        # drive frequency
        self.drive_amp = 80.0
        self._build()

    def _build(self) -> None:
        self.time = 0.0
        cx = self.width  // 2
        cy = self.height // 2
        if self.mode == 0:       # Single spring
            self.masses = [_Mass1D(cx + 100.0, mass=1.0)]
            self.drive_f = math.sqrt(self.k) / (2 * math.pi) * 0.8

        elif self.mode == 1:     # Two coupled
            self.masses = [
                _Mass1D(cx - 150.0, mass=1.0),
                _Mass1D(cx + 150.0, mass=1.0),
            ]
            self.masses[0].vel = 80.0
            self.drive_f = 0.0

        elif self.mode == 2:     # Driven resonance
            self.masses = [_Mass1D(cx, mass=1.0)]
            self.drive_f = math.sqrt(self.k) / (2 * math.pi)   # natural frequency

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_SPACE:
                self.paused = not self.paused
            elif event.key == pygame.K_r:
                self._build()
            elif event.key == pygame.K_TAB:
                self.mode = (self.mode + 1) % len(_MODES)
                self._build()
            elif event.key == pygame.K_UP:
                self.k = min(self.k + 10, 500)
                if self.mode == 2:
                    self.drive_f = math.sqrt(self.k) / (2 * math.pi)
            elif event.key == pygame.K_DOWN:
                self.k = max(self.k - 10, 5)
                if self.mode == 2:
                    self.drive_f = math.sqrt(self.k) / (2 * math.pi)
            elif event.key == pygame.K_LEFT:
                self.drive_f = max(self.drive_f - 0.05, 0.05)
            elif event.key == pygame.K_RIGHT:
                self.drive_f = min(self.drive_f + 0.05, 5.0)

    def update(self, dt: float) -> None:
        if self.paused:
            return
        self.time += dt

        if self.mode == 0:         # Single spring
            m = self.masses[0]
            disp = m.x - m.x0
            force = -self.k * disp
            m.step(force, dt, self.damping)

        elif self.mode == 1:       # Two coupled
            m1, m2 = self.masses
            k_wall  = self.k
            k_couple = self.k * 0.3
            d1 = m1.x - m1.x0
            d2 = m2.x - m2.x0
            couple = (m2.x - m1.x) - (m2.x0 - m1.x0)
            f1 = -k_wall * d1 + k_couple * couple
            f2 = -k_wall * d2 - k_couple * couple
            m1.step(f1, dt, self.damping)
            m2.step(f2, dt, self.damping)

        elif self.mode == 2:       # Driven resonance
            m = self.masses[0]
            drive = self.drive_amp * math.sin(2 * math.pi * self.drive_f * self.time)
            disp  = m.x - m.x0
            force = -self.k * disp + drive
            m.step(force, dt, self.damping * 0.1)

    # ------------------------------------------------------------------ #
    #  Drawing                                                             #
    # ------------------------------------------------------------------ #
    def _draw_spring(self, surface: pygame.Surface,
                     x_wall: float, x_mass: float, y: float) -> None:
        coils = 14
        coil_w = 10
        length = abs(x_mass - x_wall)
        step   = length / (coils * 2)
        pts: list[tuple[int, int]] = [(int(x_wall), int(y))]
        for i in range(coils * 2):
            px = x_wall + (i + 0.5) * step
            py = y + (coil_w if i % 2 == 0 else -coil_w)
            pts.append((int(px), int(py)))
        pts.append((int(x_mass), int(y)))
        if len(pts) > 1:
            pygame.draw.lines(surface, _SPRING_COL, False, pts, 2)

    def _draw_trail(self, surface: pygame.Surface,
                    trail: list[float], y_center: float, color: tuple) -> None:
        if len(trail) < 2:
            return
        pts = []
        for i, tx in enumerate(trail):
            px = int(i * self.width / len(trail))
            py = int(y_center + (tx - (self.width // 2)) * 0.5)
            pts.append((px, py))
        pygame.draw.lines(surface, color, False, pts, 1)

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)
        cx = self.width  // 2
        cy = self.height // 2
        mode_name = _MODES[self.mode]

        if self.mode == 0:
            m = self.masses[0]
            wall_x = cx - 300
            pygame.draw.rect(surface, (80, 80, 120), (wall_x - 10, cy - 80, 10, 160))
            self._draw_spring(surface, wall_x, m.x, cy)
            pygame.draw.circle(surface, _MASS_COL, (int(m.x), cy), 22)
            # Draw equilibrium line
            pygame.draw.line(surface, (50, 50, 80), (cx, cy - 100), (cx, cy + 100), 1)
            # Trail at bottom
            self._draw_trail(surface, m.trail, cy + 200, _TRAIL_COL)
            font = pygame.font.SysFont("monospace", 14)
            w_n = math.sqrt(self.k) / (2 * math.pi)
            surface.blit(font.render(f"k={self.k:.0f}  ωn={w_n:.2f} Hz  x={m.x - m.x0:+.1f}px",
                                     True, _TEXT_COL), (12, cy + 160))

        elif self.mode == 1:
            m1, m2 = self.masses
            wall_l = 80
            wall_r = self.width - 80
            wall_y = cy
            pygame.draw.rect(surface, (80, 80, 120), (wall_l - 10, wall_y - 80, 10, 160))
            pygame.draw.rect(surface, (80, 80, 120), (wall_r,      wall_y - 80, 10, 160))
            self._draw_spring(surface, wall_l, m1.x, wall_y)
            self._draw_spring(surface, m1.x,   m2.x, wall_y)
            self._draw_spring(surface, m2.x,  wall_r, wall_y)
            pygame.draw.circle(surface, _MASS_COL,         (int(m1.x), wall_y), 22)
            pygame.draw.circle(surface, (60, 200, 160),     (int(m2.x), wall_y), 22)
            self._draw_trail(surface, m1.trail, cy + 200, _MASS_COL)
            self._draw_trail(surface, m2.trail, cy + 250, (60, 200, 160))

        elif self.mode == 2:
            m = self.masses[0]
            wall_x = cx - 300
            # Animated driving force indicator
            drive_x = wall_x + self.drive_amp * math.sin(2 * math.pi * self.drive_f * self.time)
            pygame.draw.rect(surface, (80, 80, 120), (int(drive_x) - 10, cy - 80, 10, 160))
            self._draw_spring(surface, drive_x, m.x, cy)
            pygame.draw.circle(surface, _MASS_COL, (int(m.x), cy), 22)
            self._draw_trail(surface, m.trail, cy + 200, _TRAIL_COL)
            font = pygame.font.SysFont("monospace", 14)
            w_n = math.sqrt(self.k) / (2 * math.pi)
            ratio = self.drive_f / w_n if w_n > 0 else 0
            surface.blit(
                font.render(f"k={self.k:.0f}  ωn={w_n:.2f} Hz  ωd={self.drive_f:.2f} Hz  ratio={ratio:.2f}",
                            True, _TEXT_COL), (12, cy + 160))
            surf_res = font.render("← → adjust drive frequency  (resonance when ratio≈1)",
                                   True, (255, 200, 80))
            surface.blit(surf_res, (12, cy + 180))

        font = pygame.font.SysFont("monospace", 14)
        lines = [
            f"Mode: {mode_name}  (TAB cycle)",
            "↑↓ stiffness   SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
