"""Write a compact JSON inventory of every baked production texture."""

from __future__ import annotations

import json
import os

import unreal


ROOTS = (
    "/Game/Conclavia/Production/MetaHumans",
    "/Game/Conclavia/Production/Hero",
)
OUTPUT = os.path.join(
    unreal.Paths.project_saved_dir(), "Audits", "production-textures.json"
)


def prop(value: object, name: str, default: object = None) -> object:
    try:
        return value.get_editor_property(name)
    except Exception:
        return default


def dimensions(texture: unreal.Texture) -> tuple[int | None, int | None]:
    try:
        return texture.blueprint_get_size_x(), texture.blueprint_get_size_y()
    except Exception:
        return None, None


def main() -> None:
    rows: list[dict[str, object]] = []
    for root in ROOTS:
        for object_path in unreal.EditorAssetLibrary.list_assets(
            root, recursive=True, include_folder=False
        ):
            asset = unreal.load_asset(object_path)
            if not isinstance(asset, unreal.Texture):
                continue
            width, height = dimensions(asset)
            rows.append(
                {
                    "path": object_path,
                    "width": width,
                    "height": height,
                    "lodBias": prop(asset, "lod_bias"),
                    "lodGroup": str(prop(asset, "lod_group")),
                    "neverStream": prop(asset, "never_stream"),
                    "compression": str(prop(asset, "compression_settings")),
                    "virtualTexture": prop(asset, "virtual_texture_streaming"),
                }
            )
    rows.sort(key=lambda row: str(row["path"]))
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as output:
        json.dump(rows, output, indent=2)
    unreal.log_warning(
        f"CONCLAVIA_TEXTURE_AUDIT: COMPLETE textures={len(rows)} output={OUTPUT}"
    )


if __name__ == "__main__":
    main()
