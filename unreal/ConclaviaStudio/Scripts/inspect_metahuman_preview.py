"""Inspect the locally assembled UE 5.8 MetaHuman preview graph."""

from __future__ import annotations

import unreal


CHARACTER_PATH = "/Game/Conclavia/Cast/MHC_Ada.MHC_Ada"


def main() -> None:
    character = unreal.load_asset(CHARACTER_PATH)
    if not isinstance(character, unreal.MetaHumanCharacter):
        raise RuntimeError(f"Missing character: {CHARACTER_PATH}")

    subsystem = unreal.get_editor_subsystem(
        unreal.MetaHumanCharacterEditorSubsystem
    )
    if not subsystem.try_add_object_to_edit(character=character):
        raise RuntimeError("Could not open the character for preview")

    try:
        subsystem.assemble_for_preview(character=character)
        actor = subsystem.spawn_meta_human_actor(character=character)
        if actor is None:
            raise RuntimeError("MetaHuman preview actor was not created")

        unreal.log_warning(
            "CONCLAVIA_PREVIEW_ACTOR: "
            f"class={actor.get_class().get_path_name()} components={len(actor.get_components_by_class(unreal.ActorComponent))}"
        )
        for component in actor.get_components_by_class(unreal.ActorComponent):
            details = [
                f"name={component.get_name()}",
                f"class={component.get_class().get_path_name()}",
            ]
            if isinstance(component, unreal.SkeletalMeshComponent):
                mesh = component.get_editor_property("skeletal_mesh_asset")
                details.append(
                    f"mesh={mesh.get_path_name() if mesh is not None else 'none'}"
                )
                details.append(f"materials={len(component.get_materials())}")
            if isinstance(component, unreal.GroomComponent):
                groom = component.get_editor_property("groom_asset")
                details.append(
                    f"groom={groom.get_path_name() if groom is not None else 'none'}"
                )
            unreal.log_warning("CONCLAVIA_PREVIEW_COMPONENT: " + " ".join(details))
    finally:
        if subsystem.is_object_added_for_editing(character=character):
            subsystem.remove_object_to_edit(character=character)

    unreal.log_warning("CONCLAVIA_PREVIEW_INSPECTION_COMPLETE")


main()
