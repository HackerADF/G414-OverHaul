"""
Falling Sand – cellular automaton.

Each cell can be: empty, sand, water, stone, fire, smoke, or lava.
Rules are evaluated each tick to produce realistic bulk behaviour.

YouTube inspiration: The Powder Toy, viral "falling sand" videos,
Noita physics trailer.
"""
from __future__ import annotations
import random
import pygame
import numpy as np

_BG = (10, 10, 10)

# Cell type IDs
EMPTY  = 0
SAND   = 1
WATER  = 2
STONE  = 3
FIRE   = 4
SMOKE  = 5
LAVA   = 6
WOOD   = 7

_CELL_COLORS = {
    EMPTY: ( 10,  10,  10),
    SAND:  (194, 178, 128),
    WATER: ( 30, 100, 200),
    STONE: (130, 130, 140),
    FIRE:  (255, 140,   0),
    SMOKE: ( 80,  80,  80),
    LAVA:  (200,  50,   0),
    WOOD:  (120,  80,  30),
}

_CELL_NAMES = {
    EMPTY: "Empty", SAND: "Sand", WATER: "Water", STONE: "Stone",
    FIRE: "Fire", SMOKE: "Smoke", LAVA: "Lava", WOOD: "Wood",
}

_FLAMMABLE = {WOOD, SAND}
_TEXT_COL = (200, 200, 200)
_CELL_SIZE = 4


class FallingSandSim:
    NAME = "Falling Sand"
    DESCRIPTION = (
        "Cellular automaton with Sand, Water, Stone, Fire, Smoke, Lava, and Wood. "
        "Left-click to place material. Right-click to erase. Scroll to resize brush."
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.cs     = _CELL_SIZE
        self.cols   = width  // self.cs
        self.rows   = height // self.cs
        self.grid   = np.zeros((self.rows, self.cols), dtype=np.uint8)
        self.selected = SAND
        self.brush_r  = 4
        self.paused   = False
        self._mouse_held = False
        self._rclick_held = False

    def reset(self) -> None:
        self.grid[:] = EMPTY

    def _place(self, mx: int, my: int, cell_type: int) -> None:
        cx = mx // self.cs
        cy = my // self.cs
        for dy in range(-self.brush_r, self.brush_r + 1):
            for dx in range(-self.brush_r, self.brush_r + 1):
                if dx * dx + dy * dy <= self.brush_r * self.brush_r:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < self.cols and 0 <= ny < self.rows:
                        self.grid[ny, nx] = cell_type

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            keys = {
                pygame.K_1: SAND,   pygame.K_2: WATER, pygame.K_3: STONE,
                pygame.K_4: FIRE,   pygame.K_5: SMOKE, pygame.K_6: LAVA,
                pygame.K_7: WOOD,   pygame.K_0: EMPTY,
            }
            if event.key in keys:
                self.selected = keys[event.key]
            elif event.key == pygame.K_r:
                self.reset()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                self._mouse_held = True
            elif event.button == 3:
                self._rclick_held = True
            elif event.button == 4:
                self.brush_r = min(self.brush_r + 1, 15)
            elif event.button == 5:
                self.brush_r = max(self.brush_r - 1, 1)
        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1:
                self._mouse_held = False
            elif event.button == 3:
                self._rclick_held = False
        elif event.type == pygame.MOUSEMOTION:
            if self._mouse_held:
                self._place(*event.pos, self.selected)
            elif self._rclick_held:
                self._place(*event.pos, EMPTY)

    # ------------------------------------------------------------------ #
    #  Update rules                                                        #
    # ------------------------------------------------------------------ #
    def update(self, dt: float) -> None:
        if self.paused:
            return
        grid = self.grid
        rows, cols = self.rows, self.cols
        # Iterate bottom-up, randomise left/right to avoid bias
        for y in range(rows - 2, -1, -1):
            xs = list(range(cols))
            random.shuffle(xs)
            for x in xs:
                cell = grid[y, x]
                if cell == EMPTY:
                    continue
                elif cell == SAND:
                    self._update_sand(grid, x, y, rows, cols)
                elif cell == WATER:
                    self._update_water(grid, x, y, rows, cols)
                elif cell == FIRE:
                    self._update_fire(grid, x, y, rows, cols)
                elif cell == SMOKE:
                    self._update_smoke(grid, x, y, rows, cols)
                elif cell == LAVA:
                    self._update_lava(grid, x, y, rows, cols)

    def _update_sand(self, g, x, y, rows, cols) -> None:
        below = y + 1
        if below >= rows:
            return
        if g[below, x] == EMPTY:
            g[below, x], g[y, x] = SAND, EMPTY
        elif g[below, x] == WATER:
            g[below, x], g[y, x] = SAND, WATER
        else:
            dx = random.choice([-1, 1])
            nx = x + dx
            if 0 <= nx < cols:
                if g[below, nx] == EMPTY:
                    g[below, nx], g[y, x] = SAND, EMPTY
                elif g[below, nx] == WATER:
                    g[below, nx], g[y, x] = SAND, WATER

    def _update_water(self, g, x, y, rows, cols) -> None:
        below = y + 1
        if below < rows and g[below, x] == EMPTY:
            g[below, x], g[y, x] = WATER, EMPTY
            return
        dx = random.choice([-1, 1])
        for d in [dx, -dx]:
            nx = x + d
            if 0 <= nx < cols and g[y, nx] == EMPTY:
                g[y, nx], g[y, x] = WATER, EMPTY
                return

    def _update_fire(self, g, x, y, rows, cols) -> None:
        # Spread to neighbouring flammable cells
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < rows and 0 <= nx < cols:
                neighbour = g[ny, nx]
                if neighbour in _FLAMMABLE and random.random() < 0.02:
                    g[ny, nx] = FIRE
        # Chance to become smoke
        if random.random() < 0.005:
            g[y, x] = SMOKE
        # Rise
        if y > 0 and g[y - 1, x] == EMPTY and random.random() < 0.3:
            g[y - 1, x], g[y, x] = FIRE, EMPTY

    def _update_smoke(self, g, x, y, rows, cols) -> None:
        if y > 0:
            dx = random.choice([-1, 0, 0, 1])
            nx = x + dx
            if 0 <= nx < cols and g[y - 1, nx] == EMPTY and random.random() < 0.5:
                g[y - 1, nx], g[y, x] = SMOKE, EMPTY
        if random.random() < 0.002:
            g[y, x] = EMPTY

    def _update_lava(self, g, x, y, rows, cols) -> None:
        below = y + 1
        if below < rows and g[below, x] == EMPTY:
            g[below, x], g[y, x] = LAVA, EMPTY
            return
        # Solidify slowly
        if random.random() < 0.0005:
            g[y, x] = STONE
        # Ignite neighbours
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < rows and 0 <= nx < cols:
                if g[ny, nx] in _FLAMMABLE and random.random() < 0.01:
                    g[ny, nx] = FIRE
        # Lava flows sideways
        dx = random.choice([-1, 1])
        nx = x + dx
        if 0 <= nx < cols and g[y, nx] == EMPTY and random.random() < 0.4:
            g[y, nx], g[y, x] = LAVA, EMPTY

    # ------------------------------------------------------------------ #
    #  Draw                                                                #
    # ------------------------------------------------------------------ #
    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)
        cs = self.cs
        grid = self.grid

        for y in range(self.rows):
            for x in range(self.cols):
                cell = grid[y, x]
                if cell == EMPTY:
                    continue
                col = _CELL_COLORS.get(cell, (200, 200, 200))
                # Add slight color variation for realism
                r = max(0, min(255, col[0] + random.randint(-10, 10)))
                g2 = max(0, min(255, col[1] + random.randint(-10, 10)))
                b = max(0, min(255, col[2] + random.randint(-10, 10)))
                pygame.draw.rect(surface, (r, g2, b),
                                 (x * cs, y * cs, cs - 1, cs - 1))

        # HUD
        font = pygame.font.SysFont("monospace", 14)
        sel_name = _CELL_NAMES.get(self.selected, "?")
        lines = [
            f"Selected: {sel_name}  (1-7: Sand/Water/Stone/Fire/Smoke/Lava/Wood  0: Erase)",
            f"Brush size: {self.brush_r}  (scroll)   LMB place   RMB erase   R reset   SPACE pause   ESC menu",
        ]
        for i, line in enumerate(lines):
            surf = font.render(line, True, _TEXT_COL)
            surface.blit(surf, (8, 8 + i * 18))

        # Brush preview
        mx, my = pygame.mouse.get_pos()
        pygame.draw.circle(surface, (255, 255, 255),
                           (mx, my), self.brush_r * self.cs, 1)
