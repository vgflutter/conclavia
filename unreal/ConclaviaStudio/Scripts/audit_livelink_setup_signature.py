"""Report the callable LiveLinkSetup signature on the assembled cast."""

from __future__ import annotations

import unreal


def main() -> None:
    unreal.EditorLoadingAndSavingUtils.load_map(
        "/Game/Conclavia/Studio/L_PremiumStudio"
    )
    actor = next(
        actor
        for actor in unreal.get_editor_subsystem(
            unreal.EditorActorSubsystem
        ).get_all_level_actors()
        if "ConclaviaProductionCast" in {str(tag) for tag in actor.tags}
    )
    for method, args in (
        ("LiveLinkSetup", ()),
        ("LiveLinkSetup", (None,)),
        ("LiveLinkSetup", (None, None)),
        ("LiveLinkSetup", (None, None, None)),
    ):
        try:
            result = actor.call_method(method, args=args)
        except Exception as error:
            unreal.log_warning(
                f"CONCLAVIA_LL_SIGNATURE args={len(args)} error={error}"
            )
        else:
            unreal.log_warning(
                f"CONCLAVIA_LL_SIGNATURE args={len(args)} result={result!r}"
            )
    unreal.log_warning("CONCLAVIA_LL_SIGNATURE READY")


if __name__ == "__main__":
    main()
