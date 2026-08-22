"""Build Conclavia's reusable hybrid seated MetaHuman idle.

The lower body is solved analytically into a compact seated stance, while the
upper body is sampled from Epic's authored MetaHuman idle. This keeps the legs
under the desk without ever hand-authoring mirrored shoulder, elbow or wrist
rotations -- the source of the visibly inverted arms in the first prototype.
"""

from __future__ import annotations

import unreal


SKELETON_PATH = (
    "/MetaHumanCharacter/Female/Medium/NormalWeight/Body/metahuman_base_skel"
)
OUTPUT_ROOT = "/Game/Conclavia/Studio/Animations"
ASSET_NAME = "AS_Conclavia_SeatedIdle"
ASSET_PATH = f"{OUTPUT_ROOT}/{ASSET_NAME}"
SOURCE_IDLE_PATH = (
    "/MetaHumanCharacter/Optional/Animation/TemplateAnimations/"
    "Technical_Loops/Idle/mhc_mh001_fmn_b_idle"
)
UPPER_BODY_BONES = (
    "spine_01",
    "spine_02",
    "spine_03",
    "spine_04",
    "spine_05",
    "neck_01",
    "clavicle_l",
    "clavicle_r",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
)
LOWER_BODY_BONES = (
    "thigh_l",
    "calf_l",
    "foot_l",
    "thigh_r",
    "calf_r",
    "foot_r",
)
TRACKED_BONES = UPPER_BODY_BONES + LOWER_BODY_BONES

OUTPUT_FPS = 30
SAMPLE_RATE_HZ = 4.0

# The Epic technical loop contains broad head dips intended for animation
# review. In a meeting close-up those read as prolonged eye closure or loss of
# attention. Keep the authored timing and shoulder motion, but bake a restrained
# camera-facing share of the upper-spine/neck rotation into the reusable asset.
ATTENTIVE_ROTATION_WEIGHTS = {
    "spine_04": 0.72,
    "spine_05": 0.55,
    "neck_01": 0.28,
}

def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_SEATED_IDLE: {message}")


def copy_transform(value: unreal.Transform) -> unreal.Transform:
    result = unreal.Transform()
    result.translation = value.translation
    result.rotation = value.rotation
    result.scale3d = value.scale3d
    return result


def direction(start: unreal.Vector, end: unreal.Vector) -> unreal.Vector:
    return unreal.Vector(end.x - start.x, end.y - start.y, end.z - start.z)


def aim_chain_bone(
    pose: unreal.AnimPose,
    parent_name: str,
    child_name: str,
    target_child: unreal.Vector,
) -> None:
    parent = copy_transform(
        pose.get_bone_pose(parent_name, unreal.AnimPoseSpaces.WORLD)
    )
    child = pose.get_bone_pose(child_name, unreal.AnimPoseSpaces.WORLD)
    current_direction = direction(parent.translation, child.translation)
    target_direction = direction(parent.translation, target_child)
    delta = unreal.MathLibrary.quat_find_between_vectors(
        current_direction, target_direction
    )
    parent.rotation = unreal.MathLibrary.multiply_quat_quat(
        delta, parent.rotation
    )
    pose.set_bone_pose(parent, parent_name, unreal.AnimPoseSpaces.WORLD)

    resolved_child = pose.get_bone_pose(child_name, unreal.AnimPoseSpaces.WORLD)
    log(
        f"aim parent={parent_name} child={child_name} "
        f"target=({target_child.x:.1f},{target_child.y:.1f},{target_child.z:.1f}) "
        f"resolved=({resolved_child.translation.x:.1f},"
        f"{resolved_child.translation.y:.1f},{resolved_child.translation.z:.1f})"
    )


def restore_world_rotation(
    pose: unreal.AnimPose,
    reference_pose: unreal.AnimPose,
    bone_name: str,
) -> None:
    posed = copy_transform(
        pose.get_bone_pose(bone_name, unreal.AnimPoseSpaces.WORLD)
    )
    reference = reference_pose.get_bone_pose(
        bone_name, unreal.AnimPoseSpaces.WORLD
    )
    posed.rotation = reference.rotation
    pose.set_bone_pose(posed, bone_name, unreal.AnimPoseSpaces.WORLD)


def solve_lower_body_pose(skeleton: unreal.Skeleton) -> unreal.AnimPose:
    reference = skeleton.get_reference_pose()
    pose = skeleton.get_reference_pose()

    # Compact, camera-facing seated stance: knees remain under the hips, shins
    # fall almost vertically and feet retain their authored flat orientation.
    # MetaHuman uses X as character-forward and Y as character-right.  Keep
    # the lateral separation on Y and move both knees forward on X; the
    # previous prototype swapped those axes, which is why the legs read as a
    # narrow standing pose even after the seated sequence was applied.
    for side, sign in (("l", -1.0), ("r", 1.0)):
        knee_target = unreal.Vector(31.0, 10.5 * sign, 54.0)
        ankle_target = unreal.Vector(32.0, 10.5 * sign, 17.0)
        aim_chain_bone(pose, f"thigh_{side}", f"calf_{side}", knee_target)
        aim_chain_bone(pose, f"calf_{side}", f"foot_{side}", ankle_target)
        restore_world_rotation(pose, reference, f"foot_{side}")

    return pose


def sample_authored_upper_body(
    skeleton: unreal.Skeleton,
) -> tuple[dict[str, list[unreal.Transform]], float]:
    source = unreal.load_asset(SOURCE_IDLE_PATH)
    if not isinstance(source, unreal.AnimSequence):
        raise RuntimeError(f"Missing authored MetaHuman idle: {SOURCE_IDLE_PATH}")

    options = unreal.AnimPoseEvaluationOptions()
    options.set_editor_property("should_retarget", True)
    duration = max(0.001, float(source.get_play_length()))
    key_count = max(2, int(round(duration * SAMPLE_RATE_HZ)) + 1)
    samples = {bone_name: [] for bone_name in UPPER_BODY_BONES}
    reference_pose = skeleton.get_reference_pose()
    for index in range(key_count):
        # Preserve both the authored speed and the authored loop boundary. The
        # full technical loop is copied instead of compressing 45 seconds into
        # a short sequence or cutting it at an arbitrary non-looping frame.
        source_time = duration * index / (key_count - 1)
        pose = source.get_anim_pose_at_time(source_time, options)
        for bone_name in UPPER_BODY_BONES:
            sampled = copy_transform(
                pose.get_bone_pose(bone_name, unreal.AnimPoseSpaces.LOCAL)
            )
            rotation_weight = ATTENTIVE_ROTATION_WEIGHTS.get(bone_name)
            if rotation_weight is not None:
                reference = reference_pose.get_bone_pose(
                    bone_name,
                    unreal.AnimPoseSpaces.LOCAL,
                )
                sampled.rotation = reference.rotation.slerp_quat(
                    sampled.rotation,
                    rotation_weight,
                )
            samples[bone_name].append(sampled)
    log(
        f"AUTHORED_UPPER_BODY source={SOURCE_IDLE_PATH} "
        f"source_duration={duration:.3f} samples={key_count}"
    )
    return samples, duration


def build_animation(
    skeleton: unreal.Skeleton,
    seated_pose: unreal.AnimPose,
    upper_body_samples: dict[str, list[unreal.Transform]],
    output_duration: float,
) -> unreal.AnimSequence:
    if unreal.EditorAssetLibrary.does_asset_exist(ASSET_PATH):
        unreal.EditorAssetLibrary.delete_asset(ASSET_PATH)

    factory = unreal.AnimSequenceFactory()
    factory.target_skeleton = skeleton
    animation = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        ASSET_NAME,
        OUTPUT_ROOT,
        unreal.AnimSequence,
        factory,
    )
    if not isinstance(animation, unreal.AnimSequence):
        raise RuntimeError(f"Could not create {ASSET_PATH}")

    controller = animation.controller
    controller.open_bracket("Build Conclavia seated idle")
    try:
        frame_count = max(1, int(round(output_duration * OUTPUT_FPS)))
        controller.set_frame_rate(unreal.FrameRate(OUTPUT_FPS, 1), False)
        controller.set_number_of_frames(unreal.FrameNumber(frame_count), False)
        for bone_name in TRACKED_BONES:
            controller.add_bone_track(bone_name, False)
            if bone_name in upper_body_samples:
                keys = upper_body_samples[bone_name]
            else:
                posed = seated_pose.get_bone_pose(
                    bone_name,
                    unreal.AnimPoseSpaces.LOCAL,
                )
                source_key_count = len(next(iter(upper_body_samples.values())))
                keys = [copy_transform(posed) for _ in range(source_key_count)]
            controller.set_bone_track_keys(
                bone_name,
                [key.translation for key in keys],
                [key.rotation for key in keys],
                [key.scale3d for key in keys],
                False,
            )
    finally:
        controller.close_bracket(False)

    unreal.EditorAssetLibrary.save_loaded_asset(animation, only_if_is_dirty=False)
    return animation


def main() -> None:
    skeleton = unreal.load_asset(SKELETON_PATH)
    if not isinstance(skeleton, unreal.Skeleton):
        raise RuntimeError(f"Missing MetaHuman skeleton: {SKELETON_PATH}")
    seated_pose = solve_lower_body_pose(skeleton)
    upper_body_samples, output_duration = sample_authored_upper_body(skeleton)
    animation = build_animation(
        skeleton,
        seated_pose,
        upper_body_samples,
        output_duration,
    )
    log(
        f"READY asset={animation.get_path_name()} "
        f"duration={output_duration:.3f} "
        "authored_upper_body=True seated_lower_body=True"
    )


main()
