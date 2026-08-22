"""Audit the EC2 audio bridge exposed to MetaHuman Audio Live Link."""

from __future__ import annotations

import unreal


def log(message: str) -> None:
    unreal.log_warning(f"CONCLAVIA_AUDIO_LIVE_LINK: {message}")


def main() -> None:
    api = unreal.MetaHumanLocalLiveLinkSourceBlueprint
    for method_name in (
        "get_audio_devices",
        "get_audio_tracks",
        "get_audio_formats",
        "create_audio_source",
        "create_audio_subject",
        "get_subject_settings",
    ):
        method = getattr(api, method_name)
        log(f"method={method_name} doc={method.__doc__}")
    devices = api.get_audio_devices(include_media_bundles=False)
    log(f"devices={list(devices)!r}")
    target_device_index = next(
        (
            index
            for index, device in enumerate(devices)
            if "CABLE Output" in repr(device)
        ),
        0,
    )
    log(f"target_device_index={target_device_index}")
    for index, device in enumerate(devices):
        tracks, timed_out = api.get_audio_tracks(device, timeout=5.0)
        log(
            f"device={index} value={device!r} tracks={list(tracks)!r} "
            f"timed_out={timed_out}"
        )
        for track_index, track in enumerate(tracks):
            formats, format_timed_out = api.get_audio_formats(track, timeout=5.0)
            log(
                f"device={index} track={track_index} formats={list(formats)!r} "
                f"timed_out={format_timed_out}"
            )
            if index == target_device_index and track_index == 0 and formats:
                source, source_succeeded = api.create_audio_source()
                log(
                    f"source={source!r} succeeded={source_succeeded}"
                )
                if source_succeeded:
                    subject, subject_succeeded = api.create_audio_subject(
                        source,
                        formats[0],
                        "ConclaviaVoiceAudit",
                        start_timeout=8.0,
                        format_wait_time=0.1,
                        sample_timeout=8.0,
                    )
                    log(
                        f"subject={subject!r} succeeded={subject_succeeded}"
                    )
                    if subject_succeeded:
                        settings = api.get_subject_settings(subject)
                        log(f"settings={settings!r}")
    log("READY")


if __name__ == "__main__":
    main()
