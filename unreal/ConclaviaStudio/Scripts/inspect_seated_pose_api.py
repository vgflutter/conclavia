"""Log the UE 5.8 Python surface needed to author a seated MetaHuman pose."""

import unreal


def public_names(value: object, contains: tuple[str, ...] = ()) -> list[str]:
    names = [name for name in dir(value) if not name.startswith("_")]
    if contains:
        names = [name for name in names if any(token in name.lower() for token in contains)]
    return sorted(names)


mesh = unreal.load_asset("/MetaHumanCharacter/Body/IdentityTemplate/SKM_Body")
unreal.log_warning(f"CONCLAVIA_POSE_API mesh={mesh} class={type(mesh)}")
if isinstance(mesh, unreal.SkeletalMesh):
    skeleton = mesh.get_editor_property("skeleton")
    unreal.log_warning(f"CONCLAVIA_POSE_API skeleton={skeleton}")
    unreal.log_warning(
        "CONCLAVIA_POSE_API mesh_methods="
        + ",".join(public_names(mesh, ("bone", "skeleton", "ref")))
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API skeleton_methods="
        + ",".join(public_names(skeleton, ("bone", "ref", "pose")))
    )
    reference_pose = skeleton.get_reference_pose()
    unreal.log_warning(
        f"CONCLAVIA_POSE_API reference_pose_type={type(reference_pose)} "
        f"length={len(reference_pose) if hasattr(reference_pose, '__len__') else -1}"
    )

animation = unreal.load_asset(
    "/MetaHumanCharacter/Optional/Animation/TemplateAnimations/"
    "Technical_Loops/Idle/mhc_mh001_fmn_b_idle"
)
unreal.log_warning(f"CONCLAVIA_POSE_API animation={animation} class={type(animation)}")
if isinstance(animation, unreal.AnimSequence):
    unreal.log_warning(
        "CONCLAVIA_POSE_API animation_methods="
        + ",".join(public_names(animation, ("bone", "frame", "track", "controller", "skeleton", "data")))
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API animation_props="
        + ",".join(public_names(animation))
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API get_anim_pose_at_frame_doc="
        + str(animation.get_anim_pose_at_frame.__doc__)
    )
    options = unreal.AnimPoseEvaluationOptions()
    unreal.log_warning(
        "CONCLAVIA_POSE_API evaluation_options="
        + str(options)
        + " props="
        + ",".join(public_names(options))
    )
    sampled_pose = animation.get_anim_pose_at_frame(0, options)
    unreal.log_warning(
        "CONCLAVIA_POSE_API sampled_pose="
        + str(sampled_pose)
        + " bones="
        + str(len(sampled_pose.get_bone_names()))
    )
    for sampled_bone in (
        "pelvis",
        "spine_01",
        "upperarm_l",
        "lowerarm_l",
        "hand_l",
        "upperarm_r",
        "lowerarm_r",
        "hand_r",
    ):
        unreal.log_warning(
            f"CONCLAVIA_POSE_API sampled_local bone={sampled_bone} "
            f"value={sampled_pose.get_bone_pose(sampled_bone, unreal.AnimPoseSpaces.LOCAL)}"
        )
    data_model = animation.data_model
    unreal.log_warning(
        "CONCLAVIA_POSE_API data_model_methods="
        + ",".join(public_names(data_model, ("bone", "frame", "track", "rate", "key")))
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API data_model_props="
        + ",".join(public_names(data_model))
    )
    controller = animation.controller
    unreal.log_warning(
        "CONCLAVIA_POSE_API controller_methods="
        + ",".join(public_names(controller, ("bone", "frame", "track", "bracket", "key")))
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API set_bone_track_keys_doc="
        + str(controller.set_bone_track_keys.__doc__)
    )
    unreal.log_warning(
        "CONCLAVIA_POSE_API add_bone_curve_doc="
        + str(controller.add_bone_curve.__doc__)
    )

unreal.log_warning(
    "CONCLAVIA_POSE_API anim_pose_methods="
    + ",".join(public_names(reference_pose, ("bone", "pose", "transform", "name")))
)
bone_names = [str(name) for name in reference_pose.get_bone_names()]
important_bones = [
    name
    for name in bone_names
    if any(
        token in name.lower()
        for token in (
            "root",
            "pelvis",
            "spine",
            "thigh",
            "calf",
            "foot",
            "clavicle",
            "upperarm",
            "lowerarm",
            "hand",
        )
    )
]
unreal.log_warning(
    "CONCLAVIA_POSE_API important_bones=" + ",".join(important_bones)
)
for bone_name in (
    "root",
    "pelvis",
    "spine_01",
    "thigh_l",
    "calf_l",
    "foot_l",
    "thigh_r",
    "calf_r",
    "foot_r",
    "upperarm_l",
    "lowerarm_l",
    "upperarm_r",
    "lowerarm_r",
):
    unreal.log_warning(
        f"CONCLAVIA_POSE_API ref_transform bone={bone_name} "
        f"value={reference_pose.get_bone_pose(bone_name)}"
    )
unreal.log_warning(
    "CONCLAVIA_POSE_API get_bone_pose_doc="
    + str(reference_pose.get_bone_pose.__doc__)
)
unreal.log_warning(
    "CONCLAVIA_POSE_API set_bone_pose_doc="
    + str(reference_pose.set_bone_pose.__doc__)
)

skeletal_subsystem = unreal.get_editor_subsystem(unreal.SkeletalMeshEditorSubsystem)
unreal.log_warning(
    "CONCLAVIA_POSE_API skeletal_subsystem_methods="
    + ",".join(public_names(skeletal_subsystem, ("bone", "skeleton", "pose")))
)

factory = unreal.AnimSequenceFactory()
unreal.log_warning(
    "CONCLAVIA_POSE_API factory_props="
    + ",".join(public_names(factory, ("skeleton", "target")))
)
unreal.log_warning(
    "CONCLAVIA_POSE_API quat_methods="
    + ",".join(public_names(unreal.Quat(), ("mul", "rot", "euler", "norm", "inverse")))
)
unreal.log_warning(
    "CONCLAVIA_POSE_API math_quat_methods="
    + ",".join(public_names(unreal.MathLibrary, ("quat", "rotator", "compose")))
)
unreal.log_warning(
    "CONCLAVIA_POSE_API pose_spaces="
    + ",".join(public_names(unreal.AnimPoseSpaces))
)
for space_name in public_names(unreal.AnimPoseSpaces):
    value = getattr(unreal.AnimPoseSpaces, space_name)
    unreal.log_warning(f"CONCLAVIA_POSE_API pose_space {space_name}={value}")
for bone_name in (
    "root",
    "pelvis",
    "thigh_l",
    "calf_l",
    "foot_l",
    "ball_l",
    "thigh_r",
    "calf_r",
    "foot_r",
    "ball_r",
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
):
    for space_name in ("LOCAL", "WORLD"):
        if hasattr(unreal.AnimPoseSpaces, space_name):
            space = getattr(unreal.AnimPoseSpaces, space_name)
            unreal.log_warning(
                f"CONCLAVIA_POSE_API {space_name.lower()}_transform "
                f"bone={bone_name} value={reference_pose.get_bone_pose(bone_name, space)}"
            )
