"""Install the project-side skeleton expected by the commercial Face AnimBP.

The Fab plugin ships a compatible skeleton inside its own mount point, while
its runtime animation blueprint resolves the standard MetaHuman project path.
Duplicating through Unreal preserves the package identity and references; a
filesystem copy would leave the source package name embedded in the asset.
"""

import unreal


SOURCE = "/RuntimeMetaHumanLipSync/LipSyncData/LipSync_Face_Archetype_Skeleton"
TARGET_DIRECTORY = "/Game/MetaHumans/Common/Face"
TARGET = f"{TARGET_DIRECTORY}/Face_Archetype_Skeleton"


if unreal.EditorAssetLibrary.does_asset_exist(TARGET):
    unreal.log(f"Conclavia commercial lip-sync skeleton already present: {TARGET}")
else:
    if not unreal.EditorAssetLibrary.does_asset_exist(SOURCE):
        raise RuntimeError(f"Commercial lip-sync source skeleton is missing: {SOURCE}")
    unreal.EditorAssetLibrary.make_directory(TARGET_DIRECTORY)
    duplicated = unreal.EditorAssetLibrary.duplicate_asset(SOURCE, TARGET)
    if not duplicated or not unreal.EditorAssetLibrary.does_asset_exist(TARGET):
        raise RuntimeError(f"Could not duplicate {SOURCE} to {TARGET}")
    if not unreal.EditorAssetLibrary.save_asset(TARGET, only_if_is_dirty=False):
        raise RuntimeError(f"Could not save {TARGET}")
    unreal.log(f"Conclavia commercial lip-sync skeleton installed: {TARGET}")
