"""Report meshes, materials and animation components for the staged cast."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_CAST_AUDIT: {message}")


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")

    actors = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).get_all_level_actors()
    cast = sorted(
        (
            actor
            for actor in actors
            if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}
        ),
        key=lambda actor: actor.get_actor_label(),
    )
    log(f"CAST count={len(cast)}")
    for actor in cast:
        location = actor.get_actor_location()
        log(
            f"ACTOR label={actor.get_actor_label()} "
            f"location=({location.x:.1f},{location.y:.1f},{location.z:.1f})"
        )
        for component in actor.get_components_by_class(
            unreal.SkeletalMeshComponent
        ):
            mesh = component.get_skeletal_mesh_asset()
            if mesh is None:
                continue
            materials = [
                material.get_path_name() if material is not None else "None"
                for material in component.get_materials()
            ]
            log(
                f"COMPONENT actor={actor.get_actor_label()} "
                f"name={component.get_name()} mesh={mesh.get_path_name()} "
                f"materials={'|'.join(materials)}"
            )
            if component.get_name() == "SkeletalMesh":
                for material in component.get_materials()[:2]:
                    if material is None:
                        continue
                    vector_names = unreal.MaterialEditingLibrary.get_vector_parameter_names(
                        material
                    )
                    scalar_names = unreal.MaterialEditingLibrary.get_scalar_parameter_names(
                        material
                    )
                    log(
                        f"MATERIAL path={material.get_path_name()} "
                        f"vectors={','.join(str(name) for name in vector_names)} "
                        f"scalars={','.join(str(name) for name in scalar_names)}"
                    )


if __name__ == "__main__":
    main()
