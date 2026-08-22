"""Print the complete animation stack of one production MetaHuman."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_ANIM_STACK_AUDIT: {message}")


def safe_property(obj: object, name: str) -> object:
    try:
        return obj.get_editor_property(name)
    except Exception as error:
        return f"ERROR:{error}"


def main() -> None:
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
    log(f"actor={actor.get_actor_label()} class={actor.get_class().get_path_name()}")
    for component in actor.get_components_by_class(unreal.ActorComponent):
        details = [
            f"component={component.get_name()}",
            f"class={component.get_class().get_path_name()}",
            f"tick={safe_property(component, 'component_tick')!r}",
        ]
        if isinstance(component, unreal.SkeletalMeshComponent):
            anim = component.get_anim_instance()
            post = component.get_post_process_instance()
            details.extend(
                (
                    f"mode={safe_property(component, 'animation_mode')!r}",
                    f"anim_class={safe_property(component, 'anim_class')!r}",
                    f"anim={anim.get_class().get_path_name() if anim else None}",
                    f"post={post.get_class().get_path_name() if post else None}",
                    f"mesh={component.get_skeletal_mesh_asset().get_path_name() if component.get_skeletal_mesh_asset() else None}",
                    f"leader={safe_property(component, 'leader_pose_component')!r}",
                )
            )
        log(" ".join(details))

    actor_class = actor.get_class()
    for name in ("LiveLinkSubject", "UseLiveLink"):
        try:
            value = actor.get_editor_property(name)
        except Exception as first_error:
            try:
                value = actor.get_editor_property(
                    "live_link_subject" if name == "LiveLinkSubject" else "use_live_link"
                )
            except Exception as second_error:
                value = f"ERROR:{first_error}; {second_error}"
        log(f"actor_property {name}={value!r}")

    functions = sorted(
        name
        for name in dir(actor)
        if any(token in name.casefold() for token in ("live", "anim", "link"))
    )
    log(f"python_methods={functions}")
    log("READY")


if __name__ == "__main__":
    main()
