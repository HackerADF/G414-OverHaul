"""
pygame display wrapper – manages the window, clock, and frame loop.
"""
from __future__ import annotations
import pygame

_DEFAULT_FPS = 60


class Display:
    """
    Thin pygame window abstraction.
    Handles window creation, the event pump, frame timing, and teardown.
    """

    def __init__(
        self,
        width: int = 1280,
        height: int = 720,
        title: str = "G414 Physics Engine",
        fps: int = _DEFAULT_FPS,
    ) -> None:
        pygame.init()
        pygame.display.set_caption(title)
        self.width  = width
        self.height = height
        self.fps    = fps
        self.surface = pygame.display.set_mode((width, height))
        self.clock   = pygame.time.Clock()
        self.running = True

    def tick(self) -> float:
        """Advance the clock and return delta time in seconds."""
        ms = self.clock.tick(self.fps)
        return min(ms / 1000.0, 0.05)   # cap at 50 ms to avoid spiral of death

    def pump_events(self) -> list[pygame.event.Event]:
        return pygame.event.get()

    def flip(self) -> None:
        pygame.display.flip()

    def quit(self) -> None:
        self.running = False
        pygame.quit()

    def set_title(self, title: str) -> None:
        pygame.display.set_caption(title)
