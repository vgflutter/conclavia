"""Probe the generated UE 5.8 MetaHuman subject binding function."""

from __future__ import annotations

import unreal


LEVEL_PATH = "/Game/Conclavia/Studio/L_PremiumStudio"


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_SUBJECT_BINDING_AUDIT: {message}")


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
    log(f"call_method_doc={actor.call_method.__doc__}")
    skeletal_components = actor.get_components_by_class(unreal.SkeletalMeshComponent)
    for component in skeletal_components:
        mesh = component.get_skeletal_mesh_asset()
        mesh_path = mesh.get_path_name() if mesh else ""
        try:
            anim_class = component.get_editor_property("anim_class")
        except Exception:
            anim_class = None
        log(
            f"skeletal_component={component.get_name()} mesh={mesh_path} "
            f"anim_class={anim_class!r}"
        )
    face = next(
        (
            component
            for component in skeletal_components
            if component.get_name().casefold() == "face"
        ),
        None,
    )
    if face is None:
        raise RuntimeError("Face component missing")
    retarget_candidates = (
        "/MetaHumanCharacter/Animation/ABP_MH_LiveLink",
        "/MetaHumanCharacter/Animation/Face/ABP_MH_LiveLink",
        "/MetaHumans/Common/Face/ABP_MH_LiveLink",
    )
    retarget = next(
        (
            asset
            for path in retarget_candidates
            if (asset := unreal.EditorAssetLibrary.load_asset(path)) is not None
        ),
        None,
    )
    log(f"face={face.get_name()} retarget={retarget!r}")
    live_link_subject = unreal.LiveLinkSubjectName()
    live_link_subject.set_editor_property("name", unreal.Name("ConclaviaVoice"))
    log(
        f"live_link_subject={live_link_subject!r} "
        f"doc={unreal.LiveLinkSubjectName.__doc__}"
    )
    attempts = (
        ("SetSubject", (unreal.Name("ConclaviaVoice"),)),
        ("set_subject", (unreal.Name("ConclaviaVoice"),)),
        ("LiveLinkSetup", (unreal.Name("ConclaviaVoice"), True)),
        ("LiveLinkSetup", (unreal.Name("ConclaviaVoice"), True, None)),
        ("LiveLinkSetup", (unreal.Name("ConclaviaVoice"), True, None, None)),
        ("LiveLinkSetup", (unreal.Name("ConclaviaVoice"), True, None, None, None)),
        ("LiveLinkSetup", (face, retarget, unreal.Name("ConclaviaVoice"), True)),
        ("LiveLinkSetup", (face, None, unreal.Name("ConclaviaVoice"), True)),
        ("LiveLinkSetup", (face, retarget, live_link_subject, True)),
        ("LiveLinkSetup", (face, live_link_subject, retarget, True)),
        ("LiveLinkSetup", (face, live_link_subject, None, True)),
        ("live_link_setup", (unreal.Name("ConclaviaVoice"), True)),
    )
    for method_name, args in attempts:
        try:
            result = actor.call_method(method_name, args=args)
        except Exception as error:
            log(f"method={method_name} args={args!r} error={error}")
        else:
            log(f"method={method_name} args={args!r} result={result!r}")
    log("READY")


if __name__ == "__main__":
    main()
