"""Find and validate the UE 5.8 MetaHuman Live Link retarget asset."""

from __future__ import annotations

import unreal


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_LL_RETARGET {message}")


def main() -> None:
    unreal.EditorLoadingAndSavingUtils.load_map(
        "/Game/Conclavia/Studio/L_PremiumStudio"
    )
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    candidates = []
    for root in ("/MetaHumanCharacter", "/MetaHumans", "/Game"):
        for data in registry.get_assets_by_path(root, recursive=True):
            path = str(data.package_name)
            asset_class = str(data.asset_class_path.asset_name)
            if "live" in path.casefold() or "retarget" in path.casefold():
                candidates.append((path, asset_class))
    for path, asset_class in candidates:
        log(f"candidate={path} class={asset_class}")

    actor = next(
        actor
        for actor in unreal.get_editor_subsystem(
            unreal.EditorActorSubsystem
        ).get_all_level_actors()
        if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}
    )
    face = next(
        component
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent)
        if component.get_name().casefold() == "face"
    )
    subject = unreal.LiveLinkSubjectName()
    subject.set_editor_property("name", unreal.Name("ConclaviaVoice"))
    for path, asset_class in candidates:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        values = [asset]
        if asset_class == "AnimBlueprint":
            generated = unreal.load_class(None, f"{path}.{path.rsplit('/', 1)[-1]}_C")
            values.insert(0, generated)
        for value in values:
            if value is None:
                continue
            try:
                result = actor.call_method(
                    "LiveLinkSetup", args=(face, subject, value, True)
                )
            except Exception as error:
                log(
                    f"attempt={path} value={value!r} class={asset_class} "
                    f"error={error}"
                )
            else:
                log(
                    f"SUCCESS path={path} value={value!r} "
                    f"class={asset_class} result={result!r}"
                )
                log("READY")
                return
    log("READY")


if __name__ == "__main__":
    main()
