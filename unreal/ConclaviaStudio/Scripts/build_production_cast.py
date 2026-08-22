"""Build Conclavia's five production MetaHumans from Epic's UE 5.8 presets.

The visual identity is intentionally separate from the name/personality stored
in a talk.  Presets give the POC five genuinely different faces and bodies;
the cloud pass adds the production facial rig and source textures required by
MetaHuman Animator and high-quality Pixel Streaming.
"""

from __future__ import annotations

from dataclasses import dataclass

import unreal


PRESET_ROOT = "/MetaHumanCharacter/Optional/Presets"
CHARACTER_ROOT = "/Game/Conclavia/Production/Characters"
GENERATED_ROOT = "/Game/Conclavia/Production/MetaHumans"
HERO_ROOT = "/Game/Conclavia/Production/Hero"
COMMON_ROOT = "/Game/Conclavia/Production/Common"


@dataclass(frozen=True)
class CastMember:
    on_air_name: str
    preset_name: str

    @property
    def asset_name(self) -> str:
        return f"MHC_{self.on_air_name.replace(' ', '')}"


CAST = (
    CastMember("Elena Riva", "Ada"),
    CastMember("Lorenzo Vitale", "Lorenzo"),
    CastMember("Giulia Ferri", "Aera"),
    CastMember("Marco Bellini", "Omari"),
    CastMember("Sofia Greco", "Vivian"),
)


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_PRODUCTION_CAST: {message}")


def build_root(member: CastMember) -> str:
    # The host was assembled first as the production-quality gate. Reuse it
    # instead of paying the cloud autorig/texture latency a second time.
    if member.on_air_name == "Marco Bellini":
        return f"{HERO_ROOT}/{member.asset_name}"
    return f"{GENERATED_ROOT}/{member.asset_name}"


def assembled_blueprint(member: CastMember) -> str | None:
    for object_path in unreal.EditorAssetLibrary.list_assets(
        build_root(member),
        recursive=True,
        include_folder=False,
    ):
        package_path = object_path.split(".", 1)[0]
        if unreal.EditorAssetLibrary.load_blueprint_class(package_path) is not None:
            return package_path
    return None


def fresh_character(member: CastMember) -> unreal.MetaHumanCharacter:
    source_path = f"{PRESET_ROOT}/{member.preset_name}.{member.preset_name}"
    source = unreal.load_asset(source_path)
    if not isinstance(source, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Missing MetaHuman preset: {source_path}")

    destination = f"{CHARACTER_ROOT}/{member.asset_name}"
    if unreal.EditorAssetLibrary.does_asset_exist(destination):
        unreal.EditorAssetLibrary.delete_asset(destination)

    duplicate = unreal.AssetToolsHelpers.get_asset_tools().duplicate_asset(
        asset_name=member.asset_name,
        package_path=CHARACTER_ROOT,
        original_object=source,
    )
    if not isinstance(duplicate, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Could not duplicate preset {member.preset_name}")
    unreal.EditorAssetLibrary.save_loaded_asset(duplicate, only_if_is_dirty=False)
    return duplicate


def build_member(
    member: CastMember,
    subsystem: unreal.MetaHumanCharacterEditorSubsystem,
) -> None:
    existing = assembled_blueprint(member)
    if existing is not None:
        log(f"REUSE name={member.on_air_name} blueprint={existing}")
        return

    output_root = build_root(member)
    if unreal.EditorAssetLibrary.does_directory_exist(output_root):
        unreal.EditorAssetLibrary.delete_directory(output_root)
    character = fresh_character(member)
    if not subsystem.try_add_object_to_edit(character=character):
        raise RuntimeError(f"Could not edit {member.asset_name}")

    try:
        log(f"PREVIEW name={member.on_air_name} preset={member.preset_name}")
        subsystem.assemble_for_preview(character=character)

        rig_request = unreal.MetaHumanCharacterAutoRiggingRequestParams()
        rig_request.blocking = True
        rig_request.report_progress = False
        rig_request.rig_type = unreal.MetaHumanRigType.JOINTS_AND_BLEND_SHAPES
        log(f"AUTORIG_START name={member.on_air_name}")
        subsystem.request_auto_rigging(character=character, params=rig_request)

        texture_request = unreal.MetaHumanCharacterTextureRequestParams()
        texture_request.blocking = True
        texture_request.report_progress = False
        log(f"TEXTURES_START name={member.on_air_name}")
        subsystem.request_texture_sources(character=character, params=texture_request)
        if not character.has_high_resolution_textures:
            raise RuntimeError(
                f"High-resolution textures missing for {member.on_air_name}"
            )
        if not subsystem.can_build_meta_human(character=character):
            raise RuntimeError(f"{member.on_air_name} is not ready for assembly")

        build_params = unreal.MetaHumanCharacterEditorBuildParameters()
        build_params.pipeline_type = unreal.MetaHumanDefaultPipelineType.CINEMATIC
        build_params.absolute_build_path = output_root
        build_params.common_folder_path = COMMON_ROOT
        build_params.name_override = member.asset_name
        build_params.enable_wardrobe_item_validation = True
        log(f"ASSEMBLY_START name={member.on_air_name} pipeline=Cinematic")
        subsystem.build_meta_human(character=character, params=build_params)
    finally:
        if subsystem.is_object_added_for_editing(character=character):
            subsystem.remove_object_to_edit(character)

    unreal.EditorAssetLibrary.save_directory(
        "/Game/Conclavia/Production",
        only_if_is_dirty=False,
        recursive=True,
    )
    blueprint = assembled_blueprint(member)
    if blueprint is None:
        raise RuntimeError(f"Assembly produced no blueprint for {member.on_air_name}")
    log(
        f"READY name={member.on_air_name} preset={member.preset_name} "
        f"pipeline=Cinematic blueprint={blueprint}"
    )


def main() -> None:
    unreal.EditorAssetLibrary.make_directory(CHARACTER_ROOT)
    unreal.EditorAssetLibrary.make_directory(GENERATED_ROOT)
    subsystem = unreal.get_editor_subsystem(
        unreal.MetaHumanCharacterEditorSubsystem
    )
    for member in CAST:
        build_member(member, subsystem)
        # A Cinematic assembly temporarily holds multiple 8K bake graphs and
        # can otherwise retain tens of gigabytes until editor shutdown. Each
        # completed member is already persisted, so release those transients
        # before starting the next cloud rig/assembly.
        unreal.SystemLibrary.collect_garbage()

    ready = [(member.on_air_name, assembled_blueprint(member)) for member in CAST]
    missing = [name for name, blueprint in ready if blueprint is None]
    if missing:
        raise RuntimeError("Missing assembled cast: " + ", ".join(missing))
    for name, blueprint in ready:
        log(f"BLUEPRINT name={name} path={blueprint}")
    log("CAST_READY count=5 pipeline=Cinematic")


if __name__ == "__main__":
    main()
