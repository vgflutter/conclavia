"""Find which assembled MetaHuman component LiveLinkSetup expects.

The level is never saved.  Every candidate runs in a fresh editor process so
the compiled Blueprint can reveal its own intended animation-class switch.
"""

from __future__ import annotations

import os
import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_SETUP_TARGET_AUDIT: {message}")


def component_state(component: unreal.SkeletalMeshComponent) -> str:
    anim = component.get_anim_instance()
    post = component.get_post_process_instance()
    return (
        f"name={component.get_name()} "
        f"mode={component.get_editor_property('animation_mode')} "
        f"anim_class={component.get_editor_property('anim_class')!r} "
        f"anim={anim.get_class().get_path_name() if anim else None} "
        f"post={post.get_class().get_path_name() if post else None}"
    )


def components_for(actor: unreal.Actor) -> dict[str, unreal.SkeletalMeshComponent]:
    """Always resolve components after Blueprint property changes.

    Changing the generated MetaHuman Live Link properties in the editor reruns
    its construction script.  References captured before that point are named
    ``TRASH_*`` and cannot tell us what the assembled character actually uses.
    """
    return {
        component.get_name().casefold(): component
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent)
        if not component.get_name().casefold().startswith("trash_")
    }


def main() -> None:
    target_name = os.environ.get("CONCLAVIA_AUDIT_TARGET", "face").casefold()
    retarget_name = os.environ.get("CONCLAVIA_AUDIT_RETARGET", "none").casefold()
    if target_name not in {"face", "body"}:
        target_name = "face"
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")
    actor = next(
        candidate
        for candidate in unreal.get_editor_subsystem(
            unreal.EditorActorSubsystem
        ).get_all_level_actors()
        if "ConclaviaProductionCast" in {str(tag) for tag in candidate.tags}
        and "Seat1" in {str(tag) for tag in candidate.tags}
    )
    components = components_for(actor)
    face = components["face"]
    body = components["body"]
    subject = unreal.LiveLinkSubjectName()
    subject.set_editor_property("name", unreal.Name("ConclaviaVoice"))
    actor.set_editor_property("LiveLinkSubject", subject)
    actor.set_editor_property("UseLiveLink", True)
    components = components_for(actor)
    face = components["face"]
    body = components["body"]
    target = components[target_name]
    retarget = (
        unreal.LiveLinkRemapAsset if retarget_name == "remap" else None
    )

    log(
        f"target={target_name} retarget={retarget_name} "
        f"actor={actor.get_actor_label()}"
    )
    log(f"before_body {component_state(body)}")
    log(f"before_face {component_state(face)}")
    result = actor.call_method(
        "LiveLinkSetup",
        args=(target, subject, retarget, True),
    )
    components = components_for(actor)
    face = components["face"]
    body = components["body"]
    log(f"result={result!r}")
    log(f"after_body {component_state(body)}")
    log(f"after_face {component_state(face)}")
    for property_name in dir(actor):
        folded = property_name.casefold()
        if not any(token in folded for token in ("live", "subject", "retarget")):
            continue
        try:
            value = actor.get_editor_property(property_name)
        except Exception:
            continue
        log(f"actor_property {property_name}={value!r}")
    log("READY")


if __name__ == "__main__":
    main()
