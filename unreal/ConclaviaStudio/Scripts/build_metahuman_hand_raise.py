"""Author a solver-driven seated hand raise with Epic's MetaHuman Control Rig.

The source seated idle is first loaded into the rig through its Backwards Solve
graph.  Only MetaHuman controls are keyed afterwards; no bone rotations are
authored by this script.  The exported animation contains a raise, a stable
hold and a lower segment so the runtime can pause while waiting for permission.
"""

from __future__ import annotations

import math

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"
SOURCE_IDLE_PATH = "/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle"
CONTROL_RIG_PATH = "/Game/MetaHumans/Common/Common/MetaHuman_ControlRig"
OUTPUT_ROOT = "/Game/Conclavia/Studio/Animations"
OUTPUT_NAME = "AS_Conclavia_MetaHumanHandRaise"
OUTPUT_PATH = f"{OUTPUT_ROOT}/{OUTPUT_NAME}"
TEMP_SEQUENCE_NAME = "LS_Conclavia_MetaHumanHandRaise_Source"
TEMP_SEQUENCE_PATH = f"{OUTPUT_ROOT}/{TEMP_SEQUENCE_NAME}"

FPS = 30
START_FRAME = 0
RAISE_START_FRAME = 12
RAISE_END_FRAME = 48
HOLD_FRAME = 72
LOWER_START_FRAME = 105
END_FRAME = 141


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_HAND_RAISE: {message}")


def asset_tools() -> unreal.AssetTools:
    return unreal.AssetToolsHelpers.get_asset_tools()


def find_body_component() -> unreal.SkeletalMeshComponent:
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    ranked: list[tuple[int, unreal.SkeletalMeshComponent]] = []
    for actor in actor_subsystem.get_all_level_actors():
        tags = {str(tag) for tag in actor.tags}
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            if component.get_name() != "Body":
                continue
            mesh = component.get_skeletal_mesh_asset()
            if not isinstance(mesh, unreal.SkeletalMesh):
                continue
            score = 100 if "ConclaviaProductionCast" in tags else 0
            score += 20 if "aera" in actor.get_actor_label().casefold() else 0
            ranked.append((score, component))
    if not ranked:
        raise RuntimeError("No staged MetaHuman body component was found")
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1]


def recreate_asset(path: str, name: str, asset_class: type, factory: object):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        if not unreal.EditorAssetLibrary.delete_asset(path):
            raise RuntimeError(f"Could not replace {path}")
    asset = asset_tools().create_asset(name, OUTPUT_ROOT, asset_class, factory)
    if asset is None:
        raise RuntimeError(f"Could not create {path}")
    return asset


def frame(value: int) -> unreal.FrameNumber:
    return unreal.FrameNumber(value=value)


def control_channels(section) -> dict[str, object]:
    result: dict[str, object] = {}
    for channel in section.get_all_channels():
        name = str(channel.get_name())
        result[name] = channel
    return result


def find_control_channel(channels: dict[str, object], name: str):
    channel = channels.get(name)
    if channel is not None:
        return channel
    return next(
        (
            candidate
            for candidate_name, candidate in channels.items()
            if candidate_name.startswith(name + "_")
        ),
        None,
    )


def replace_channel_key(channel, at: int, value) -> None:
    for existing in channel.get_keys():
        if existing.get_time().frame_number.value == at:
            existing.set_value(value)
            return
    channel.add_key(frame(at), value)


def key_bool_channel(
    channels: dict[str, object],
    control: str,
    at: int,
    value: bool,
) -> None:
    channel = find_control_channel(channels, control)
    if channel is None:
        raise RuntimeError(f"Missing Control Rig channel: {control}")
    replace_channel_key(channel, at, value)


def key_euler_channels(
    channels: dict[str, object],
    control: str,
    at: int,
    value: unreal.EulerTransform,
) -> None:
    values = {
        "Location.X": value.location.x,
        "Location.Y": value.location.y,
        "Location.Z": value.location.z,
        "Rotation.X": value.rotation.roll,
        "Rotation.Y": value.rotation.pitch,
        "Rotation.Z": value.rotation.yaw,
        "Scale.X": value.scale.x,
        "Scale.Y": value.scale.y,
        "Scale.Z": value.scale.z,
    }
    missing: list[str] = []
    for suffix, channel_value in values.items():
        name = f"{control}.{suffix}"
        channel = find_control_channel(channels, name)
        if channel is None:
            missing.append(name)
            continue
        replace_channel_key(channel, at, channel_value)
    if missing:
        raise RuntimeError("Missing Control Rig channels: " + ", ".join(missing))


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - (2.0 * value))


def lerp_world_transform(
    start: unreal.Transform,
    end: unreal.Transform,
    alpha: float,
) -> unreal.Transform:
    result = unreal.Transform()
    result.translation = unreal.Vector(
        start.translation.x + ((end.translation.x - start.translation.x) * alpha),
        start.translation.y + ((end.translation.y - start.translation.y) * alpha),
        start.translation.z + ((end.translation.z - start.translation.z) * alpha),
    )
    result.rotation = start.rotation.slerp_quat(end.rotation, alpha)
    result.scale3d = unreal.Vector(start.scale3d.x, start.scale3d.y, start.scale3d.z)
    return result


def build() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load map: {LEVEL_PATH}")

    source_idle = unreal.load_asset(SOURCE_IDLE_PATH)
    rig_asset = unreal.load_asset(CONTROL_RIG_PATH)
    if not isinstance(source_idle, unreal.AnimSequence):
        raise RuntimeError(f"Missing source idle: {SOURCE_IDLE_PATH}")
    if rig_asset is None or not hasattr(rig_asset, "get_control_rig_class"):
        raise RuntimeError(f"Missing MetaHuman Control Rig: {CONTROL_RIG_PATH}")

    body_component = find_body_component()
    body_mesh = body_component.get_skeletal_mesh_asset()
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    temporary_actor = actor_subsystem.spawn_actor_from_class(
        unreal.SkeletalMeshActor,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if not isinstance(temporary_actor, unreal.SkeletalMeshActor):
        raise RuntimeError("Could not spawn the Control Rig authoring actor")
    temporary_actor.set_actor_label("TMP_Conclavia_MetaHumanHandRaise")
    temporary_actor.skeletal_mesh_component.set_skeletal_mesh(body_mesh)
    body_component = temporary_actor.skeletal_mesh_component
    level_sequence = recreate_asset(
        TEMP_SEQUENCE_PATH,
        TEMP_SEQUENCE_NAME,
        unreal.LevelSequence,
        unreal.LevelSequenceFactoryNew(),
    )
    level_sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    level_sequence.set_tick_resolution_directly(unreal.FrameRate(FPS, 1))
    level_sequence.set_playback_start(START_FRAME)
    level_sequence.set_playback_end(END_FRAME)
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(level_sequence)

    binding = level_sequence.add_possessable(temporary_actor)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rig_track = unreal.ControlRigSequencerLibrary.find_or_create_control_rig_track(
        world,
        level_sequence,
        rig_asset.get_control_rig_class(),
        binding,
        is_layered_control_rig=False,
    )
    if rig_track is None:
        raise RuntimeError("Could not create the MetaHuman Control Rig track")
    rig_proxies = unreal.ControlRigSequencerLibrary.get_control_rigs(level_sequence)
    if not rig_proxies:
        raise RuntimeError("The MetaHuman Control Rig did not initialize")
    rig = rig_proxies[0].control_rig
    section = rig_track.get_section_to_key()
    hierarchy = rig.get_hierarchy()
    for control_name in (
        "hand_r_ik_ctrl",
        "arm_r_pv_ik_ctrl",
        "arm_r_fk_ik_switch",
    ):
        key = unreal.RigElementKey(
            type=unreal.RigElementType.CONTROL,
            name=control_name,
        )
        settings = hierarchy.get_control_settings(key)
        log(f"CONTROL name={control_name} type={settings.control_type}")

    loaded = unreal.ControlRigSequencerLibrary.load_anim_sequence_into_control_rig_section(
        section,
        source_idle,
        body_component,
        frame(START_FRAME),
        reset_controls=True,
    )
    if not loaded:
        raise RuntimeError("MetaHuman Backwards Solve could not load the seated idle")
    channels = control_channels(section)
    interesting_channels = sorted(
        name
        for name in channels
        if any(
            control in name
            for control in (
                "hand_r_ik_ctrl",
                "arm_r_pv_ik_ctrl",
                "arm_r_fk_ik_switch",
            )
        )
    )
    log("CHANNELS " + ",".join(interesting_channels))

    hand_control = "hand_r_ik_ctrl"
    pole_control = "arm_r_pv_ik_ctrl"
    switch_control = "arm_r_fk_ik_switch"
    base_hand = unreal.ControlRigSequencerLibrary.get_local_control_rig_euler_transform(
        level_sequence,
        rig,
        hand_control,
        frame(RAISE_START_FRAME),
    )
    base_pole = unreal.ControlRigSequencerLibrary.get_local_control_rig_euler_transform(
        level_sequence,
        rig,
        pole_control,
        frame(RAISE_START_FRAME),
    )
    base_switch = unreal.ControlRigSequencerLibrary.get_local_control_rig_bool(
        level_sequence,
        rig,
        switch_control,
        frame(RAISE_START_FRAME),
    )
    base_hand_world = unreal.ControlRigSequencerLibrary.get_control_rig_world_transform(
        level_sequence,
        rig,
        hand_control,
        frame(RAISE_START_FRAME),
    )
    pose_options = unreal.AnimPoseEvaluationOptions()
    pose_options.set_editor_property("should_retarget", True)
    reference_pose = source_idle.get_anim_pose_at_time(
        RAISE_START_FRAME / FPS,
        pose_options,
    )
    head_pose = reference_pose.get_bone_pose("head", unreal.AnimPoseSpaces.WORLD)
    upperarm_pose = reference_pose.get_bone_pose(
        "upperarm_r",
        unreal.AnimPoseSpaces.WORLD,
    )
    side_x = upperarm_pose.translation.x - head_pose.translation.x
    side_y = upperarm_pose.translation.y - head_pose.translation.y
    side_length = max(math.sqrt((side_x * side_x) + (side_y * side_y)), 0.001)
    side_x /= side_length
    side_y /= side_length
    # The backwards-solved technical idle is on the FK side.  Switch to the
    # matching IK pose at the beginning of the gesture, then animate the hand
    # target and pole vector through Epic's MetaHuman solver.
    raised_switch = not base_switch
    raised_hand_world = unreal.Transform()
    raised_hand_world.translation = unreal.Vector(
        head_pose.translation.x + (side_x * 26.0),
        head_pose.translation.y + (side_y * 26.0),
        # Wrist just above the head centre keeps the fingertips inside the
        # meeting camera safe area while the raised-hand silhouette stays clear.
        head_pose.translation.z + 8.0,
    )
    # MetaHuman's hand control points opposite the fingers in this solved idle.
    # A half turn around its local palm-normal keeps the palm plane stable while
    # reversing the finger axis from down to up. Slerp below makes it continuous.
    raised_hand_world.rotation = base_hand_world.rotation.multiply(
        unreal.Quat(0.0, 1.0, 0.0, 0.0)
    )
    raised_hand_world.scale3d = unreal.Vector(
        base_hand_world.scale3d.x,
        base_hand_world.scale3d.y,
        base_hand_world.scale3d.z,
    )

    # Backwards Solve bakes a key on every frame. Replace every gesture-frame
    # key instead of laying six sparse keys over the baked idle; leaving the
    # intervening baked keys caused the earlier one-frame shoulder spasms.
    for at in range(START_FRAME, END_FRAME + 1):
        if at <= RAISE_START_FRAME:
            hand_world_value = base_hand_world
        elif at <= RAISE_END_FRAME:
            alpha = smoothstep(
                (at - RAISE_START_FRAME) / (RAISE_END_FRAME - RAISE_START_FRAME)
            )
            hand_world_value = lerp_world_transform(
                base_hand_world,
                raised_hand_world,
                alpha,
            )
        elif at <= LOWER_START_FRAME:
            hand_world_value = raised_hand_world
        else:
            alpha = smoothstep(
                (at - LOWER_START_FRAME) / (END_FRAME - LOWER_START_FRAME)
            )
            hand_world_value = lerp_world_transform(
                raised_hand_world,
                base_hand_world,
                alpha,
            )

        switch_value = (
            raised_switch
            if RAISE_START_FRAME <= at < END_FRAME
            else base_switch
        )
        key_bool_channel(channels, switch_control, at, switch_value)
        unreal.ControlRigSequencerLibrary.set_control_rig_world_transform(
            level_sequence,
            rig,
            hand_control,
            frame(at),
            hand_world_value,
        )
        # Keep a stable backwards-solved pole target. The official two-bone IK
        # solver then chooses a continuous elbow plane while the hand rises.
        key_euler_channels(channels, pole_control, at, base_pole)
    keyed_hand = unreal.ControlRigSequencerLibrary.get_local_control_rig_euler_transform(
        level_sequence,
        rig,
        hand_control,
        frame(HOLD_FRAME),
    )
    keyed_switch = unreal.ControlRigSequencerLibrary.get_local_control_rig_bool(
        level_sequence,
        rig,
        switch_control,
        frame(HOLD_FRAME),
    )
    unreal.LevelSequenceEditorBlueprintLibrary.set_current_time(HOLD_FRAME)
    unreal.LevelSequenceEditorBlueprintLibrary.refresh_current_level_sequence()

    skeleton = source_idle.get_editor_property("skeleton")
    factory = unreal.AnimSequenceFactory()
    factory.target_skeleton = skeleton
    output = recreate_asset(
        OUTPUT_PATH,
        OUTPUT_NAME,
        unreal.AnimSequence,
        factory,
    )
    options = unreal.AnimSeqExportOption()
    options.export_transforms = True
    options.export_morph_targets = False
    options.evaluate_all_skeletal_mesh_components = True
    if not unreal.SequencerTools.export_anim_sequence(
        world,
        level_sequence,
        output,
        options,
        binding,
        False,
    ):
        raise RuntimeError("Sequencer could not export the hand raise animation")

    unreal.EditorAssetLibrary.save_loaded_asset(output, only_if_is_dirty=False)
    unreal.EditorAssetLibrary.save_loaded_asset(level_sequence, only_if_is_dirty=False)
    start_pose = output.get_anim_pose_at_time(0.4, pose_options)
    hold_pose = output.get_anim_pose_at_time(HOLD_FRAME / FPS, pose_options)
    deltas: list[str] = []
    for bone_name in ("clavicle_r", "upperarm_r", "lowerarm_r", "hand_r"):
        start = start_pose.get_bone_pose(bone_name, unreal.AnimPoseSpaces.WORLD)
        hold = hold_pose.get_bone_pose(bone_name, unreal.AnimPoseSpaces.WORLD)
        delta = unreal.MathLibrary.subtract_vector_vector(
            hold.translation,
            start.translation,
        )
        deltas.append(
            f"{bone_name}=({delta.x:.2f},{delta.y:.2f},{delta.z:.2f})"
        )
    log(
        f"READY output={output.get_path_name()} duration={output.get_play_length():.3f} "
        f"body_mesh={body_mesh.get_path_name()} source={SOURCE_IDLE_PATH} "
        f"rig={CONTROL_RIG_PATH} switch_base={base_switch} "
        f"switch_raised={raised_switch} keyed_switch={keyed_switch} "
        f"hand_base={base_hand} hand_world_base={base_hand_world} "
        f"hand_world_raised={raised_hand_world} keyed_hand={keyed_hand} "
        f"bone_deltas={' '.join(deltas)}"
    )
    actor_subsystem.destroy_actor(temporary_actor)


build()
