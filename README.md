# Balloon Road Simulation

A lightweight Three.js first-person mini-game inspired by your reference image.

## How to run

From the project folder:

```bash
cd /Users/ianchoefroggggy/Documents/GitHub/balloon-world-sim
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

Important: open it in a normal web browser tab (Chrome/Safari/Edge), not an editor HTML preview pane.

## Controls

- Click screen: lock mouse / start
- Mouse: look around
- `W A S D`: move
- `Shift`: sprint
- `T`: teleport to near the hot-air balloon
- `Esc`: release mouse
- `R`: restart after game over
- If mouse lock is blocked in your browser/app, hold left mouse and drag to look around (fallback mode).

## Gameplay details implemented

- You start very far from a single hot-air balloon target in front of you.
- The road and surrounding grass field extend in both directions.
- Grass has layered texture and smooth wind-wave motion.
- Sky includes moving cloud textures.
- Slow-moving cars spawn more frequently on the road.
- Cars use a loaded 3D model (`assets/ToyCar.glb`) with slight color variation.
- Colliding with cars does not kill you.
- You can walk on road and grass freely.
- Stairs face the road/player approach direction.
- Entering the lobby triggers balloon lift-off, but the balloon leaves without carrying the player.
- After the balloon ascends, game over is shown.

## Asset note

- Car model: `assets/ToyCar.glb` from Khronos glTF Sample Assets.
