"""Build Conclavia's first maximum-quality runtime MetaHuman.

The local preview actor is useful for validating GPU and Pixel Streaming, but
it deliberately lacks the production face rig and source textures. This gate
duplicates one of Epic's authored UE 5.8 presets, requests those cloud assets
and assembles the Cinematic pipeline used for the visual quality comparison.
"""

from __future__ import annotations

import unreal


PRESET_NAME = "Omari"
PRESET_PATH = (
    f"/MetaHumanCharacter/Optional/Presets/{PRESET_NAME}.{PRESET_NAME}"
)
CHARACTER_FOLDER = "/Game/Conclavia/Production/Characters"
CHARACTER_NAME = "MHC_MarcoBellini"
CHARACTER_PATH = f"{CHARACTER_FOLDER}/{CHARACTER_NAME}.{CHARACTER_NAME}"
BUILD_PATH = "/Game/Conclavia/Production/Hero"
COMMON_PATH = "/Game/Conclavia/Production/Common"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_PRODUCTION_HERO: {message}")


def fresh_character() -> unreal.MetaHumanCharacter:
    source = unreal.load_asset(PRESET_PATH)
    if not isinstance(source, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Missing MetaHuman preset: {PRESET_PATH}")

    existing = unreal.load_asset(CHARACTER_PATH)
    if isinstance(existing, unreal.MetaHumanCharacter):
        # Only the project-owned hero character is replaced. A cancelled cloud
        # request can otherwise leave an asset that looks valid but cannot be
        # assembled on the next run.
        unreal.EditorAssetLibrary.delete_asset(
            f"{CHARACTER_FOLDER}/{CHARACTER_NAME}"
        )
        log(f"removed incomplete character={CHARACTER_PATH}")

    character = unreal.AssetToolsHelpers.get_asset_tools().duplicate_asset(
        asset_name=CHARACTER_NAME,
        package_path=CHARACTER_FOLDER,
        original_object=source,
    )
    if not isinstance(character, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Could not duplicate preset {PRESET_NAME}")
    unreal.EditorAssetLibrary.save_loaded_asset(character, only_if_is_dirty=False)
    log(f"created character={CHARACTER_PATH} preset={PRESET_NAME}")
    return character


def request_production_sources(
    character: unreal.MetaHumanCharacter,
    subsystem: unreal.MetaHumanCharacterEditorSubsystem,
) -> None:
    rig_request = unreal.MetaHumanCharacterAutoRiggingRequestParams()
    rig_request.blocking = True
    rig_request.report_progress = False
    rig_request.rig_type = unreal.MetaHumanRigType.JOINTS_AND_BLEND_SHAPES
    log("autorig start")
    subsystem.request_auto_rigging(character=character, params=rig_request)
    log("autorig complete")

    texture_request = unreal.MetaHumanCharacterTextureRequestParams()
    texture_request.blocking = True
    texture_request.report_progress = False
    log("texture source request start")
    subsystem.request_texture_sources(character=character, params=texture_request)
    if not character.has_high_resolution_textures:
        raise RuntimeError("High-resolution MetaHuman textures were not downloaded")
    log("texture source request complete")


def build() -> None:
    unreal.EditorAssetLibrary.make_directory(CHARACTER_FOLDER)
    unreal.EditorAssetLibrary.make_directory(BUILD_PATH)
    unreal.EditorAssetLibrary.make_directory(COMMON_PATH)
    character = fresh_character()
    subsystem = unreal.get_editor_subsystem(
        unreal.MetaHumanCharacterEditorSubsystem
    )
    if not subsystem.try_add_object_to_edit(character=character):
        raise RuntimeError("Could not register the production hero for editing")

    try:
        log("preview integrity check")
        subsystem.assemble_for_preview(character=character)
        request_production_sources(character, subsystem)
        if not subsystem.can_build_meta_human(character=character):
            raise RuntimeError("MetaHuman is not ready for Cinematic assembly")

        params = unreal.MetaHumanCharacterEditorBuildParameters()
        params.pipeline_type = unreal.MetaHumanDefaultPipelineType.CINEMATIC
        params.absolute_build_path = BUILD_PATH
        params.common_folder_path = COMMON_PATH
        params.name_override = CHARACTER_NAME
        params.enable_wardrobe_item_validation = True
        log("assembly start pipeline=Cinematic")
        subsystem.build_meta_human(character=character, params=params)
        log("assembly complete pipeline=Cinematic")
    finally:
        if subsystem.is_object_added_for_editing(character=character):
            subsystem.remove_object_to_edit(character=character)

    unreal.EditorAssetLibrary.save_directory(
        "/Game/Conclavia/Production",
        only_if_is_dirty=False,
        recursive=True,
    )
    assets = unreal.EditorAssetLibrary.list_assets(
        BUILD_PATH,
        recursive=True,
        include_folder=False,
    )
    for asset_path in assets:
        log(f"asset={asset_path}")
    if not assets:
        raise RuntimeError("Cinematic assembly produced no runtime assets")
    log(
        f"READY character={CHARACTER_NAME} preset={PRESET_NAME} "
        f"pipeline=Cinematic assets={len(assets)}"
    )


if __name__ == "__main__":
    build()
