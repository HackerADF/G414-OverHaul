from .double_pendulum import DoublePendulumSim
from .nbody import NBodySim
from .cloth import ClothSim
from .balls import BouncingBallsSim
from .waves import WaveInterferenceSim
from .sand import FallingSandSim
from .fluid_sph import FluidSPHSim
from .spring_oscillator import SpringOscillatorSim
from .rotating_rings import RotatingRingsSim
from .string_web     import StringWebSim

__all__ = [
    "DoublePendulumSim",
    "NBodySim",
    "ClothSim",
    "BouncingBallsSim",
    "WaveInterferenceSim",
    "FallingSandSim",
    "FluidSPHSim",
    "SpringOscillatorSim",
    "RotatingRingsSim",
    "StringWebSim",
]
