"""Place the MetaHuman identity-template meshes in the centre studio seat.

The probe is intentionally isolated behind PROBE_* labels so it can be removed
without touching the generated studio. It verifies the visual quality and mesh
alignment of the runtime assets bundled with Unreal before the production cast
pipeline is committed to them.
"""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"
BODY_PATH = "/MetaHumanCharacter/Body/IdentityTemplate/SKM_Body"
FACE_PATH = "/MetaHumanCharacter/Face/SKM_Face"


def spawn_mesh(label: str, mesh_path: str) -> unreal.SkeletalMeshActor:
    mesh = unreal.load_asset(mesh_path)
    if not isinstance(mesh, unreal.SkeletalMesh):
        raise RuntimeError(f"Missing skeletal mesh: {mesh_path}")

    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsystem.spawn_actor_from_class(
        unreal.SkeletalMeshActor,
        unreal.Vector(-18.0, 0.0, 0.0),
    )
    if actor is None:
        raise RuntimeError(f"Could not spawn {label}")
    actor.set_actor_label(label)
    actor.set_actor_rotation(
        unreal.Rotator(roll=0.0, pitch=0.0, yaw=180.0), False
    )
    actor.tags = [unreal.Name("ConclaviaProbe"), unreal.Name("Seat3")]

    component = actor.get_component_by_class(unreal.SkeletalMeshComponent)
    component.set_skeletal_mesh_asset(mesh)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(True)
    return actor


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")

    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in subsystem.get_all_level_actors():
        if actor.actor_has_tag("ConclaviaProbe") or actor.get_actor_label().startswith("PROBE_"):
            subsystem.destroy_actor(actor)

    spawn_mesh("PROBE_MetaHuman_Body", BODY_PATH)
    spawn_mesh("PROBE_MetaHuman_Face", FACE_PATH)

    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, LEVEL_PATH):
        raise RuntimeError("Could not save probe map")
    unreal.log_warning("CONCLAVIA_MH_PROBE: READY")


main()
