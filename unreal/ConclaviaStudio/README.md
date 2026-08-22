# Conclavia Studio (Unreal Engine 5.8 commercial lab)

Real-time rendering POC for Conclavia. The project enables MetaHuman Character,
MetaHuman SDK and Pixel Streaming 2 and exposes a local director control plane.

## Current web validation path: UE 5.8 single hero

The Next.js application now launches the deliberately isolated `lipsync58`
profile by default. It runs one warmed Cine-quality MetaHuman in the UE 5.8
premium studio with a fixed portrait camera. Aera, Ada, Vivian and Jelena use
the same audited commercial face pipeline and can be switched at runtime without
restarting Pixel Streaming. Jelena's UE 5.6 character package and shared
clothing/groom dependencies are migrated automatically on first use when they
are present on the studio instance. The UE 5.6 `lipsync` profile remains an
explicit rollback, while the duet and five-person levels remain experiments
rather than production claims.

The 5.8 control plane accepts bounded mono PCM16 at 16 kHz, plays it inside
Unreal and feeds the same samples to the commercial full-face generator.
`/health` exposes the real engine version, selected AnimBP model route,
generator, camera and facial-control state; `/director/cue` and `/audio/speech`
are the only control endpoints used by the web application. Audible playback
and facial inference therefore share the Unreal render clock instead of being
synchronized by browser timers.

The persisted 5.8 package provides sixteen named cameras and keeps the verified
session on `CAM_Seat_1_Close`. It keeps the hero warm at Cine LOD0 with strand
hair and full-resolution subsurface skin. Pixel Streaming 2 codec negotiation
is enabled in `Config/DefaultGame.ini`, matching the 5.8 plugin configuration
class and preventing a WebRTC offer from failing before the first frame.

The dedicated 1920×1080 player removes Epic's stock Pixel Streaming controls.
Startup uses a private browser as a render-readiness gate: it requires a decoded
1080p frame and gives shader, texture and groom resources time to settle before
the public player is mounted. A connected-but-black peer, a missing hairstyle
or a blocked composition can no longer be called ready.

The 22 August 2026 5.8 validation decoded the 1920×1080 Pixel Streaming 2 feed
at 30.34 fps with no 100 ms frame gaps. The commercial speech audit measured a
peak jaw input of `0.224960`, a rendered jaw curve of `0.223365` and a maximum
tracking error of `0.001595`. The browser audio audit found one live WebRTC
audio track, peak RMS `0.04447`, 146 audible samples and no browser errors. The
runtime revision is `ue58-commercial-lipsync-v14-attentive-idle`; readiness also
requires the Face AnimBP to report that its `Realistic` model route is active.

This is a stable single-performer laboratory, not a finished show and not yet a
claim that Unreal beats LiveAvatar. The current gate covers speech, listening
reactions, authored waiting motion and request-to-speak. Additional identities
and shot-dependent LOD still require the same visual/performance audit.
Proprietary Marketplace binaries and sample content are excluded from Git; only
the integration bridge and automation belong in this repository.

The remaining sections also document earlier duet and five-person work. They
are useful engineering references, but they do not describe the mode currently
selected by `/api/unreal/session` and must not be read as production claims.

## Control plane

The runtime listens on `127.0.0.1:8081` by default.

- `GET /health`
- `POST /director/cue`
- `POST /director/snapshot`

Example cue:

```json
{
  "speakerId": "participant-1",
  "targetId": "participant-2",
  "speakerName": "Elena Riva",
  "targetName": "Lorenzo Vitale",
  "shot": "close-up",
  "intent": "challenge",
  "expectedDurationMs": 14000
}
```

`expectedDurationMs` lets the runtime edit the contribution instead of showing
one static angle. A direct response opens on both participants, moves to the
speaker only when the answer is long enough, allows at most one contextual
breath in a long contribution, and prepares the handoff on a two-shot or the
master. A new cue cancels every pending cut, so an early speech end can never
leave a stale camera change behind.

Override the port and visual profile at launch:

```text
-ConclaviaControlPort=8081 -ConclaviaStudioProfile=pop
```

Supported profiles are `lipsync58`, the UE 5.6 rollback `lipsync`, and the
experimental `pop` and `serious` stages. The studio build script imports two
bespoke premium 16:9 plates, creates persistent cast positions and named
broadcast cameras, then saves a deterministic production level. Runtime
direction only switches real level cameras; it never rebuilds geometry.

The output includes a restrained native broadcast package: a compact channel
bug, a live badge, and a 340 px lower third. The lower third uses the actual
speaker and addressee names, appears for 3.1 seconds at the start of a turn, and
then leaves the picture clear. Captions remain off by default. The master camera
uses a calibrated 16:9 filmback and shows all five seats in both profiles;
automatic exposure is disabled to prevent brightness pumping between cuts.

## Web control-room supervisor

`Start-StudioSupervisor.ps1` turns the renderer into a service that the Next.js
control room can operate. It listens on port `8090`, requires the bearer token
stored in `Saved/supervisor.token`, and exposes:

- `GET /health` — process plus real Unreal stage/camera health
- `POST /start` with `{ "profile": "pop" }` or `serious`
- `POST /director/cue` — authenticated proxy to Unreal on localhost `8081`
- `POST /stop` — terminates the complete Unreal and signalling process trees

Run it as a high-privilege scheduled task on Windows. Publish `8090` only behind
TLS and an IP allow-list/private network; never publish the local Unreal control
port. The browser needs only the Pixel Streaming player. The Next.js server
holds the supervisor token and returns only sanitized status and player data.

Build or rebuild the premium level from Unreal's Python environment:

```powershell
& C:\Epic\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe `
  C:\ConclaviaStudio\ConclaviaStudio.uproject `
  -unattended -nop4 -nosplash -nullrhi `
  '-ExecutePythonScript=C:\ConclaviaStudio\Scripts\build_premium_studio.py'
```

## Remote smoke test

After compiling the editor target on Windows, run the real off-screen engine and
exercise both control-plane routes:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& C:\ConclaviaStudio\Scripts\Test-ControlPlane.ps1 -Profile pop
```

The script starts Unreal with hardware rendering, waits for `/health`, sends a
director cue, prints both JSON responses and then terminates only the process it
created. It intentionally leaves port `8081` private; expose the final viewer via
Pixel Streaming rather than publishing the director endpoint.

Validate Epic's native MetaHuman synthesis path with the bundled automation
test. This initializes a real MetaHuman character and verifies its generated
face, body, texture and material assets:

```powershell
& C:\ConclaviaStudio\Scripts\Test-MetaHuman.ps1
```

The Epic Games Launcher installation must include **MetaHuman Creator Core
Data**. It is an optional engine component; without it, texture synthesis and
the preset/lighting libraries are incomplete. Raw identity-template face and
body meshes are intentionally not used as substitutes: they are unassembled,
untextured technical assets and do not meet the production quality target.

## Pixel Streaming 2 smoke test

Clone the official Pixel Streaming Infrastructure version that matches the
installed Unreal release to `C:\PixelStreamingInfrastructure`, build it once,
then run:

```powershell
& C:\ConclaviaStudio\Scripts\Test-PixelStreaming.ps1 `
  -Profile pop `
  -Shot close-up
```

Use `-RebuildInfrastructure` only after changing or updating the official
signalling frontend. The test otherwise reuses the existing build, starts Unreal
at `1280x720`, sends a real director cue, and opens a Playwright-controlled
Chromium viewer with `AutoConnect` enabled. It succeeds only after the browser
has decoded a moving video frame, then saves
`Saved\PixelStreaming\viewer.jpg` and samples NVIDIA encoder utilization while
the peer is still connected. A page returning HTTP 200 is deliberately not
treated as a successful stream.

AWS G6 Windows instances can expose the same L4 through duplicate DXGI adapter
records. Pixel Streaming 2 CUDA/NVENC interop resolves the physical device as
adapter `0` on the validated 5.8 host, so that is the review launcher default;
override `-GraphicsAdapter` when a host exposes different ordering. A valid run
reports `cudaReady: true`, `hardwareEncoderFailed: false`, video
`readyState: 4`, advancing `currentTime`, and non-zero NVIDIA `enc` samples.
All process trees are terminated in `finally`, including on failure.

## Validated cloud baseline

- Unreal Engine `5.8`
- Windows Server 2022 on EC2 `g6.2xlarge`
- NVIDIA L4 24 GB with RTX Virtual Workstation driver `596.36`
- five persistent Cinematic MetaHumans assembled from distinct Epic presets
- hardware-rendered output with a browser-validated `1920x1080` profile
- two stable exposure profiles, five-person master framing and fifteen camera cues
- compact native broadcast graphics and screenshot capture with UI
- Pixel Streaming 2 signalling and decoded H.264 video with `readyState: 4`
- full-panel, two-shot and long-lens chest-up production frames
- 8 GB texture pool, full mip residency, 16× anisotropy and full-resolution skin SSS
- a decoded H.264 Baseline browser run, complete captured frame and no page errors

The control plane, both visual profiles, camera cue, GPU renderer, native
overlay and Pixel Streaming viewer have all been exercised on that baseline.
Keep the director endpoint private; publish only the signalling/player path
after adding TLS and an authenticated ingress.

Internet playback requires TURN to be allowed by both the EC2 security group
and Windows Firewall. `Start-ReviewStream.ps1` maintains inbound TCP/UDP 19303
and UDP 49152–65535 inside the guest. A signalling page that loads but remains
black with ICE stuck in `checking` normally means one of those guest rules is
missing; an HTTP 200 response from the player is not a media-health check.

The review launcher now keeps the validated 1920×1080 profile. UE 5.8 codec
negotiation must remain enabled: disabling it reproduced a missing receive-codec
capability and prevented `CreateOffer` from completing. Resolution, codec or
adapter changes must pass the visual browser gate before becoming defaults.

## Five-character MetaHuman preview

The project can assemble all five bundled UE 5.8 MetaHuman presets inside the
editor and stream a clean immersive viewport without requiring a packaged
build:

```powershell
& C:\ConclaviaStudio\Scripts\Test-MetaHumanPreviewStreaming.ps1 `
  -Shot close-up `
  -SpeakerId participant-3
```

The automated test starts the matching UE 5.8 signalling server, assembles the
five independent preview graphs, frames the requested named production camera,
enables codec negotiation, streams the immersive editor backbuffer and requires
Chromium to decode an advancing
`1280x720` video before it succeeds. The latest AWS G6 validation reported all
five characters ready, no browser errors and a connected NVIDIA L4 renderer.
The verifier applies a small 16:9 overscan crop so the editor viewport toolbar
never appears in the broadcast picture.

`DefaultEngine.ini` enables SM6, unlimited bone influences, 16-bit bone indices
and skin-cache shaders as required by MetaHuman 5.8. The first run may populate
the shader DDC; later starts reuse it.

This preview remains useful as a fast technical gate, but it is no longer the
best visual path. The production maps now use persisted Cinematic assemblies;
the preview path deliberately does not modify those assets.

## Production cast

Build all five persisted Cinematic characters with:

```powershell
& C:\ConclaviaStudio\Scripts\Build-ProductionCast.ps1
```

The resumable build creates Elena Riva, Lorenzo Vitale, Giulia Ferri, Marco
Bellini and Sofia Greco from five distinct Epic presets. Staging gives every
guest a stable identity, seat, wardrobe color and standing podcast idle. The
current wardrobe is deliberately simple; licensed garments and authored
listening gestures are still required before calling the cast broadcast-final.
Each portrait camera is positioned as a long-lens chest-up podcast shot with
manual eye-line focus. Cinematic source textures remain resident during the
stream, while directional key/fill/rim lighting preserves facial structure
instead of clipping the face to a flat white surface. Five low-power portrait
lights add catchlights without flattening the master shot. A restrained output
sharpen pass protects micro-detail after H.264 encoding, and camera cuts disable
the default pawn's automatic camera ownership.

After assembling or replacing a character, run the production lookdev pass and
its compact audit from Unreal's Python environment:

```powershell
& C:\Epic\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe `
  C:\ConclaviaStudio\ConclaviaStudio.uproject `
  -unattended -nop4 -nosplash -nullrhi `
  '-ExecutePythonScript=C:\ConclaviaStudio\Scripts\tune_production_lookdev.py'

& C:\Epic\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe `
  C:\ConclaviaStudio\ConclaviaStudio.uproject `
  -unattended -nop4 -nosplash -nullrhi `
  '-ExecutePythonScript=C:\ConclaviaStudio\Scripts\audit_lookdev_parameters.py'
```

The tuning pass applies the same calibrated skin, eye, close-camera and portrait
lighting values to both studio profiles. The audit writes
`Saved/Audits/production-lookdev.json` with the effective face LOD, material
chain, texture dimensions, groom assets and useful facial morph targets. On the
validated cast it confirms LOD 0 faces, strand hair/brows/lashes, 8192×8192
normal and specular/roughness maps, and healthy eye overrides. Runtime adds
deterministically staggered blinks to the neutral cast; speech-driven lips and
expressions remain a separate production gate.

Four of the fifteen cameras are pair-specific two-shots for seats 1–2, 2–3,
3–4 and 4–5. The director resolves the actual speaker/addressee pair instead of
reusing a generic left/right shot, so an exchange never cuts to two uninvolved
guests. The master remains wide enough to preserve all five people while
cropping most of the virtual floor behind the desk.

Validate the complete rendered chain with:

```powershell
& C:\ConclaviaStudio\Scripts\Test-ProductionStreaming.ps1 `
  -Profile pop -Shot close-up -GraphicsAdapter 1
& C:\ConclaviaStudio\Scripts\Test-ProductionStreaming.ps1 `
  -Profile serious -Shot wide -GraphicsAdapter 1
```

Each run first places the persistent high-resolution cast into both maps, then
starts the selected 1920×1080 profile, sends a real director cue and requires a
Chromium viewer to decode advancing H.264 video. A successful HTTP response by
itself is not accepted. The generated audit frames are written to
`Saved\PixelStreaming\production-<profile>-<shot>.jpg`.

## Listening presence and request-to-speak

The single-hero runtime never synthesizes body motion by rotating MetaHuman
bones at runtime. Waiting uses `AS_Conclavia_SeatedIdle`, a loop assembled from
Epic's UE 5.8 MetaHuman technical upper-body idle and the seated lower-body
pose. It runs at `0.58x`, preserving breathing, small weight shifts and shoulder
motion without competing animation evaluators or repetitive procedural noise.
The asset bake attenuates the technical loop's broad upper-spine and neck dips
toward the MetaHuman reference pose; those motions are useful in an animation
review but read as prolonged eye closure in a meeting close-up.

Request-to-speak uses `AS_Conclavia_MetaHumanHandRaise`. The build script loads
the seated idle into Epic's `/Game/MetaHumans/Common/Common/MetaHuman_ControlRig`
through Backwards Solve, drives the right-hand IK target and exports a complete
raise, hold and lower animation. The target is derived from the active
character's head and upper-arm positions, so it is not a hand-authored set of
bone rotations. Runtime telemetry exposes `physicalGestureReady`,
`physicalGestureDriver`, `bodyGesturePhase` and `bodyGestureAlpha`.

Listening reactions use the purchased Runtime MetaHuman Lip Sync full-face
model even when the avatar is silent. A `listen-react` cue carries a semantic
`listenerMood` and bounded intensity inferred from the other participant's
speech. The reaction is held for the incoming contribution and then settles to
neutral; it does not generate audio or trigger an unsolicited intervention.
The commercial speech and listening generators remain warm across compatible
MetaHuman changes and are rebound to the new face. Switching the visible hero
therefore does not reload either ONNX model.
Use the browser acceptance script to capture idle, active-listening and settled
frames together with the corresponding health telemetry:

```powershell
node C:\ConclaviaStudio\Scripts\Capture-ListeningPresence.cjs `
  http://127.0.0.1:8080/conclavia.html `
  http://127.0.0.1:8081 `
  C:\ConclaviaStudio\Saved\ListeningPresence
```

Rebuild the solver-authored gesture after changing the staged MetaHuman or the
source idle:

```powershell
& C:\Epic\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe `
  C:\ConclaviaStudio\ConclaviaStudio.uproject `
  -unattended -nop4 -nosplash -nullrhi `
  '-ExecutePythonScript=C:\ConclaviaStudio\Scripts\build_metahuman_hand_raise.py'
```

## Real-time facial audio

The active validation path does not use a virtual Windows microphone, browser
speech synthesis or a LiveAvatar audio clone. The Next.js server creates the
selected programme voice, converts the complete utterance to bounded mono
PCM16 at 16 kHz and sends it through the token-protected supervisor. Unreal
plays those exact samples and feeds them to the matching persistent commercial
full-face generator on the same render clock. This removes the independent
audio/facial clocks that caused the earlier visible drift.

One permanently bound generator is warmed for each visible identity. A speaker
handoff only changes the active face and generator; it does not reload the model
or rebind the MetaHuman. `/health` exposes generator count, active face, PCM
bytes, control count, strongest mouth and upper-face controls and speech state,
so a moving video is not accepted as proof of working lip sync by itself.

The deterministic direct-PCM gate remains useful for low-level diagnostics:

```powershell
& C:\ConclaviaStudio\Scripts\Test-DirectPcmSubject.ps1
```

For the current web path, the stronger acceptance test is an alternating Aera /
Ada sequence that verifies active-face changes and non-zero mouth and upper-face
controls after every utterance.

## Remaining production work

MetaHuman Creator Core Data must be enabled from the engine version's
**Options** dialog in Epic Games Launcher. The purchased Runtime MetaHuman Lip
Sync full-face model is the primary facial path and does not require OpenAI
speech or NVIDIA ACE. Slow breathing, listener attention and restrained
upper-spine, neck and head motion come from the authored animation and facial
model. The current single-hero path uses Epic's authored technical idle, the
solver-baked request-to-speak gesture and semantic full-face listening moods;
it does not add procedural per-bone motion. The remaining production work is
three additional distinct commercial MetaHumans, licensed wardrobe and
shot-dependent LOD before the complete five-person stage can replace the duet
laboratory.
