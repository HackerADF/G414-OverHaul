"""
Wave Superposition & Double-Slit Interference.

Simulates a 1-D standing wave, wave superposition, and a visual
2-D interference pattern from two point sources (double-slit analogue).

YouTube inspiration: Physics Girl, TKOR water wave tank videos,
Veritasium double-slit experiments.
"""
from __future__ import annotations
import math
import pygame
from ..core.vector import Vec2

_BG       = (10, 10, 25)
_TEXT_COL = (160, 160, 210)

_MODES = ["Superposition", "Double Slit", "Standing Wave"]


def _hsv_to_rgb(h: float, s: float = 1.0, v: float = 1.0) -> tuple[int, int, int]:
    h = h % 1.0
    i = int(h * 6)
    f = h * 6 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    rgb = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i % 6]
    return (int(rgb[0] * 255), int(rgb[1] * 255), int(rgb[2] * 255))


class WaveInterferenceSim:
    NAME = "Wave Interference"
    DESCRIPTION = (
        "Superposition of sinusoidal waves and a 2-D double-slit interference pattern. "
        "Arrows adjust frequency and slit separation."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.time   = 0.0
        self.mode   = 0
        self.paused = False
        # Wave parameters
        self.freq1  = 2.0
        self.freq2  = 3.0
        self.amp1   = 0.4
        self.amp2   = 0.3
        self.speed  = 200.0
        # Double slit
        self.slit_sep   = 120.0      # pixels between sources
        self.wavelength = 80.0

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_SPACE:
                self.paused = not self.paused
            elif event.key == pygame.K_TAB:
                self.mode = (self.mode + 1) % len(_MODES)
            elif event.key == pygame.K_UP:
                self.freq1 = min(self.freq1 + 0.25, 8.0)
            elif event.key == pygame.K_DOWN:
                self.freq1 = max(self.freq1 - 0.25, 0.25)
            elif event.key == pygame.K_RIGHT:
                self.slit_sep = min(self.slit_sep + 10, 300)
                self.wavelength = min(self.wavelength + 5, 200)
            elif event.key == pygame.K_LEFT:
                self.slit_sep = max(self.slit_sep - 10, 20)
                self.wavelength = max(self.wavelength - 5, 30)

    def update(self, dt: float) -> None:
        if not self.paused:
            self.time += dt

    # ------------------------------------------------------------------ #
    #  Drawing modes                                                       #
    # ------------------------------------------------------------------ #
    def _draw_superposition(self, surface: pygame.Surface) -> None:
        cx   = self.width // 2
        mid1 = self.height // 3
        mid2 = 2 * self.height // 3

        def wave_y(mid: int, amp: float, freq: float, phase: float) -> list[tuple[int, int]]:
            pts = []
            for x in range(self.width):
                t = x / self.width
                y = mid + int(amp * (self.height * 0.18) *
                              math.sin(freq * math.tau * t - self.time * 3.0 + phase))
                pts.append((x, y))
            return pts

        w1 = wave_y(mid1, self.amp1, self.freq1, 0.0)
        w2 = wave_y(mid2, self.amp2, self.freq2, 0.5)

        # Combined wave
        combined = []
        for (x, y1), (_, y2) in zip(w1, w2):
            raw = (y1 - mid1) + (y2 - mid2)
            combined.append((x, self.height // 2 + raw // 2))

        if len(w1) > 1:
            pygame.draw.lines(surface, (100, 180, 255), False, w1, 2)
            pygame.draw.lines(surface, (255, 120,  80), False, w2, 2)
            pygame.draw.lines(surface, (100, 255, 140), False, combined, 2)

        font = pygame.font.SysFont("monospace", 13)
        surface.blit(font.render(f"Wave 1  f={self.freq1:.2f} Hz", True, (100, 180, 255)), (20, mid1 - 60))
        surface.blit(font.render(f"Wave 2  f={self.freq2:.2f} Hz", True, (255, 120,  80)), (20, mid2 - 60))
        surface.blit(font.render("Superposition (sum)", True, (100, 255, 140)), (20, self.height // 2 - 60))

    def _draw_double_slit(self, surface: pygame.Surface) -> None:
        # Two point sources separated by slit_sep, compute interference at each pixel
        cx = self.width  // 2
        cy = self.height // 2
        s1 = Vec2(cx, cy - self.slit_sep / 2)
        s2 = Vec2(cx, cy + self.slit_sep / 2)
        k  = math.tau / self.wavelength

        # Pre-compute per-row for performance
        pixel_array = pygame.surfarray.pixels3d(surface)
        for px in range(0, self.width, 2):
            for py in range(0, self.height, 2):
                p = Vec2(px, py)
                r1 = p.distance_to(s1)
                r2 = p.distance_to(s2)
                a1 = math.cos(k * r1 - self.time * 4.0) / max(r1 ** 0.5, 0.1)
                a2 = math.cos(k * r2 - self.time * 4.0) / max(r2 ** 0.5, 0.1)
                intensity = (a1 + a2) * 0.5 + 0.5
                r = int(min(255, intensity * 300))
                g = int(min(255, intensity * 150))
                b = int(min(255, intensity * 400))
                for dx in range(2):
                    for dy in range(2):
                        nx, ny = px + dx, py + dy
                        if 0 <= nx < self.width and 0 <= ny < self.height:
                            pixel_array[nx, ny] = (r, g, b)
        del pixel_array

        # Draw source dots
        pygame.draw.circle(surface, (255, 220, 80), s1.to_int_tuple(), 5)
        pygame.draw.circle(surface, (255, 220, 80), s2.to_int_tuple(), 5)

        font = pygame.font.SysFont("monospace", 13)
        surface.blit(font.render(f"λ={self.wavelength:.0f}px  slit d={self.slit_sep:.0f}px",
                                 True, _TEXT_COL), (20, self.height - 30))

    def _draw_standing_wave(self, surface: pygame.Surface) -> None:
        mid = self.height // 2
        mode_n = max(1, int(self.freq1))
        pts = []
        for x in range(self.width):
            t = x / self.width
            # Standing wave = 2A·sin(kx)·cos(ωt)
            y = mid + int(
                0.35 * self.height
                * math.sin(mode_n * math.pi * t)
                * math.cos(self.time * 4.0)
            )
            pts.append((x, y))

        # Draw nodes
        for n in range(mode_n + 1):
            node_x = int(n * self.width / mode_n)
            pygame.draw.line(surface, (80, 80, 120), (node_x, mid - 30), (node_x, mid + 30), 1)

        if len(pts) > 1:
            pygame.draw.lines(surface, (100, 200, 255), False, pts, 2)

        font = pygame.font.SysFont("monospace", 14)
        surface.blit(
            font.render(f"Standing wave  n={mode_n} (↑↓ to change)", True, _TEXT_COL),
            (20, mid - 80))

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)
        mode_name = _MODES[self.mode]
        if mode_name == "Superposition":
            self._draw_superposition(surface)
        elif mode_name == "Double Slit":
            self._draw_double_slit(surface)
        elif mode_name == "Standing Wave":
            self._draw_standing_wave(surface)

        font = pygame.font.SysFont("monospace", 14)
        lines = [
            f"Mode: {mode_name}  (TAB cycle)",
            "↑↓ frequency   ←→ wavelength / slit sep   SPACE pause   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
