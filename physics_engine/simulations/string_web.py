"""
String Web – colored balls weave a web of strings inside a circle.

Each ball starts with 2 strings whose anchors are on the lower half of
the boundary circle, giving a gentle downward pull.  Every time a ball
hits the boundary it bounces and leaves a new string anchored at that
contact point.  The more strings, the more centripetal pull – but the
bounce velocity always wins, so balls never stop moving.

When a ball crosses a string that belongs to a *different* colour it
slices that string.  A ball with no strings remaining vanishes.

Controls
--------
R       reset
SPACE   pause / resume
ESC     back to menu
"""
from __future__ import annotations
import math
import random
import pygame

from ..core.sim_base import SimBase
from ..core.vector   import Vec2

# ── Constants ─────────────────────────────────────────────────────────────────
_BG           = (8, 4, 18)
_CIRCLE_R     = 310          # boundary radius (px)
_BALL_R       = 12           # ball radius (px)
_RESTITUTION  = 1.04         # > 1 → slightly super-elastic border (bouncy)
_GRAVITY      = Vec2(0.0, 240.0)
_SPRING_K     = 0.65         # Hooke's law: force = k * displacement (px/s² per px)
_MAX_STRINGS  = 28           # cap per ball to prevent runaway
_SPEED_CAP    = 1000.0

_COLORS: list[tuple[int, int, int]] = [
    (255,  55,  80),   # red
    (255, 148,  30),   # orange
    (230, 220,  40),   # yellow
    ( 50, 215,  80),   # green
    ( 55, 148, 255),   # blue
    (190,  55, 255),   # violet
]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _ball_cuts_string(
    cpx: float, cpy: float, ball_r: float,  # cutter position + radius
    ax: float,  ay: float,                  # string anchor (fixed end)
    bx: float,  by: float,                  # string ball-end (moves with owner)
) -> bool:
    """
    True if the cutter ball overlaps the anchor-side 80% of the string.

    Proximity check (rather than path-crossing) is reliable even for fast
    balls because it triggers on the current position each frame.
    The last 20% near the ball-end is excluded so a ball physically touching
    the owner ball doesn't inadvertently cut all its strings.
    """
    # Truncate the segment to anchor → 80% along the way to the ball-end
    ex = ax + (bx - ax) * 0.80
    ey = ay + (by - ay) * 0.80
    dx, dy = ex - ax, ey - ay
    l2 = dx * dx + dy * dy
    if l2 < 1e-9:
        return False
    t    = max(0.0, min(1.0, ((cpx - ax) * dx + (cpy - ay) * dy) / l2))
    dist = math.hypot(cpx - (ax + t * dx), cpy - (ay + t * dy))
    return dist < ball_r + 2


# ── Data classes ──────────────────────────────────────────────────────────────

class _String:
    """A single string: fixed anchor → owning ball's current position."""
    __slots__ = ("ax", "ay", "color")

    def __init__(self, ax: float, ay: float, color: tuple) -> None:
        self.ax    = ax
        self.ay    = ay
        self.color = color


class _Spark:
    """Short-lived flash rendered at a string-cut point."""
    __slots__ = ("x", "y", "color", "t", "max_t")

    def __init__(self, x: float, y: float, color: tuple, life: float = 0.25) -> None:
        self.x     = x
        self.y     = y
        self.color = color
        self.t     = life
        self.max_t = life


class _Ball:
    def __init__(self, pos: Vec2, vel: Vec2, color: tuple) -> None:
        self.pos    = pos.copy()
        self.vel    = vel.copy()
        self.color  = color
        self.radius = _BALL_R
        self.strings: list[_String] = []
        self.alive  = True

    def add_string(self, ax: float, ay: float) -> None:
        if len(self.strings) < _MAX_STRINGS:
            self.strings.append(_String(ax, ay, self.color))


# ── Simulation ────────────────────────────────────────────────────────────────

class StringWebSim(SimBase):
    NAME = "String Web"
    DESCRIPTION = (
        "Colored balls weave strings on each bounce. "
        "Cross another color's string to slice it. "
        "No strings left → ball vanishes.  R reset  SPACE pause  ESC menu"
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        super().__init__(width, height)
        self.paused  = False
        self._sparks: list[_Spark] = []
        self._build()

    # ── Setup ──────────────────────────────────────────────────────────────────
    def _build(self) -> None:
        n = len(_COLORS)
        self.balls: list[_Ball] = []
        self._sparks.clear()

        # Spread balls across the upper arc: from ~-150° to ~-30°
        # (upper-left to upper-right in pygame coords where 0° = right).
        # Each ball is in its own arc sector so initial strings don't cross.
        arc_start = -math.pi * (5 / 6)   # -150°
        arc_span  = math.pi * (2 / 3)    # 120° total span
        arc_step  = arc_span / max(n - 1, 1)
        start_r   = _CIRCLE_R * 0.70     # start 70% of the way to boundary

        for idx, col in enumerate(_COLORS):
            sector_a = arc_start + idx * arc_step  # this ball's sector angle

            # Position: 70% of the way from centre toward the boundary
            sx = self.cx + math.cos(sector_a) * start_r
            sy = self.cy + math.sin(sector_a) * start_r

            # Launch inward (toward opposite side of circle) with small spread
            launch_a = sector_a + math.pi + random.uniform(-0.25, 0.25)
            speed    = random.uniform(210.0, 290.0)
            b = _Ball(
                Vec2(sx, sy),
                Vec2(math.cos(launch_a) * speed, math.sin(launch_a) * speed),
                col,
            )

            # 2 anchors on the boundary close to this ball's sector – short
            # initial strings mean low spring force and no crossing at start.
            for _ in range(2):
                a  = sector_a + random.uniform(-0.20, 0.20)
                ax = self.cx + math.cos(a) * _CIRCLE_R
                ay = self.cy + math.sin(a) * _CIRCLE_R
                b.add_string(ax, ay)
            self.balls.append(b)

    # ── Events ─────────────────────────────────────────────────────────────────
    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.KEYDOWN:
            if event.key == pygame.K_r:
                self._build()
            elif event.key == pygame.K_SPACE:
                self.paused = not self.paused

    # ── Update ─────────────────────────────────────────────────────────────────
    def update(self, dt: float) -> None:
        if self.paused:
            return
        dt = min(dt, 0.05)

        alive = [b for b in self.balls if b.alive]

        for b in alive:
            # Gravity
            b.vel += _GRAVITY * dt

            # Spring force toward each anchor (Hooke's law: F = k · displacement).
            # The farther the ball is from an anchor the harder it gets pulled,
            # so it hits the boundary with more speed and bounces farther.
            for s in b.strings:
                dx = s.ax - b.pos.x
                dy = s.ay - b.pos.y
                b.vel.x += dx * _SPRING_K * dt
                b.vel.y += dy * _SPRING_K * dt

            # Speed cap
            spd = b.vel.length()
            if spd > _SPEED_CAP:
                b.vel *= _SPEED_CAP / spd

            # Move
            b.pos += b.vel * dt

            # Boundary collision
            dx = b.pos.x - self.cx
            dy = b.pos.y - self.cy
            d  = math.hypot(dx, dy)
            limit = _CIRCLE_R - b.radius
            if d > limit:
                nx = dx / d
                ny = dy / d
                # Push back to boundary
                b.pos.x = self.cx + nx * limit
                b.pos.y = self.cy + ny * limit
                # Reflect radial velocity
                # More strings → bouncier (each string adds tension energy)
                restitution = min(1.08, _RESTITUTION + len(b.strings) * 0.009)
                vn = b.vel.x * nx + b.vel.y * ny
                if vn > 0:
                    b.vel.x -= (1.0 + restitution) * vn * nx
                    b.vel.y -= (1.0 + restitution) * vn * ny
                    # Anchor new string at contact point
                    b.add_string(
                        self.cx + nx * _CIRCLE_R,
                        self.cy + ny * _CIRCLE_R,
                    )

        # ── Ball-ball elastic collision ─────────────────────────────────────
        n_alive = len(alive)
        for i in range(n_alive):
            for j in range(i + 1, n_alive):
                b1, b2   = alive[i], alive[j]
                dx       = b2.pos.x - b1.pos.x
                dy       = b2.pos.y - b1.pos.y
                dist     = math.hypot(dx, dy)
                min_dist = b1.radius + b2.radius
                if dist >= min_dist or dist < 1e-6:
                    continue
                nx = dx / dist
                ny = dy / dist
                # Separate equally
                push = (min_dist - dist) * 0.5
                b1.pos.x -= nx * push;  b1.pos.y -= ny * push
                b2.pos.x += nx * push;  b2.pos.y += ny * push
                # Equal-mass perfectly elastic impulse
                dvx = b1.vel.x - b2.vel.x
                dvy = b1.vel.y - b2.vel.y
                vn  = dvx * nx + dvy * ny
                if vn > 0:
                    b1.vel.x -= vn * nx;  b1.vel.y -= vn * ny
                    b2.vel.x += vn * nx;  b2.vel.y += vn * ny

        # ── String slicing ──────────────────────────────────────────────────
        for cutter in alive:
            cpx, cpy = cutter.pos.x, cutter.pos.y

            for owner in alive:
                if owner is cutter or owner.color == cutter.color:
                    continue

                to_cut: list[int] = []
                opx, opy = owner.pos.x, owner.pos.y

                for i, s in enumerate(owner.strings):
                    if _ball_cuts_string(cpx, cpy, cutter.radius,
                                         s.ax, s.ay, opx, opy):
                        to_cut.append(i)

                for i in reversed(to_cut):
                    s = owner.strings[i]
                    mid_x = (s.ax + opx) / 2
                    mid_y = (s.ay + opy) / 2
                    self._sparks.append(_Spark(mid_x, mid_y, s.color))
                    owner.strings.pop(i)

                if not owner.strings:
                    owner.alive = False
                    # Death burst sparks
                    for _ in range(12):
                        a  = random.uniform(0, math.tau)
                        r  = random.uniform(10, 35)
                        self._sparks.append(_Spark(
                            owner.pos.x + math.cos(a) * r,
                            owner.pos.y + math.sin(a) * r,
                            owner.color, life=0.5,
                        ))

        # ── Sparks ──────────────────────────────────────────────────────────
        for sp in self._sparks:
            sp.t -= dt
        self._sparks = [sp for sp in self._sparks if sp.t > 0]

        # Auto-reset when all balls gone
        if all(not b.alive for b in self.balls):
            self._build()

    # ── Draw ───────────────────────────────────────────────────────────────────
    def draw(self, surface: pygame.Surface) -> None:
        surface.fill(_BG)

        # Boundary circle
        self.draw_circle_border(surface, _CIRCLE_R, (210, 210, 230), 3)
        # Soft inner glow ring
        self.draw_circle_border(surface, _CIRCLE_R + 4, (80, 80, 100), 2)

        # ── Strings ────────────────────────────────────────────────────────
        for b in self.balls:
            if not b.alive:
                continue
            bxi, byi = int(b.pos.x), int(b.pos.y)
            for s in b.strings:
                ax, ay = int(s.ax), int(s.ay)
                # Dim string body
                dim = tuple(c * 2 // 5 for c in s.color)
                pygame.draw.line(surface, dim, (ax, ay), (bxi, byi), 1)
                # Bright anchor dot
                pygame.draw.circle(surface, s.color, (ax, ay), 3)

        # ── Cut sparks ─────────────────────────────────────────────────────
        for sp in self._sparks:
            t = sp.t / sp.max_t
            r = int(sp.color[0] * t)
            g = int(sp.color[1] * t)
            b = int(sp.color[2] * t)
            pygame.draw.circle(surface, (r, g, b),
                                (int(sp.x), int(sp.y)),
                                max(1, int(7 * t)))

        # ── Balls ──────────────────────────────────────────────────────────
        for b in self.balls:
            if not b.alive:
                continue
            bxi, byi = int(b.pos.x), int(b.pos.y)
            n_str    = len(b.strings)
            # Outer glow
            dim = tuple(c // 4 for c in b.color)
            pygame.draw.circle(surface, dim, (bxi, byi), b.radius + 6)
            # Mid glow
            mid = tuple(c // 2 for c in b.color)
            pygame.draw.circle(surface, mid, (bxi, byi), b.radius + 3)
            # Core
            pygame.draw.circle(surface, b.color, (bxi, byi), b.radius)
            # Bright centre highlight
            pygame.draw.circle(surface, (255, 255, 255), (bxi, byi), b.radius - 5)
            # String count above ball
            lbl = self.font(13).render(str(n_str), True, b.color)
            surface.blit(lbl, (bxi - lbl.get_width() // 2,
                                byi - b.radius - 18))

        # ── HUD ─────────────────────────────────────────────────────────────
        alive_count  = sum(1 for b in self.balls if b.alive)
        total_strings = sum(len(b.strings) for b in self.balls if b.alive)
        self.draw_hud(surface, [
            self.NAME,
            f"Balls: {alive_count}/6   Strings: {total_strings}",
            "R reset   SPACE pause   ESC menu",
        ])
