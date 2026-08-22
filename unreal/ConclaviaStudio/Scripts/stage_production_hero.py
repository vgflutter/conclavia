"""Stage the assembled Cinematic MetaHuman for a real studio close-up."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"
BUILD_PATH = "/Game/Conclavia/Production/Hero"
SEATED_IDLE_PATH = "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle"
ACTOR_LABEL = "CAST_HERO_MarcoBellini"
CAMERA_LABEL = "CAM_Seat_3_Close"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_PRODUCTION_HERO_STAGE: {message}")


def find_blueprint_class() -> type:
    candidates: list[tuple[int, str, type]] = []
    for object_path in unreal.EditorAssetLibrary.list_assets(
        BUILD_PATH,
        recursive=True,
        include_folder=False,
    ):
        package_path = object_path.split(".", 1)[0]
        blueprint_class = unreal.EditorAssetLibrary.load_blueprint_class(package_path)
        if blueprint_class is None:
            continue
        leaf = package_path.rsplit("/", 1)[-1].casefold()
        score = 100 if "marcobellini" in leaf else 0
        score += 40 if leaf.startswith("bp_") else 0
        candidates.append((score, package_path, blueprint_class))
    if not candidates:
        raise RuntimeError(f"No assembled MetaHuman blueprint below {BUILD_PATH}")
    _, path, blueprint_class = max(candidates, key=lambda item: item[0])
    log(f"blueprint={path}")
    return blueprint_class


def clear_old_cast() -> None:
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in actor_subsystem.get_all_level_actors():
        label = actor.get_actor_label()
        tags = {str(tag) for tag in actor.tags}
        if (
            label.startswith(("MHC_STAGE_", "CAST_HERO_"))
            or "ConclaviaProductionCast" in tags
        ):
            actor_subsystem.destroy_actor(actor)


def apply_seated_idle(actor: unreal.Actor) -> str:
    animation = unreal.load_asset(SEATED_IDLE_PATH)
    if not isinstance(animation, unreal.AnimSequence):
        raise RuntimeError(f"Missing seated idle: {SEATED_IDLE_PATH}")
    body = None
    paths: list[str] = []
    for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
        mesh = component.get_skeletal_mesh_asset()
        if mesh is None:
            continue
        path = mesh.get_path_name()
        paths.append(path)
        if "body" in path.casefold() and "face" not in path.casefold():
            body = component
    if body is None:
        raise RuntimeError("Production body component missing; meshes=" + ",".join(paths))
    body.override_animation_data(animation, True, True, 0.0, 1.0)
    return body.get_skeletal_mesh_asset().get_path_name()


def stage() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load map: {LEVEL_PATH}")
    clear_old_cast()
    actor = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).spawn_actor_from_class(
        find_blueprint_class(),
        unreal.Vector(0.0, 0.0, 0.0),
        # UE 5.8 MetaHuman assemblies are authored facing +Y. Rotating the
        # root +90 degrees turns the performer toward cameras on the -X axis.
        unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
    )
    if actor is None:
        raise RuntimeError("Could not spawn production MetaHuman")
    actor.set_actor_label(ACTOR_LABEL)
    actor.tags = [
        unreal.Name("ConclaviaProductionCast"),
        unreal.Name("Seat3"),
        unreal.Name("Participant3"),
    ]
    body_path = apply_seated_idle(actor)
    bounds_origin, bounds_extent = actor.get_actor_bounds(False)
    desired_origin = unreal.Vector(22.0, 0.0, max(94.0, bounds_extent.z + 2.0))
    actor.set_actor_location(
        unreal.MathLibrary.subtract_vector_vector(desired_origin, bounds_origin),
        False,
        False,
    )

    camera = next(
        (
            candidate
            for candidate in unreal.get_editor_subsystem(
                unreal.EditorActorSubsystem
            ).get_all_level_actors()
            if candidate.get_actor_label() == CAMERA_LABEL
        ),
        None,
    )
    if not isinstance(camera, unreal.CineCameraActor):
        raise RuntimeError(f"Missing hero camera: {CAMERA_LABEL}")
    component = camera.get_cine_camera_component()
    component.set_editor_property("current_focal_length", 105.0)
    component.set_editor_property("current_aperture", 2.4)
    focus = component.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.MANUAL)
    focus.set_editor_property("manual_focus_distance", 512.0)
    component.set_editor_property("focus_settings", focus)

    world = unreal.get_editor_subsystem(
        unreal.UnrealEditorSubsystem
    ).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, LEVEL_PATH):
        raise RuntimeError("Could not save production hero stage")
    log(
        f"READY actor={ACTOR_LABEL} camera={CAMERA_LABEL} body={body_path} "
        f"extent=({bounds_extent.x:.1f},{bounds_extent.y:.1f},{bounds_extent.z:.1f})"
    )


if __name__ == "__main__":
    stage()
