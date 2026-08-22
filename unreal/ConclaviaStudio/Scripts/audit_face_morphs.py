"""List production-face morph targets relevant to audio-driven lipsync."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")
    actors = sorted(
        (
            actor
            for actor in unreal.get_editor_subsystem(
                unreal.EditorActorSubsystem
            ).get_all_level_actors()
            if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}
        ),
        key=lambda actor: actor.get_actor_label(),
    )
    for actor in actors:
        face = next(
            component
            for component in actor.get_components_by_class(
                unreal.SkeletalMeshComponent
            )
            if component.get_name().casefold() == "face"
        )
        mesh = face.get_skeletal_mesh_asset()
        names = [str(name) for name in mesh.get_all_morph_target_names()]
        relevant = [
            name
            for name in names
            if any(token in name.casefold() for token in ("jaw", "mouth", "lip"))
        ]
        unreal.log_warning(
            f"CONCLAVIA_FACE_MORPHS actor={actor.get_actor_label()} "
            f"count={len(names)} relevant={'|'.join(relevant)}"
        )
    unreal.log_warning("CONCLAVIA_FACE_MORPHS READY")


if __name__ == "__main__":
    main()
