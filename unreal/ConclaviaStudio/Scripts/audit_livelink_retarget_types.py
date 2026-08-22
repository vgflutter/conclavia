"""Identify the exact retarget class expected by an assembled UE 5.8 MetaHuman.

This runs inside Unreal Editor and only reads reflection/asset metadata.  It is
kept separate from the production runtime so a failed probe cannot alter the
studio map or the cast.
"""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_RETARGET_TYPE_AUDIT: {message}")


def main() -> None:
    if not unreal.EditorLoadingAndSavingUtils.load_map(LEVEL_PATH):
        raise RuntimeError(f"Could not load {LEVEL_PATH}")

    actor = next(
        candidate
        for candidate in unreal.get_editor_subsystem(
            unreal.EditorActorSubsystem
        ).get_all_level_actors()
        if "ConclaviaProductionCast" in {str(tag) for tag in candidate.tags}
    )
    face = next(
        component
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent)
        if component.get_name().casefold() == "face"
    )
    subject = unreal.LiveLinkSubjectName()
    subject.set_editor_property("name", unreal.Name("ConclaviaVoice"))

    reflected = sorted(
        name
        for name in dir(unreal)
        if "livelink" in name.casefold()
        or "retarget" in name.casefold()
        or "remap" in name.casefold()
    )
    log(f"python_types={reflected}")

    candidates: list[tuple[str, object]] = []
    for name in reflected:
        value = getattr(unreal, name, None)
        if isinstance(value, type):
            candidates.append((f"python_class:{name}", value))
            try:
                candidates.append(
                    (f"python_cdo:{name}", unreal.get_default_object(value))
                )
            except Exception:
                pass

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    for root in ("/MetaHumanCharacter", "/MetaHumans", "/Game"):
        for data in registry.get_assets_by_path(root, recursive=True):
            path = str(data.package_name)
            asset_class = str(data.asset_class_path.asset_name)
            folded = f"{path} {asset_class}".casefold()
            if not any(token in folded for token in ("livelink", "retarget", "remap")):
                continue
            asset = unreal.EditorAssetLibrary.load_asset(path)
            log(f"asset={path} class={asset_class} loaded={asset!r}")
            if asset is not None:
                candidates.append((f"asset:{path}", asset))
            generated = unreal.load_class(None, f"{path}.{path.rsplit('/', 1)[-1]}_C")
            if generated is not None:
                candidates.append((f"generated:{path}", generated))

    seen: set[str] = set()
    for label, candidate in candidates:
        identity = repr(candidate)
        if identity in seen:
            continue
        seen.add(identity)
        try:
            actor.call_method(
                "LiveLinkSetup",
                args=(face, subject, candidate, True),
            )
        except Exception as error:
            # Conversion errors tell us the candidate has the wrong reflected
            # type.  Any other outcome means the parameter type was accepted.
            log(f"candidate={label} value={candidate!r} error={error}")
        else:
            log(f"ACCEPTED candidate={label} value={candidate!r}")

    log("READY")


if __name__ == "__main__":
    main()
