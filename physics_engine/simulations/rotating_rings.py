"""
Rotating Rings Escape – viral-style physics demo.

A ball bounces inside 6 concentric rings that spin at different speeds
and in alternating directions.  Each ring has a gap cut-out; when the
gaps briefly align the ball can escape to the next ring.

Controls
--------
SPACE   add another ball (up to 5)
R       reset
B       toggle ball trails
+/-     speed up / slow down all rings
ESC     back to menu

YouTube inspiration: "balls escaping spinning rings" viral videos.
"""
from __future__ import annotations
import math
import random
from collections import deque
import pygame
import numpy as np

from ..core.vector import Vec2
from ..core.particles import ParticleSystem
from ..renderer.glow import draw_glow, clear_cache

# ── Constants ─────────────────────────────────────────────────────────────────
_BG         = (5, 0, 15)
_TEXT_COL   = (200, 200, 230)
_TWO_PI     = math.pi * 2

_RING_RADII  = [85, 145, 210, 280, 355, 430]
_RING_OMEGAS = [+1.0, -1.4, +1.8, -1.1, +2.2, -0.8]   # rad/s
_RING_COLORS = [
    (255,  60, 100),   # red-pink
    (255, 140,  40),   # orange
    (255, 220,  40),   # yellow
    ( 60, 255, 120),   # green
    ( 60, 160, 255),   # blue
    (180,  60, 255),   # violet
]
_RING_THICKNESS = 6          # pixels
_GAP_WIDTH       = math.radians(62)   # ~62°
_BALL_RADIUS     = 10
_RESTITUTION     = 0.88
_FRICTION        = 0.97
_GRAVITY         = Vec2(0.0, 420.0)   # px/s²
_SUBSTEPS        = 16
_MAX_BALLS       = 5
_TRAIL_LEN       = 120
_ARC_STEPS       = 180              # polygon resolution (2° each)


# ── Ring ──────────────────────────────────────────────────────────────────────

class _Ring:
    __slots__ = ("radius", "thickness", "gap_start", "gap_width",
                 "omega", "angle", "color")

    def __init__(
        self,
        radius:    float,
        gap_start: float,
        gap_width:  float,
        omega:     float,
        color:     tuple[int, int, int],
    ) -> None:
        self.radius    = float(radius)
        self.thickness = _RING_THICKNESS
        self.gap_start = gap_start          # gap center in local coords (rad)
        self.gap_width  = gap_width
        self.omega     = omega              # rad/s (+CCW, -CW)
        self.angle     = 0.0               # current rotation (rad)
        self.color     = color

    def update(self, dt: float) -> None:
        self.angle = (self.angle + self.omega * dt) % _TWO_PI

    def world_gap_start(self) -> float:
        return (self.gap_start + self.angle) % _TWO_PI

    def in_gap(self, ball_angle: float) -> bool:
        """Return True if *ball_angle* (rad, [0, 2π)) falls inside the gap."""
        gs = self.world_gap_start()
        # Normalise ball_angle into [0, 2π)
        ba = ball_angle % _TWO_PI
        # Angular distance from gap start (wrap-around safe)
        delta = (ba - gs) % _TWO_PI
        return delta < self.gap_width

    # ── Rendering ──────────────────────────────────────────────────────────────
    def draw(
        self,
        surface: pygame.Surface,
        cx:      float,
        cy:      float,
    ) -> None:
        gs = self.world_gap_start()
        ge = (gs + self.gap_width) % _TWO_PI   # gap end angle

        outer_r  = self.radius + self.thickness
        inner_r  = max(2.0, self.radius - self.thickness)
        arc_span = _TWO_PI - self.gap_width     # solid arc (radians)
        N        = max(6, int(arc_span * _ARC_STEPS / _TWO_PI))

        # Walk continuously from gap_end → gap_start (the LONG way around).
        # This guarantees all polygon points are contiguous – no crossing lines.
        outer_pts: list[tuple[int, int]] = []
        inner_pts: list[tuple[int, int]] = []
        for i in range(N + 1):
            a   = ge + arc_span * i / N
            ca  = math.cos(a)
            sa  = math.sin(a)
            outer_pts.append((int(cx + ca * outer_r), int(cy + sa * outer_r)))
            inner_pts.append((int(cx + ca * inner_r), int(cy + sa * inner_r)))

        if len(outer_pts) < 3:
            return

        polygon = outer_pts + list(reversed(inner_pts))

        # ── Glow pass: wider + dim, drawn first so bright ring sits on top ──
        glow_outer = int(outer_r + 7)
        glow_inner = max(1, int(inner_r - 7))
        glow_col   = tuple(c // 5 for c in self.color)
        go_pts     = [(int(cx + math.cos(ge + arc_span * i / N) * glow_outer),
                       int(cy + math.sin(ge + arc_span * i / N) * glow_outer))
                      for i in range(N + 1)]
        gi_pts     = [(int(cx + math.cos(ge + arc_span * i / N) * glow_inner),
                       int(cy + math.sin(ge + arc_span * i / N) * glow_inner))
                      for i in range(N + 1)]
        pygame.draw.polygon(surface, glow_col, go_pts + list(reversed(gi_pts)))

        # ── Main ring ───────────────────────────────────────────────────────
        pygame.draw.polygon(surface, self.color, polygon)
        pygame.draw.aalines(surface, self.color, False, outer_pts)
        pygame.draw.aalines(surface, self.color, False, inner_pts)

        # ── Gap endpoint markers (bright dots at each gap edge) ─────────────
        for ga in (gs, ge):
            mx = int(cx + math.cos(ga) * self.radius)
            my = int(cy + math.sin(ga) * self.radius)
            bright = tuple(min(255, c + 80) for c in self.color)
            pygame.draw.circle(surface, bright, (mx, my), 5)
            pygame.draw.circle(surface, (255, 255, 255), (mx, my), 2)


# ── Ball ──────────────────────────────────────────────────────────────────────

class _Ball:
    __slots__ = ("pos", "vel", "radius", "restitution", "trail",
                 "ring_idx", "bounces", "escaped")

    def __init__(self, x: float, y: float) -> None:
        self.pos        = Vec2(x, y)
        angle           = random.uniform(0, _TWO_PI)
        speed           = random.uniform(60, 140)
        self.vel        = Vec2(math.cos(angle) * speed, math.sin(angle) * speed)
        self.radius     = _BALL_RADIUS
        self.restitution= _RESTITUTION
        self.trail: deque[tuple[float, float]] = deque(maxlen=_TRAIL_LEN)
        self.ring_idx   = 0      # innermost ring the ball is confined within
        self.bounces    = 0
        self.escaped    = False

    def update_trail(self) -> None:
        self.trail.append((self.pos.x, self.pos.y))


# ── Simulation ────────────────────────────────────────────────────────────────

class RotatingRingsSim:
    NAME        = "Rotating Rings Escape"
    DESCRIPTION = (
        "Ball bounces inside 6 spinning rings and escapes through aligned gaps. "
        "SPACE add ball  R reset  B trails  +/- ring speed  ESC menu"
    )

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width  = width
        self.height = height
        self.cx     = width  / 2.0
        self.cy     = height / 2.0
        self.balls: list[_Ball] = []
        self.rings: list[_Ring] = []
        self.particles   = ParticleSystem()
        self.show_trails = True
        self.speed_mult  = 1.0
        self.escape_count= 0
        self.bounce_total= 0
        self._victory    = False
        self._victory_t  = 0.0
        self._font       = None   # lazily created on first draw
        self._build()

    # ── Setup ──────────────────────────────────────────────────────────────────
    def _build(self) -> None:
        self.rings.clear()
        self.balls.clear()
        self.particles = ParticleSystem()
        self._victory  = False
        clear_cache()
        for i, (rad, omega, col) in enumerate(
            zip(_RING_RADII, _RING_OMEGAS, _RING_COLORS)
        ):
            gap_start = random.uniform(0, _TWO_PI)
            self.rings.append(_Ring(rad, gap_start, _GAP_WIDTH, omega, col))
        self.balls.append(_Ball(self.cx, self.cy))

    # ── Events ─────────────────────────────────────────────────────────────────
    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type != pygame.KEYDOWN:
            return
        k = event.key
        if k == pygame.K_r:
            self.escape_count = 0
            self.bounce_total = 0
            self._build()
        elif k == pygame.K_SPACE:
            if len(self.balls) < _MAX_BALLS:
                self.balls.append(_Ball(self.cx, self.cy))
        elif k == pygame.K_b:
            self.show_trails = not self.show_trails
        elif k in (pygame.K_PLUS, pygame.K_KP_PLUS, pygame.K_EQUALS):
            self.speed_mult = min(self.speed_mult * 1.25, 5.0)
        elif k in (pygame.K_MINUS, pygame.K_KP_MINUS):
            self.speed_mult = max(self.speed_mult / 1.25, 0.2)

    # ── Update ─────────────────────────────────────────────────────────────────
    def update(self, dt: float) -> None:
        dt = min(dt, 0.05)   # clamp spike frames

        # Victory countdown
        if self._victory:
            self._victory_t -= dt
            if self._victory_t <= 0:
                self._build()
            self.particles.update(dt)
            return

        # Rotate rings
        for ring in self.rings:
            ring.angle = (ring.angle + ring.omega * self.speed_mult * dt) % _TWO_PI

        # Sub-step physics
        sub_dt = dt / _SUBSTEPS
        for _ in range(_SUBSTEPS):
            for ball in self.balls:
                # Gravity
                ball.vel += _GRAVITY * sub_dt
                ball.pos += ball.vel * sub_dt
                # Ring collisions
                for ring in self.rings:
                    self._check_ring_collision(ball, ring)
            # Ball-ball collisions
            for i in range(len(self.balls)):
                for j in range(i + 1, len(self.balls)):
                    self._ball_ball_collision(self.balls[i], self.balls[j])

        # Trails
        for ball in self.balls:
            ball.update_trail()

        # Particle update
        self.particles.update(dt)

        # Check escape (ball outside outermost ring)
        outer_r = _RING_RADII[-1] + _RING_THICKNESS
        for ball in self.balls:
            d = math.sqrt((ball.pos.x - self.cx)**2 + (ball.pos.y - self.cy)**2)
            if d > outer_r and not ball.escaped:
                ball.escaped = True
                self.escape_count += 1
                self.bounce_total += ball.bounces
                self.particles.emit_victory(ball.pos.x, ball.pos.y)
                self._victory   = True
                self._victory_t = 2.0
                return

    # ── Collision helpers ──────────────────────────────────────────────────────
    def _check_ring_collision(self, ball: _Ball, ring: _Ring) -> None:
        dx = ball.pos.x - self.cx
        dy = ball.pos.y - self.cy
        d  = math.sqrt(dx * dx + dy * dy)
        if d < 1e-6:
            d = 1e-6

        # Distance from ball centre to ring circle
        dist_to_ring = abs(d - ring.radius)
        if dist_to_ring > ball.radius + ring.thickness:
            return

        # Angle of ball relative to ring centre
        ball_angle = math.atan2(dy, dx) % _TWO_PI

        if ring.in_gap(ball_angle):
            return   # ball passes through the gap

        # Unit radial vectors
        rx = dx / d
        ry = dy / d

        # Radial velocity component (positive = outward)
        v_r = ball.vel.x * rx + ball.vel.y * ry

        # Determine which side of the ring the ball is hitting
        inside = d < ring.radius

        if inside and v_r > 0:
            # Ball moving outward, hitting inner wall → reflect inward
            ball.vel.x -= (1 + ball.restitution) * v_r * rx
            ball.vel.y -= (1 + ball.restitution) * v_r * ry
            # Apply friction to tangential component
            ball.vel.x *= _FRICTION
            ball.vel.y *= _FRICTION
            # Push back inside
            overlap = (ring.radius - ball.radius) - d
            if overlap < 0:
                ball.pos.x += overlap * rx
                ball.pos.y += overlap * ry
            ball.bounces += 1
            self._emit_sparks(ball, ring)

        elif not inside and v_r < 0:
            # Ball moving inward, hitting outer wall → reflect outward
            ball.vel.x -= (1 + ball.restitution) * v_r * rx
            ball.vel.y -= (1 + ball.restitution) * v_r * ry
            ball.vel.x *= _FRICTION
            ball.vel.y *= _FRICTION
            # Push back outside
            overlap = d - (ring.radius + ball.radius)
            if overlap < 0:
                ball.pos.x -= overlap * rx
                ball.pos.y -= overlap * ry
            ball.bounces += 1
            self._emit_sparks(ball, ring)

    def _emit_sparks(self, ball: _Ball, ring: _Ring) -> None:
        self.particles.emit_burst(
            ball.pos.x, ball.pos.y,
            ring.color,
            count=8,
            speed=220.0,
            life=0.45,
            size=2.0,
        )

    def _ball_ball_collision(self, b1: _Ball, b2: _Ball) -> None:
        dx = b2.pos.x - b1.pos.x
        dy = b2.pos.y - b1.pos.y
        dist = math.sqrt(dx * dx + dy * dy)
        min_d = b1.radius + b2.radius
        if dist >= min_d or dist < 1e-6:
            return
        nx = dx / dist
        ny = dy / dist
        # Relative velocity along normal
        dvx = b1.vel.x - b2.vel.x
        dvy = b1.vel.y - b2.vel.y
        vn  = dvx * nx + dvy * ny
        if vn <= 0:
            return   # already separating
        # Equal-mass impulse
        j = vn * (1 + _RESTITUTION) * 0.5
        b1.vel.x -= j * nx
        b1.vel.y -= j * ny
        b2.vel.x += j * nx
        b2.vel.y += j * ny
        # Separate
        overlap = min_d - dist
        b1.pos.x -= nx * overlap * 0.5
        b1.pos.y -= ny * overlap * 0.5
        b2.pos.x += nx * overlap * 0.5
        b2.pos.y += ny * overlap * 0.5

    # ── Draw ───────────────────────────────────────────────────────────────────
    def draw(self, surface: pygame.Surface) -> None:
        if self._font is None:
            self._font = pygame.font.SysFont("monospace", 14)

        surface.fill(_BG)

        # Rings
        for ring in self.rings:
            ring.draw(surface, self.cx, self.cy)

        # Ball trails
        if self.show_trails:
            for ball in self.balls:
                trail = list(ball.trail)
                n = len(trail)
                for i in range(1, n):
                    t = i / n
                    alpha = int(t * 180)
                    width = max(1, int(t * 3))
                    col   = (int(180 * t), int(220 * t), 255)
                    # Draw segment on overlay
                    x1, y1 = int(trail[i-1][0]), int(trail[i-1][1])
                    x2, y2 = int(trail[i][0]),   int(trail[i][1])
                    pygame.draw.line(surface, col, (x1, y1), (x2, y2), width)

        # Balls
        for ball in self.balls:
            bx, by = int(ball.pos.x), int(ball.pos.y)
            # Large dim glow
            draw_glow(surface, (bx, by), int(ball.radius * 3.5), (80, 180, 255), 0.6)
            # Small bright glow
            draw_glow(surface, (bx, by), int(ball.radius * 1.5), (200, 230, 255), 1.0)
            # Core
            pygame.draw.circle(surface, (255, 255, 255), (bx, by), ball.radius)
            pygame.draw.circle(surface, (160, 210, 255), (bx, by), ball.radius - 2)

        # Particles (sparks)
        self.particles.draw(surface)

        # HUD
        lines = [
            self.NAME,
            f"Balls: {len(self.balls)}  Bounces: {sum(b.bounces for b in self.balls)}  "
            f"Escapes: {self.escape_count}",
            f"Ring speed: {self.speed_mult:.2f}x   "
            f"Particles: {self.particles.count}",
            "SPACE add ball  R reset  B trails  +/- speed  ESC menu",
        ]
        for i, line in enumerate(lines):
            s = self._font.render(line, True, _TEXT_COL)
            surface.blit(s, (12, 12 + i * 18))

        # Victory overlay
        if self._victory:
            self._draw_victory(surface)

    def _draw_victory(self, surface: pygame.Surface) -> None:
        overlay = pygame.Surface(surface.get_size(), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 120))
        surface.blit(overlay, (0, 0))
        font = pygame.font.SysFont("monospace", 52, bold=True)
        txt  = font.render("ESCAPED!", True, (255, 220, 60))
        surface.blit(txt, (
            self.width  // 2 - txt.get_width()  // 2,
            self.height // 2 - txt.get_height() // 2,
        ))
        sub  = self._font.render(
            f"Escape #{self.escape_count}  –  resetting in {self._victory_t:.1f}s",
            True, (200, 200, 200),
        )
        surface.blit(sub, (
            self.width  // 2 - sub.get_width()  // 2,
            self.height // 2 + 50,
        ))
        self.particles.draw(surface)
