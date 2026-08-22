"""Author diagnostic seated-pose variants for the MetaHuman base skeleton.

The UE 5.8 MetaHuman plugin ships only standing technical loops.  These five
short assets deliberately vary the local bend axis/order so a rendered audit
can identify the correct convention before the final seated idle is authored.
"""

from __future__ import annotations

from dataclasses import dataclass

import unreal


SKELETON_PATH = (
    "/MetaHumanCharacter/Female/Medium/NormalWeight/Body/metahuman_base_skel"
)
OUTPUT_ROOT = "/Game/Conclavia/Studio/Animations"


@dataclass(frozen=True)
class Variant:
    name: str
    leg_degrees: float
    leg_mirrored: bool
    leg_pre_multiply: bool


VARIANTS = (
    Variant("AS_Seat_Order_1", 66.0, False, False),
    Variant("AS_Seat_Order_2", 66.0, False, True),
    Variant("AS_Seat_Order_3", 66.0, True, True),
    Variant("AS_Seat_Order_4", -66.0, False, True),
    Variant("AS_Seat_Order_5", -66.0, True, True),
)


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_SEATED_POSE: {message}")


def rotation_delta(axis: str, degrees: float) -> unreal.Quat:
    values = {
        "x": unreal.Vector(degrees, 0.0, 0.0),
        "y": unreal.Vector(0.0, degrees, 0.0),
        "z": unreal.Vector(0.0, 0.0, degrees),
    }
    return unreal.MathLibrary.quat_make_from_euler(values[axis])


def compose(reference: unreal.Quat, delta: unreal.Quat, pre: bool) -> unreal.Quat:
    if pre:
        return unreal.MathLibrary.multiply_quat_quat(delta, reference)
    return unreal.MathLibrary.multiply_quat_quat(reference, delta)


def with_rotation(reference: unreal.Transform, rotation: unreal.Quat) -> unreal.Transform:
    result = unreal.Transform()
    result.translation = reference.translation
    result.rotation = rotation
    result.scale3d = reference.scale3d
    return result


def build_variant(
    skeleton: unreal.Skeleton,
    reference_pose: unreal.AnimPose,
    variant: Variant,
) -> unreal.AnimSequence:
    asset_path = f"{OUTPUT_ROOT}/{variant.name}"
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        unreal.EditorAssetLibrary.delete_asset(asset_path)

    factory = unreal.AnimSequenceFactory()
    factory.target_skeleton = skeleton
    animation = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        variant.name,
        OUTPUT_ROOT,
        unreal.AnimSequence,
        factory,
    )
    if not isinstance(animation, unreal.AnimSequence):
        raise RuntimeError(f"Could not create {asset_path}")

    controller = animation.controller
    controller.open_bracket(f"Build {variant.name}")
    try:
        controller.set_frame_rate(unreal.FrameRate(30, 1), False)
        controller.set_number_of_frames(unreal.FrameNumber(60), False)

        # The MetaHuman base skeleton bends both legs into the sagittal plane
        # with equal local-Y deltas.  Keep that solved chain fixed while the
        # five actors expose different arm conventions in one audit frame.
        for side in ("l", "r"):
            side_sign = 1.0 if side == "l" else -1.0
            mirror = side_sign if variant.leg_mirrored else 1.0
            for bone_name, degrees in (
                (f"thigh_{side}", variant.leg_degrees * mirror),
                (f"calf_{side}", -92.0 * mirror),
                (f"foot_{side}", 26.0 * mirror),
            ):
                reference = reference_pose.get_bone_pose(bone_name)
                rotation = compose(
                    reference.rotation,
                    rotation_delta("y", degrees),
                    variant.leg_pre_multiply,
                )
                posed = with_rotation(reference, rotation)
                controller.add_bone_track(bone_name, False)
                controller.set_bone_track_keys(
                    bone_name,
                    [posed.translation, posed.translation],
                    [posed.rotation, posed.rotation],
                    [posed.scale3d, posed.scale3d],
                    False,
                )

            for bone_name, degrees in (
                (f"upperarm_{side}", 25.0),
                (f"lowerarm_{side}", 24.0),
            ):
                reference = reference_pose.get_bone_pose(bone_name)
                rotation = compose(
                    reference.rotation,
                    rotation_delta("z", degrees),
                    False,
                )
                posed = with_rotation(reference, rotation)
                controller.add_bone_track(bone_name, False)
                controller.set_bone_track_keys(
                    bone_name,
                    [posed.translation, posed.translation],
                    [posed.rotation, posed.rotation],
                    [posed.scale3d, posed.scale3d],
                    False,
                )
    finally:
        controller.close_bracket(False)

    unreal.EditorAssetLibrary.save_loaded_asset(animation, only_if_is_dirty=False)
    log(
        f"built={asset_path} leg_degrees={variant.leg_degrees} "
        f"leg_mirrored={variant.leg_mirrored} leg_pre={variant.leg_pre_multiply}"
    )
    return animation


def main() -> None:
    skeleton = unreal.load_asset(SKELETON_PATH)
    if not isinstance(skeleton, unreal.Skeleton):
        raise RuntimeError(f"Missing MetaHuman skeleton: {SKELETON_PATH}")
    reference_pose = skeleton.get_reference_pose()
    for variant in VARIANTS:
        build_variant(skeleton, reference_pose, variant)
    unreal.EditorAssetLibrary.save_directory(OUTPUT_ROOT, only_if_is_dirty=False)
    log("READY variants=5")


main()
