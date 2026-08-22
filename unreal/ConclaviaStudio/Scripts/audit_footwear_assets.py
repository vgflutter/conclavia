"""Inventory production-ready footwear available to MetaHuman Character."""

from __future__ import annotations

import unreal


TOKENS = ("shoe", "shoes", "sneaker", "trainer", "boot", "footwear")
ROOTS = ("/Game", "/MetaHumanCharacter", "/MetaHumans")


def main() -> None:
    matches: list[str] = []
    for root in ROOTS:
        if not unreal.EditorAssetLibrary.does_directory_exist(root):
            continue
        for object_path in unreal.EditorAssetLibrary.list_assets(
            root,
            recursive=True,
            include_folder=False,
        ):
            path = object_path.split(".", 1)[0]
            if any(token in path.casefold() for token in TOKENS):
                matches.append(path)

    unreal.log_warning(
        "CONCLAVIA_FOOTWEAR count="
        + str(len(set(matches)))
        + " assets="
        + "|".join(sorted(set(matches)))
    )


main()
