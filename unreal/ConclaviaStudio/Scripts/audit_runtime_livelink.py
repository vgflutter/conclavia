"""Inspect the UE 5.8 runtime Live Link hooks on Conclavia's production cast.

The output is intentionally machine-readable in the Unreal log so the cloud
bootstrap can be kept deterministic across MetaHuman plugin revisions.
"""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_RUNTIME_LIVELINK_AUDIT: {message}")


def property_names(value: object) -> list[str]:
    names: set[str] = set()
    value_type = value if isinstance(value, type) else type(value)
    for owner in value_type.mro():
        names.update(getattr(owner, "__dict__", {}).keys())
    names.update(name for name in dir(value) if not name.startswith("_"))
    return sorted(names)


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")

    log(f"preset_doc={unreal.LiveLinkPreset.__doc__}")
    log(f"preset_members={property_names(unreal.LiveLinkPreset)}")
    log(
        "source_blueprint_members="
        f"{property_names(unreal.MetaHumanLocalLiveLinkSourceBlueprint)}"
    )

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
        log(
            f"actor={actor.get_actor_label()} class={actor.get_class().get_path_name()} "
            f"class_doc={type(actor).__doc__}"
        )
        for candidate in (
            "use_live_link",
            "live_link_subject",
            "live_link_subject_name",
            "live_link_subject_name_to_use",
        ):
            try:
                value = actor.get_editor_property(candidate)
            except Exception:
                continue
            log(f"actor={actor.get_actor_label()} property={candidate} value={value!r}")
        generated_class = actor.get_class()
        class_default = unreal.get_default_object(generated_class)
        log(
            f"actor={actor.get_actor_label()} class_default_doc={type(class_default).__doc__}"
        )
        for candidate in (
            "use_live_link",
            "live_link_subject",
            "live_link_subject_name",
            "live_link_subject_name_to_use",
        ):
            try:
                value = class_default.get_editor_property(candidate)
            except Exception as error:
                log(
                    f"actor={actor.get_actor_label()} class_default_property={candidate} "
                    f"error={error}"
                )
                continue
            log(
                f"actor={actor.get_actor_label()} class_default_property={candidate} "
                f"value={value!r}"
            )
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            component_name = component.get_name()
            mesh = component.get_skeletal_mesh_asset()
            anim_instance = component.get_anim_instance()
            post_instance = component.get_post_process_instance()
            try:
                leader = component.get_editor_property("leader_pose_component")
            except Exception:
                leader = None
            log(
                f"actor={actor.get_actor_label()} component={component_name} "
                f"class={component.get_class().get_path_name()} "
                f"mesh={mesh.get_path_name() if mesh else None} "
                f"anim={anim_instance.get_class().get_path_name() if anim_instance else None} "
                f"post={post_instance.get_class().get_path_name() if post_instance else None} "
                f"leader={leader.get_name() if leader else None}"
            )
            for instance_label, instance in (("anim", anim_instance), ("post", post_instance)):
                if instance is None:
                    continue
                relevant = [
                    name for name in property_names(instance)
                    if any(token in name.casefold() for token in ("live", "link", "subject", "audio"))
                ]
                log(
                    f"actor={actor.get_actor_label()} component={component_name} "
                    f"{instance_label}_relevant={relevant}"
                )

    log("READY")


if __name__ == "__main__":
    main()
