"""Build Conclavia's native 3D broadcast studios.

The previous POC used a photographic plate.  This version deliberately builds
the set from lit 3D geometry so camera moves, shadows, depth, seated characters
and reflections remain coherent.  It generates both a young/pop set and a
quieter editorial set from the same broadcast-safe layout.
"""

from __future__ import annotations

import math

import unreal


CONTENT_ROOT = "/Game/Conclavia/Studio"
POP_LEVEL_PATH = f"{CONTENT_ROOT}/L_PremiumStudio"
EDITORIAL_LEVEL_PATH = f"{CONTENT_ROOT}/L_EditorialStudio"

SEAT_Y = (-272.0, -136.0, 0.0, 136.0, 272.0)
SEAT_X = (62.0, 28.0, 18.0, 28.0, 62.0)
SEAT_Z = 56.0

CUBE = "/Engine/BasicShapes/Cube.Cube"
SPHERE = "/Engine/BasicShapes/Sphere.Sphere"
CYLINDER = "/Engine/BasicShapes/Cylinder.Cylinder"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_NATIVE_STUDIO: {message}")


def delete_asset(path: str) -> None:
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)


def make_material(
    name: str,
    color: unreal.LinearColor,
    *,
    roughness: float = 0.55,
    metallic: float = 0.0,
    emissive_strength: float = 0.0,
) -> unreal.Material:
    path = f"{CONTENT_ROOT}/Materials/{name}"
    delete_asset(path)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name,
        f"{CONTENT_ROOT}/Materials",
        unreal.Material,
        unreal.MaterialFactoryNew(),
    )
    if not isinstance(material, unreal.Material):
        raise RuntimeError(f"Could not create material {name}")

    material.set_editor_property(
        "shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT
    )

    base = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant4Vector, -360, -40
    )
    base.set_editor_property("constant", color)
    unreal.MaterialEditingLibrary.connect_material_property(
        base, "", unreal.MaterialProperty.MP_BASE_COLOR
    )

    rough = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant, -360, 90
    )
    rough.set_editor_property("r", roughness)
    unreal.MaterialEditingLibrary.connect_material_property(
        rough, "", unreal.MaterialProperty.MP_ROUGHNESS
    )

    metal = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant, -360, 160
    )
    metal.set_editor_property("r", metallic)
    unreal.MaterialEditingLibrary.connect_material_property(
        metal, "", unreal.MaterialProperty.MP_METALLIC
    )

    if emissive_strength > 0.0:
        glow = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant4Vector, -360, 235
        )
        glow.set_editor_property(
            "constant",
            unreal.LinearColor(
                color.r * emissive_strength,
                color.g * emissive_strength,
                color.b * emissive_strength,
                1.0,
            ),
        )
        unreal.MaterialEditingLibrary.connect_material_property(
            glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR
        )

    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)
    return material


def create_materials() -> dict[str, unreal.Material]:
    colors = {
        # Authored in linear space. Display-space values clipped the first pass.
        "M_SetNavy": (unreal.LinearColor(0.002, 0.005, 0.014, 1), 0.47, 0.0, 0.0),
        "M_SetInk": (unreal.LinearColor(0.006, 0.009, 0.022, 1), 0.38, 0.12, 0.0),
        "M_SetGraphite": (unreal.LinearColor(0.022, 0.027, 0.035, 1), 0.7, 0.0, 0.0),
        "M_SetBone": (unreal.LinearColor(0.18, 0.14, 0.105, 1), 0.72, 0.0, 0.0),
        "M_SetCyan": (unreal.LinearColor(0.0, 0.095, 0.18, 1), 0.48, 0.02, 0.0),
        "M_SetBlue": (unreal.LinearColor(0.008, 0.025, 0.17, 1), 0.5, 0.0, 0.0),
        "M_SetCoral": (unreal.LinearColor(0.42, 0.025, 0.008, 1), 0.62, 0.0, 0.0),
        "M_SetPink": (unreal.LinearColor(0.32, 0.006, 0.065, 1), 0.58, 0.0, 0.0),
        "M_SetGold": (unreal.LinearColor(0.42, 0.13, 0.005, 1), 0.56, 0.0, 0.0),
        "M_SetTeal": (unreal.LinearColor(0.005, 0.085, 0.09, 1), 0.53, 0.0, 0.0),
        "M_SetAmber": (unreal.LinearColor(0.28, 0.055, 0.008, 1), 0.6, 0.0, 0.0),
        "M_SetFabricLight": (unreal.LinearColor(0.16, 0.17, 0.19, 1), 0.92, 0.0, 0.0),
        "M_SetMetal": (unreal.LinearColor(0.018, 0.023, 0.032, 1), 0.2, 0.75, 0.0),
        "M_SetCopper": (unreal.LinearColor(0.16, 0.035, 0.008, 1), 0.24, 0.72, 0.0),
        "M_SetWood": (unreal.LinearColor(0.12, 0.028, 0.008, 1), 0.46, 0.0, 0.0),
        "M_SetCeramic": (unreal.LinearColor(0.012, 0.017, 0.026, 1), 0.22, 0.05, 0.0),
        "M_GlowCyan": (unreal.LinearColor(0.0, 0.24, 0.42, 1), 0.3, 0.0, 0.65),
        "M_GlowCoral": (unreal.LinearColor(0.58, 0.025, 0.01, 1), 0.3, 0.0, 0.55),
        "M_GlowWarm": (unreal.LinearColor(0.52, 0.12, 0.018, 1), 0.3, 0.0, 0.48),
    }
    return {
        name: make_material(
            name,
            values[0],
            roughness=values[1],
            metallic=values[2],
            emissive_strength=values[3],
        )
        for name, values in colors.items()
    }


def actor_subsystem() -> unreal.EditorActorSubsystem:
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def spawn_actor(actor_class: type, location: unreal.Vector, label: str) -> unreal.Actor:
    actor = actor_subsystem().spawn_actor_from_class(actor_class, location)
    if actor is None:
        raise RuntimeError(f"Failed to spawn {label}")
    actor.set_actor_label(label)
    return actor


def add_shape(
    label: str,
    mesh_path: str,
    location: unreal.Vector,
    scale: unreal.Vector,
    material: unreal.MaterialInterface,
    rotation: unreal.Rotator | None = None,
    *,
    cast_shadow: bool = True,
) -> unreal.StaticMeshActor:
    actor = spawn_actor(unreal.StaticMeshActor, location, label)
    mesh = unreal.load_asset(mesh_path)
    if not isinstance(mesh, unreal.StaticMesh):
        raise RuntimeError(f"Missing engine mesh: {mesh_path}")
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(cast_shadow)
    actor.set_actor_scale3d(scale)
    if rotation is not None:
        actor.set_actor_rotation(rotation, False)
    actor.tags = [unreal.Name("ConclaviaSet"), unreal.Name(label)]
    return actor


def look_at(actor: unreal.Actor, target: unreal.Vector) -> None:
    actor.set_actor_rotation(
        unreal.MathLibrary.find_look_at_rotation(actor.get_actor_location(), target),
        False,
    )


def add_camera(
    label: str,
    location: unreal.Vector,
    target: unreal.Vector,
    focal_length: float,
    aperture: float = 3.2,
) -> unreal.CineCameraActor:
    camera = spawn_actor(unreal.CineCameraActor, location, label)
    look_at(camera, target)
    component = camera.get_cine_camera_component()
    filmback = component.get_editor_property("filmback")
    filmback.set_editor_property("sensor_width", 36.0)
    filmback.set_editor_property("sensor_height", 20.25)
    component.set_editor_property("filmback", filmback)
    component.set_editor_property("current_focal_length", focal_length)
    component.set_editor_property("current_aperture", aperture)
    focus = component.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    component.set_editor_property("focus_settings", focus)
    camera.tags = [unreal.Name("ConclaviaCamera"), unreal.Name(label)]
    return camera


def add_rect_light(
    label: str,
    location: unreal.Vector,
    target: unreal.Vector,
    color: unreal.LinearColor,
    intensity: float,
    width: float,
    height: float,
) -> unreal.RectLight:
    light = spawn_actor(unreal.RectLight, location, label)
    look_at(light, target)
    component = light.get_component_by_class(unreal.RectLightComponent)
    component.set_editor_property("intensity", intensity)
    component.set_editor_property("light_color", color.to_color(True))
    component.set_editor_property("source_width", width)
    component.set_editor_property("source_height", height)
    component.set_editor_property("barn_door_angle", 68.0)
    component.set_editor_property("barn_door_length", 40.0)
    component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    return light


def add_architecture(
    materials: dict[str, unreal.Material],
    style: str,
) -> None:
    pop = style == "Pop"
    wall = materials["M_SetNavy"]
    floor = materials["M_SetInk"]
    trim = materials["M_SetGraphite"]

    add_shape(
        "SET_Floor",
        CUBE,
        unreal.Vector(130, 0, -35),
        unreal.Vector(11.5, 18.0, 0.7),
        floor,
    )
    add_shape(
        "SET_BackWall",
        CUBE,
        unreal.Vector(535, 0, 300),
        unreal.Vector(0.65, 18.0, 6.0),
        wall,
    )
    add_shape(
        "SET_LeftWing",
        CUBE,
        unreal.Vector(180, -905, 285),
        unreal.Vector(6.4, 0.45, 5.7),
        trim,
    )
    add_shape(
        "SET_RightWing",
        CUBE,
        unreal.Vector(180, 905, 285),
        unreal.Vector(6.4, 0.45, 5.7),
        trim,
    )

    panel_materials = (
        ["M_SetCyan", "M_SetBlue", "M_SetGold", "M_SetPink", "M_SetCoral"]
        if pop
        else ["M_SetTeal", "M_SetInk", "M_SetBone", "M_SetInk", "M_SetAmber"]
    )
    for index, (seat_y, material_name) in enumerate(
        zip(SEAT_Y, panel_materials), start=1
    ):
        add_shape(
            f"SET_Panel_{index}",
            CUBE,
            unreal.Vector(480, seat_y, 325),
            unreal.Vector(0.34, 1.92, 4.35),
            materials[material_name],
        )
        glow_name = "M_GlowCyan" if index % 2 else (
            "M_GlowCoral" if pop else "M_GlowWarm"
        )
        for edge, offset_y in (("L", -202.0), ("R", 202.0)):
            add_shape(
                f"SET_Panel_{index}_{edge}_Glow",
                CUBE,
                unreal.Vector(440, seat_y + offset_y, 325),
                unreal.Vector(0.08, 0.035, 4.45),
                materials[glow_name],
                cast_shadow=False,
            )

    for index, y in enumerate(range(-820, 821, 62)):
        add_shape(
            f"SET_AcousticSlat_{index:02d}",
            CUBE,
            unreal.Vector(425 - (index % 3) * 5.0, float(y), 315),
            unreal.Vector(0.18, 0.15 if index % 4 else 0.22, 4.9),
            trim if index % 3 else materials["M_SetNavy"],
        )

    # A clean luminous portal replaces the earlier blocky halo. It frames the
    # ensemble without placing a distracting ring directly behind one head.
    portal_material = materials["M_GlowCyan" if pop else "M_GlowWarm"]
    for label, y, z, scale in (
        ("Top", 0.0, 488.0, unreal.Vector(0.14, 4.10, 0.045)),
        ("Left", -420.0, 350.0, unreal.Vector(0.14, 0.045, 2.75)),
        ("Right", 420.0, 350.0, unreal.Vector(0.14, 0.045, 2.75)),
    ):
        add_shape(
            f"SET_Portal_{label}",
            CUBE,
            unreal.Vector(398.0, y, z),
            scale,
            portal_material,
            cast_shadow=False,
        )

    # Side shelves make the room feel inhabited. Their books and ceramics are
    # deliberately asymmetrical so the set does not read as a generated grid.
    for side, y in (("L", -650.0), ("R", 650.0)):
        for shelf_index, z in enumerate((205.0, 295.0, 385.0), start=1):
            add_shape(
                f"SET_Shelf_{side}_{shelf_index}",
                CUBE,
                unreal.Vector(375.0, y, z),
                unreal.Vector(0.34, 1.05, 0.055),
                materials["M_SetWood" if pop else "M_SetMetal"],
            )
        book_offset = -52.0 if side == "L" else 35.0
        for book_index, (dy, height, material_name) in enumerate(
            (
                (book_offset, 42.0, "M_SetCoral"),
                (book_offset + 20.0, 54.0, "M_SetGold"),
                (book_offset + 42.0, 47.0, "M_SetCyan"),
            ),
            start=1,
        ):
            add_shape(
                f"PROP_Book_{side}_{book_index}",
                CUBE,
                unreal.Vector(345.0, y + dy, 226.0 + height * 0.5),
                unreal.Vector(0.16, 0.08, height / 100.0),
                materials[material_name if pop else "M_SetBone"],
            )
        add_shape(
            f"PROP_ShelfVase_{side}",
            CYLINDER,
            unreal.Vector(345.0, y + (-28.0 if side == "L" else 18.0), 317.0),
            unreal.Vector(0.16, 0.16, 0.28),
            materials["M_SetCeramic"],
        )


def add_lounge_chair(
    index: int,
    location: unreal.Vector,
    material: unreal.Material,
    base_material: unreal.Material,
) -> None:
    prefix = f"SET_Chair_{index}"
    x, y = location.x, location.y
    add_shape(
        f"{prefix}_Seat",
        SPHERE,
        unreal.Vector(x + 28, y, 70),
        unreal.Vector(0.60, 0.70, 0.22),
        material,
    )
    add_shape(
        f"{prefix}_Back",
        SPHERE,
        unreal.Vector(x + 76, y, 124),
        unreal.Vector(0.30, 0.68, 0.78),
        material,
    )
    for side, offset_y in (("L", -48.0), ("R", 48.0)):
        add_shape(
            f"{prefix}_Arm_{side}",
            CUBE,
            unreal.Vector(x + 22, y + offset_y, 92),
            unreal.Vector(0.44, 0.075, 0.11),
            material,
            unreal.Rotator(roll=0.0, pitch=-5.0, yaw=0.0),
        )
    add_shape(
        f"{prefix}_Pedestal",
        CYLINDER,
        unreal.Vector(x + 42, y, 35),
        unreal.Vector(0.15, 0.15, 0.44),
        base_material,
    )
    add_shape(
        f"{prefix}_Foot",
        CYLINDER,
        unreal.Vector(x + 42, y, 9),
        unreal.Vector(0.46, 0.46, 0.09),
        base_material,
    )


def add_cast_furniture(
    materials: dict[str, unreal.Material],
    style: str,
) -> None:
    pop = style == "Pop"
    chair_names = (
        ["M_SetCyan", "M_SetGold", "M_SetFabricLight", "M_SetCoral", "M_SetBlue"]
        if pop
        else ["M_SetTeal", "M_SetGraphite", "M_SetFabricLight", "M_SetAmber", "M_SetInk"]
    )
    for index, (x, y, material_name) in enumerate(
        zip(SEAT_X, SEAT_Y, chair_names), start=1
    ):
        add_lounge_chair(
            index,
            unreal.Vector(x, y, 0),
            materials[material_name],
            materials["M_SetMetal"],
        )

    # A shared rounded podcast console hides the technical lower-body rig while
    # keeping shoulders, hands and microphones readable in medium shots.  The
    # first version was too low and exposed the default rig pose in wide shots.
    add_shape(
        "SET_PodcastTableFascia",
        CYLINDER,
        unreal.Vector(-58, 0, 84),
        unreal.Vector(1.04, 6.75, 0.28),
        materials["M_SetGraphite"],
    )
    add_shape(
        "SET_PodcastTableTop",
        CYLINDER,
        unreal.Vector(-82, 0, 110),
        unreal.Vector(1.18, 7.05, 0.10),
        materials["M_SetMetal"],
    )
    add_shape(
        "SET_PodcastTableBase",
        CYLINDER,
        unreal.Vector(-52, 0, 35),
        unreal.Vector(0.42, 1.85, 0.35),
        materials["M_SetNavy"],
    )
    add_shape(
        "SET_PodcastTableGlow",
        CUBE,
        unreal.Vector(-145, 0, 105),
        unreal.Vector(0.035, 3.02, 0.035),
        materials["M_GlowCyan" if pop else "M_GlowWarm"],
        cast_shadow=False,
    )
    add_shape(
        "SET_PodcastTableModestyPanel",
        CUBE,
        unreal.Vector(-126, 0, 50),
        unreal.Vector(0.22, 6.50, 0.40),
        materials["M_SetWood" if pop else "M_SetNavy"],
    )
    # Fine luminous reveals give the deep front panel enough articulation for
    # a wide YouTube frame without turning it into a gaming desk.
    for reveal_index, reveal_y in enumerate(SEAT_Y):
        add_shape(
            f"SET_PodcastTableReveal_{reveal_index + 1}",
            CUBE,
            unreal.Vector(-149, reveal_y, 52),
            unreal.Vector(0.018, 0.018, 0.28),
            materials[
                "M_GlowCyan"
                if not pop or reveal_index % 2 == 0
                else "M_GlowCoral"
            ],
            cast_shadow=False,
        )

    for index, (x, y) in enumerate(zip(SEAT_X, SEAT_Y), start=1):
        mic_x = -24.0
        mic_y = y + (34.0 if index % 2 else -34.0)
        add_shape(
            f"PROP_Mic_{index}_Base",
            CYLINDER,
            unreal.Vector(mic_x, mic_y, 122),
            unreal.Vector(0.12, 0.12, 0.035),
            materials["M_SetMetal"],
        )
        add_shape(
            f"PROP_Mic_{index}_Stem",
            CYLINDER,
            unreal.Vector(mic_x, mic_y, 137),
            unreal.Vector(0.024, 0.024, 0.27),
            materials["M_SetCopper"],
        )
        add_shape(
            f"PROP_Mic_{index}_Joint",
            SPHERE,
            unreal.Vector(mic_x, mic_y, 151),
            unreal.Vector(0.055, 0.055, 0.055),
            materials["M_SetGraphite"],
        )
        add_shape(
            f"PROP_Mic_{index}_Boom",
            CYLINDER,
            unreal.Vector(mic_x + 24, mic_y, 153),
            unreal.Vector(0.022, 0.022, 0.47),
            materials["M_SetCopper"],
            unreal.Rotator(roll=0.0, pitch=90.0, yaw=0.0),
        )
        add_shape(
            f"PROP_Mic_{index}_Capsule",
            CYLINDER,
            unreal.Vector(mic_x + 51, mic_y, 153),
            unreal.Vector(0.07, 0.07, 0.15),
            materials["M_SetGraphite"],
            unreal.Rotator(roll=0.0, pitch=90.0, yaw=0.0),
        )
        for ring_index, ring_x in enumerate((mic_x + 43, mic_x + 51, mic_x + 59)):
            add_shape(
                f"PROP_Mic_{index}_Grille_{ring_index}",
                CYLINDER,
                unreal.Vector(ring_x, mic_y, 153),
                unreal.Vector(0.076, 0.076, 0.012),
                materials["M_SetMetal"],
                unreal.Rotator(roll=0.0, pitch=90.0, yaw=0.0),
            )

        # A small water glass makes the low table read as a working studio set.
        add_shape(
            f"PROP_Glass_{index}",
            CYLINDER,
            unreal.Vector(-102, y * 0.80, 124),
            unreal.Vector(0.075, 0.075, 0.135),
            materials["M_SetCeramic" if pop else "M_SetBone"],
            cast_shadow=False,
        )

    # The compact broadcast mixer is the hero prop. Keep every control within
    # one coherent 120 cm chassis so it reads as a real desk object in its
    # dedicated high-angle insert, rather than as floating set decoration.
    add_shape(
        "PROP_Mixer_Body",
        CUBE,
        unreal.Vector(-82, 72, 128),
        unreal.Vector(0.28, 0.62, 0.080),
        materials["M_SetCeramic"],
    )
    add_shape(
        "PROP_Mixer_WoodCheek_L",
        CUBE,
        unreal.Vector(-82, 6, 128),
        unreal.Vector(0.27, 0.055, 0.085),
        materials["M_SetWood"],
    )
    add_shape(
        "PROP_Mixer_WoodCheek_R",
        CUBE,
        unreal.Vector(-82, 138, 128),
        unreal.Vector(0.27, 0.055, 0.085),
        materials["M_SetWood"],
    )
    for channel in range(5):
        channel_y = 24.0 + channel * 24.0
        add_shape(
            f"PROP_Mixer_FaderTrack_{channel + 1}",
            CUBE,
            unreal.Vector(-99, channel_y, 137),
            unreal.Vector(0.13, 0.014, 0.007),
            materials["M_SetMetal"],
        )
        add_shape(
            f"PROP_Mixer_Fader_{channel + 1}",
            CUBE,
            unreal.Vector(-101 + (channel % 3) * 6, channel_y, 139),
            unreal.Vector(0.034, 0.040, 0.020),
            materials["M_SetBone"],
        )
        for row in range(2):
            add_shape(
                f"PROP_Mixer_Knob_{channel + 1}_{row + 1}",
                CYLINDER,
                unreal.Vector(-70 + row * 15, channel_y, 138),
                unreal.Vector(0.032, 0.032, 0.025),
                materials["M_SetCoral" if (channel + row) % 2 else "M_SetCyan"],
            )
    for meter in range(4):
        add_shape(
            f"PROP_Mixer_Meter_{meter + 1}",
            CUBE,
            unreal.Vector(-49, 36 + meter * 22, 138),
            unreal.Vector(0.040, 0.048, 0.010),
            materials["M_GlowCyan" if meter < 3 else "M_GlowCoral"],
            cast_shadow=False,
        )
    add_shape(
        "PROP_Mixer_Display",
        CUBE,
        unreal.Vector(-50, 118, 138),
        unreal.Vector(0.065, 0.105, 0.010),
        materials["M_GlowCyan"],
        cast_shadow=False,
    )


def add_seat_markers() -> None:
    for index, (seat_x, seat_y) in enumerate(zip(SEAT_X, SEAT_Y), start=1):
        marker = spawn_actor(
            unreal.Actor,
            unreal.Vector(seat_x, seat_y, SEAT_Z),
            f"CAST_Seat_{index}",
        )
        marker.tags = [unreal.Name("ConclaviaSeat"), unreal.Name(f"Seat{index}")]
        look_at(marker, unreal.Vector(-650, 0, 145))


def add_camera_package() -> None:
    add_camera(
        "CAM_Wide_Master",
        unreal.Vector(-960, 0, 224),
        unreal.Vector(55, 0, 190),
        38.0,
        4.0,
    )
    add_camera(
        "CAM_Wide_Slider_Left",
        unreal.Vector(-800, -480, 220),
        unreal.Vector(55, -45, 178),
        42.0,
    )
    add_camera(
        "CAM_Wide_Slider_Right",
        unreal.Vector(-800, 480, 220),
        unreal.Vector(55, 45, 178),
        42.0,
    )

    for index, (seat_x, seat_y) in enumerate(zip(SEAT_X, SEAT_Y), start=1):
        camera_y = seat_y + (80 if index <= 3 else -80)
        add_camera(
            f"CAM_Seat_{index}_Close",
            unreal.Vector(-505, camera_y, 178),
            unreal.Vector(seat_x, seat_y, 162),
            72.0,
            2.8,
        )

    add_camera(
        "CAM_TwoShot_Left",
        unreal.Vector(-700, -395, 198),
        unreal.Vector(55, -385, 172),
        54.0,
        3.2,
    )
    add_camera(
        "CAM_TwoShot_Right",
        unreal.Vector(-700, 395, 198),
        unreal.Vector(55, 385, 172),
        54.0,
        3.2,
    )
    add_camera(
        "CAM_Host_Medium",
        unreal.Vector(-650, -45, 194),
        unreal.Vector(SEAT_X[2], 0, 174),
        58.0,
        2.8,
    )
    add_camera(
        "CAM_Desk_Detail",
        unreal.Vector(-315, 72, 305),
        unreal.Vector(-82, 72, 132),
        92.0,
        5.6,
    )


def add_lighting(style: str) -> None:
    pop = style == "Pop"
    neutral = unreal.LinearColor(1.0, 0.91, 0.82, 1.0)
    cool = unreal.LinearColor(0.26, 0.64, 1.0, 1.0)
    warm = unreal.LinearColor(1.0, 0.28 if pop else 0.48, 0.12, 1.0)

    add_rect_light(
        "LIGHT_Key",
        unreal.Vector(-330, -360, 510),
        unreal.Vector(45, 0, 150),
        neutral,
        230.0,
        520.0,
        300.0,
    )
    add_rect_light(
        "LIGHT_Fill",
        unreal.Vector(-250, 490, 390),
        unreal.Vector(45, 0, 150),
        cool,
        65.0,
        440.0,
        260.0,
    )
    add_rect_light(
        "LIGHT_Rim",
        unreal.Vector(330, -260, 440),
        unreal.Vector(45, 0, 165),
        warm,
        145.0,
        400.0,
        220.0,
    )

    for index, y in enumerate(SEAT_Y, start=1):
        point = spawn_actor(
            unreal.PointLight,
            unreal.Vector(315, y, 105),
            f"LIGHT_Accent_{index}",
        )
        component = point.get_component_by_class(unreal.PointLightComponent)
        component.set_editor_property("intensity", 26.0 if pop else 22.0)
        component.set_editor_property(
            "light_color", (cool if index % 2 else warm).to_color(True)
        )
        component.set_editor_property("attenuation_radius", 360.0)
        component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)

    skylight = spawn_actor(
        unreal.SkyLight,
        unreal.Vector(0, 0, 320),
        "LIGHT_Ambient",
    )
    sky_component = skylight.get_component_by_class(unreal.SkyLightComponent)
    sky_component.set_editor_property("intensity", 0.09)
    sky_component.set_editor_property("real_time_capture", False)
    sky_component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)


def build_level(
    materials: dict[str, unreal.Material],
    style: str,
    level_path: str,
) -> None:
    # Never delete the map that is currently open: Unreal will keep its actor
    # graph alive and can carry old transient preview actors into the new file.
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    if unreal.EditorAssetLibrary.does_asset_exist(level_path):
        unreal.EditorAssetLibrary.delete_asset(level_path)

    add_architecture(materials, style)
    add_cast_furniture(materials, style)
    add_seat_markers()
    add_camera_package()
    add_lighting(style)

    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, level_path):
        raise RuntimeError(f"Failed to save {level_path}")
    log(f"READY style={style} map={level_path}")


def main() -> None:
    unreal.EditorAssetLibrary.make_directory(f"{CONTENT_ROOT}/Materials")
    materials = create_materials()
    build_level(materials, "Pop", POP_LEVEL_PATH)
    build_level(materials, "Editorial", EDITORIAL_LEVEL_PATH)
    unreal.EditorAssetLibrary.save_directory(
        CONTENT_ROOT,
        only_if_is_dirty=False,
        recursive=True,
    )
    log("NATIVE_3D_STUDIOS_READY styles=Pop,Editorial")


if __name__ == "__main__":
    main()
