"""
SimBase – lightweight optional base class for G414 simulations.

Inherit from this to get:
  • Lazy font caching via self.font(size, bold)
  • draw_hud(surface, lines) helper
  • draw_text(surface, text, x, y, size, color) helper
  • Centred-text helper

Existing simulations work without inheriting from this; it's purely
additive for new simulations.

Quick-start example
-------------------
from physics_engine.core.sim_base import SimBase

class MySim(SimBase):
    NAME = "My Simulation"
    DESCRIPTION = "A short description shown in the menu."

    def __init__(self, width=1280, height=720):
        super().__init__(width, height)
        # your init here

    def handle_event(self, event):
        pass          # handle pygame events

    def update(self, dt):
        pass          # dt in seconds

    def draw(self, surface):
        surface.fill((10, 10, 20))
        self.draw_hud(surface, ["My Simulation", "ESC menu"])
"""
from __future__ import annotations
import pygame


class SimBase:
    """Optional base class for G414 Physics Engine simulations."""

    NAME        = "Unnamed Simulation"
    DESCRIPTION = ""

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.cx     = width  / 2.0
        self.cy     = height / 2.0
        self._fonts: dict[tuple, pygame.font.Font] = {}

    # ── Font helpers ───────────────────────────────────────────────────────────
    def font(self, size: int = 14, bold: bool = False) -> pygame.font.Font:
        """Return a cached monospace font at the requested size."""
        key = (size, bold)
        if key not in self._fonts:
            self._fonts[key] = pygame.font.SysFont("monospace", size, bold=bold)
        return self._fonts[key]

    # ── Text / HUD helpers ─────────────────────────────────────────────────────
    def draw_text(
        self,
        surface: pygame.Surface,
        text:    str,
        x:       int,
        y:       int,
        size:    int   = 14,
        color:   tuple = (180, 180, 210),
        bold:    bool  = False,
    ) -> pygame.Rect:
        """Render a single line; returns the blit rect."""
        surf = self.font(size, bold).render(text, True, color)
        surface.blit(surf, (x, y))
        return surf.get_rect(topleft=(x, y))

    def draw_text_centered(
        self,
        surface: pygame.Surface,
        text:    str,
        y:       int,
        size:    int   = 14,
        color:   tuple = (180, 180, 210),
        bold:    bool  = False,
    ) -> None:
        """Render text horizontally centred on the surface."""
        surf = self.font(size, bold).render(text, True, color)
        surface.blit(surf, (self.width // 2 - surf.get_width() // 2, y))

    def draw_hud(
        self,
        surface:     pygame.Surface,
        lines:       list[str],
        color:       tuple = (180, 180, 210),
        x:           int   = 12,
        y:           int   = 12,
        line_height: int   = 18,
        size:        int   = 14,
    ) -> None:
        """Draw multiple lines of HUD text starting at (x, y)."""
        f = self.font(size)
        for i, line in enumerate(lines):
            s = f.render(line, True, color)
            surface.blit(s, (x, y + i * line_height))

    # ── Dim circle helper (common border circle pattern) ──────────────────────
    def draw_circle_border(
        self,
        surface: pygame.Surface,
        radius:  int,
        color:   tuple = (220, 220, 240),
        width:   int   = 3,
    ) -> None:
        pygame.draw.circle(
            surface, color,
            (int(self.cx), int(self.cy)),
            radius, width,
        )

    # ── Default interface (override in subclass) ───────────────────────────────
    def handle_event(self, event: pygame.event.Event) -> None:
        pass

    def update(self, dt: float) -> None:
        pass

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill((10, 10, 20))
        self.draw_hud(surface, [self.NAME, self.DESCRIPTION[:80]])
