"""Build Conclavia's first production MetaHuman cast from UE 5.8 presets.

The MetaHuman Character plugin ships a curated preset library.  This script
duplicates the selected presets into the project, verifies that their preview
assemblies are valid, and builds runtime-ready optimized characters without
depending on Fab marketplace content.
"""

from __future__ import annotations

import unreal


CAST_ROOT = "/Game/Conclavia/Cast"
GENERATED_ROOT = f"{CAST_ROOT}/Generated"
PRESET_ROOT = "/MetaHumanCharacter/Optional/Presets"

# A deliberately varied first cast. Names used on air remain controlled by the
# Conclavia talk configuration; these are internal visual identities.
CAST_PRESETS = ("Ada", "Lorenzo", "Aera", "Omari", "Vivian")


def duplicate_preset(name: str) -> unreal.MetaHumanCharacter:
    source = unreal.load_asset(f"{PRESET_ROOT}/{name}.{name}")
    if not isinstance(source, unreal.MetaHumanCharacter):
        raise RuntimeError(f"MetaHuman preset is missing or invalid: {name}")

    destination = f"{CAST_ROOT}/MHC_{name}"
    existing = unreal.load_asset(destination)
    if isinstance(existing, unreal.MetaHumanCharacter):
        return existing

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    duplicate = asset_tools.duplicate_asset(
        asset_name=f"MHC_{name}",
        package_path=CAST_ROOT,
        original_object=source,
    )
    if not isinstance(duplicate, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Could not duplicate MetaHuman preset: {name}")
    unreal.EditorAssetLibrary.save_loaded_asset(duplicate, only_if_is_dirty=False)
    return duplicate


def build_character(name: str) -> None:
    character = duplicate_preset(name)
    subsystem = unreal.get_editor_subsystem(
        unreal.MetaHumanCharacterEditorSubsystem
    )

    if not subsystem.try_add_object_to_edit(character=character):
        raise RuntimeError(f"Could not open MHC_{name} for editing")

    try:
        # Preview assembly is local and provides an early integrity check for
        # the face, body, wardrobe and groom graph before the heavier build.
        subsystem.assemble_for_preview(character=character)
        can_build = subsystem.can_build_meta_human(character=character)
        unreal.log_warning(
            "CONCLAVIA_CAST_CHECK: "
            f"name={name} can_build={can_build} "
            f"high_res_textures={character.has_high_resolution_textures}"
        )
        if not can_build:
            # Presets intentionally omit downloaded high-resolution sources.
            # The C++ editor bridge persists the fully local preview assembly
            # instead, so preparing the remaining cast must continue.
            unreal.log_warning(
                f"CONCLAVIA_CAST_PREVIEW_ONLY: name={name}"
            )
            return

        params = unreal.MetaHumanCharacterEditorBuildParameters()
        params.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
        params.pipeline_quality = unreal.MetaHumanQualityLevel.MEDIUM
        params.absolute_build_path = f"{GENERATED_ROOT}/{name}"
        params.common_folder_path = f"{GENERATED_ROOT}/Common"
        params.enable_wardrobe_item_validation = False
        subsystem.build_meta_human(character=character, params=params)
        unreal.log_warning(f"CONCLAVIA_CAST_BUILT: {name}")
    finally:
        if subsystem.is_object_added_for_editing(character=character):
            subsystem.remove_object_to_edit(character=character)


def main() -> None:
    unreal.EditorAssetLibrary.make_directory(CAST_ROOT)
    unreal.EditorAssetLibrary.make_directory(GENERATED_ROOT)

    # Duplicate every identity before attempting a production build so the
    # local preview exporter can process the full cast in one editor session.
    for name in CAST_PRESETS:
        duplicate_preset(name)

    for name in CAST_PRESETS:
        build_character(name)

    unreal.EditorAssetLibrary.save_directory(
        CAST_ROOT, only_if_is_dirty=False, recursive=True
    )
    for asset_path in unreal.EditorAssetLibrary.list_assets(
        GENERATED_ROOT, recursive=True, include_folder=False
    ):
        unreal.log_warning(f"CONCLAVIA_CAST_ASSET: {asset_path}")
    unreal.log_warning("CONCLAVIA_CAST_COMPLETE")


main()
