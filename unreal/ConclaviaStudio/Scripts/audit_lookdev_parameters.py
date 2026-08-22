"""Write a compact look-development audit for the staged Cinematic cast.

The production MetaHuman materials expose hundreds of wrinkle-map controls.
Those are useful at animation time but drown out the few global values that
matter for a neutral portrait.  This audit keeps only global skin/eye controls,
resolved texture sizes, groom state and usable facial morph targets.
"""

from __future__ import annotations

import json
import os
from typing import Any

import unreal


LEVEL = "/Game/Conclavia/Studio/L_PremiumStudio"
OUTPUT = os.path.join(
    unreal.Paths.project_saved_dir(), "Audits", "production-lookdev.json"
)
KEEP_SCALAR_TOKENS = (
    "rough",
    "spec",
    "scatter",
    "cloud",
    "iris",
    "pupil",
    "sclera",
    "cornea",
    "wet",
    "normal strength",
    "cavity",
    "contrast",
    "brightness",
    "saturation",
)
SKIP_SCALAR_TOKENS = (
    "head_wm",
    "brow_",
    "cheek_",
    "eye_crease",
    "mouth_",
    "nose_",
)
MORPH_TOKENS = (
    "blink",
    "squint",
    "look",
    "brow",
    "jaw",
    "mouth",
    "smile",
)


def property_value(value: Any, name: str, default: Any = None) -> Any:
    try:
        return value.get_editor_property(name)
    except Exception:
        return default


def path(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return value.get_path_name()
    except Exception:
        return str(value)


def texture_size(texture: Any) -> list[int] | None:
    if texture is None:
        return None
    try:
        return [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()]
    except Exception:
        return None


def parameter_name(entry: Any) -> str:
    info = property_value(entry, "parameter_info")
    return str(property_value(info, "name", "unknown"))


def serialize_value(value: Any) -> Any:
    if isinstance(value, (bool, int, float, str)) or value is None:
        return value
    if isinstance(value, unreal.LinearColor):
        return [value.r, value.g, value.b, value.a]
    return str(value)


def material_chain(material: Any) -> list[Any]:
    result = []
    seen: set[str] = set()
    current = material
    while current is not None:
        current_path = path(current) or str(id(current))
        if current_path in seen:
            break
        seen.add(current_path)
        result.append(current)
        current = property_value(current, "parent")
    return result


def material_report(material: Any) -> dict[str, Any]:
    report: dict[str, Any] = {
        "path": path(material),
        "class": material.get_class().get_name(),
        "chain": [path(item) for item in material_chain(material)],
        "scalars": {},
        "vectors": {},
        "textures": {},
    }
    for source in reversed(material_chain(material)):
        for entry in property_value(source, "scalar_parameter_values", ()) or ():
            name = parameter_name(entry)
            lowered = name.casefold()
            if any(token in lowered for token in SKIP_SCALAR_TOKENS):
                continue
            if not any(token in lowered for token in KEEP_SCALAR_TOKENS):
                continue
            report["scalars"][name] = serialize_value(
                property_value(entry, "parameter_value")
            )
        for entry in property_value(source, "vector_parameter_values", ()) or ():
            name = parameter_name(entry)
            lowered = name.casefold()
            if any(
                token in lowered
                for token in ("skin", "base", "color", "sclera", "iris")
            ):
                report["vectors"][name] = serialize_value(
                    property_value(entry, "parameter_value")
                )
        for entry in property_value(source, "texture_parameter_values", ()) or ():
            name = parameter_name(entry)
            lowered = name.casefold()
            if not any(
                token in lowered
                for token in (
                    "base",
                    "color",
                    "normal",
                    "spec",
                    "rough",
                    "scatter",
                    "iris",
                    "sclera",
                )
            ):
                continue
            texture = property_value(entry, "parameter_value")
            report["textures"][name] = {
                "path": path(texture),
                "size": texture_size(texture),
                "lodBias": property_value(texture, "lod_bias"),
                "neverStream": property_value(texture, "never_stream"),
            }
    return report


def morph_names(component: unreal.SkeletalMeshComponent) -> list[str]:
    mesh = component.get_skeletal_mesh_asset()
    targets = property_value(mesh, "morph_targets", ()) or ()
    names = []
    for target in targets:
        name = target.get_name()
        if any(token in name.casefold() for token in MORPH_TOKENS):
            names.append(name)
    return sorted(names)


def actor_report(actor: unreal.Actor) -> dict[str, Any]:
    result: dict[str, Any] = {
        "label": actor.get_actor_label(),
        "skeletal": [],
        "grooms": [],
        "lodSync": [],
    }
    for component in actor.get_components_by_class(unreal.ActorComponent):
        class_name = component.get_class().get_name()
        if isinstance(component, unreal.SkeletalMeshComponent):
            mesh = component.get_skeletal_mesh_asset()
            slots = []
            for index, material in enumerate(component.get_materials()):
                if material is None:
                    continue
                material_path = (path(material) or "").casefold()
                if not any(
                    token in material_path
                    for token in ("face", "skin", "eye", "tear", "lacrimal")
                ):
                    continue
                slots.append({"index": index, **material_report(material)})
            if slots or "face" in (path(mesh) or "").casefold():
                result["skeletal"].append(
                    {
                        "component": component.get_name(),
                        "mesh": path(mesh),
                        "forcedLodModel": property_value(
                            component, "forced_lod_model"
                        ),
                        "minLodModel": property_value(component, "min_lod_model"),
                        "morphTargets": morph_names(component),
                        "materials": slots,
                    }
                )
        elif "Groom" in class_name:
            result["grooms"].append(
                {
                    "component": component.get_name(),
                    "asset": path(property_value(component, "groom_asset")),
                    "forcedLod": property_value(component, "forced_lod"),
                }
            )
        elif "LODSync" in class_name:
            result["lodSync"].append(
                {
                    "component": component.get_name(),
                    "forcedLod": property_value(component, "forced_lod"),
                    "minLod": property_value(component, "min_lod"),
                }
            )
    return result


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL):
        raise RuntimeError(f"Could not load {LEVEL}")
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
        raise RuntimeError(f"Expected five staged actors, found {len(cast)}")
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as output:
        json.dump(
            {"level": LEVEL, "actors": [actor_report(actor) for actor in cast]},
            output,
            ensure_ascii=False,
            indent=2,
        )
    unreal.log_warning(f"CONCLAVIA_LOOKDEV_AUDIT: READY path={OUTPUT}")


if __name__ == "__main__":
    main()
