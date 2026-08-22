"""Tune the assembled Cinematic cast for a live podcast close-up.

This pass intentionally changes persistent MetaHuman material instances rather
than applying a screen-space sharpening filter.  It restores pore-scale normal
detail, tempers the broad plastic highlight, removes the preset cloudy-eye
override and gives every seat a restrained portrait catchlight.  The same
lookdev is applied to both the pop and editorial studios.
"""

from __future__ import annotations

from typing import Any

import unreal


LEVELS = (
    "/Game/Conclavia/Studio/L_PremiumStudio",
    "/Game/Conclavia/Studio/L_EditorialStudio",
)
SEAT_Y = (-272.0, -136.0, 0.0, 136.0, 272.0)
FACE_X = (62.0, 28.0, 18.0, 28.0, 62.0)
FACE_Z = 162.0


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_LOOKDEV: {message}")


def property_value(value: Any, name: str, default: Any = None) -> Any:
    try:
        return value.get_editor_property(name)
    except Exception:
        return default


def persistent_material(material: Any) -> unreal.MaterialInstanceConstant | None:
    """Resolve a level MID back to its per-character persistent instance."""
    current = material
    visited: set[str] = set()
    while current is not None:
        try:
            current_path = current.get_path_name()
        except Exception:
            current_path = str(id(current))
        if current_path in visited:
            return None
        visited.add(current_path)
        if isinstance(current, unreal.MaterialInstanceConstant):
            return current
        current = property_value(current, "parent")
    return None


def scalar_names(material: unreal.MaterialInstanceConstant) -> set[str]:
    try:
        return {
            str(name)
            for name in unreal.MaterialEditingLibrary.get_scalar_parameter_names(
                material
            )
        }
    except Exception:
        return set()


def set_scalars(
    material: unreal.MaterialInstanceConstant,
    values: dict[str, float],
) -> list[str]:
    available = scalar_names(material)
    changed = []
    for name, value in values.items():
        if name not in available:
            continue
        unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(
            material,
            name,
            value,
        )
        changed.append(f"{name}={value:.3f}")
    if changed:
        unreal.MaterialEditingLibrary.update_material_instance(material)
        unreal.EditorAssetLibrary.save_loaded_asset(
            material,
            only_if_is_dirty=False,
        )
    return changed


def tune_face(actor: unreal.Actor) -> None:
    face = next(
        (
            component
            for component in actor.get_components_by_class(
                unreal.SkeletalMeshComponent
            )
            if component.get_name() == "Face"
        ),
        None,
    )
    if face is None:
        raise RuntimeError(f"Face component missing on {actor.get_actor_label()}")

    # USkinnedMeshComponent uses 1 for rendered LOD 0. Keep both the face and
    # LODSync floor on the maximum-quality cinematic asset.
    face.set_editor_property("forced_lod_model", 1)
    face.set_editor_property("min_lod_model", 0)
    face.set_editor_property("enable_update_rate_optimizations", False)

    changed_assets: set[str] = set()
    for slot_index, material in enumerate(face.get_materials()):
        persistent = persistent_material(material)
        if persistent is None:
            continue
        asset_path = persistent.get_path_name()
        if asset_path in changed_assets:
            continue
        changed_assets.add(asset_path)

        lowered = asset_path.casefold()
        changes: list[str] = []
        if "face_skin_baked_lod0" in lowered:
            # The generated neutral defaults are deliberately soft. Preserve
            # SSS, but recover the pore normal and break up the broad specular
            # highlight that made the face read like wax in the live encode.
            changes = set_scalars(
                persistent,
                {
                    "Micro Skin Normal Strength": 1.08,
                    "Micro Skin Cavity Specular Multiply": 0.78,
                    "Roughness Adjust": 1.12,
                    "Spec Adjust": 0.80,
                },
            )
        elif "eye" in lowered and "eyelash" not in lowered:
            # All five presets carried Cloudy Eye Intensity=2 on the left eye,
            # which is inappropriate for a healthy studio cast and removed
            # contrast from the iris. Keep the procedural eye shader, but use
            # restrained saturation and a readable broadcast-size pupil.
            changes = set_scalars(
                persistent,
                {
                    "Cloudy Eye Intensity": 0.0,
                    "Iris Global Saturation": 1.25,
                    "Pupil Dilation": 0.82,
                    "Sclera Irritation Veins Opacity": 0.24,
                },
            )
        if changes:
            log(
                f"MATERIAL actor={actor.get_actor_label()} slot={slot_index} "
                f"asset={asset_path} values={';'.join(changes)}"
            )


def actor_by_label(label: str) -> unreal.Actor | None:
    return next(
        (
            actor
            for actor in unreal.get_editor_subsystem(
                unreal.EditorActorSubsystem
            ).get_all_level_actors()
            if actor.get_actor_label() == label
        ),
        None,
    )


def tune_rect_light(
    label: str,
    *,
    intensity: float,
    width: float,
    height: float,
) -> None:
    actor = actor_by_label(label)
    if not isinstance(actor, unreal.RectLight):
        raise RuntimeError(f"Missing studio light {label}")
    component = actor.get_component_by_class(unreal.RectLightComponent)
    component.set_editor_property("intensity", intensity)
    component.set_editor_property("source_width", width)
    component.set_editor_property("source_height", height)


def ensure_portrait_light(index: int, editorial: bool) -> None:
    label = f"LIGHT_Portrait_{index + 1}"
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = actor_by_label(label)
    if actor is None:
        actor = subsystem.spawn_actor_from_class(
            unreal.RectLight,
            unreal.Vector(-175.0, SEAT_Y[index] - 74.0, 232.0),
        )
        if actor is None:
            raise RuntimeError(f"Could not create {label}")
        actor.set_actor_label(label)
    if not isinstance(actor, unreal.RectLight):
        raise RuntimeError(f"Wrong actor type for {label}")

    target = unreal.Vector(FACE_X[index], SEAT_Y[index], FACE_Z)
    actor.set_actor_rotation(
        unreal.MathLibrary.find_look_at_rotation(actor.get_actor_location(), target),
        False,
    )
    actor.tags = [unreal.Name("ConclaviaPortraitLight"), unreal.Name(label)]
    component = actor.get_component_by_class(unreal.RectLightComponent)
    # This is a catchlight, not a second frontal key. Higher values erased the
    # cheek and eye-socket modelling once the frame passed through H.264.
    component.set_editor_property("intensity", 6.0 if editorial else 7.0)
    component.set_editor_property("source_width", 44.0)
    component.set_editor_property("source_height", 20.0)
    component.set_editor_property("attenuation_radius", 260.0)
    component.set_editor_property("barn_door_angle", 50.0)
    component.set_editor_property("barn_door_length", 65.0)
    component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    component.set_editor_property(
        "light_color",
        unreal.LinearColor(1.0, 0.90, 0.82, 1.0).to_color(True),
    )


def tune_level(level_path: str) -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(level_path):
        raise RuntimeError(f"Could not load {level_path}")
    editorial = "Editorial" in level_path
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
    if len(cast) != 5:
        raise RuntimeError(f"Expected five cast members, found {len(cast)}")
    for actor in cast:
        tune_face(actor)

    # Close cameras keep a flattering long-lens perspective, but the earlier
    # 222 cm working distance produced a face-only technical test.
    # A podcast portrait needs enough torso and wardrobe to feel like a person
    # in a set while still preserving the LOD-0 skin detail.
    by_label = {actor.get_actor_label(): actor for actor in actors}

    # The original master was framed like a virtual-stage tech demo: excessive
    # floor, full legs and too much empty headroom. Crop it as an ensemble
    # podcast frame, with the desk hiding the lower body and the faces occupying
    # enough of a 1080p output to remain readable.
    master = by_label.get("CAM_Wide_Master")
    if not isinstance(master, unreal.CineCameraActor):
        raise RuntimeError("Missing CAM_Wide_Master")
    master_location = unreal.Vector(-735.0, 0.0, 202.0)
    master_target = unreal.Vector(40.0, 0.0, 168.0)
    master.set_actor_location(master_location, False, False)
    master.set_actor_rotation(
        unreal.MathLibrary.find_look_at_rotation(master_location, master_target),
        False,
    )
    master_cine = master.get_cine_camera_component()
    master_cine.set_editor_property("current_focal_length", 42.0)
    master_cine.set_editor_property("current_aperture", 4.8)

    # Give each adjacent pair a real axis-matched two-shot. Reusing a single
    # left/right camera made a 2→3 reply show seats 1→2, which broke both
    # conversational continuity and the promise that the addressee stays on
    # screen.
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for first_seat in range(1, 5):
        second_seat = first_seat + 1
        label = f"CAM_TwoShot_{first_seat}_{second_seat}"
        camera = by_label.get(label)
        if camera is None:
            camera = actor_subsystem.spawn_actor_from_class(
                unreal.CineCameraActor,
                unreal.Vector(),
            )
            if camera is None:
                raise RuntimeError(f"Could not create {label}")
            camera.set_actor_label(label)
        if not isinstance(camera, unreal.CineCameraActor):
            raise RuntimeError(f"Wrong actor type for {label}")
        first_index = first_seat - 1
        second_index = second_seat - 1
        pair_y = (SEAT_Y[first_index] + SEAT_Y[second_index]) * 0.5
        pair_x = (FACE_X[first_index] + FACE_X[second_index]) * 0.5
        side_offset = 20.0 if pair_y <= 0.0 else -20.0
        location = unreal.Vector(-470.0, pair_y + side_offset, 181.0)
        target = unreal.Vector(pair_x, pair_y, 158.0)
        camera.set_actor_location(location, False, False)
        camera.set_actor_rotation(
            unreal.MathLibrary.find_look_at_rotation(location, target),
            False,
        )
        camera.tags = [unreal.Name("ConclaviaCamera"), unreal.Name(label)]
        cine = camera.get_cine_camera_component()
        filmback = cine.get_editor_property("filmback")
        filmback.set_editor_property("sensor_width", 36.0)
        filmback.set_editor_property("sensor_height", 20.25)
        cine.set_editor_property("filmback", filmback)
        cine.set_editor_property("current_focal_length", 68.0)
        cine.set_editor_property("current_aperture", 4.5)
        focus = cine.get_editor_property("focus_settings")
        focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
        cine.set_editor_property("focus_settings", focus)

    for index, (face_x, face_y) in enumerate(zip(FACE_X, SEAT_Y), start=1):
        camera = by_label.get(f"CAM_Seat_{index}_Close")
        if not isinstance(camera, unreal.CineCameraActor):
            raise RuntimeError(f"Missing close camera for seat {index}")
        side_offset = 42.0 if index <= 3 else -42.0
        location = unreal.Vector(-270.0, face_y + side_offset, 174.0)
        target = unreal.Vector(face_x, face_y, 158.0)
        camera.set_actor_location(location, False, False)
        camera.set_actor_rotation(
            unreal.MathLibrary.find_look_at_rotation(location, target),
            False,
        )
        cine = camera.get_cine_camera_component()
        cine.set_editor_property("current_focal_length", 96.0)
        cine.set_editor_property("current_aperture", 4.2)
        delta = unreal.MathLibrary.subtract_vector_vector(location, target)
        distance = (
            delta.x * delta.x + delta.y * delta.y + delta.z * delta.z
        ) ** 0.5
        focus = cine.get_editor_property("focus_settings")
        focus.set_editor_property("focus_method", unreal.CameraFocusMethod.MANUAL)
        focus.set_editor_property("manual_focus_distance", distance)
        cine.set_editor_property("focus_settings", focus)

    # Narrower sources and a much lower fill preserve cheek and eye-socket
    # modelling. Individual low-power eye-line lights add catchlights without
    # flattening the ensemble master shot.
    tune_rect_light("LIGHT_Key", intensity=118.0, width=230.0, height=150.0)
    tune_rect_light("LIGHT_Fill", intensity=13.0, width=360.0, height=220.0)
    tune_rect_light("LIGHT_Rim", intensity=82.0, width=270.0, height=160.0)
    ambient = by_label.get("LIGHT_Ambient")
    if isinstance(ambient, unreal.SkyLight):
        ambient_component = ambient.get_component_by_class(unreal.SkyLightComponent)
        ambient_component.set_editor_property("intensity", 0.16)
    for index in range(5):
        ensure_portrait_light(index, editorial)

    world = unreal.get_editor_subsystem(
        unreal.UnrealEditorSubsystem
    ).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, level_path):
        raise RuntimeError(f"Could not save tuned map {level_path}")
    log(f"MAP_READY path={level_path} portraitLights=5")


def main() -> None:
    for level_path in LEVELS:
        tune_level(level_path)
    unreal.EditorAssetLibrary.save_directory(
        "/Game/Conclavia/Production",
        only_if_is_dirty=False,
        recursive=True,
    )
    log("READY maps=2 skin=Cinematic eyes=healthy portraitLights=10")


if __name__ == "__main__":
    main()
