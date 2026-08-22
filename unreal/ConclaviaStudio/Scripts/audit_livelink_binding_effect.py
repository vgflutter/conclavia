"""Audit what LiveLinkSetup changes on the assembled MetaHuman face."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_BINDING_EFFECT_AUDIT: {message}")


def component_state(face: unreal.SkeletalMeshComponent) -> str:
    try:
        anim_class = face.get_editor_property("anim_class")
    except Exception as error:
        anim_class = f"ERROR:{error}"
    anim = face.get_anim_instance()
    post = face.get_post_process_instance()
    return (
        f"anim_class={anim_class!r} "
        f"anim={anim.get_class().get_path_name() if anim else None} "
        f"post={post.get_class().get_path_name() if post else None}"
    )


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")
    actor = next(
        candidate
        for candidate in unreal.get_editor_subsystem(
            unreal.EditorActorSubsystem
        ).get_all_level_actors()
        if "ConclaviaProductionCast" in {str(tag) for tag in candidate.tags}
    )
    face = next(
        component
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent)
        if component.get_name().casefold() == "face"
    )
    subject = unreal.LiveLinkSubjectName()
    subject.set_editor_property("name", unreal.Name("ConclaviaVoice"))
    log(f"initial {component_state(face)}")

    for candidate in (unreal.LiveLinkRetargetAsset, unreal.LiveLinkRemapAsset):
        try:
            result = actor.call_method(
                "LiveLinkSetup",
                args=(face, subject, candidate, True),
            )
        except Exception as error:
            log(f"candidate={candidate.__name__} error={error}")
        else:
            log(
                f"candidate={candidate.__name__} result={result!r} "
                f"{component_state(face)}"
            )

    for property_name in ("live_link_subject", "use_live_link"):
        try:
            value = actor.get_editor_property(property_name)
        except Exception as error:
            log(f"property={property_name} error={error}")
        else:
            log(f"property={property_name} value={value!r}")
    log("READY")


if __name__ == "__main__":
    main()
