"""Inspect the UE 5.8 MetaHuman body Control Rig before runtime wiring."""

from __future__ import annotations

import unreal


RIG_PATHS = (
    "/Game/MetaHumans/Common/Common/MetaHuman_ControlRig",
    "/Game/Conclavia/Production/Common/Common/MetaHuman_ControlRig",
    "/MetaHumanCharacter/Common/MetaHuman_ControlRig",
)


def public_names(value: object, tokens: tuple[str, ...] = ()) -> list[str]:
    names = [name for name in dir(value) if not name.startswith("_")]
    if tokens:
        names = [
            name for name in names if any(token in name.lower() for token in tokens)
        ]
    return sorted(names)


def main() -> None:
    for path in RIG_PATHS:
        rig = unreal.load_asset(path)
        unreal.log_warning(
            f"CONCLAVIA_BODY_RIG asset={path} value={rig} type={type(rig)}"
        )
        if rig is None:
            continue

        unreal.log_warning(
            "CONCLAVIA_BODY_RIG methods="
            + ",".join(
                public_names(
                    rig,
                    ("hierarchy", "control", "generated", "class", "rig"),
                )
            )
        )
        hierarchy = None
        for candidate in ("hierarchy", "get_hierarchy"):
            try:
                value = getattr(rig, candidate)
                hierarchy = value() if callable(value) else value
                if hierarchy is not None:
                    break
            except Exception as error:
                unreal.log_warning(
                    f"CONCLAVIA_BODY_RIG hierarchy_candidate={candidate} error={error}"
                )
        if hierarchy is None:
            continue

        unreal.log_warning(
            "CONCLAVIA_BODY_RIG hierarchy_methods="
            + ",".join(
                public_names(
                    hierarchy,
                    ("key", "control", "element", "transform", "name"),
                )
            )
        )
        try:
            keys = hierarchy.get_all_keys(False)
        except TypeError:
            keys = hierarchy.get_all_keys()
        for key in keys:
            key_type = str(getattr(key, "type", ""))
            key_name = str(getattr(key, "name", ""))
            if "CONTROL" not in key_type.upper():
                continue
            if any(
                token in key_name.lower()
                for token in (
                    "hand",
                    "arm",
                    "elbow",
                    "wrist",
                    "clav",
                    "shoulder",
                    "chest",
                    "spine",
                    "head",
                    "neck",
                )
            ):
                unreal.log_warning(
                    f"CONCLAVIA_BODY_RIG control={key_name} type={key_type}"
                )
        unreal.log_warning(f"CONCLAVIA_BODY_RIG selected={path}")
        break

    unreal.log_warning("CONCLAVIA_BODY_RIG complete")


main()
