"""Author the Grade 1 single-MetaHuman broadcast set in the UE 5.6 lab.

The commercial lip-sync sample is the only renderer that has passed a long
continuous benchmark so far.  Instead of moving the experiment back to the
heavier five-person project, this script turns that known-good map into a
small, physical podcast set: one hero, one chair, one desk, one microphone and
three clean editorial shot lanes controlled by the runtime bridge.
"""

from __future__ import annotations

import unreal


SOURCE_LEVEL = "/Game/FirstPerson/Maps/FirstPersonMap"
TARGET_LEVEL = "/Game/Conclavia/Grade1/L_Grade1HeroPop"
CONTENT_ROOT = "/Game/Conclavia/Grade1"

CUBE = "/Engine/BasicShapes/Cube.Cube"
SPHERE = "/Engine/BasicShapes/Sphere.Sphere"
CYLINDER = "/Engine/BasicShapes/Cylinder.Cylinder"
AERA_CLASS = "/Game/MetaHumans/Aera/BP_Aera.BP_Aera_C"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_GRADE1: {message}")


def delete_asset(path: str) -> None:
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)


def make_material(
    name: str,
    color: unreal.LinearColor,
    *,
    roughness: float,
    metallic: float = 0.0,
    emissive: float = 0.0,
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
        raise RuntimeError(f"Could not create material {path}")

    base = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant4Vector, -360, -20
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

    if emissive > 0.0:
        glow = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant4Vector, -360, 235
        )
        glow.set_editor_property(
            "constant",
            unreal.LinearColor(
                color.r * emissive,
                color.g * emissive,
                color.b * emissive,
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
    return {
        "navy": make_material(
            "M_Grade1Navy",
            unreal.LinearColor(0.003, 0.008, 0.020, 1.0),
            roughness=0.62,
        ),
        "graphite": make_material(
            "M_Grade1Graphite",
            unreal.LinearColor(0.016, 0.022, 0.034, 1.0),
            roughness=0.34,
            metallic=0.45,
        ),
        "fabric": make_material(
            "M_Grade1Fabric",
            unreal.LinearColor(0.055, 0.075, 0.105, 1.0),
            roughness=0.92,
        ),
        "cyan": make_material(
            "M_Grade1Cyan",
            unreal.LinearColor(0.0, 0.22, 0.44, 1.0),
            roughness=0.42,
            emissive=0.72,
        ),
        "coral": make_material(
            "M_Grade1Coral",
            unreal.LinearColor(0.50, 0.025, 0.010, 1.0),
            roughness=0.48,
            emissive=0.58,
        ),
        "gold": make_material(
            "M_Grade1Gold",
            unreal.LinearColor(0.38, 0.12, 0.006, 1.0),
            roughness=0.50,
            emissive=0.36,
        ),
        "metal": make_material(
            "M_Grade1Metal",
            unreal.LinearColor(0.012, 0.017, 0.026, 1.0),
            roughness=0.20,
            metallic=0.82,
        ),
        "ceramic": make_material(
            "M_Grade1Ceramic",
            unreal.LinearColor(0.20, 0.16, 0.12, 1.0),
            roughness=0.24,
        ),
    }


def actor_subsystem() -> unreal.EditorActorSubsystem:
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def find_hero() -> unreal.Actor:
    candidates = []
    for actor in actor_subsystem().get_all_level_actors():
        class_name = actor.get_class().get_name().casefold()
        label = actor.get_actor_label().casefold()
        if "aera" in class_name or "aera" in label:
            candidates.append(actor)
    if candidates:
        return candidates[0]

    # The commercial sample creates Aera in BeginPlay.  Commandlet authoring
    # deliberately never enters game mode, so the source level contains no
    # serialized performer to discover.  Persist the exact same purchased
    # MetaHuman class in the Grade 1 map; the runtime bridge can then attach
    # the proven Face AnimBP and commercial solver without a duplicate spawn.
    actor_class = unreal.load_class(None, AERA_CLASS)
    if actor_class is None:
        raise RuntimeError(f"Could not load commercial hero class {AERA_CLASS}")
    hero = actor_subsystem().spawn_actor_from_class(
        actor_class,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(),
    )
    if hero is None:
        raise RuntimeError(f"Could not spawn commercial hero class {AERA_CLASS}")
    return hero


def find_face_component(hero: unreal.Actor) -> unreal.SkeletalMeshComponent:
    for component in hero.get_components_by_class(unreal.SkeletalMeshComponent):
        if component.get_name().casefold() == "face":
            return component
    raise RuntimeError("The commercial hero has no Face skeletal-mesh component")


def add_shape(
    label: str,
    mesh_path: str,
    location: unreal.Vector,
    scale: unreal.Vector,
    material: unreal.MaterialInterface,
    rotation: unreal.Rotator,
    *,
    cast_shadow: bool = True,
) -> unreal.StaticMeshActor:
    actor = actor_subsystem().spawn_actor_from_class(
        unreal.StaticMeshActor, location, rotation
    )
    if actor is None:
        raise RuntimeError(f"Could not spawn {label}")
    actor.set_actor_label(label)
    actor.tags = [unreal.Name("ConclaviaGrade1"), unreal.Name(label)]
    actor.set_actor_scale3d(scale)
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    mesh = unreal.load_asset(mesh_path)
    if not isinstance(component, unreal.StaticMeshComponent) or not isinstance(
        mesh, unreal.StaticMesh
    ):
        raise RuntimeError(f"Missing mesh/component for {label}")
    component.set_static_mesh(mesh)
    component.set_material(0, material)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    component.set_cast_shadow(cast_shadow)
    return actor


def look_at(actor: unreal.Actor, target: unreal.Vector) -> None:
    actor.set_actor_rotation(
        unreal.MathLibrary.find_look_at_rotation(actor.get_actor_location(), target),
        False,
    )


def add_rect_light(
    label: str,
    location: unreal.Vector,
    target: unreal.Vector,
    color: unreal.LinearColor,
    intensity: float,
    width: float,
    height: float,
) -> None:
    light = actor_subsystem().spawn_actor_from_class(unreal.RectLight, location)
    if not isinstance(light, unreal.RectLight):
        raise RuntimeError(f"Could not spawn {label}")
    light.set_actor_label(label)
    light.tags = [unreal.Name("ConclaviaGrade1"), unreal.Name(label)]
    look_at(light, target)
    component = light.get_component_by_class(unreal.RectLightComponent)
    component.set_editor_property("intensity", intensity)
    component.set_editor_property("light_color", color.to_color(True))
    component.set_editor_property("source_width", width)
    component.set_editor_property("source_height", height)
    component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)


def offset(
    origin: unreal.Vector,
    side: unreal.Vector,
    front: unreal.Vector,
    x: float,
    y: float,
    z: float,
) -> unreal.Vector:
    return unreal.Vector(
        origin.x + side.x * x + front.x * y,
        origin.y + side.y * x + front.y * y,
        origin.z + z,
    )


def clean_previous_grade1() -> None:
    for actor in actor_subsystem().get_all_level_actors():
        if "ConclaviaGrade1" in {str(tag) for tag in actor.tags}:
            actor_subsystem().destroy_actor(actor)


def clean_source_geometry(hero: unreal.Actor) -> int:
    """Remove the First Person template's walls before authoring our set.

    The commercial sample ships inside FirstPersonMap. Its grey test-room
    cubes were still serialized into the derived Grade 1 level and crossed
    the context/right camera lanes even when every Conclavia prop was placed
    correctly. Runtime owns portrait lighting, so only physical template
    geometry is removed here; the purchased MetaHuman and world services stay
    untouched.
    """
    removed = 0
    for actor in list(actor_subsystem().get_all_level_actors()):
        if actor == hero:
            continue
        class_name = actor.get_class().get_name().casefold()
        if isinstance(actor, unreal.StaticMeshActor) or class_name in {
            "brush",
            "blockingvolume",
        }:
            actor_subsystem().destroy_actor(actor)
            removed += 1
    return removed


def build() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(SOURCE_LEVEL):
        raise RuntimeError(f"Could not load {SOURCE_LEVEL}")
    clean_previous_grade1()
    unreal.EditorAssetLibrary.make_directory(f"{CONTENT_ROOT}/Materials")
    hero = find_hero()
    hero.set_actor_label("CONCLAVIA_GRADE1_HERO_AERA")
    hero.tags = list(hero.tags) + [unreal.Name("ConclaviaGrade1Hero")]
    removed_source_geometry = clean_source_geometry(hero)

    face = find_face_component(hero)
    bounds_origin, bounds_extent = hero.get_actor_bounds(False)
    # The assembled MetaHuman blueprint and its Face component use opposite
    # local-facing signs.  Runtime cameras are calibrated from Face, therefore
    # the physical set must use the same axes.  Actor axes put the wall, desk
    # and one colour panel between lens and performer in the first Grade 1
    # render even though their relative offsets looked correct in the editor.
    # SceneComponent direction vectors are already normalized by Unreal.
    # Python's Vector wrapper does not expose C++'s GetSafeNormal().
    front = face.get_right_vector()
    side = face.get_forward_vector()
    # Use the same component basis as the camera rig. MetaHuman's assembled
    # root is rotated relative to Face; applying the root rotation to props
    # turned thin wall/desk axes across the camera lane.
    rotation = face.get_world_rotation()
    head = unreal.Vector(
        bounds_origin.x,
        bounds_origin.y,
        bounds_origin.z + bounds_extent.z - 25.0,
    )
    materials = create_materials()

    # Layered acoustic wall: dark physical depth, three asymmetric colour
    # fields and narrow practical strips.  It stays readable in both the
    # context shot and the shallow-depth portrait without looking like a game
    # calibration room.
    add_shape(
        "GRADE1_BackWall",
        CUBE,
        offset(head, side, front, 0.0, -175.0, -18.0),
        unreal.Vector(3.8, 0.18, 2.7),
        materials["navy"],
        rotation,
    )
    for index, (x, width, material_name, height) in enumerate(
        (
            (-118.0, 0.78, "cyan", 1.75),
            (-25.0, 0.58, "gold", 2.10),
            (73.0, 0.92, "coral", 1.88),
        ),
        start=1,
    ):
        add_shape(
            f"GRADE1_Panel_{index}",
            CUBE,
            offset(head, side, front, x, -164.0, -10.0),
            unreal.Vector(width, 0.055, height),
            materials[material_name],
            rotation,
            cast_shadow=False,
        )
    for index, x in enumerate((-164.0, 146.0), start=1):
        add_shape(
            f"GRADE1_Practical_{index}",
            CUBE,
            offset(head, side, front, x, -150.0, -4.0),
            unreal.Vector(0.035, 0.035, 2.25),
            materials["cyan" if index == 1 else "coral"],
            rotation,
            cast_shadow=False,
        )

    add_shape(
        "GRADE1_Floor",
        CUBE,
        offset(head, side, front, 0.0, 12.0, -176.0),
        unreal.Vector(4.1, 3.0, 0.075),
        materials["graphite"],
        rotation,
    )
    add_shape(
        "GRADE1_Rug",
        CYLINDER,
        offset(head, side, front, 0.0, 18.0, -166.5),
        unreal.Vector(2.15, 1.45, 0.025),
        materials["fabric"],
        rotation,
        cast_shadow=False,
    )

    # The chair back plus the high shared desk produce an unmistakably seated
    # podcast silhouette while safely masking the commercial sample's standing
    # lower-body rig.  This makes Grade 1 visually honest without risking a new
    # retargeting stack before the face benchmark is locked.
    add_shape(
        "GRADE1_ChairBack",
        SPHERE,
        offset(head, side, front, 0.0, -24.0, -86.0),
        unreal.Vector(0.66, 0.34, 0.82),
        materials["fabric"],
        rotation,
    )
    add_shape(
        "GRADE1_DeskTop",
        CUBE,
        offset(head, side, front, 0.0, 42.0, -101.0),
        unreal.Vector(1.70, 0.46, 0.075),
        materials["metal"],
        rotation,
    )
    add_shape(
        "GRADE1_DeskFascia",
        CUBE,
        offset(head, side, front, 0.0, 51.0, -136.0),
        unreal.Vector(1.62, 0.17, 0.58),
        materials["graphite"],
        rotation,
    )
    add_shape(
        "GRADE1_DeskGlow",
        CUBE,
        offset(head, side, front, 0.0, 69.0, -119.0),
        unreal.Vector(1.34, 0.020, 0.022),
        materials["cyan"],
        rotation,
        cast_shadow=False,
    )

    # One detailed hero prop is more convincing than decorative clutter.  The
    # boom, grille rings and small water cup remain visible in the context and
    # three-quarter shots but never cover the mouth.
    mic_side = 77.0
    add_shape(
        "GRADE1_MicBase",
        CYLINDER,
        offset(head, side, front, mic_side, 31.0, -88.0),
        unreal.Vector(0.13, 0.13, 0.035),
        materials["metal"],
        rotation,
    )
    add_shape(
        "GRADE1_MicStem",
        CYLINDER,
        offset(head, side, front, mic_side, 31.0, -68.0),
        unreal.Vector(0.025, 0.025, 0.37),
        materials["graphite"],
        rotation,
    )
    add_shape(
        "GRADE1_MicCapsule",
        SPHERE,
        offset(head, side, front, mic_side - 14.0, 24.0, -43.0),
        unreal.Vector(0.16, 0.12, 0.11),
        materials["metal"],
        rotation,
    )
    add_shape(
        "GRADE1_WaterCup",
        CYLINDER,
        offset(head, side, front, -91.0, 30.0, -86.0),
        unreal.Vector(0.085, 0.085, 0.15),
        materials["ceramic"],
        rotation,
        cast_shadow=False,
    )

    # Portrait lighting is owned by the runtime bridge.  Duplicating it here
    # with three baked RectLights caused eye/skin clipping after auto exposure
    # adapted to the dark navy set.  One lighting authority also guarantees
    # that every editorial camera sees the same face contrast.

    world = unreal.get_editor_subsystem(
        unreal.UnrealEditorSubsystem
    ).get_editor_world()
    if not unreal.EditorLoadingAndSavingUtils.save_map(world, TARGET_LEVEL):
        raise RuntimeError(f"Could not save {TARGET_LEVEL}")
    log(
        "READY map={} hero={} removed_source_geometry={} bounds=({:.1f},{:.1f},{:.1f}) front=({:.3f},{:.3f},{:.3f})".format(
            TARGET_LEVEL,
            hero.get_actor_label(),
            removed_source_geometry,
            bounds_extent.x,
            bounds_extent.y,
            bounds_extent.z,
            front.x,
            front.y,
            front.z,
        )
    )


if __name__ == "__main__":
    build()
