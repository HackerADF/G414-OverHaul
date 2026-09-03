"""
Cached glow / bloom rendering utilities.

Glow surfaces are pre-computed radial gradients with cubic falloff,
cached by (color_rgb, radius) so each unique combination is only
generated once per session.  Blitting with BLEND_ADD on a dark
background gives the classic neon-glow look without any GPU shaders.
"""
from __future__ import annotations
import math
import pygame

# Cache: (color_tuple, radius_int) → pygame.Surface
_glow_cache: dict[tuple, pygame.Surface] = {}


def _make_glow_surface(color: tuple[int, int, int], radius: int) -> pygame.Surface:
    """Generate a soft radial gradient circle Surface (SRCALPHA, square)."""
    size = radius * 2 + 2
    surf = pygame.Surface((size, size), pygame.SRCALPHA)
    surf.fill((0, 0, 0, 0))
    cx = cy = radius + 1
    r, g, b = color
    for px in range(size):
        for py in range(size):
            dx = px - cx
            dy = py - cy
            dist = math.sqrt(dx * dx + dy * dy)
            if dist >= radius:
                continue
            t = 1.0 - dist / radius          # 1 at center, 0 at edge
            alpha = int(t * t * t * 180)     # cubic falloff, max alpha 180
            surf.set_at((px, py), (r, g, b, alpha))
    return surf


def draw_glow(
    surface: pygame.Surface,
    pos: tuple[float, float],
    radius: int,
    color: tuple[int, int, int],
    intensity: float = 1.0,
) -> None:
    """
    Blit a cached glow circle onto *surface* at *pos* using BLEND_ADD.

    *intensity* (0–1) scales the radius to allow cheap dimming without
    regenerating the surface.
    """
    r = max(2, int(radius * max(0.1, intensity)))
    key = (color, r)
    if key not in _glow_cache:
        _glow_cache[key] = _make_glow_surface(color, r)
    gsurf = _glow_cache[key]
    x = int(pos[0]) - r - 1
    y = int(pos[1]) - r - 1
    surface.blit(gsurf, (x, y), special_flags=pygame.BLEND_ADD)


def draw_bloom_pass(surface: pygame.Surface) -> None:
    """
    Cheap full-screen bloom: scale down, scale back up, BLEND_ADD composite.

    Optional – call once per frame after drawing everything else.
    Skipping this keeps a stable 60 fps on slow hardware.
    """
    w, h = surface.get_size()
    half = pygame.transform.smoothscale(surface, (w // 2, h // 2))
    bloom = pygame.transform.smoothscale(half, (w, h))
    surface.blit(bloom, (0, 0), special_flags=pygame.BLEND_ADD)


def clear_cache() -> None:
    """Free all cached glow surfaces (call when switching simulations)."""
    _glow_cache.clear()
