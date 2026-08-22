"""Audit the runtime body animation stack used by the commercial lip-sync cast.

The commercial sample spawns its MetaHumans at runtime, so inspecting the
Conclavia production map reports the wrong assets.  This script loads the same
5.6 sample map and actor classes used by the bridge, then prints the body mesh,
AnimBP, post-process graph and skeleton information needed to build a real
per-frame additive performance layer.
"""

from __future__ import annotations

import unreal


MAP_PATH = "/Game/FirstPerson/Maps/FirstPersonMap"
CAST_CLASSES = (
    "/Game/MetaHumans/Aera/BP_Aera.BP_Aera_C",
    "/Game/MetaHumans/Ada/BP_Ada.BP_Ada_C",
)


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_COMMERCIAL_BODY_AUDIT: {message}")


def safe_property(obj: object, name: str) -> object:
    try:
        return obj.get_editor_property(name)
    except Exception as error:
        return f"ERROR:{error}"


def object_path(value: object | None) -> str:
    if value is None:
        return "None"
    try:
        return value.get_path_name()
    except Exception:
        return repr(value)


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(MAP_PATH):
        raise RuntimeError(f"Could not load {MAP_PATH}")

    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for index, class_path in enumerate(CAST_CLASSES):
        actor_class = unreal.load_class(None, class_path)
        if actor_class is None:
            raise RuntimeError(f"Could not load {class_path}")
        actor = actor_subsystem.spawn_actor_from_class(
            actor_class,
            unreal.Vector(index * 100.0, 0.0, 0.0),
            unreal.Rotator(),
        )
        if actor is None:
            raise RuntimeError(f"Could not spawn {class_path}")
        log(f"ACTOR class={class_path} label={actor.get_actor_label()}")

        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            mesh = component.get_skeletal_mesh_asset()
            anim_instance = component.get_anim_instance()
            post_instance = component.get_post_process_instance()
            skeleton = safe_property(mesh, "skeleton") if mesh else None
            post_class = safe_property(mesh, "post_process_anim_blueprint") if mesh else None
            log(
                "COMPONENT "
                f"name={component.get_name()} "
                f"class={component.get_class().get_path_name()} "
                f"mesh={object_path(mesh)} "
                f"skeleton={object_path(skeleton)} "
                f"mode={safe_property(component, 'animation_mode')!r} "
                f"anim_class={object_path(safe_property(component, 'anim_class'))} "
                f"anim_instance={object_path(anim_instance.get_class()) if anim_instance else 'None'} "
                f"mesh_post_class={object_path(post_class)} "
                f"post_instance={object_path(post_instance.get_class()) if post_instance else 'None'} "
                f"leader={object_path(safe_property(component, 'leader_pose_component'))}"
            )

            if skeleton is not None and not isinstance(skeleton, str):
                try:
                    reference_pose = skeleton.get_reference_pose()
                    names = [str(name) for name in reference_pose.get_bone_names()]
                except Exception as error:
                    names = [f"ERROR:{error}"]
                interesting = [
                    name
                    for name in names
                    if any(
                        token in name.casefold()
                        for token in ("root", "pelvis", "spine", "neck", "head")
                    )
                ]
                log(
                    f"SKELETON component={component.get_name()} "
                    f"bones={len(names)} interesting={','.join(interesting)}"
                )

        actor_subsystem.destroy_actor(actor)

    log("READY")


if __name__ == "__main__":
    main()
