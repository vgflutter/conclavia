# Conclavia studio plates

The production project keeps the original 16:9 source plates outside Unreal's
asset registry and imports them through `Scripts/build_premium_studio.py`.

- `studio-pop-2026-v1.png`: youthful, colourful streaming-podcast set.
- `studio-editorial-2026-v1.png`: sober editorial set with warm wood and teal.

Both plates contain exactly five empty seats and were generated specifically
for Conclavia. Their imported Unreal textures, materials and camera layout are
recreated deterministically by the build script.
