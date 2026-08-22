"""Place the five assembled production MetaHumans in both studio maps."""

from __future__ import annotations

from dataclasses import dataclass

import unreal


POP_LEVEL = "/Game/Conclavia/Studio/L_PremiumStudio"
EDITORIAL_LEVEL = "/Game/Conclavia/Studio/L_EditorialStudio"
GENERATED_ROOT = "/Game/Conclavia/Production/MetaHumans"
HERO_ROOT = "/Game/Conclavia/Production/Hero"
IDLE_PATH = "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle"
SEAT_Y = (-272.0, -136.0, 0.0, 136.0, 272.0)
SEAT_X = (62.0, 28.0, 18.0, 28.0, 62.0)
FACE_Z = 162.0
WARDROBE_COLORS = (
    unreal.LinearColor(0.16, 0.018, 0.035, 1.0),
    unreal.LinearColor(0.012, 0.055, 0.17, 1.0),
    unreal.LinearColor(0.008, 0.14, 0.10, 1.0),
    unreal.LinearColor(0.026, 0.03, 0.04, 1.0),
    unreal.LinearColor(0.13, 0.018, 0.15, 1.0),
)


@dataclass(frozen=True)
class CastMember:
    on_air_name: str

    @property
    def asset_name(self) -> str:
        return f"MHC_{self.on_air_name.replace(' ', '')}"


CAST = tuple(
    CastMember(name)
    for name in (
        "Elena Riva",
        "Lorenzo Vitale",
        "Giulia Ferri",
        "Marco Bellini",
        "Sofia Greco",
    )
)


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_PRODUCTION_STAGE: {message}")


def find_blueprint_class(member: CastMember) -> type:
    folder = (
        f"{HERO_ROOT}/{member.asset_name}"
        if member.on_air_name == "Marco Bellini"
        else f"{GENERATED_ROOT}/{member.asset_name}"
    )
    assets = unreal.EditorAssetLibrary.list_assets(
        folder,
        recursive=True,
        include_folder=False,
    )
    candidates: list[tuple[int, str, type]] = []
    for object_path in assets:
        package_path = object_path.split(".", 1)[0]
        blueprint_class = unreal.EditorAssetLibrary.load_blueprint_class(package_path)
        if blueprint_class is None:
            continue
        leaf = package_path.rsplit("/", 1)[-1]
        score = 0
        if leaf == member.asset_name:
            score += 100
        if leaf == f"BP_{member.asset_name}":
            score += 120
        if member.asset_name.lower() in leaf.lower():
            score += 40
        candidates.append((score, package_path, blueprint_class))

    if not candidates:
        raise RuntimeError(f"No assembled blueprint found below {folder}")
    _, package_path, blueprint_class = max(candidates, key=lambda value: value[0])
    log(f"BLUEPRINT name={member.on_air_name} path={package_path}")
    return blueprint_class


def clear_cast() -> None:
    actors = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).get_all_level_actors()
    for actor in actors:
        if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}:
            unreal.get_editor_subsystem(
                unreal.EditorActorSubsystem
            ).destroy_actor(actor)


def apply_broadcast_idle(actor: unreal.Actor, index: int) -> str:
    animation = unreal.load_asset(IDLE_PATH)
    if not isinstance(animation, unreal.AnimSequence):
        raise RuntimeError(f"Missing broadcast idle: {IDLE_PATH}")

    candidates: list[tuple[unreal.SkeletalMeshComponent, str]] = []
    for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
        mesh = component.get_skeletal_mesh_asset()
        if mesh is None:
            continue
        candidates.append((component, mesh.get_path_name()))

    body = next(
        (
            component
            for component, path in candidates
            if "body" in path.lower() and "face" not in path.lower()
        ),
        None,
    )
    if body is None:
        raise RuntimeError(
            "Could not identify production body component; meshes="
            + ",".join(path for _, path in candidates)
        )

    animation_duration = max(0.1, float(animation.get_play_length()))
    start_position = (index * 7.13) % animation_duration
    play_rate = 0.94 + (index % 3) * 0.04
    animated_components = 0
    for component, mesh_path in candidates:
        if "face" in mesh_path.casefold() or component.get_name().casefold() == "face":
            continue
        try:
            component.override_animation_data(
                animation,
                True,
                True,
                start_position,
                play_rate,
            )
            animated_components += 1
        except Exception as error:
            log(f"POSE_SKIP mesh={mesh_path} error={error}")
    if animated_components == 0:
        raise RuntimeError("No production body or wardrobe accepted the seated pose")
    log(f"POSE_APPLIED seat={index + 1} components={animated_components}")
    return body.get_skeletal_mesh_asset().get_path_name()


def color_wardrobe(actor: unreal.Actor, index: int) -> None:
    wardrobe = next(
        (
            component
            for component in actor.get_components_by_class(
                unreal.SkeletalMeshComponent
            )
            if component.get_name() == "SkeletalMesh"
        ),
        None,
    )
    if wardrobe is None:
        raise RuntimeError(f"Wardrobe component missing for seat {index + 1}")

    color = WARDROBE_COLORS[index]
    updated: set[str] = set()
    for material in wardrobe.get_materials():
        if not isinstance(material, unreal.MaterialInstanceConstant):
            continue
        path = material.get_path_name()
        if path in updated:
            continue
        updated.add(path)
        for parameter in (
            "C_color",
            "diffuse_color_1",
            "diffuse_color_2",
            "B_diffuse_color_1",
        ):
            unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(
                material,
                parameter,
                color,
            )
        unreal.MaterialEditingLibrary.update_material_instance(material)
        unreal.EditorAssetLibrary.save_loaded_asset(
            material,
            only_if_is_dirty=False,
        )
    log(
        f"WARDROBE seat={index + 1} "
        f"color=({color.r:.3f},{color.g:.3f},{color.b:.3f})"
    )


def place_member(member: CastMember, index: int, blueprint_class: type) -> None:
    actor = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).spawn_actor_from_class(
        blueprint_class,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
    )
    if actor is None:
        raise RuntimeError(f"Could not spawn {member.on_air_name}")

    actor.set_actor_label(f"CAST_{index + 1}_{member.asset_name}")
    actor.tags = [
        unreal.Name("ConclaviaProductionCast"),
        unreal.Name(f"Seat{index + 1}"),
        unreal.Name(f"Participant{index + 1}"),
    ]
    body_mesh = apply_broadcast_idle(actor, index)
    color_wardrobe(actor, index)
    bounds_origin, bounds_extent = actor.get_actor_bounds(False)
    desired_origin = unreal.Vector(
        SEAT_X[index],
        SEAT_Y[index],
        max(94.0, bounds_extent.z + 4.0),
    )
    correction = unreal.MathLibrary.subtract_vector_vector(
        desired_origin,
        bounds_origin,
    )
    actor.set_actor_location(correction, False, False)
    log(
        f"STAGED seat={index + 1} name={member.on_air_name} "
        f"body={body_mesh} "
        f"extent=({bounds_extent.x:.1f},{bounds_extent.y:.1f},{bounds_extent.z:.1f})"
    )


def tune_close_cameras() -> None:
    actors = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).get_all_level_actors()
    by_label = {actor.get_actor_label(): actor for actor in actors}
    for index, (seat_x, seat_y) in enumerate(zip(SEAT_X, SEAT_Y), start=1):
        label = f"CAM_Seat_{index}_Close"
        camera = by_label.get(label)
        if not isinstance(camera, unreal.CineCameraActor):
            raise RuntimeError(f"Missing production close camera: {label}")
        component = camera.get_cine_camera_component()
        # True head-and-shoulders portrait. The old 500 cm camera compressed
        # the face into a medium shot, hiding the 8K Cinematic skin textures.
        side_offset = 28.0 if index <= 3 else -28.0
        location = unreal.Vector(-220.0, seat_y + side_offset, 174.0)
        face_target = unreal.Vector(seat_x, seat_y, FACE_Z)
        camera.set_actor_location(location, False, False)
        camera.set_actor_rotation(
            unreal.MathLibrary.find_look_at_rotation(location, face_target),
            False,
        )
        component.set_editor_property("current_focal_length", 100.0)
        # Keep the full face inside the sharp plane. A wider f/3.2 looked
        # cinematic at a glance but softened the micro-normal skin detail.
        component.set_editor_property("current_aperture", 4.0)
        delta_x = location.x - seat_x
        delta_y = location.y - seat_y
        delta_z = location.z - FACE_Z
        focus_distance = (delta_x * delta_x + delta_y * delta_y + delta_z * delta_z) ** 0.5
        focus = component.get_editor_property("focus_settings")
        focus.set_editor_property("focus_method", unreal.CameraFocusMethod.MANUAL)
        focus.set_editor_property("manual_focus_distance", focus_distance)
        component.set_editor_property("focus_settings", focus)
        log(
            f"CAMERA label={label} focus={focus_distance:.1f} "
            "focal=100.0 aperture=4.0"
        )


def stage_level(level_path: str, classes: tuple[type, ...]) -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(level_path):
        raise RuntimeError(f"Could not load {level_path}")
    clear_cast()
    for index, (member, blueprint_class) in enumerate(zip(CAST, classes)):
        place_member(member, index, blueprint_class)
    tune_close_cameras()

    world = unreal.get_editor_subsystem(
        unreal.UnrealEditorSubsystem
    ).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, level_path):
        raise RuntimeError(f"Could not save staged map {level_path}")
    log(f"MAP_READY path={level_path} cast=5")


def main() -> None:
    classes = tuple(find_blueprint_class(member) for member in CAST)
    stage_level(POP_LEVEL, classes)
    stage_level(EDITORIAL_LEVEL, classes)
    log("READY maps=2 cast=5")


if __name__ == "__main__":
    main()
