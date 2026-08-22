"""Find reusable seated and conversational animations bundled with UE/MetaHuman."""

from __future__ import annotations

import unreal


SEARCH_ROOTS = (
    "/MetaHumanCharacter",
    "/MetaHumans",
    "/Game",
    "/Engine",
)
TERMS = (
    "sit",
    "seat",
    "chair",
    "talk",
    "conversation",
    "listen",
    "idle",
    "attentive",
    "agree",
    "nod",
    "gesture",
    "emote",
    "explain",
    "present",
)


def main() -> None:
    matches: list[str] = []

    for root in SEARCH_ROOTS:
        for path in unreal.EditorAssetLibrary.list_assets(
            root, recursive=True, include_folder=False
        ):
            lowered = path.lower()
            if not any(term in lowered for term in TERMS):
                continue
            asset = unreal.load_asset(path)
            if not isinstance(
                asset, (unreal.AnimSequence, unreal.AnimMontage, unreal.PoseAsset)
            ):
                continue
            class_name = type(asset).__name__
            details = ""
            if isinstance(asset, unreal.AnimSequence):
                skeleton = asset.get_editor_property("skeleton")
                skeleton_path = skeleton.get_path_name() if skeleton else "none"
                details = (
                    f" duration={asset.get_play_length():.3f}"
                    f" skeleton={skeleton_path}"
                )
            matches.append(f"{class_name} {path}{details}")

    for match in sorted(set(matches)):
        unreal.log_warning(f"CONCLAVIA_ANIMATION_CANDIDATE: {match}")
    unreal.log_warning(f"CONCLAVIA_ANIMATION_CANDIDATES_READY: count={len(matches)}")


main()
