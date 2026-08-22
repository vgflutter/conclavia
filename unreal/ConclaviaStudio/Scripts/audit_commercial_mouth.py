"""Audit the commercial MetaHuman mouth assets used by the live lip-sync lab.

The bridge changes runtime material instances, so this script records the
authored teeth / oral-cavity material parameters and texture resolution before
we tune them.  It deliberately does not mutate project content.
"""

from __future__ import annotations

import json
import os
from typing import Any

import unreal


OUTPUT = os.path.join(
    unreal.Paths.project_saved_dir(), "Audits", "commercial-mouth.json"
)
TOKENS = ("teeth", "tooth", "gum", "tongue", "mouth", "oral", "cavity")


def editor_property(value: Any, name: str, default: Any = None) -> Any:
    try:
        return value.get_editor_property(name)
    except Exception:
        return default


def object_path(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return value.get_path_name()
    except Exception:
        return str(value)


def parameter_name(entry: Any) -> str:
    info = editor_property(entry, "parameter_info")
    return str(editor_property(info, "name", "unknown"))


def value_json(value: Any) -> Any:
    if isinstance(value, (bool, int, float, str)) or value is None:
        return value
    if isinstance(value, unreal.LinearColor):
        return [value.r, value.g, value.b, value.a]
    return str(value)


def material_chain(material: Any) -> list[Any]:
    chain: list[Any] = []
    seen: set[str] = set()
    current = material
    while current is not None:
        key = object_path(current) or str(id(current))
        if key in seen:
            break
        seen.add(key)
        chain.append(current)
        current = editor_property(current, "parent")
    return chain


def texture_report(texture: Any) -> dict[str, Any]:
    size = None
    try:
        size = [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()]
    except Exception:
        pass
    return {
        "path": object_path(texture),
        "size": size,
        "lodBias": editor_property(texture, "lod_bias"),
        "neverStream": editor_property(texture, "never_stream"),
    }


def material_report(material: Any) -> dict[str, Any]:
    report: dict[str, Any] = {
        "path": object_path(material),
        "class": material.get_class().get_name(),
        "chain": [object_path(item) for item in material_chain(material)],
        "scalars": {},
        "vectors": {},
        "textures": {},
    }
    for source in reversed(material_chain(material)):
        for entry in editor_property(source, "scalar_parameter_values", ()) or ():
            report["scalars"][parameter_name(entry)] = value_json(
                editor_property(entry, "parameter_value")
            )
        for entry in editor_property(source, "vector_parameter_values", ()) or ():
            report["vectors"][parameter_name(entry)] = value_json(
                editor_property(entry, "parameter_value")
            )
        for entry in editor_property(source, "texture_parameter_values", ()) or ():
            texture = editor_property(entry, "parameter_value")
            report["textures"][parameter_name(entry)] = texture_report(texture)
    return report


def main() -> None:
    assets = unreal.EditorAssetLibrary.list_assets("/Game", recursive=True)
    matches = [
        path
        for path in assets
        if any(token in path.casefold() for token in TOKENS)
        and "material" in path.casefold()
    ]
    # MI_Teeth_Baked does not necessarily live in a folder named Materials.
    matches.extend(
        path
        for path in assets
        if any(token in path.rsplit("/", 1)[-1].casefold() for token in TOKENS)
    )
    reports = []
    for path in sorted(set(matches)):
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if asset is None or "Material" not in asset.get_class().get_name():
            continue
        reports.append(material_report(asset))

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as output:
        json.dump({"materials": reports}, output, indent=2, ensure_ascii=False)
    unreal.log_warning(
        f"CONCLAVIA_COMMERCIAL_MOUTH_AUDIT: materials={len(reports)} path={OUTPUT}"
    )


if __name__ == "__main__":
    main()
