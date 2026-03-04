#!/usr/bin/env python3
"""
G414 Physics Engine – interactive launcher.

Run:
    python main.py           # opens the simulation menu
    python main.py --list    # prints available simulations
    python main.py --sim 0   # launch simulation by index directly
"""
from __future__ import annotations
import argparse
import sys
import pygame

from physics_engine.renderer import Display
from physics_engine.simulations import (
    DoublePendulumSim,
    NBodySim,
    ClothSim,
    BouncingBallsSim,
    WaveInterferenceSim,
    FallingSandSim,
    FluidSPHSim,
    SpringOscillatorSim,
)

WIDTH  = 1280
HEIGHT = 720

_SIMULATIONS = [
    DoublePendulumSim,
    NBodySim,
    ClothSim,
    BouncingBallsSim,
    WaveInterferenceSim,
    FallingSandSim,
    FluidSPHSim,
    SpringOscillatorSim,
]

# ── Menu colours ──────────────────────────────────────────────────────────────
_BG_MENU    = (8,  10, 20)
_TITLE_COL  = (220, 200, 80)
_ITEM_COL   = (180, 180, 210)
_SEL_COL    = (100, 200, 255)
_DESC_COL   = (130, 130, 160)
_FOOT_COL   = (90,  90, 120)


class Menu:
    """Full-screen simulation picker rendered with pygame."""

    def __init__(self, surface: pygame.Surface) -> None:
        self.surface   = surface
        self.selected  = 0
        self.font_title = pygame.font.SysFont("monospace", 36, bold=True)
        self.font_item  = pygame.font.SysFont("monospace", 22)
        self.font_desc  = pygame.font.SysFont("monospace", 14)
        self.width, self.height = surface.get_size()

    def handle_event(self, event: pygame.event.Event) -> int | None:
        """Return simulation index if one was chosen, else None."""
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_UP:
                self.selected = (self.selected - 1) % len(_SIMULATIONS)
            elif event.key == pygame.K_DOWN:
                self.selected = (self.selected + 1) % len(_SIMULATIONS)
            elif event.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                return self.selected
        elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            hit = self._item_at(*event.pos)
            if hit is not None:
                return hit
        elif event.type == pygame.MOUSEMOTION:
            hit = self._item_at(*event.pos)
            if hit is not None:
                self.selected = hit
        return None

    def _item_at(self, mx: int, my: int) -> int | None:
        item_h = 46
        start_y = 160
        for i in range(len(_SIMULATIONS)):
            y = start_y + i * item_h
            if y <= my < y + item_h:
                return i
        return None

    def draw(self) -> None:
        surf = self.surface
        surf.fill(_BG_MENU)

        # Title
        t = self.font_title.render("G414 Physics Engine", True, _TITLE_COL)
        surf.blit(t, (self.width // 2 - t.get_width() // 2, 30))

        sub = self.font_desc.render(
            "Popular YouTube physics experiments – interactive Python simulations",
            True, _DESC_COL)
        surf.blit(sub, (self.width // 2 - sub.get_width() // 2, 80))

        pygame.draw.line(surf, (40, 40, 70), (80, 110), (self.width - 80, 110), 1)

        item_h = 46
        start_y = 130
        for i, sim_cls in enumerate(_SIMULATIONS):
            y = start_y + i * item_h
            is_sel = i == self.selected
            num  = self.font_item.render(f"  {i + 1}.", True, _ITEM_COL if not is_sel else _SEL_COL)
            name = self.font_item.render(sim_cls.NAME, True, _SEL_COL if is_sel else _ITEM_COL)
            desc = self.font_desc.render(f"       {sim_cls.DESCRIPTION[:90]}…"
                                         if len(sim_cls.DESCRIPTION) > 90
                                         else f"       {sim_cls.DESCRIPTION}",
                                         True, _DESC_COL)
            if is_sel:
                pygame.draw.rect(surf, (20, 30, 55),
                                 (60, y, self.width - 120, item_h - 2), border_radius=4)
            surf.blit(num,  (70, y + 4))
            surf.blit(name, (120, y + 4))
            surf.blit(desc, (60, y + 26))

        footer = self.font_desc.render(
            "↑↓ navigate   ENTER / click select   ESC quit", True, _FOOT_COL)
        surf.blit(footer, (self.width // 2 - footer.get_width() // 2, self.height - 30))


def run_simulation(display: Display, sim_cls: type) -> None:
    """Instantiate and run a single simulation until ESC is pressed."""
    sim = sim_cls(display.width, display.height)
    display.set_title(f"G414 – {sim.NAME}")

    while display.running:
        dt = display.tick()

        for event in display.pump_events():
            if event.type == pygame.QUIT:
                display.quit()
                return
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                return      # back to menu
            sim.handle_event(event)

        sim.update(dt)
        sim.draw(display.surface)
        display.flip()


def run_menu(display: Display) -> None:
    """Show the main menu and dispatch to selected simulations."""
    menu = Menu(display.surface)
    display.set_title("G414 Physics Engine")

    while display.running:
        for event in display.pump_events():
            if event.type == pygame.QUIT:
                display.quit()
                return
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                display.quit()
                return

            choice = menu.handle_event(event)
            if choice is not None:
                run_simulation(display, _SIMULATIONS[choice])
                if not display.running:
                    return
                display.set_title("G414 Physics Engine")

        menu.draw()
        display.flip()
        display.clock.tick(60)


def main() -> None:
    parser = argparse.ArgumentParser(description="G414 Physics Engine")
    parser.add_argument("--list", action="store_true", help="List available simulations")
    parser.add_argument("--sim", type=int, metavar="N", help="Launch simulation N directly (0-indexed)")
    args = parser.parse_args()

    if args.list:
        for i, cls in enumerate(_SIMULATIONS):
            print(f"  [{i}] {cls.NAME}")
            print(f"       {cls.DESCRIPTION}")
        return

    display = Display(WIDTH, HEIGHT, fps=60)

    if args.sim is not None:
        if not 0 <= args.sim < len(_SIMULATIONS):
            print(f"Error: --sim must be between 0 and {len(_SIMULATIONS) - 1}")
            sys.exit(1)
        run_simulation(display, _SIMULATIONS[args.sim])
    else:
        run_menu(display)

    if display.running:
        display.quit()


if __name__ == "__main__":
    main()
