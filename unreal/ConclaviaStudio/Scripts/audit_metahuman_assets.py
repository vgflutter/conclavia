"""Report reusable MetaHuman runtime assets bundled with Unreal Engine.

This does not download or acquire marketplace content. It only inspects assets
already installed with the MetaHuman Character engine plugin so the POC can
decide whether a license-independent technical cast is viable.
"""

from __future__ import annotations

import unreal


EXACT_ASSETS = (
    "/MetaHumanCharacter/Body/IdentityTemplate/SKM_Body",
    "/MetaHumanCharacter/Body/IdentityTemplate/SKM_Body_DNA",
    "/MetaHumanCharacter/Face/SKM_Face",
    "/MetaHumanCharacter/Face/SKM_Face_DNA",
    "/MetaHumanAnimator/TestData/Meshes/Ada_StaticMesh",
    "/MetaHumanAnimator/TestData/Meshes/Remeshed_Ada_StaticMesh",
)

LIST_TOKENS = (
    "preset",
    "template",
    "character",
    "wardrobe",
    "outfit",
    "ada",
    "etta",
)


def describe_asset(path: str) -> None:
    asset = unreal.load_asset(path)
    if asset is None:
        return

    asset_class = asset.get_class().get_name()
    details = [f"path={path}", f"class={asset_class}"]
    if isinstance(asset, unreal.SkeletalMesh):
        materials = asset.get_editor_property("materials")
        details.append(f"materials={len(materials)}")
        details.append(f"bounds={asset.get_bounds().box_extent}")
        skeleton = asset.get_editor_property("skeleton")
        details.append(f"skeleton={skeleton.get_path_name() if skeleton else 'none'}")

    unreal.log_warning("CONCLAVIA_MH_ASSET: " + " | ".join(details))


def main() -> None:
    for path in EXACT_ASSETS:
        describe_asset(path)
    matches = []
    for path in unreal.EditorAssetLibrary.list_assets(
        "/MetaHumanCharacter", recursive=True, include_folder=False
    ):
        if any(token in path.casefold() for token in LIST_TOKENS):
            matches.append(path)
    for path in matches[:300]:
        unreal.log_warning(f"CONCLAVIA_MH_CANDIDATE: {path}")
    unreal.log_warning(f"CONCLAVIA_MH_CANDIDATE: total={len(matches)}")
    unreal.log_warning("CONCLAVIA_MH_ASSET: AUDIT_COMPLETE")


main()
