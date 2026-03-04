"""
Elastic Ball Collisions – the π (pi) Counting Experiment.

Two blocks collide elastically. The number of collisions between a small
block, a large block, and the wall equals digits of π, depending on the
mass ratio (1, 100, 10 000, …).

Also provides a free-form ball sandbox mode.

YouTube inspiration: 3Blue1Brown "The Most Unexpected Answer to a
Counting Puzzle" (Pi Day 2019).
"""
from __future__ import annotations
import math
import random
import pygame
from ..core.vector import Vec2
from ..core.body import RigidBody
from ..core.collision import CollisionDetector

_BG       = (12, 12, 20)
_WALL_COL = (80, 80, 120)
_TEXT_COL = (180, 180, 210)
_FLOOR_Y  = 550


class BouncingBallsSim:
    NAME = "Elastic Collisions – π Counter"
    DESCRIPTION = (
        "The collision count between two perfectly elastic blocks reveals digits of π. "
        "Press 1/2/3/4 to change the mass ratio (1, 100, 10 000, 1 000 000)."
    )

    MASS_RATIOS = [1, 100, 10_000, 1_000_000]
    PI_DIGITS   = ["3", "31", "314", "3141"]

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.ratio_idx = 1            # start at 100:1
        self.paused = False
        self.collisions = 0
        self.small_block: RigidBody  # assigned in _build
        self.large_block: RigidBody
        self._build()

    def _build(self) -> None:
        self.collisions = 0
        ratio = self.MASS_RATIOS[self.ratio_idx]
        floor = _FLOOR_Y

        # Small block (left)
        self.small_block = RigidBody(Vec2(400, floor - 30), mass=1.0, radius=30.0)
        self.small_block.vel = Vec2(0, 0)
        self.small_block.restitution = 1.0
        self.small_block.color = (100, 180, 255)

        # Large block (right), moving left
        large_r = 30 + 10 * math.log10(max(1, ratio))
        self.large_block = RigidBody(Vec2(750, floor - large_r), mass=float(ratio), radius=large_r)
        self.large_block.vel = Vec2(-120.0, 0)
        self.large_block.restitution = 1.0
        self.large_block.color = (255, 130, 60)

    def _resolve_1d(self) -> bool:
        """1-D elastic collision between the two blocks. Returns True if collision occurred."""
        a, b = self.small_block, self.large_block
        gap = b.pos.x - b.radius - (a.pos.x + a.radius)
        if gap > 0.5:
            return False
        # Separate
        overlap = -gap + 0.5
        total = a.mass + b.mass
        a.pos.x -= overlap * b.mass / total
        b.pos.x += overlap * a.mass / total
        # Perfectly elastic 1-D collision
        va_new = ((a.mass - b.mass) * a.vel.x + 2 * b.mass * b.vel.x) / total
        vb_new = ((b.mass - a.mass) * b.vel.x + 2 * a.mass * a.vel.x) / total
        a.vel.x = va_new
        b.vel.x = vb_new
        return True

    def update(self, dt: float) -> None:
        if self.paused:
            return

        sub = 8
        sub_dt = dt / sub

        for _ in range(sub):
            # Move
            self.small_block.pos += self.small_block.vel * sub_dt
            self.large_block.pos += self.large_block.vel * sub_dt

            # Wall collision (left wall at x=100)
            wall_x = 100 + self.small_block.radius
            if self.small_block.pos.x <= wall_x:
                self.small_block.pos.x = wall_x
                self.small_block.vel.x = abs(self.small_block.vel.x)
                self.collisions += 1

            # Block–block collision
            if self._resolve_1d():
                self.collisions += 1

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self._build()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused
            elif event.key == pygame.K_1:
                self.ratio_idx = 0; self._build()
            elif event.key == pygame.K_2:
                self.ratio_idx = 1; self._build()
            elif event.key == pygame.K_3:
                self.ratio_idx = 2; self._build()
            elif event.key == pygame.K_4:
                self.ratio_idx = 3; self._build()

    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        # Floor
        pygame.draw.line(surface, _WALL_COL,
                         (0, _FLOOR_Y), (self.width, _FLOOR_Y), 2)
        # Left wall
        pygame.draw.line(surface, _WALL_COL,
                         (100, 0), (100, _FLOOR_Y), 2)

        # Blocks drawn as rects for clarity
        def draw_block(b: RigidBody, label: str) -> None:
            r = int(b.radius)
            rect = pygame.Rect(int(b.pos.x) - r, _FLOOR_Y - 2 * r, 2 * r, 2 * r)
            pygame.draw.rect(surface, b.color, rect)
            pygame.draw.rect(surface, (255, 255, 255), rect, 2)
            font = pygame.font.SysFont("monospace", 13)
            txt = font.render(label, True, (255, 255, 255))
            surface.blit(txt, (rect.centerx - txt.get_width() // 2, rect.centery - 8))

        draw_block(self.small_block, "1 kg")
        mass_label = f"{int(self.large_block.mass):,} kg"
        draw_block(self.large_block, mass_label)

        font_big  = pygame.font.SysFont("monospace", 48, bold=True)
        font_med  = pygame.font.SysFont("monospace", 22)
        font_small = pygame.font.SysFont("monospace", 14)

        ratio = self.MASS_RATIOS[self.ratio_idx]
        expected = self.PI_DIGITS[self.ratio_idx]

        col_txt = font_big.render(f"{self.collisions:,}", True, (255, 220, 80))
        surface.blit(col_txt, (self.width // 2 - col_txt.get_width() // 2, 80))

        sub_txt = font_med.render("total collisions", True, _TEXT_COL)
        surface.blit(sub_txt, (self.width // 2 - sub_txt.get_width() // 2, 145))

        pi_txt = font_med.render(f"Expected digits of π: {expected}…", True, (100, 255, 160))
        surface.blit(pi_txt, (self.width // 2 - pi_txt.get_width() // 2, 185))

        lines = [
            self.NAME,
            f"Mass ratio 1 : {ratio:,}",
            "1/2/3/4 mass ratio   SPACE pause   R reset   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font_small.render(line, True, _TEXT_COL)
            surface.blit(surf, (12, 12 + i * 18))
