"""2D vector math used throughout the engine."""
from __future__ import annotations
import math


class Vec2:
    """Immutable-style 2D vector with full operator support."""

    __slots__ = ("x", "y")

    def __init__(self, x: float = 0.0, y: float = 0.0) -> None:
        self.x = float(x)
        self.y = float(y)

    # ------------------------------------------------------------------ #
    #  Arithmetic                                                          #
    # ------------------------------------------------------------------ #
    def __add__(self, other: Vec2) -> Vec2:
        return Vec2(self.x + other.x, self.y + other.y)

    def __sub__(self, other: Vec2) -> Vec2:
        return Vec2(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar: float) -> Vec2:
        return Vec2(self.x * scalar, self.y * scalar)

    def __rmul__(self, scalar: float) -> Vec2:
        return self.__mul__(scalar)

    def __truediv__(self, scalar: float) -> Vec2:
        return Vec2(self.x / scalar, self.y / scalar)

    def __neg__(self) -> Vec2:
        return Vec2(-self.x, -self.y)

    def __iadd__(self, other: Vec2) -> Vec2:
        self.x += other.x
        self.y += other.y
        return self

    def __isub__(self, other: Vec2) -> Vec2:
        self.x -= other.x
        self.y -= other.y
        return self

    def __imul__(self, scalar: float) -> Vec2:
        self.x *= scalar
        self.y *= scalar
        return self

    # ------------------------------------------------------------------ #
    #  Comparison / hashing                                               #
    # ------------------------------------------------------------------ #
    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Vec2):
            return NotImplemented
        return self.x == other.x and self.y == other.y

    def __repr__(self) -> str:
        return f"Vec2({self.x:.4f}, {self.y:.4f})"

    # ------------------------------------------------------------------ #
    #  Core operations                                                     #
    # ------------------------------------------------------------------ #
    def dot(self, other: Vec2) -> float:
        return self.x * other.x + self.y * other.y

    def cross(self, other: Vec2) -> float:
        """Scalar z-component of the 3-D cross product."""
        return self.x * other.y - self.y * other.x

    def length_sq(self) -> float:
        return self.x * self.x + self.y * self.y

    def length(self) -> float:
        return math.sqrt(self.length_sq())

    def normalized(self) -> Vec2:
        mag = self.length()
        if mag < 1e-12:
            return Vec2(0.0, 0.0)
        return Vec2(self.x / mag, self.y / mag)

    def perpendicular(self) -> Vec2:
        """Returns a vector rotated 90° counter-clockwise."""
        return Vec2(-self.y, self.x)

    def rotated(self, angle: float) -> Vec2:
        """Rotate by *angle* radians counter-clockwise."""
        c, s = math.cos(angle), math.sin(angle)
        return Vec2(c * self.x - s * self.y, s * self.x + c * self.y)

    def lerp(self, other: Vec2, t: float) -> Vec2:
        return Vec2(self.x + (other.x - self.x) * t, self.y + (other.y - self.y) * t)

    def distance_to(self, other: Vec2) -> float:
        return (self - other).length()

    def angle(self) -> float:
        """Angle of this vector from the positive x-axis (radians)."""
        return math.atan2(self.y, self.x)

    def copy(self) -> Vec2:
        return Vec2(self.x, self.y)

    # ------------------------------------------------------------------ #
    #  Convenience constructors                                            #
    # ------------------------------------------------------------------ #
    @staticmethod
    def from_angle(angle: float, length: float = 1.0) -> Vec2:
        return Vec2(math.cos(angle) * length, math.sin(angle) * length)

    @staticmethod
    def zero() -> Vec2:
        return Vec2(0.0, 0.0)

    def to_tuple(self) -> tuple[float, float]:
        return (self.x, self.y)

    def to_int_tuple(self) -> tuple[int, int]:
        return (int(self.x), int(self.y))
