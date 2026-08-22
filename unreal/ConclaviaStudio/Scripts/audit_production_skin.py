"""Audit the exact MetaHuman skin stack used by the staged production cast.

The report is intentionally asset- and component-level: it verifies that the
actors visible in Pixel Streaming use the assembled Cinematic face, LOD 0,
high-resolution texture parameters, eyes and strand grooms.  It does not alter
the project, so it is safe to run before and after a quality pass.
"""

from __future__ import annotations

from typing import Any

import unreal


LEVEL = "/Game/Conclavia/Studio/L_PremiumStudio"
SKIN_TOKENS = (
    "skin",
    "face",
    "head",
    "normal",
    "rough",
    "spec",
    "cavity",
    "detail",
    "albedo",
    "basecolor",
    "base_color",
    "eye",
)


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_SKIN_AUDIT: {message}")


def editor_property(value: Any, name: str, default: Any = "n/a") -> Any:
    try:
        return value.get_editor_property(name)
    except Exception:
        return default


def object_path(value: Any) -> str:
    if value is None:
        return "none"
    try:
        return value.get_path_name()
    except Exception:
        return str(value)


def texture_size(texture: Any) -> str:
    if texture is None:
        return "none"
    for method_x, method_y in (
        ("blueprint_get_size_x", "blueprint_get_size_y"),
        ("get_size_x", "get_size_y"),
    ):
        try:
            width = getattr(texture, method_x)()
            height = getattr(texture, method_y)()
            return f"{width}x{height}"
        except Exception:
            continue
    return "unknown"


def parameter_name(entry: Any) -> str:
    info = editor_property(entry, "parameter_info", None)
    name = editor_property(info, "name", "unknown") if info else "unknown"
    return str(name)


def audit_material(material: Any, actor_label: str, component_name: str) -> None:
    if material is None:
        return
    material_path = object_path(material)
    log(
        f"MATERIAL actor={actor_label} component={component_name} "
        f"class={material.get_class().get_name()} path={material_path}"
    )

    parent = editor_property(material, "parent", None)
    if parent not in (None, "n/a"):
        log(f"MATERIAL_PARENT material={material_path} path={object_path(parent)}")

    for property_name in (
        "texture_parameter_values",
        "scalar_parameter_values",
        "vector_parameter_values",
    ):
        entries = editor_property(material, property_name, ())
        if entries == "n/a":
            continue
        for entry in entries:
            name = parameter_name(entry)
            if not any(token in name.casefold() for token in SKIN_TOKENS):
                continue
            value = editor_property(entry, "parameter_value", "n/a")
            if property_name == "texture_parameter_values":
                log(
                    f"TEXTURE material={material_path} parameter={name} "
                    f"path={object_path(value)} size={texture_size(value)} "
                    f"lod_bias={editor_property(value, 'lod_bias')} "
                    f"never_stream={editor_property(value, 'never_stream')}"
                )
            else:
                log(
                    f"PARAM material={material_path} parameter={name} value={value}"
                )


def audit_skeletal_component(actor_label: str, component: Any) -> None:
    mesh = component.get_skeletal_mesh_asset()
    mesh_path = object_path(mesh)
    component_name = component.get_name()
    log(
        f"SKELETAL actor={actor_label} component={component_name} mesh={mesh_path} "
        f"forced_lod={editor_property(component, 'forced_lod_model')} "
        f"min_lod={editor_property(component, 'min_lod_model')} "
        f"update_rate_optimizations="
        f"{editor_property(component, 'enable_update_rate_optimizations')}"
    )
    for index, material in enumerate(component.get_materials()):
        log(
            f"SLOT actor={actor_label} component={component_name} "
            f"index={index} material={object_path(material)}"
        )
        lower = object_path(material).casefold()
        if any(token in lower for token in SKIN_TOKENS):
            audit_material(material, actor_label, component_name)


def audit_actor(actor: unreal.Actor) -> None:
    label = actor.get_actor_label()
    log(f"ACTOR label={label} class={actor.get_class().get_path_name()}")
    for component in actor.get_components_by_class(unreal.ActorComponent):
        class_name = component.get_class().get_name()
        if isinstance(component, unreal.SkeletalMeshComponent):
            audit_skeletal_component(label, component)
        elif "LODSync" in class_name:
            log(
                f"LODSYNC actor={label} component={component.get_name()} "
                f"forced_lod={editor_property(component, 'forced_lod')} "
                f"min_lod={editor_property(component, 'min_lod')}"
            )
        elif "Groom" in class_name:
            log(
                f"GROOM actor={label} component={component.get_name()} "
                f"asset={object_path(editor_property(component, 'groom_asset', None))} "
                f"forced_lod={editor_property(component, 'forced_lod')}"
            )


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL):
        raise RuntimeError(f"Could not load {LEVEL}")
    actors = unreal.get_editor_subsystem(
        unreal.EditorActorSubsystem
    ).get_all_level_actors()
    cast = [
        actor
        for actor in actors
        if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}
    ]
    if len(cast) != 5:
        raise RuntimeError(f"Expected five staged actors, found {len(cast)}")
    for actor in sorted(cast, key=lambda value: value.get_actor_label()):
        audit_actor(actor)
    log("COMPLETE actors=5")


if __name__ == "__main__":
    main()
