# G414 Physics Engine

A Python physics engine for running the interactive simulations you see in popular YouTube videos — from chaotic pendulums and N-body gravity to cloth, fluid, and falling sand.

## Simulations

| # | Name | Key physics |
|---|------|------------|
| 1 | **Double Pendulum (Chaos)** | Lagrangian mechanics, RK4 integration, sensitive dependence on initial conditions |
| 2 | **N-Body Gravity** | Gravitational force, orbital mechanics, three-body problem, galaxy collision |
| 3 | **Cloth Simulation** | Verlet integration, distance constraints, structural/shear/bend springs, tearing |
| 4 | **Elastic Collisions – π Counter** | 1-D elastic collisions, conservation of momentum & energy, digits of π |
| 5 | **Wave Interference** | Superposition, double-slit interference pattern, standing waves |
| 6 | **Falling Sand** | Cellular automaton — sand, water, fire, smoke, lava, stone, wood |
| 7 | **SPH Fluid** | Smoothed Particle Hydrodynamics, Navier-Stokes pressure & viscosity |
| 8 | **Spring Oscillator** | Simple harmonic motion, coupled oscillators, driven resonance |

## Installation

```bash
pip install -r requirements.txt
```

Requires **Python 3.10+**.

## Usage

```bash
# Interactive menu
python main.py

# Launch a specific simulation directly
python main.py --sim 0   # Double Pendulum
python main.py --sim 1   # N-Body Gravity
# ...

# List all simulations
python main.py --list
```

## Controls (common)

| Key | Action |
|-----|--------|
| `ESC` | Return to main menu |
| `SPACE` | Pause / resume |
| `R` | Reset simulation |
| `↑ ↓ ← →` | Adjust parameters (simulation-specific) |

### Simulation-specific controls

**Double Pendulum** – SPACE pause, R reset
**N-Body** – `← →` cycle scenarios, SPACE pause, R reset
**Cloth** – LMB grab, RMB tear, W wind, C calm
**Elastic Collisions** – `1`/`2`/`3`/`4` mass ratio (1 : 1, 1 : 100, 1 : 10 000, 1 : 1 000 000)
**Waves** – TAB cycle mode, `↑↓` frequency, `← →` wavelength
**Falling Sand** – `1–7` material, `0` erase, scroll brush size, LMB place, RMB erase
**SPH Fluid** – LMB add particles, RMB repel
**Spring Oscillator** – TAB cycle mode, `↑↓` stiffness, `← →` drive frequency

## Architecture

```
physics_engine/
├── core/
│   ├── vector.py         Vec2 – 2D math primitives
│   ├── body.py           Particle, RigidBody
│   ├── world.py          Physics world – gravity, integration, boundaries
│   ├── collision.py      Circle-circle impulse resolution
│   └── constraint.py     Distance & spring constraints
├── simulations/
│   ├── double_pendulum.py
│   ├── nbody.py
│   ├── cloth.py
│   ├── balls.py
│   ├── waves.py
│   ├── sand.py
│   ├── fluid_sph.py
│   └── spring_oscillator.py
└── renderer/
    └── display.py        pygame window & clock wrapper
```

## References

- *Ten Minute Physics* by Matthias Müller (NVIDIA) – SPH and cloth methods
- 3Blue1Brown *"The Most Unexpected Answer to a Counting Puzzle"* – π collision experiment
- Chenciner & Montgomery (2000) – figure-8 three-body solution
- Müller et al. (2003) *"Particle-Based Fluid Simulation for Interactive Applications"* – SPH kernels
