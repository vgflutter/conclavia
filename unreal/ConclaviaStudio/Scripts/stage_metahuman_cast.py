"""Stage the five local UE 5.8 MetaHuman presets in Conclavia's studio.

The presets bundled with the MetaHuman Character plugin can be assembled for
editor preview without Fab downloads.  Keeping the characters open for the
duration of the editor session preserves the generated face, body, wardrobe
and groom graph and lets the POC exercise the real cast while the production
assets are still being acquired.
"""

from __future__ import annotations

import os

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"
CAST_ROOT = "/Game/Conclavia/Cast"
CAST_PRESETS = ("Ada", "Lorenzo", "Aera", "Omari", "Vivian")
POSE_PATHS = (
    "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle",
    "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle",
    "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle",
    "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle",
    "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle",
)
SEAT_Y = (-420.0, -210.0, 0.0, 210.0, 420.0)
SEAT_X = (52.0, 30.0, 22.0, 30.0, 52.0)
LIGHT_INTENSITIES = {
    "LIGHT_Key": 245.0,
    "LIGHT_Fill": 82.0,
    "LIGHT_Rim": 145.0,
}


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_METAHUMAN_STAGE: {message}")


def clear_previous_cast() -> None:
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in actor_subsystem.get_all_level_actors():
        if actor.get_actor_label().startswith("MHC_STAGE_"):
            actor_subsystem.destroy_actor(actor)


def tune_studio_lighting() -> None:
    for actor in unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).get_all_level_actors():
        label = actor.get_actor_label()
        if label in LIGHT_INTENSITIES:
            component = actor.get_component_by_class(unreal.RectLightComponent)
            if component:
                component.set_editor_property(
                    "intensity", LIGHT_INTENSITIES[label]
                )
        elif label == "LIGHT_Ambient":
            component = actor.get_component_by_class(unreal.SkyLightComponent)
            if component:
                component.set_editor_property("intensity", 0.28)


def apply_diagnostic_pose(actor: unreal.Actor, index: int) -> str:
    animation = unreal.load_asset(POSE_PATHS[index])
    if not isinstance(animation, unreal.AnimSequence):
        raise RuntimeError(f"Missing diagnostic pose: {POSE_PATHS[index]}")

    candidates: list[tuple[unreal.SkeletalMeshComponent, str]] = []
    for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
        mesh = component.get_skeletal_mesh_asset()
        if mesh is None:
            continue
        mesh_path = mesh.get_path_name()
        candidates.append((component, mesh_path))

    body = next(
        (
            component
            for component, mesh_path in candidates
            if "body" in mesh_path.lower() and "face" not in mesh_path.lower()
        ),
        None,
    )
    if body is None:
        meshes = ",".join(path for _, path in candidates)
        raise RuntimeError(f"Could not find body component; meshes={meshes}")

    start_position = (index * 0.73) % 4.0
    play_rate = 0.94 + (index % 3) * 0.04
    animated_components = 0
    for component, mesh_path in candidates:
        if "face" in mesh_path.lower():
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
            log(f"pose-skip mesh={mesh_path} error={error}")
    if animated_components == 0:
        raise RuntimeError("No body or wardrobe components accepted the seated pose")
    log(f"pose-applied components={animated_components}")
    return body.get_skeletal_mesh_asset().get_path_name()


def stage_character(
    subsystem: unreal.MetaHumanCharacterEditorSubsystem,
    name: str,
    index: int,
) -> unreal.Actor:
    path = f"{CAST_ROOT}/MHC_{name}.MHC_{name}"
    character = unreal.load_asset(path)
    if not isinstance(character, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Missing local MetaHuman character: {path}")

    if not subsystem.try_add_object_to_edit(character=character):
        raise RuntimeError(f"Could not open MHC_{name} for preview")

    subsystem.assemble_for_preview(character=character)
    actor = subsystem.spawn_meta_human_actor(
        character=character,
        keep_transient=False,
    )
    if actor is None:
        raise RuntimeError(f"Could not spawn MHC_{name}")

    actor.set_actor_label(f"MHC_STAGE_{index + 1}_{name}")
    actor.tags = [
        unreal.Name("ConclaviaCast"),
        unreal.Name(f"Seat{index + 1}"),
        unreal.Name(f"MetaHuman{name}"),
    ]
    # The preview pipeline keeps the outfit in a separate Chaos cloth
    # component. Overriding only the body animation makes the body move through
    # that garment and creates the torn-shirt artefacts seen in close-ups. Keep
    # the complete preview assembly in its coherent reference pose unless a
    # diagnostic explicitly opts into the seated animation. Production
    # assemblies drive body and cloth together and do not need this workaround.
    seated_preview = os.environ.get("CONCLAVIA_PREVIEW_SEATED", "0") == "1"
    if seated_preview:
        body_mesh = apply_diagnostic_pose(actor, index)
        pose_label = POSE_PATHS[index]
    else:
        body = next(
            (
                component.get_skeletal_mesh_asset()
                for component in actor.get_components_by_class(
                    unreal.SkeletalMeshComponent
                )
                if component.get_skeletal_mesh_asset() is not None
                and "body" in component.get_skeletal_mesh_asset().get_path_name().lower()
                and "face" not in component.get_skeletal_mesh_asset().get_path_name().lower()
            ),
            None,
        )
        body_mesh = body.get_path_name() if body is not None else "preview-body"
        pose_label = "coherent-reference-pose"
    # Preview pipeline actors have identity-dependent component offsets.  Seat
    # their rendered bounds rather than their blueprint root; otherwise a turn
    # rotates the person around an invisible pivot and makes the cast drift out
    # of its chairs.
    actor.set_actor_rotation(
        # The UE 5.8 MetaHuman preview pipeline is authored facing +Y.  A
        # +90-degree root turn faces the broadcast cameras on the -X axis.
        unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
        False,
    )
    actor.set_actor_location(unreal.Vector(0.0, 0.0, 0.0), False, False)
    bounds_origin, bounds_extent = actor.get_actor_bounds(False)
    desired_origin = unreal.Vector(
        SEAT_X[index],
        SEAT_Y[index],
        max(94.0, bounds_extent.z + 2.0),
    )
    correction = unreal.MathLibrary.subtract_vector_vector(
        desired_origin,
        bounds_origin,
    )
    actor.set_actor_location(correction, False, False)
    log(
        f"seat={index + 1} name={name} "
        f"class={actor.get_class().get_path_name()} "
        f"pose={pose_label} body={body_mesh} "
        f"components={len(actor.get_components_by_class(unreal.ActorComponent))} "
        f"bounds_extent=({bounds_extent.x:.1f},{bounds_extent.y:.1f},{bounds_extent.z:.1f})"
    )
    return actor


def frame_preview_camera() -> str:
    camera_label = os.environ.get(
        "CONCLAVIA_PREVIEW_CAMERA",
        "CAM_Wide_Master",
    )
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    camera = next(
        (
            actor
            for actor in actor_subsystem.get_all_level_actors()
            if actor.get_actor_label() == camera_label
        ),
        None,
    )
    if not isinstance(camera, unreal.CineCameraActor):
        raise RuntimeError(f"Preview camera not found: {camera_label}")

    # The studio cameras are authored for seated runtime characters. The local
    # editor-preview assembly has a taller neutral pose, so the same 72 mm lens
    # exposes the whole diagnostic body and its low-quality preview garment.
    # A true podcast close-up should read as head-and-shoulders and keep the
    # audience's attention on the face.
    if camera_label.endswith("_Close"):
        component = camera.get_cine_camera_component()
        component.set_editor_property("current_focal_length", 165.0)
        component.set_editor_property("current_aperture", 4.0)

    editor_subsystem = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    editor_subsystem.set_level_viewport_camera_info(
        camera.get_actor_location(),
        camera.get_actor_rotation(),
    )
    return camera_label


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load studio level: {LEVEL_PATH}")

    clear_previous_cast()
    tune_studio_lighting()
    subsystem = unreal.get_editor_subsystem(
        unreal.MetaHumanCharacterEditorSubsystem
    )

    for index, name in enumerate(CAST_PRESETS):
        stage_character(subsystem, name, index)

    world = unreal.get_editor_subsystem(
        unreal.UnrealEditorSubsystem
    ).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, LEVEL_PATH):
        raise RuntimeError("Could not save staged MetaHuman cast")

    camera_label = frame_preview_camera()
    log(f"READY cast=5 camera={camera_label}")
    unreal.SystemLibrary.execute_console_command(
        world_context_object=world,
        command="Conclavia.StartEditorStream",
    )


main()
