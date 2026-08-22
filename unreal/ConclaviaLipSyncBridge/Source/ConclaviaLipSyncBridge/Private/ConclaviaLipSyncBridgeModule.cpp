#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Animation/Skeleton.h"
#include "BlendRealisticMetaHumanLipSyncAnimNode.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/ActorComponent.h"
#include "Components/AudioComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/PointLight.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HttpPath.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "ImageUtils.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/ScopeLock.h"
#include "Modules/ModuleManager.h"
#include "RealisticMetaHumanLipSyncGenerator.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Sound/SoundWaveProcedural.h"
#include "TimerManager.h"
#include "UnrealClient.h"
#include "UObject/StrongObjectPtr.h"
#include "UObject/Package.h"
#include "UObject/UnrealType.h"

#if WITH_EDITOR
#include "AssetRegistry/AssetRegistryModule.h"
#include "Cloud/MetaHumanARServiceRequest.h"
#include "Containers/Ticker.h"
#include "Editor.h"
#include "MetaHumanCharacter.h"
#include "MetaHumanCharacterEditorSubsystem.h"
#include "MetaHumanCollectionPipeline.h"
#include "Misc/PackageName.h"
#include "Subsystem/MetaHumanCharacterBuild.h"
#include "UObject/SavePackage.h"
#include "UObject/UObjectIterator.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogConclaviaLipSyncBridge, Log, All);

namespace ConclaviaLipSyncBridge
{
    TUniquePtr<FHttpServerResponse> JsonResponse(
        const FString& Body,
        const EHttpServerResponseCodes Code = EHttpServerResponseCodes::Ok)
    {
        TUniquePtr<FHttpServerResponse> Response =
            FHttpServerResponse::Create(Body, TEXT("application/json; charset=utf-8"));
        Response->Code = Code;
        Response->Headers.Add(TEXT("Access-Control-Allow-Origin"), {TEXT("*")});
        return Response;
    }
}

class FConclaviaLipSyncBridgeModule final : public IModuleInterface
{
public:
    // Conclavia presence revision: v46-floor-control.
    virtual void StartupModule() override
    {
#if WITH_EDITOR
        FString RequestedBuildAvatar;
        const bool bLegacyVivianBuild =
            FParse::Param(FCommandLine::Get(), TEXT("ConclaviaBuildVivian"));
        if (bLegacyVivianBuild
            || FParse::Value(
                FCommandLine::Get(), TEXT("ConclaviaBuildAvatar="), RequestedBuildAvatar))
        {
            BuilderAvatarName = bLegacyVivianBuild
                ? TEXT("Vivian")
                : RequestedBuildAvatar.TrimStartAndEnd();
            if (!BuilderAvatarName.Equals(TEXT("Vivian"), ESearchCase::IgnoreCase)
                && !BuilderAvatarName.Equals(TEXT("Jelena"), ESearchCase::IgnoreCase))
            {
                UE_LOG(LogConclaviaLipSyncBridge, Error,
                    TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: FAILED reason=unsupported-preset preset=%s"),
                    *BuilderAvatarName);
                FPlatformMisc::RequestExitWithStatus(true, 1);
                return;
            }
            BuilderAvatarName = BuilderAvatarName.Equals(
                TEXT("Jelena"), ESearchCase::IgnoreCase)
                ? TEXT("Jelena")
                : TEXT("Vivian");
            VivianBuildStartedAt = FPlatformTime::Seconds();
            VivianBuildTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
                FTickerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::TickVivianBuild),
                0.25f);
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: START engine=5.6 preset=%s"),
                *BuilderAvatarName);
            return;
        }
#endif

        if (!FParse::Param(FCommandLine::Get(), TEXT("ConclaviaBridge")))
        {
            return;
        }

        FParse::Value(FCommandLine::Get(), TEXT("ConclaviaBridgePort="), ControlPort);
        FParse::Value(FCommandLine::Get(), TEXT("ConclaviaAvatar="), SelectedAvatarId);
        SelectedAvatarId = SelectedAvatarId.ToLower();
        if (!SelectedAvatarId.Equals(TEXT("ada"))
            && !SelectedAvatarId.Equals(TEXT("vivian"))
            && !SelectedAvatarId.Equals(TEXT("jelena")))
        {
            SelectedAvatarId = TEXT("aera");
        }
        WorldInitializationHandle = FWorldDelegates::OnPostWorldInitialization.AddRaw(
            this,
            &FConclaviaLipSyncBridgeModule::HandleWorldInitialization);
        WorldTickHandle = FWorldDelegates::OnWorldTickStart.AddRaw(
            this,
            &FConclaviaLipSyncBridgeModule::HandleWorldTickStart);
        StartHttpServer();
    }

    virtual void ShutdownModule() override
    {
#if WITH_EDITOR
        if (VivianBuildTickerHandle.IsValid())
        {
            FTSTicker::GetCoreTicker().RemoveTicker(VivianBuildTickerHandle);
            VivianBuildTickerHandle.Reset();
        }
        if (VivianSubsystem && VivianCharacter.IsValid()
            && VivianSubsystem->IsObjectAddedForEditing(VivianCharacter.Get()))
        {
            VivianSubsystem->RemoveObjectToEdit(VivianCharacter.Get());
        }
        VivianCharacter.Reset();
        VivianPipeline.Reset();
        VivianSubsystem = nullptr;
#endif

        FWorldDelegates::OnPostWorldInitialization.Remove(WorldInitializationHandle);
        FWorldDelegates::OnWorldTickStart.Remove(WorldTickHandle);
        StopPlayback();
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearAllTimersForObject(this);
        }
        ClearAllGeneratorBindings();
        Generators.Reset();
        if (Router.IsValid())
        {
            Router->UnbindRoute(HealthRoute);
            Router->UnbindRoute(SpeechRoute);
            Router->UnbindRoute(CueRoute);
            Router->UnbindRoute(AvatarRoute);
        }
        Router.Reset();
    }

private:
#if WITH_EDITOR
    enum class EVivianBuildPhase : uint8
    {
        Initialize,
        AwaitRig,
        RequestTextures,
        AwaitTextures,
        Assemble
    };

    bool FinishVivianBuild(const bool bSucceeded, const FString& Message)
    {
        if (VivianSubsystem && VivianCharacter.IsValid()
            && VivianSubsystem->IsObjectAddedForEditing(VivianCharacter.Get()))
        {
            VivianSubsystem->RemoveObjectToEdit(VivianCharacter.Get());
        }
        if (bSucceeded)
        {
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: READY preset=%s %s"),
                *BuilderAvatarName, *Message);
        }
        else
        {
            UE_LOG(LogConclaviaLipSyncBridge, Error,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: FAILED preset=%s %s"),
                *BuilderAvatarName, *Message);
        }
        VivianBuildTickerHandle.Reset();
        FPlatformMisc::RequestExitWithStatus(true, bSucceeded ? 0 : 1);
        return false;
    }

    UMetaHumanCharacter* LoadOrCreateVivianCharacter()
    {
        const FString SourceAssetName = FString::Printf(TEXT("MHC_%s"), *BuilderAvatarName);
        const FString SourcePackagePath = FString::Printf(
            TEXT("/Game/Conclavia/AvatarSources/%s"), *SourceAssetName);
        const FString SourceObjectPath = FString::Printf(
            TEXT("%s.%s"), *SourcePackagePath, *SourceAssetName);
        if (UMetaHumanCharacter* Existing = LoadObject<UMetaHumanCharacter>(
            nullptr, *SourceObjectPath))
        {
            return Existing;
        }

        const FString PresetPath = FString::Printf(
            TEXT("/MetaHumanCharacter/Optional/Presets/%s.%s"),
            *BuilderAvatarName,
            *BuilderAvatarName);
        UMetaHumanCharacter* Preset = LoadObject<UMetaHumanCharacter>(nullptr, *PresetPath);
        if (!Preset)
        {
            return nullptr;
        }

        UPackage* Package = CreatePackage(*SourcePackagePath);
        if (!Package)
        {
            return nullptr;
        }
        Package->FullyLoad();
        UMetaHumanCharacter* Character = Cast<UMetaHumanCharacter>(StaticDuplicateObject(
            Preset,
            Package,
            FName(*SourceAssetName),
            RF_Public | RF_Standalone | RF_Transactional));
        if (!Character)
        {
            return nullptr;
        }
        FAssetRegistryModule::AssetCreated(Character);
        Package->MarkPackageDirty();
        return Character;
    }

    bool SaveVivianSourceCharacter()
    {
        if (!VivianCharacter.IsValid())
        {
            return false;
        }
        UPackage* Package = VivianCharacter->GetOutermost();
        const FString Filename = FPackageName::LongPackageNameToFilename(
            Package->GetName(), FPackageName::GetAssetPackageExtension());
        FSavePackageArgs SaveArgs;
        SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
        SaveArgs.SaveFlags = SAVE_NoError;
        return UPackage::SavePackage(
            Package, VivianCharacter.Get(), *Filename, SaveArgs);
    }

    bool SaveVivianOutputPackages()
    {
        TArray<UPackage*> Packages;
        ForEachObjectOfClass(UPackage::StaticClass(), [&Packages](UObject* Object)
        {
            UPackage* Package = CastChecked<UPackage>(Object);
            if (Package->IsDirty()
                && Package->GetName().StartsWith(TEXT("/Game/MetaHumans/")))
            {
                Packages.Add(Package);
            }
        });
        Packages.Sort([](const UPackage& Left, const UPackage& Right)
        {
            return Left.GetName() < Right.GetName();
        });
        UE_LOG(LogConclaviaLipSyncBridge, Display,
            TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: SAVE_START preset=%s packages=%d"),
            *BuilderAvatarName, Packages.Num());
        for (UPackage* Package : Packages)
        {
            const FString Filename = FPackageName::LongPackageNameToFilename(
                Package->GetName(), FPackageName::GetAssetPackageExtension());
            FSavePackageArgs SaveArgs;
            SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
            SaveArgs.SaveFlags = SAVE_NoError;
            if (!UPackage::SavePackage(Package, nullptr, *Filename, SaveArgs))
            {
                UE_LOG(LogConclaviaLipSyncBridge, Error,
                    TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: SAVE_FAILED preset=%s package=%s"),
                    *BuilderAvatarName, *Package->GetName());
                return false;
            }
        }
        return Packages.Num() > 0;
    }

    bool TickVivianBuild(float)
    {
        const FString BlueprintPath = FString::Printf(
            TEXT("/Game/MetaHumans/%s/BP_%s.BP_%s_C"),
            *BuilderAvatarName,
            *BuilderAvatarName,
            *BuilderAvatarName);
        const FString BlueprintAssetPath = FString::Printf(
            TEXT("/Game/MetaHumans/%s/BP_%s"),
            *BuilderAvatarName,
            *BuilderAvatarName);
        if (StaticLoadClass(AActor::StaticClass(), nullptr, *BlueprintPath))
        {
            return FinishVivianBuild(true,
                FString::Printf(TEXT("reuse=true blueprint=%s"), *BlueprintAssetPath));
        }
        if (FPlatformTime::Seconds() - VivianBuildStartedAt > 1200.0)
        {
            return FinishVivianBuild(false, TEXT("reason=timeout"));
        }
        if (!GEditor)
        {
            return true;
        }

        if (VivianBuildPhase == EVivianBuildPhase::Initialize)
        {
            VivianCharacter.Reset(LoadOrCreateVivianCharacter());
            VivianSubsystem = UMetaHumanCharacterEditorSubsystem::Get();
            if (!VivianCharacter.IsValid() || !VivianSubsystem)
            {
                return FinishVivianBuild(false,
                    TEXT("reason=preset-or-subsystem-unavailable"));
            }
            VivianSubsystem->InitializeMetaHumanCharacter(VivianCharacter.Get());
            if (!VivianSubsystem->TryAddObjectToEdit(VivianCharacter.Get()))
            {
                return FinishVivianBuild(false,
                    TEXT("reason=could-not-register-character"));
            }

            const EMetaHumanCharacterRigState RigState =
                VivianSubsystem->GetRiggingState(VivianCharacter.Get());
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: CHARACTER preset=%s rigState=%d highResTextures=%s"),
                *BuilderAvatarName,
                static_cast<int32>(RigState),
                VivianCharacter->HasHighResolutionTextures() ? TEXT("true") : TEXT("false"));
            if (RigState == EMetaHumanCharacterRigState::Rigged)
            {
                VivianBuildPhase = EVivianBuildPhase::RequestTextures;
                return true;
            }
            VivianSubsystem->AutoRigFace(
                VivianCharacter.Get(),
                UE::MetaHuman::ERigType::JointsAndBlendshapes);
            VivianBuildPhase = EVivianBuildPhase::AwaitRig;
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: AUTORIG_START preset=%s type=JointsAndBlendshapes"),
                *BuilderAvatarName);
            return true;
        }

        if (VivianBuildPhase == EVivianBuildPhase::AwaitRig)
        {
            if (VivianSubsystem->IsAutoRiggingFace(VivianCharacter.Get()))
            {
                return true;
            }
            if (VivianSubsystem->GetRiggingState(VivianCharacter.Get())
                != EMetaHumanCharacterRigState::Rigged)
            {
                return FinishVivianBuild(false, TEXT("reason=auto-rig-failed"));
            }
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: AUTORIG_READY preset=%s"),
                *BuilderAvatarName);
            VivianBuildPhase = EVivianBuildPhase::RequestTextures;
            return true;
        }

        if (VivianBuildPhase == EVivianBuildPhase::RequestTextures)
        {
            if (VivianCharacter->HasHighResolutionTextures())
            {
                VivianBuildPhase = EVivianBuildPhase::Assemble;
                return true;
            }
            VivianSubsystem->RequestHighResolutionTextures(
                VivianCharacter.Get(), ERequestTextureResolution::Res2k);
            VivianBuildPhase = EVivianBuildPhase::AwaitTextures;
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: TEXTURES_START preset=%s resolution=2k"),
                *BuilderAvatarName);
            return true;
        }

        if (VivianBuildPhase == EVivianBuildPhase::AwaitTextures)
        {
            if (VivianSubsystem->IsRequestingHighResolutionTextures(VivianCharacter.Get()))
            {
                return true;
            }
            if (VivianCharacter->HasHighResolutionTextures())
            {
                UE_LOG(LogConclaviaLipSyncBridge, Display,
                    TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: TEXTURES_READY preset=%s highRes=true"),
                    *BuilderAvatarName);
            }
            else
            {
                UE_LOG(LogConclaviaLipSyncBridge, Warning,
                    TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: TEXTURES_READY preset=%s highRes=false"),
                    *BuilderAvatarName);
            }
            if (!SaveVivianSourceCharacter())
            {
                return FinishVivianBuild(false, TEXT("reason=source-save-failed"));
            }
            UE_LOG(LogConclaviaLipSyncBridge, Display,
                TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: SOURCE_READY preset=%s path=/Game/Conclavia/AvatarSources/MHC_%s"),
                *BuilderAvatarName, *BuilderAvatarName);
            VivianBuildPhase = EVivianBuildPhase::Assemble;
            return true;
        }

        FText BuildError;
        if (!VivianSubsystem->CanBuildMetaHuman(VivianCharacter.Get(), BuildError))
        {
            return FinishVivianBuild(false,
                FString::Printf(TEXT("reason=not-buildable detail=%s"), *BuildError.ToString()));
        }
        FMetaHumanCharacterEditorBuildParameters BuildParameters;
        BuildParameters.AbsoluteBuildPath = TEXT("/Game/MetaHumans");
        BuildParameters.CommonFolderPath = TEXT("/Game/MetaHumans/Common");
        BuildParameters.NameOverride = BuilderAvatarName;
        UClass* PipelineClass = LoadClass<UMetaHumanCollectionPipeline>(
            nullptr,
            TEXT("/MetaHumanCharacter/BuildPipeline/BP_DefaultLegacyPipeline_High.BP_DefaultLegacyPipeline_High_C"));
        if (!PipelineClass)
        {
            return FinishVivianBuild(false,
                TEXT("reason=legacy-high-pipeline-unavailable"));
        }
        VivianPipeline.Reset(NewObject<UMetaHumanCollectionPipeline>(
            GetTransientPackage(), PipelineClass));
        if (!VivianPipeline.IsValid())
        {
            return FinishVivianBuild(false,
                TEXT("reason=legacy-high-pipeline-instantiation-failed"));
        }
        BuildParameters.PipelineOverride = VivianPipeline.Get();
        UE_LOG(LogConclaviaLipSyncBridge, Display,
            TEXT("CONCLAVIA_MEETING_AVATAR_BUILD: ASSEMBLY_START preset=%s pipeline=LegacyHigh output=/Game/MetaHumans/%s"),
            *BuilderAvatarName, *BuilderAvatarName);
        FMetaHumanCharacterEditorBuild::BuildMetaHumanCharacter(
            VivianCharacter.Get(), BuildParameters);
        if (!SaveVivianOutputPackages())
        {
            return FinishVivianBuild(false, TEXT("reason=save-failed"));
        }
        if (!StaticLoadClass(AActor::StaticClass(), nullptr, *BlueprintPath))
        {
            return FinishVivianBuild(false,
                TEXT("reason=assembly-produced-no-blueprint"));
        }
        return FinishVivianBuild(true,
            FString::Printf(TEXT("reuse=false blueprint=%s"), *BlueprintAssetPath));
    }
#endif

    struct FPerformanceBeat
    {
        int32 AtMs = 0;
        ERealisticMetaHumanLipSyncMood Mood = ERealisticMetaHumanLipSyncMood::Confidence;
        FString MoodName = TEXT("confidence");
        float Intensity = 0.20f;
        FString Focus = TEXT("camera");
        FString Gesture = TEXT("none");
    };

    void StartHttpServer()
    {
        FHttpServerModule& Server = FHttpServerModule::Get();
        Router = Server.GetHttpRouter(ControlPort);
        HealthRoute = Router->BindRoute(
            FHttpPath(TEXT("/health")),
            EHttpServerRequestVerbs::VERB_GET,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaLipSyncBridgeModule::HandleHealth));
        SpeechRoute = Router->BindRoute(
            FHttpPath(TEXT("/audio/speech")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaLipSyncBridgeModule::HandleSpeech));
        CueRoute = Router->BindRoute(
            FHttpPath(TEXT("/director/cue")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaLipSyncBridgeModule::HandleCue));
        AvatarRoute = Router->BindRoute(
            FHttpPath(TEXT("/avatar")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaLipSyncBridgeModule::HandleAvatar));
        Server.StartAllListeners();
        UE_LOG(
            LogConclaviaLipSyncBridge,
            Display,
            TEXT("Conclavia 5.6 lip-sync bridge listening on 127.0.0.1:%u"),
            ControlPort);
    }

    void HandleWorldInitialization(UWorld* World, const UWorld::InitializationValues)
    {
        AttachWorld(World);
    }

    void AttachWorld(UWorld* World)
    {
        if (!World || (World->WorldType != EWorldType::Game && World->WorldType != EWorldType::PIE))
        {
            return;
        }
        if (StudioWorld.Get() == World)
        {
            return;
        }

        StudioWorld = World;
        World->GetTimerManager().SetTimer(
            StageDiscoveryTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::DiscoverStage),
            0.5f,
            true,
            1.0f);
    }

    void HandleWorldTickStart(UWorld* World, ELevelTick, float DeltaSeconds)
    {
        AttachWorld(World);
        if (StudioWorld.Get() == World)
        {
            ApplyPendingAvatarSwitch();
        }
        if (StudioWorld.Get() == World && !bStageReady)
        {
            // The commercial sample resets its timer manager while the map is
            // entering play. Drive discovery from the actual world tick too,
            // so that reset cannot strand a healthy renderer at stageReady=false.
            DiscoverStage();
        }
        if (StudioWorld.Get() == World && PendingCaptureFrames > 0)
        {
            --PendingCaptureFrames;
            if (PendingCaptureFrames == 0)
            {
                CaptureViewportFrame();
            }
        }
        if (StudioWorld.Get() == World && bStageReady)
        {
            UpdatePerformanceTimeline();
            // Publish state before Unreal evaluates the animation graph. The
            // previous post-actor root teleports made body, groom and shadow
            // advance on different clocks and caused the visible hard jumps.
            UpdateCastPerformance(DeltaSeconds);
        }
    }

    void ApplyPendingAvatarSwitch()
    {
        FString RequestedAvatarId;
        {
            FScopeLock Lock(&AvatarSwitchMutex);
            if (PendingAvatarId.IsEmpty())
            {
                return;
            }
            RequestedAvatarId = MoveTemp(PendingAvatarId);
            PendingAvatarId.Reset();
        }
        if (RequestedAvatarId.Equals(SelectedAvatarId) && bStageReady)
        {
            return;
        }

        StopPlayback();
        if (StudioWorld.IsValid())
        {
            FTimerManager& Timers = StudioWorld->GetTimerManager();
            Timers.ClearTimer(StageDiscoveryTimer);
            Timers.ClearTimer(InitialCameraTimer);
            Timers.ClearTimer(ModelTimer);
            Timers.ClearTimer(CameraBlendTimer);
        }
        ClearAllGeneratorBindings();
        Generators.Reset();
        GeneratorBoundStates.Reset();
        CastActors.Reset();
        CastFaces.Reset();
        CameraRigTargets.Reset();
        CameraRigFronts.Reset();
        CameraRigSides.Reset();
        HeroActor.Reset();
        HeroFace.Reset();
        PendingPerformanceBeats.Reset();
        ActivePerformanceBeats.Reset();
        BoundGeneratorProperties.Reset();
        BoundAnimNodes.Reset();
        BoundModeProperties.Reset();

        SelectedAvatarId = RequestedAvatarId;
        StageDiscoveryAttempts = 0;
        ActiveFaceIndex = 0;
        ActiveTargetIndex = INDEX_NONE;
        bStageReady = false;
        bModelReady = false;
        bGeneratorBound = false;
        bCinematicLodForced = false;
        bCameraRigCalibrated = false;
        bHandRaiseRequested = false;
        ActiveBodyGesture = TEXT("none");
        ActivePerformanceGesture = TEXT("none");
        ActivePerformanceFocus = TEXT("camera");

        UE_LOG(
            LogConclaviaLipSyncBridge,
            Display,
            TEXT("Conclavia hot-switching MetaHuman avatar=%s"),
            *SelectedAvatarId);
        DiscoverStage();
    }

    void CaptureViewportFrame()
    {
        if (!GEngine || !GEngine->GameViewport)
        {
            return;
        }

        // Direct ReadPixels returns the off-screen editor back buffer on this
        // cloud renderer, which is valid-sized but black. Unreal's screenshot
        // queue captures after the actual viewport has presented and therefore
        // sees the same frame that Pixel Streaming encodes.
        FScreenshotRequest::RequestScreenshot(
            TEXT("C:/ConclaviaStudio/Saved/PixelStreaming/lipsync-audit.png"),
            false,
            false);
    }

    static USkeletalMeshComponent* FindFaceComponent(AActor* Actor)
    {
        if (!Actor)
        {
            return nullptr;
        }

        TArray<USkeletalMeshComponent*> Components;
        Actor->GetComponents<USkeletalMeshComponent>(Components);
        for (USkeletalMeshComponent* Component : Components)
        {
            if (Component && Component->GetName().Equals(TEXT("Face"), ESearchCase::IgnoreCase))
            {
                return Component;
            }
        }
        return nullptr;
    }

    static int32 ParticipantIndexFromId(const FString& Id, const int32 CastSize)
    {
        if (CastSize <= 0)
        {
            return INDEX_NONE;
        }
        if (Id.TrimStartAndEnd().IsEmpty())
        {
            return INDEX_NONE;
        }
        FString Prefix;
        FString Number;
        if (!Id.Split(TEXT("-"), &Prefix, &Number, ESearchCase::IgnoreCase, ESearchDir::FromEnd))
        {
            return 0;
        }
        return FMath::Abs(FCString::Atoi(*Number) - 1) % CastSize;
    }

    static bool SetIntegerProperty(UObject* Object, const FName PropertyName, const int32 Value)
    {
        if (!Object)
        {
            return false;
        }
        if (FIntProperty* Property = FindFProperty<FIntProperty>(Object->GetClass(), PropertyName))
        {
            Property->SetPropertyValue_InContainer(Object, Value);
            return true;
        }
        return false;
    }

    void ConfigureCinematicMetaHuman(AActor* Hero, USkeletalMeshComponent* Face)
    {
        if (!Hero || !Face)
        {
            return;
        }

        // Skeletal LOD index zero is represented by ForcedLOD=1. Keeping every
        // component on its highest authored LOD prevents the face, teeth and
        // groom from silently dropping quality during a streamed close-up.
        TArray<USkeletalMeshComponent*> SkeletalComponents;
        Hero->GetComponents<USkeletalMeshComponent>(SkeletalComponents);
        for (USkeletalMeshComponent* Component : SkeletalComponents)
        {
            if (!Component)
            {
                continue;
            }
            Component->SetForcedLOD(1);
            Component->SetComponentTickEnabled(true);
            Component->VisibilityBasedAnimTickOption =
                EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
            Component->SetTextureForceResidentFlag(true);

            const USkeletalMesh* Mesh = Component->GetSkeletalMeshAsset();
            const USkeleton* Skeleton = Mesh ? Mesh->GetSkeleton() : nullptr;
            const UAnimInstance* AnimInstance = Component->GetAnimInstance();
            const UAnimInstance* PostProcessInstance = Component->GetPostProcessInstance();
            const USkinnedMeshComponent* Leader = Component->LeaderPoseComponent.Get();
            UE_LOG(
                LogConclaviaLipSyncBridge,
                Display,
                TEXT("Conclavia animation stack actor=%s component=%s mesh=%s skeleton=%s anim=%s postProcess=%s leader=%s"),
                *Hero->GetName(),
                *Component->GetName(),
                Mesh ? *Mesh->GetPathName() : TEXT("none"),
                Skeleton ? *Skeleton->GetPathName() : TEXT("none"),
                AnimInstance ? *AnimInstance->GetClass()->GetPathName() : TEXT("none"),
                PostProcessInstance ? *PostProcessInstance->GetClass()->GetPathName() : TEXT("none"),
                Leader ? *Leader->GetName() : TEXT("none"));
        }

        // MetaHuman's LODSync component owns the cross-component decision. Use
        // reflection so this bridge stays independent from the optional
        // MetaHuman module while still pinning its public ForcedLOD to LOD0.
        for (UActorComponent* Component : Hero->GetComponents())
        {
            if (!Component
                || !Component->GetClass()->GetName().Contains(TEXT("LODSync"), ESearchCase::IgnoreCase))
            {
                continue;
            }
            const bool bForced = SetIntegerProperty(Component, TEXT("ForcedLOD"), 0);
            const bool bMinimum = SetIntegerProperty(Component, TEXT("MinLOD"), 0);
            Component->SetComponentTickEnabled(true);
            bCinematicLodForced = bForced || bMinimum;
        }

        FaceMaterialNames.Reset();
        for (int32 MaterialIndex = 0; MaterialIndex < Face->GetNumMaterials(); ++MaterialIndex)
        {
            if (UMaterialInterface* Material = Face->GetMaterial(MaterialIndex))
            {
                FaceMaterialNames.Add(Material->GetName());

                // The marketplace sample is intentionally neutral and soft.
                // Keep its authored maps, but recover pore-scale contrast and
                // remove the cloudy-eye preset that flattens a live close-up.
                UMaterialInstanceDynamic* Dynamic =
                    Face->CreateAndSetMaterialInstanceDynamic(MaterialIndex);
                if (!Dynamic)
                {
                    continue;
                }
                const FString MaterialName = Material->GetName();
                if (MaterialName.Contains(TEXT("Skin_Baked"), ESearchCase::IgnoreCase))
                {
                    Dynamic->SetScalarParameterValue(TEXT("Micro Skin Normal Strength"), 1.08f);
                    Dynamic->SetScalarParameterValue(
                        TEXT("Micro Skin Cavity Specular Multiply"),
                        0.78f);
                    Dynamic->SetScalarParameterValue(TEXT("Roughness Adjust"), 1.10f);
                    Dynamic->SetScalarParameterValue(TEXT("Spec Adjust"), 0.82f);
                }
                else if (MaterialName.Contains(TEXT("Eye"), ESearchCase::IgnoreCase)
                    && !MaterialName.Contains(TEXT("Eyelash"), ESearchCase::IgnoreCase)
                    && !MaterialName.Contains(TEXT("EyeShell"), ESearchCase::IgnoreCase))
                {
                    Dynamic->SetScalarParameterValue(TEXT("Cloudy Eye Intensity"), 0.0f);
                    Dynamic->SetScalarParameterValue(TEXT("Iris Global Saturation"), 1.18f);
                    Dynamic->SetScalarParameterValue(TEXT("Pupil Dilation"), 0.86f);
                }
                else if (MaterialName.Contains(TEXT("Teeth_Baked"), ESearchCase::IgnoreCase))
                {
                    // The commercial sample ships 1K baked oral maps even on
                    // its Cine character. Preserve those authored maps, then
                    // recover small-scale enamel, gum and cavity separation in
                    // the material instead of lifting the entire mouth into a
                    // flat white patch under the portrait fill light.
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Basecolor Value"), 0.73f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Specular"), 0.14f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Roughness"), 0.20f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Sharp Normal Strength"), 1.16f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Detail Normal Strength"), 0.90f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Micro Normal Tiling"), 3.35f);
                    Dynamic->SetScalarParameterValue(TEXT("Teeth Micro Normal Strength"), 0.38f);
                    Dynamic->SetScalarParameterValue(TEXT("Gums Basecolor Saturation"), 0.075f);
                    Dynamic->SetScalarParameterValue(TEXT("Gums Basecolor Value"), 0.62f);
                    Dynamic->SetScalarParameterValue(TEXT("Gums Roughness"), 0.30f);
                    Dynamic->SetScalarParameterValue(TEXT("Gum Line Basecolor Value"), 0.67f);
                    Dynamic->SetScalarParameterValue(TEXT("Gum Line Roughness Offset"), 0.29f);
                    // Preserve depth without turning the oral cavity into a
                    // uniform black hole when the jaw opens in a close-up.
                    Dynamic->SetScalarParameterValue(TEXT("Mouth Occlusion Amount"), 1.78f);
                    Dynamic->SetScalarParameterValue(TEXT("Depth Offset"), 0.22f);
                }
            }
        }
        FaceMaterialSummary = FString::Join(FaceMaterialNames, TEXT(","));
    }

    void DiscoverStage()
    {
        ++StageDiscoveryAttempts;
        if (!StudioWorld.IsValid())
        {
            return;
        }

        AActor* Aera = nullptr;
        AActor* Ada = nullptr;
        AActor* Vivian = nullptr;
        AActor* Jelena = nullptr;
        TArray<TWeakObjectPtr<AActor>> DiscoveredMetaHumans;
        for (TActorIterator<AActor> It(StudioWorld.Get()); It; ++It)
        {
            USkeletalMeshComponent* CandidateFace = FindFaceComponent(*It);
            if (!CandidateFace)
            {
                continue;
            }
            if (It->GetName().Contains(TEXT("Aera"), ESearchCase::IgnoreCase))
            {
                Aera = *It;
                DiscoveredMetaHumans.Add(*It);
            }
            else if (It->GetName().Contains(TEXT("Ada"), ESearchCase::IgnoreCase))
            {
                Ada = *It;
                DiscoveredMetaHumans.Add(*It);
            }
            else if (It->GetName().Contains(TEXT("Vivian"), ESearchCase::IgnoreCase))
            {
                Vivian = *It;
                DiscoveredMetaHumans.Add(*It);
            }
            else if (It->GetName().Contains(TEXT("Jelena"), ESearchCase::IgnoreCase))
            {
                Jelena = *It;
                DiscoveredMetaHumans.Add(*It);
            }
        }

        auto SpawnCastMember = [this](const TCHAR* ClassPath, const FTransform& Transform)
            -> AActor*
        {
            UClass* CastClass = LoadClass<AActor>(nullptr, ClassPath);
            if (!CastClass || !StudioWorld.IsValid())
            {
                return nullptr;
            }
            FActorSpawnParameters SpawnParameters;
            SpawnParameters.SpawnCollisionHandlingOverride =
                ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
            return StudioWorld->SpawnActor<AActor>(CastClass, Transform, SpawnParameters);
        };

        AActor* SelectedHero = Aera;
        if (SelectedAvatarId.Equals(TEXT("ada")))
        {
            SelectedHero = Ada;
        }
        else if (SelectedAvatarId.Equals(TEXT("vivian")))
        {
            SelectedHero = Vivian;
        }
        else if (SelectedAvatarId.Equals(TEXT("jelena")))
        {
            SelectedHero = Jelena;
        }
        const FTransform HeroTransform = Aera
            ? Aera->GetActorTransform()
            : FTransform::Identity;
        if (!SelectedHero)
        {
            const TCHAR* ClassPath = SelectedAvatarId.Equals(TEXT("ada"))
                ? TEXT("/Game/MetaHumans/Ada/BP_Ada.BP_Ada_C")
                : SelectedAvatarId.Equals(TEXT("vivian"))
                    ? TEXT("/Game/MetaHumans/Vivian/BP_Vivian.BP_Vivian_C")
                    : SelectedAvatarId.Equals(TEXT("jelena"))
                        ? TEXT("/Game/MetaHumans/Jelena/BP_Jelena.BP_Jelena_C")
                    : TEXT("/Game/MetaHumans/Aera/BP_Aera.BP_Aera_C");
            SelectedHero = SpawnCastMember(ClassPath, HeroTransform);
        }
        USkeletalMeshComponent* SelectedFace = FindFaceComponent(SelectedHero);
        if (!SelectedHero || !SelectedFace)
        {
            if ((StageDiscoveryAttempts % 20) == 0)
            {
                UE_LOG(
                    LogConclaviaLipSyncBridge,
                    Warning,
                    TEXT("Benchmark hero discovery pending attempt=%d avatar=%s actor=%s face=%s"),
                    StageDiscoveryAttempts,
                    *SelectedAvatarId,
                    SelectedHero ? *SelectedHero->GetPathName() : TEXT("missing"),
                    SelectedFace ? *SelectedFace->GetPathName() : TEXT("missing"));
            }
            return;
        }

        if (SelectedAvatarId.Equals(TEXT("vivian"))
            || SelectedAvatarId.Equals(TEXT("jelena")))
        {
            UClass* CommercialFaceAnimClass = LoadClass<UAnimInstance>(
                nullptr,
                TEXT("/Game/RuntimeLipSync/Face/Face_AnimBP.Face_AnimBP_C"));
            if (!CommercialFaceAnimClass)
            {
                UE_LOG(
                    LogConclaviaLipSyncBridge,
                    Error,
                    TEXT("Assembled avatar commercial Face AnimBP is unavailable: %s"),
                    *SelectedAvatarId);
                return;
            }
            SelectedFace->SetAnimInstanceClass(CommercialFaceAnimClass);
        }

        StudioWorld->GetTimerManager().ClearTimer(StageDiscoveryTimer);
        const FVector StageCenter = Aera
            ? Aera->GetActorLocation()
            : SelectedHero->GetActorLocation();
        SelectedHero->SetActorLocation(StageCenter);
        if (Aera && SelectedHero != Aera)
        {
            SelectedHero->SetActorRotation(Aera->GetActorRotation());
        }
        SelectedHero->SetActorHiddenInGame(false);
        SelectedHero->SetActorTickEnabled(true);
        SelectedHero->SetActorLabel(FString::Printf(
            TEXT("CONCLAVIA_BENCHMARK_HERO_%s"),
            *SelectedAvatarId.ToUpper()));
        SelectedHero->Tags.AddUnique(TEXT("ConclaviaBenchmarkHero"));
        SelectedHero->Tags.AddUnique(TEXT("Seat1"));

        // The benchmark intentionally renders one hero only. Keeping the
        // sample's second MetaHuman alive continued to allocate its groom,
        // skin and animation graph even outside the camera, causing the hair
        // pop and render hitches we were trying to measure. The five-person
        // programme must not return until this one-face baseline is stable.
        for (const TWeakObjectPtr<AActor>& Extra : DiscoveredMetaHumans)
        {
            if (AActor* ExtraActor = Extra.Get())
            {
                if (ExtraActor == SelectedHero)
                {
                    continue;
                }
                ExtraActor->SetActorHiddenInGame(true);
                ExtraActor->SetActorEnableCollision(false);
                ExtraActor->SetActorTickEnabled(false);
            }
        }
        CastActors.Reset();
        CastActors.Add(SelectedHero);
        CastFaces.Reset();
        CastFaces.Add(SelectedFace);
        CameraRigTargets.Reset();
        CameraRigFronts.Reset();
        CameraRigSides.Reset();
        for (int32 Index = 0; Index < CastActors.Num(); ++Index)
        {
            AActor* const CastActor = CastActors[Index].Get();
            USkeletalMeshComponent* const CastFace = CastFaces[Index].Get();
            if (!IsValid(CastActor) || !IsValid(CastFace))
            {
                CastActors.Reset();
                CastFaces.Reset();
                return;
            }

            // Snapshot the stable rig before creating dynamic face materials.
            // TWeakObjectPtr's operator-> hid an invalid component during the
            // first two-person boot and turned this into an opaque bounds crash.
            // Explicit raw pointers plus IsValid keep stage discovery retryable.
            CameraRigTargets.Add(CastFace->Bounds.Origin + FVector(0.0, 0.0, 11.0));
            CameraRigFronts.Add(CastFace->GetRightVector().GetSafeNormal());
            CameraRigSides.Add(CastFace->GetForwardVector().GetSafeNormal());
            ConfigureCinematicMetaHuman(CastActor, CastFace);
        }
        PerformanceClock = 0.0;
        SpeakerChangedAt = FPlatformTime::Seconds();
        ActiveFaceIndex = 0;
        HeroActor = CastActors[0];
        HeroFace = CastFaces[0];
        CalibrateActiveCameraRig();

        Grade1PropCount = 0;
        for (TActorIterator<AActor> It(StudioWorld.Get()); It; ++It)
        {
            if (It->ActorHasTag(FName(TEXT("ConclaviaGrade1"))))
            {
                ++Grade1PropCount;
            }
        }
        const FString RuntimeMapName = StudioWorld->GetMapName();
        bGrade1SetReady =
            RuntimeMapName.Contains(TEXT("L_Grade1HeroPop"))
            && Grade1PropCount >= 16;

        if (GEngine && GEngine->GameViewport)
        {
            GEngine->GameViewport->RemoveAllViewportWidgets();
            // The broadcast feed must never expose editor/sample diagnostics
            // (texture-pool warnings, shader messages, stat overlays). Runtime
            // health remains available through the bridge API and log file.
            GEngine->Exec(StudioWorld.Get(), TEXT("DisableAllScreenMessages"));
        }
        // Keep the sample map's atmospheric sky, but remove its razor-sharp
        // character shadow. The lab owns the portrait contrast while this
        // low-level sun still gives the background enough energy to render.
        for (TActorIterator<ADirectionalLight> It(StudioWorld.Get()); It; ++It)
        {
            if (UDirectionalLightComponent* Light =
                    Cast<UDirectionalLightComponent>(It->GetLightComponent()))
            {
                Light->SetIntensity(0.35f);
                Light->SetCastShadows(false);
                Light->SetVisibility(true);
            }
        }
        // Open on the validated hero lane. The previous context framing was
        // far enough outside the serialized MetaHuman/set bounds to stream a
        // perfectly valid but empty sky frame until the first director cue.
        // A browser must see the performer as soon as WebRTC connects.
        ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Front);
        // The vendor MetaHuman finishes registering its skeletal components
        // after stage discovery. Re-apply the validated hero shot once that
        // initialization has settled: otherwise health reports the right
        // camera name while the serialized transform still sees empty sky.
        StudioWorld->GetTimerManager().SetTimer(
            InitialCameraTimer,
            FTimerDelegate::CreateRaw(
                this,
                &FConclaviaLipSyncBridgeModule::InitializeBroadcastCamera),
            1.5f,
            false);
        bStageReady = bGrade1SetReady;
        WarmGenerators();

        const UAnimInstance* ActiveAnim = HeroFace->GetAnimInstance();
        UE_LOG(
            LogConclaviaLipSyncBridge,
            Display,
            TEXT("5.6 Grade 1 hero ready: cast=%d props=%d set=%s active=%s anim=%s"),
            CastActors.Num(),
            Grade1PropCount,
            bGrade1SetReady ? TEXT("ready") : TEXT("missing"),
            *HeroActor->GetPathName(),
            ActiveAnim ? *ActiveAnim->GetClass()->GetPathName() : TEXT("pending"));
    }

    enum class ECameraShot : uint8
    {
        Context,
        Front,
        ThreeQuarterLeft,
        ThreeQuarterRight,
        ProfileLeft,
        ProfileRight,
        TwoShot,
        Listener
    };

    void InitializeBroadcastCamera()
    {
        if (!StudioWorld.IsValid() || !HeroActor.IsValid() || !HeroFace.IsValid())
        {
            return;
        }

        CalibrateActiveCameraRig();
        ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Front);
        UE_LOG(
            LogConclaviaLipSyncBridge,
            Display,
            TEXT("Deferred broadcast camera initialized: %s"),
            *ActiveCameraName);
    }

    static void SetAnimNodeGaze(
        UObject* Container,
        const float YawBiasDegrees,
        const float PitchBiasDegrees,
        const float MotionScale,
        const bool bDirectCameraGaze)
    {
        if (!Container)
        {
            return;
        }
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (!Property->Struct
                || !Property->Struct->IsChildOf(
                    FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
            {
                continue;
            }
            void* Address = Property->ContainerPtrToValuePtr<void>(Container);
            FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(Address);
            Node->GazeYawBiasDegrees = YawBiasDegrees;
            Node->GazePitchBiasDegrees = PitchBiasDegrees;
            Node->GazeMotionScale = MotionScale;
            Node->bDirectCameraGaze = bDirectCameraGaze;
        }
    }

    static void SetAnimNodePerformance(
        UObject* Container,
        const bool bSpeaking,
        const bool bListening,
        const float SpeechEnergy,
        const float SpeechPulse,
        const float PhraseBoundary,
        const float ExpressionValence,
        const float ExpressionArousal,
        const int32 ExpressionSignature,
        const float ListenerEngagement)
    {
        if (!Container)
        {
            return;
        }
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (!Property->Struct
                || !Property->Struct->IsChildOf(
                    FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
            {
                continue;
            }
            void* Address = Property->ContainerPtrToValuePtr<void>(Container);
            FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(Address);
            Node->bConclaviaSpeaking = bSpeaking;
            Node->bConclaviaListening = bListening;
            Node->ConclaviaSpeechEnergy = SpeechEnergy;
            Node->ConclaviaSpeechPulse = SpeechPulse;
            Node->ConclaviaPhraseBoundary = PhraseBoundary;
            Node->ConclaviaExpressionValence = ExpressionValence;
            Node->ConclaviaExpressionArousal = ExpressionArousal;
            Node->ConclaviaExpressionSignature = ExpressionSignature;
            Node->ConclaviaListenerEngagement = ListenerEngagement;
        }
    }

    int32 ResolveExpressionSignature() const
    {
        if (ActiveMoodName.Equals(TEXT("happiness"), ESearchCase::IgnoreCase)) return 1;
        if (ActiveMoodName.Equals(TEXT("sadness"), ESearchCase::IgnoreCase)) return 6;
        if (ActiveMoodName.Equals(TEXT("disgust"), ESearchCase::IgnoreCase)) return 2;
        if (ActiveMoodName.Equals(TEXT("anger"), ESearchCase::IgnoreCase)) return 2;
        if (ActiveMoodName.Equals(TEXT("surprise"), ESearchCase::IgnoreCase)) return 3;
        if (ActiveMoodName.Equals(TEXT("fear"), ESearchCase::IgnoreCase)) return 3;
        if (ActiveMoodName.Equals(TEXT("excitement"), ESearchCase::IgnoreCase)) return 4;
        if (ActiveMoodName.Equals(TEXT("boredom"), ESearchCase::IgnoreCase)) return 0;
        if (ActiveMoodName.Equals(TEXT("playfulness"), ESearchCase::IgnoreCase)) return 5;
        if (ActiveMoodName.Equals(TEXT("confusion"), ESearchCase::IgnoreCase)) return 6;
        if (ActiveMoodName.Equals(TEXT("confidence"), ESearchCase::IgnoreCase)) return 7;
        return 0;
    }

    void ResolveExpressionDimensions(float& OutValence, float& OutArousal) const
    {
        OutValence = 0.10f;
        OutArousal = 0.34f;
        if (ActiveMoodName.Equals(TEXT("happiness"), ESearchCase::IgnoreCase))
        {
            OutValence = 0.82f;
            OutArousal = 0.60f;
        }
        else if (ActiveMoodName.Equals(TEXT("sadness"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.68f;
            OutArousal = 0.25f;
        }
        else if (ActiveMoodName.Equals(TEXT("disgust"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.72f;
            OutArousal = 0.58f;
        }
        else if (ActiveMoodName.Equals(TEXT("playfulness"), ESearchCase::IgnoreCase))
        {
            OutValence = 0.66f;
            OutArousal = 0.72f;
        }
        else if (ActiveMoodName.Equals(TEXT("excitement"), ESearchCase::IgnoreCase))
        {
            OutValence = 0.54f;
            OutArousal = 0.92f;
        }
        else if (ActiveMoodName.Equals(TEXT("anger"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.82f;
            OutArousal = 0.88f;
        }
        else if (ActiveMoodName.Equals(TEXT("surprise"), ESearchCase::IgnoreCase))
        {
            OutValence = 0.12f;
            OutArousal = 0.94f;
        }
        else if (ActiveMoodName.Equals(TEXT("fear"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.72f;
            OutArousal = 0.88f;
        }
        else if (ActiveMoodName.Equals(TEXT("confusion"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.22f;
            OutArousal = 0.46f;
        }
        else if (ActiveMoodName.Equals(TEXT("boredom"), ESearchCase::IgnoreCase))
        {
            OutValence = -0.35f;
            OutArousal = 0.18f;
        }
        else if (ActiveMoodName.Equals(TEXT("confidence"), ESearchCase::IgnoreCase))
        {
            OutValence = 0.34f;
            OutArousal = 0.52f;
        }
        const float IntensityScale = FMath::Clamp(
            PerformanceCurrentIntensity / 0.40f,
            0.25f,
            1.20f);
        OutValence *= IntensityScale;
        OutArousal *= IntensityScale;
    }

    void ConfigureCastGaze(const ECameraShot Shot, const int32 ShotSubjectIndex)
    {
        for (int32 Index = 0; Index < CastFaces.Num(); ++Index)
        {
            USkeletalMeshComponent* Face = CastFaces[Index].Get();
            if (!IsValid(Face))
            {
                continue;
            }

            float YawBias = 0.0f;
            float PitchBias = -0.15f;
            float MotionScale = Index == ActiveFaceIndex ? 0.90f : 1.0f;
            const bool bFrontalSubject =
                Index == ShotSubjectIndex && Shot == ECameraShot::Front;
            if (Index == ShotSubjectIndex)
            {
                if (Shot == ECameraShot::ThreeQuarterLeft)
                {
                    YawBias = -3.2f;
                }
                else if (Shot == ECameraShot::ThreeQuarterRight)
                {
                    YawBias = 3.2f;
                }
                else if (Shot == ECameraShot::ProfileLeft)
                {
                    YawBias = -5.4f;
                }
                else if (Shot == ECameraShot::ProfileRight)
                {
                    YawBias = 5.4f;
                }
            }
            else
            {
                // Off-camera guests keep following the active speaker instead
                // of staring through the set. The sign is stable per seat and
                // the commercial node adds only tiny independent microsaccades.
                YawBias = Index < ActiveFaceIndex ? 5.0f : -5.0f;
                PitchBias = -0.35f;
            }

            SetAnimNodeGaze(
                Face->GetAnimInstance(),
                YawBias,
                PitchBias,
                MotionScale,
                bFrontalSubject);
            SetAnimNodeGaze(
                Face->GetPostProcessInstance(),
                YawBias,
                PitchBias,
                MotionScale,
                bFrontalSubject);
        }
    }

    void CalibrateActiveCameraRig()
    {
        if (!CameraRigTargets.IsValidIndex(ActiveFaceIndex))
        {
            bCameraRigCalibrated = false;
            return;
        }
        CameraRigTarget = CameraRigTargets[ActiveFaceIndex];
        CameraRigFront = CameraRigFronts[ActiveFaceIndex];
        CameraRigSide = CameraRigSides[ActiveFaceIndex];
        bCameraRigCalibrated = true;
    }

    URealisticMetaHumanLipSyncGenerator* GetGeneratorForIndex(const int32 Index) const
    {
        return Generators.IsValidIndex(Index) ? Generators[Index].Get() : nullptr;
    }

    URealisticMetaHumanLipSyncGenerator* GetActiveGenerator() const
    {
        return GetGeneratorForIndex(ActiveFaceIndex);
    }

    void ClearGeneratorBinding(
        UObject* Container,
        URealisticMetaHumanLipSyncGenerator* Current)
    {
        if (!Container || !Current)
        {
            return;
        }
        for (TFieldIterator<FObjectPropertyBase> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->PropertyClass
                && Current->IsA(Property->PropertyClass)
                && Property->GetObjectPropertyValue_InContainer(Container) == Current)
            {
                Property->SetObjectPropertyValue_InContainer(Container, nullptr);
            }
        }
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->Struct
                && Property->Struct->IsChildOf(FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
            {
                void* Address = Property->ContainerPtrToValuePtr<void>(Container);
                FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                    static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(Address);
                if (Node->LipSyncGenerator == Current)
                {
                    Node->LipSyncGenerator = nullptr;
                }
            }
        }
    }

    void ClearAllGeneratorBindings()
    {
        for (int32 Index = 0; Index < Generators.Num(); ++Index)
        {
            URealisticMetaHumanLipSyncGenerator* Current = GetGeneratorForIndex(Index);
            if (CastFaces.IsValidIndex(Index) && CastFaces[Index].IsValid())
            {
                ClearGeneratorBinding(CastFaces[Index]->GetAnimInstance(), Current);
            }
            if (CastActors.IsValidIndex(Index) && CastActors[Index].IsValid())
            {
                ClearGeneratorBinding(CastActors[Index].Get(), Current);
            }
        }
    }

    void SelectSpeaker(const int32 RequestedIndex)
    {
        if (CastActors.IsEmpty() || CastFaces.IsEmpty())
        {
            return;
        }
        const int32 NewIndex = FMath::Clamp(RequestedIndex, 0, CastActors.Num() - 1);
        const bool bSpeakerChanged = NewIndex != ActiveFaceIndex;
        if (bSpeakerChanged)
        {
            SpeakerChangedAt = FPlatformTime::Seconds();
            ++SpeakerHandoffCount;
        }
        CameraBlendDuration = bSpeakerChanged ? 0.24f : 0.34f;
        ActiveFaceIndex = NewIndex;
        HeroActor = CastActors[NewIndex];
        HeroFace = CastFaces[NewIndex];
        CalibrateActiveCameraRig();
        // The commercial solvers are warmed and permanently bound when the
        // stage starts. Rebinding through reflection on every cue introduced
        // needless latency and could briefly interrupt the face graph.
        if (!GeneratorBoundStates.IsValidIndex(NewIndex)
            || !GeneratorBoundStates[NewIndex])
        {
            BindCurrentGenerator();
        }
    }

    static bool PerformanceMoodFromName(
        const FString& Name,
        ERealisticMetaHumanLipSyncMood& OutMood)
    {
        if (Name.Equals(TEXT("neutral"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Neutral;
        }
        else if (Name.Equals(TEXT("happiness"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Happiness;
        }
        else if (Name.Equals(TEXT("sadness"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Sadness;
        }
        else if (Name.Equals(TEXT("disgust"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Disgust;
        }
        else if (Name.Equals(TEXT("anger"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Anger;
        }
        else if (Name.Equals(TEXT("surprise"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Surprise;
        }
        else if (Name.Equals(TEXT("fear"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Fear;
        }
        else if (Name.Equals(TEXT("excitement"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Excitement;
        }
        else if (Name.Equals(TEXT("boredom"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Boredom;
        }
        else if (Name.Equals(TEXT("playfulness"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Playfulness;
        }
        else if (Name.Equals(TEXT("confusion"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Confusion;
        }
        else if (Name.Equals(TEXT("confidence"), ESearchCase::IgnoreCase))
        {
            OutMood = ERealisticMetaHumanLipSyncMood::Confidence;
        }
        else
        {
            return false;
        }
        return true;
    }

    static void ParsePerformanceBeats(
        const TSharedPtr<FJsonObject>& Payload,
        TArray<FPerformanceBeat>& OutBeats)
    {
        OutBeats.Reset();
        if (!Payload.IsValid())
        {
            return;
        }
        const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
        if (!Payload->TryGetArrayField(TEXT("performanceBeats"), Values) || !Values)
        {
            return;
        }
        for (const TSharedPtr<FJsonValue>& Value : *Values)
        {
            if (OutBeats.Num() >= 12 || !Value.IsValid())
            {
                break;
            }
            const TSharedPtr<FJsonObject> BeatObject = Value->AsObject();
            if (!BeatObject.IsValid())
            {
                continue;
            }
            FPerformanceBeat Beat;
            double AtMs = 0.0;
            double Intensity = 0.20;
            BeatObject->TryGetNumberField(TEXT("atMs"), AtMs);
            BeatObject->TryGetNumberField(TEXT("intensity"), Intensity);
            BeatObject->TryGetStringField(TEXT("mood"), Beat.MoodName);
            BeatObject->TryGetStringField(TEXT("focus"), Beat.Focus);
            BeatObject->TryGetStringField(TEXT("gesture"), Beat.Gesture);
            if (!PerformanceMoodFromName(Beat.MoodName, Beat.Mood))
            {
                continue;
            }
            Beat.AtMs = FMath::Clamp(FMath::RoundToInt(AtMs), 0, 60000);
            // Diagnostic v32 deliberately exercises the vendor model's entire
            // documented range. Production shaping comes only after we have
            // proved that every requested mood changes the solved face.
            Beat.Intensity = FMath::Clamp(static_cast<float>(Intensity), 0.0f, 1.0f);
            if (!Beat.Focus.Equals(TEXT("camera"), ESearchCase::IgnoreCase)
                && !Beat.Focus.Equals(TEXT("target"), ESearchCase::IgnoreCase)
                && !Beat.Focus.Equals(TEXT("thought"), ESearchCase::IgnoreCase))
            {
                Beat.Focus = TEXT("camera");
            }
            if (!Beat.Gesture.Equals(TEXT("none"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("nod"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("tilt"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("emphasis"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("settle"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase)
                && !Beat.Gesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase))
            {
                Beat.Gesture = TEXT("none");
            }
            OutBeats.Add(MoveTemp(Beat));
        }
        OutBeats.Sort([](const FPerformanceBeat& Left, const FPerformanceBeat& Right)
        {
            return Left.AtMs < Right.AtMs;
        });
    }

    void ApplySolverPerformanceBeat(const FPerformanceBeat& Beat)
    {
        URealisticMetaHumanLipSyncGenerator* Current = GetActiveGenerator();
        if (!Current)
        {
            return;
        }
        // Reinitializing an unchanged mood at every semantic beat can flatten
        // the continuous facial solve. Select the emotional identity once per
        // utterance, then animate only its intensity.
        if (!ActiveMoodName.Equals(Beat.MoodName, ESearchCase::IgnoreCase))
        {
            Current->SetMood(Beat.Mood);
            ActiveMoodName = Beat.MoodName;
        }
        PerformanceTargetIntensity = Beat.Intensity;
        if (AppliedPerformanceBeatCount == 0)
        {
            PerformanceCurrentIntensity = PerformanceTargetIntensity;
        }
        Current->SetMoodIntensity(PerformanceCurrentIntensity);
        ActiveMoodIntensity = PerformanceCurrentIntensity;
        ++AppliedPerformanceBeatCount;
    }

    void AdvanceSolverPerformance(const int32 SampleCursor)
    {
        if (ActivePerformanceBeats.IsEmpty())
        {
            return;
        }
        const int32 SolverTimeMs = FMath::RoundToInt(
            static_cast<double>(SampleCursor) * 1000.0 / 16000.0);
        while (ActivePerformanceBeats.IsValidIndex(NextSolverPerformanceBeatIndex)
            && ActivePerformanceBeats[NextSolverPerformanceBeatIndex].AtMs <= SolverTimeMs)
        {
            ApplySolverPerformanceBeat(
                ActivePerformanceBeats[NextSolverPerformanceBeatIndex]);
            ++NextSolverPerformanceBeatIndex;
        }
        if (URealisticMetaHumanLipSyncGenerator* Current = GetActiveGenerator())
        {
            PerformanceCurrentIntensity = FMath::FInterpTo(
                PerformanceCurrentIntensity,
                PerformanceTargetIntensity,
                0.04f,
                5.5f);
            Current->SetMoodIntensity(PerformanceCurrentIntensity);
            ActiveMoodIntensity = PerformanceCurrentIntensity;
        }
    }

    void UpdatePerformanceTimeline()
    {
        if (!bSpeechActive || ActivePerformanceBeats.IsEmpty())
        {
            return;
        }
        const double Now = FPlatformTime::Seconds();
        const int32 AudibleTimeMs = FMath::RoundToInt(
            (Now - SpeechAudioStartsAt) * 1000.0);
        while (ActivePerformanceBeats.IsValidIndex(NextAudiblePerformanceBeatIndex)
            && ActivePerformanceBeats[NextAudiblePerformanceBeatIndex].AtMs <= AudibleTimeMs)
        {
            const FPerformanceBeat& Beat =
                ActivePerformanceBeats[NextAudiblePerformanceBeatIndex];
            ActivePerformanceFocus = Beat.Focus;
            ActivePerformanceGesture = Beat.Gesture;
            PerformanceGestureStartedAt = Now;
            ++NextAudiblePerformanceBeatIndex;
        }
    }

    void UpdateCastPerformance(const float DeltaSeconds)
    {
        const float SafeDelta = FMath::Clamp(DeltaSeconds, 0.0f, 0.05f);
        const double Now = FPlatformTime::Seconds();
        PerformanceClock += static_cast<double>(SafeDelta);
        SpeechAccentPulse = FMath::FInterpTo(SpeechAccentPulse, 0.0f, SafeDelta, 6.8f);
        SpeechPhrasePulse = FMath::FInterpTo(SpeechPhrasePulse, 0.0f, SafeDelta, 3.8f);

        if (bListeningReactionActive && !bSpeechActive && Now >= ListeningReactionExpiresAt)
        {
            SetMoodPreset(ERealisticMetaHumanLipSyncMood::Neutral, TEXT("neutral"), 0.0f);
            PerformanceCurrentIntensity = 0.0f;
            PerformanceTargetIntensity = 0.0f;
            ActivePerformanceFocus = TEXT("camera");
            bListeningReactionActive = false;
        }

        float ExpressionValence = 0.0f;
        float ExpressionArousal = 0.0f;
        ResolveExpressionDimensions(ExpressionValence, ExpressionArousal);
        const int32 ExpressionSignature = ResolveExpressionSignature();

        for (int32 Index = 0; Index < CastActors.Num(); ++Index)
        {
            AActor* Actor = CastActors[Index].Get();
            USkeletalMeshComponent* Face = CastFaces.IsValidIndex(Index)
                ? CastFaces[Index].Get()
                : nullptr;
            if (!IsValid(Actor) || !IsValid(Face))
            {
                continue;
            }

            const bool bSpeaker = Index == ActiveFaceIndex;
            const bool bSpeaking = bSpeaker && bSpeechActive;
            const bool bListening = bSpeaker && !bSpeechActive;
            // Body motion is owned by authored MetaHuman AnimSequences and the
            // Animation Blueprint. This bridge publishes semantic state only;
            // it no longer synthesizes random head, breathing or listening
            // rotations per frame.
            const float Engagement = bListening
                ? FMath::Clamp(0.20f + PerformanceCurrentIntensity * 0.90f, 0.0f, 0.82f)
                : 0.0f;
            SetAnimNodePerformance(
                Face->GetAnimInstance(),
                bSpeaking,
                bListening,
                bSpeaking ? SmoothedSpeechEnergy : 0.0f,
                bSpeaking ? FMath::Max(SpeechAccentPulse, SpeechPhrasePulse * 0.52f) : 0.0f,
                bSpeaking ? SpeechPhrasePulse : 0.0f,
                bSpeaker ? ExpressionValence : 0.0f,
                bSpeaker ? ExpressionArousal : 0.0f,
                bSpeaker ? ExpressionSignature : 0,
                Engagement);
            SetAnimNodePerformance(
                Face->GetPostProcessInstance(),
                bSpeaking,
                bListening,
                bSpeaking ? SmoothedSpeechEnergy : 0.0f,
                bSpeaking ? FMath::Max(SpeechAccentPulse, SpeechPhrasePulse * 0.52f) : 0.0f,
                bSpeaking ? SpeechPhrasePulse : 0.0f,
                bSpeaker ? ExpressionValence : 0.0f,
                bSpeaker ? ExpressionArousal : 0.0f,
                bSpeaker ? ExpressionSignature : 0,
                Engagement);
        }
    }

    void UpdateCameraBlend()
    {
        ACameraActor* Camera = CameraActor.Get();
        if (!Camera || !StudioWorld.IsValid())
        {
            return;
        }

        const float Elapsed = static_cast<float>(
            FPlatformTime::Seconds() - CameraBlendStartedAt);
        const float Alpha = FMath::Clamp(Elapsed / CameraBlendDuration, 0.0f, 1.0f);
        const float EasedAlpha = Alpha * Alpha * (3.0f - 2.0f * Alpha);
        Camera->SetActorLocationAndRotation(
            FMath::Lerp(CameraBlendStartLocation, CameraBlendTargetLocation, EasedAlpha),
            FQuat::Slerp(CameraBlendStartRotation, CameraBlendTargetRotation, EasedAlpha));
        Camera->GetCameraComponent()->SetFieldOfView(
            FMath::Lerp(CameraBlendStartFov, CameraBlendTargetFov, EasedAlpha));

        if (Alpha >= 1.0f)
        {
            StudioWorld->GetTimerManager().ClearTimer(CameraBlendTimer);
        }
    }

    void ConfigureCamera(AActor* Hero, USkeletalMeshComponent* Face, ECameraShot Shot)
    {
        if (!Hero || !Face || !StudioWorld.IsValid())
        {
            return;
        }

        // The assembled sample's bounds include its groom and do not line up
        // exactly with the visual eye line. This calibrated world-Z offset
        // keeps the complete face and shoulders inside the streamed 16:9
        // frame; the two measured failure bounds were +24 cm and -35 cm.
        if (!bCameraRigCalibrated)
        {
            CameraRigTarget = Face->Bounds.Origin + FVector(0.0, 0.0, 11.0);
            CameraRigFront = Face->GetRightVector().GetSafeNormal();
            CameraRigSide = Face->GetForwardVector().GetSafeNormal();
            bCameraRigCalibrated = true;
        }
        // Never derive a new camera anchor from animated bounds while a person
        // is speaking. Hair, jaw and idle-body bounds move every frame; using
        // them at each cut made the entire portrait appear to jump or breathe.
        FVector Target = CameraRigTarget;
        // In this assembled sample the MetaHuman's visual front is local +Y.
        // Blend it with local +X to produce portrait angles without exposing a
        // full profile, which would hide one eye and weaken visible lip sync.
        const FVector Front = CameraRigFront;
        const FVector Side = CameraRigSide;
        FVector Direction = Front;
        float CameraDistance = 101.0f;
        float TargetFov = 49.0f;
        bool bUseExplicitCameraLocation = false;
        FVector ExplicitCameraLocation = FVector::ZeroVector;
        int32 ShotSubjectIndex = ActiveFaceIndex;
        ActiveCameraName = FString::Printf(TEXT("CAM_Grade1_Hero_%d"), ActiveFaceIndex + 1);
        if (Shot == ECameraShot::Context || Shot == ECameraShot::TwoShot)
        {
            // Keep the context shot on the exact same, already validated
            // optical axis as the hero portrait. Widen through distance/FOV
            // only: shifting the world-Z target here made this camera miss the
            // performer and every foreground prop on the Grade 1 map.
            Target += FVector(0.0f, 0.0f, 8.0f);
            CameraDistance = 148.0f;
            TargetFov = 60.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Grade1_Context_%d"), ActiveFaceIndex + 1);
        }
        else if (Shot == ECameraShot::Listener && CameraRigTargets.Num() >= 2)
        {
            const int32 ListenerIndex = ActiveFaceIndex == 0 ? 1 : 0;
            ShotSubjectIndex = ListenerIndex;
            Target = CameraRigTargets[ListenerIndex];
            Direction = (CameraRigFronts[ListenerIndex]
                - CameraRigSides[ListenerIndex] * 0.20f).GetSafeNormal();
            CameraDistance = 108.0f;
            TargetFov = 51.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Seat_%d_Listener"),
                ListenerIndex + 1);
        }
        else if (Shot == ECameraShot::ThreeQuarterLeft)
        {
            Target -= FVector(0.0f, 0.0f, 7.0f);
            Direction = (Front + Side * 0.22f).GetSafeNormal();
            CameraDistance = 109.0f;
            TargetFov = 47.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Grade1_EditorialLeft_%d"), ActiveFaceIndex + 1);
        }
        else if (Shot == ECameraShot::ThreeQuarterRight)
        {
            Target -= FVector(0.0f, 0.0f, 7.0f);
            Direction = (Front - Side * 0.22f).GetSafeNormal();
            CameraDistance = 109.0f;
            TargetFov = 47.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Grade1_EditorialRight_%d"), ActiveFaceIndex + 1);
        }
        else if (Shot == ECameraShot::ProfileLeft)
        {
            Direction = (Front + Side * 0.52f).GetSafeNormal();
            CameraDistance = 110.0f;
            TargetFov = 48.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Seat_%d_ProfileLeft"), ActiveFaceIndex + 1);
        }
        else if (Shot == ECameraShot::ProfileRight)
        {
            Direction = (Front + Side * 0.28f).GetSafeNormal();
            CameraDistance = 100.0f;
            TargetFov = 46.0f;
            ActiveCameraName = FString::Printf(
                TEXT("CAM_Seat_%d_ProfileRight"), ActiveFaceIndex + 1);
        }

        const FVector CameraLocation = bUseExplicitCameraLocation
            ? ExplicitCameraLocation
            : Target + Direction.GetSafeNormal() * CameraDistance;
        const FRotator CameraRotation = (Target - CameraLocation).Rotation();
        ACameraActor* Camera = CameraActor.Get();
        if (!Camera)
        {
            Camera = StudioWorld->SpawnActor<ACameraActor>(CameraLocation, CameraRotation);
        }
        if (!Camera)
        {
            return;
        }
        const bool bNewCamera = !CameraActor.IsValid();
        if (bNewCamera)
        {
            Camera->SetActorLocationAndRotation(CameraLocation, CameraRotation);
            Camera->GetCameraComponent()->SetFieldOfView(TargetFov);
        }
        else
        {
            CameraBlendStartLocation = Camera->GetActorLocation();
            CameraBlendTargetLocation = CameraLocation;
            CameraBlendStartRotation = Camera->GetActorQuat();
            CameraBlendTargetRotation = CameraRotation.Quaternion();
            CameraBlendStartFov = Camera->GetCameraComponent()->FieldOfView;
            CameraBlendTargetFov = TargetFov;
            CameraBlendStartedAt = FPlatformTime::Seconds();
            StudioWorld->GetTimerManager().SetTimer(
                CameraBlendTimer,
                FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::UpdateCameraBlend),
                1.0f / 60.0f,
                true,
                0.0f);
        }
        FPostProcessSettings& PostProcess = Camera->GetCameraComponent()->PostProcessSettings;
        PostProcess.bOverride_DepthOfFieldFstop = true;
        PostProcess.DepthOfFieldFstop = 4.0f;
        PostProcess.bOverride_DepthOfFieldFocalDistance = true;
        PostProcess.DepthOfFieldFocalDistance = CameraDistance;
        PostProcess.bOverride_AutoExposureBias = true;
        // Streaming compression loses shadow detail first. A small positive
        // exposure lift plus the stronger soft fill below preserves darker
        // skin without flattening the key/fill separation on lighter faces.
        PostProcess.AutoExposureBias = -0.32f;
        // Pixel Streaming already performs temporal compression. Cinematic
        // motion blur on top of a short editorial camera move smears the
        // eyes and makes normal head gestures read as a low-quality stream.
        PostProcess.bOverride_MotionBlurAmount = true;
        PostProcess.MotionBlurAmount = 0.0f;
        PostProcess.bOverride_MotionBlurMax = true;
        PostProcess.MotionBlurMax = 0.0f;
        Camera->GetCameraComponent()->PostProcessBlendWeight = 1.0f;
        CameraActor = Camera;
        if (APlayerController* Controller = StudioWorld->GetFirstPlayerController())
        {
            Controller->SetViewTarget(Camera);
        }
        ConfigureCastGaze(Shot, ShotSubjectIndex);

        // Lights stay locked to the subject rather than following the camera.
        // This avoids exposure and shadow pops during an intra-turn camera move.
        const FVector ScreenHorizontal =
            FVector::CrossProduct(FVector::UpVector, Front).GetSafeNormal();

        if (!KeyLight.IsValid())
        {
            APointLight* Light = StudioWorld->SpawnActor<APointLight>(
                Target + Front * 72.0 - ScreenHorizontal * 52.0 + FVector(0.0, 0.0, 48.0),
                FRotator::ZeroRotator);
            if (Light)
            {
                Light->PointLightComponent->SetIntensity(1180.0f);
                Light->PointLightComponent->SetAttenuationRadius(650.0f);
                Light->PointLightComponent->SetSourceRadius(45.0f);
                Light->PointLightComponent->SetSoftSourceRadius(25.0f);
                Light->PointLightComponent->SetLightColor(FLinearColor(1.0f, 0.90f, 0.82f));
                Light->PointLightComponent->SetCastShadows(true);
                KeyLight = Light;
            }
        }
        if (KeyLight.IsValid())
        {
            KeyLight->SetActorLocation(
                Target
                + Front * 72.0
                - ScreenHorizontal * 52.0
                + FVector(0.0, 0.0, 48.0));
        }

        if (!FillLight.IsValid())
        {
            APointLight* Light = StudioWorld->SpawnActor<APointLight>(
                Target + Front * 62.0 + ScreenHorizontal * 48.0 + FVector(0.0, 0.0, 14.0),
                FRotator::ZeroRotator);
            if (Light)
            {
                Light->PointLightComponent->SetIntensity(620.0f);
                Light->PointLightComponent->SetAttenuationRadius(600.0f);
                Light->PointLightComponent->SetSourceRadius(55.0f);
                Light->PointLightComponent->SetSoftSourceRadius(30.0f);
                Light->PointLightComponent->SetLightColor(FLinearColor(0.76f, 0.86f, 1.0f));
                Light->PointLightComponent->SetCastShadows(false);
                FillLight = Light;
            }
        }
        if (FillLight.IsValid())
        {
            FillLight->SetActorLocation(
                Target
                + Front * 62.0
                + ScreenHorizontal * 48.0
                + FVector(0.0, 0.0, 14.0));
        }

        if (!RimLight.IsValid())
        {
            APointLight* Light = StudioWorld->SpawnActor<APointLight>(
                Target - Front * 48.0 + ScreenHorizontal * 30.0 + FVector(0.0, 0.0, 54.0),
                FRotator::ZeroRotator);
            if (Light)
            {
                Light->PointLightComponent->SetIntensity(540.0f);
                Light->PointLightComponent->SetAttenuationRadius(420.0f);
                Light->PointLightComponent->SetSourceRadius(32.0f);
                Light->PointLightComponent->SetSoftSourceRadius(18.0f);
                Light->PointLightComponent->SetLightColor(FLinearColor(0.62f, 0.80f, 1.0f));
                Light->PointLightComponent->SetCastShadows(false);
                RimLight = Light;
            }
        }
        if (RimLight.IsValid())
        {
            RimLight->SetActorLocation(
                Target
                - Front * 48.0
                + ScreenHorizontal * 30.0
                + FVector(0.0, 0.0, 54.0));
        }
    }

    void SetMoodPreset(
        const ERealisticMetaHumanLipSyncMood Mood,
        const TCHAR* Name,
        const float Intensity)
    {
        if (URealisticMetaHumanLipSyncGenerator* Current = GetActiveGenerator())
        {
            Current->SetMood(Mood);
            Current->SetMoodIntensity(Intensity);
            ActiveMoodName = Name;
            ActiveMoodIntensity = Intensity;
            PerformanceCurrentIntensity = Intensity;
            PerformanceTargetIntensity = Intensity;
        }
    }

    static int64 FindEnumValueContaining(UEnum* Enum, const FString& Needle)
    {
        if (!Enum)
        {
            return INDEX_NONE;
        }
        for (int32 Index = 0; Index < Enum->NumEnums(); ++Index)
        {
            if (Enum->GetNameStringByIndex(Index).Contains(Needle, ESearchCase::IgnoreCase))
            {
                return Enum->GetValueByIndex(Index);
            }
        }
        return INDEX_NONE;
    }

    bool BindGenerator(
        UObject* Container,
        URealisticMetaHumanLipSyncGenerator* InGenerator)
    {
        if (!Container || !InGenerator)
        {
            return false;
        }

        bool bBound = false;
        for (TFieldIterator<FObjectPropertyBase> Property(Container->GetClass()); Property; ++Property)
        {
            const FString PropertyName = Property->GetName();
            if (Property->PropertyClass
                && InGenerator->IsA(Property->PropertyClass)
                && PropertyName.Contains(TEXT("Generator"), ESearchCase::IgnoreCase))
            {
                Property->SetObjectPropertyValue_InContainer(Container, InGenerator);
                bBound = true;
                BoundGeneratorProperties.AddUnique(PropertyName);
            }
        }

        for (TFieldIterator<FBoolProperty> Property(Container->GetClass()); Property; ++Property)
        {
            const FString PropertyName = Property->GetName();
            if (PropertyName.Equals(TEXT("bIsRealisticLipSyncModel"), ESearchCase::IgnoreCase)
                || (PropertyName.Contains(TEXT("Realistic"), ESearchCase::IgnoreCase)
                    && PropertyName.Contains(TEXT("LipSync"), ESearchCase::IgnoreCase)))
            {
                Property->SetPropertyValue_InContainer(Container, true);
                BoundModeProperties.AddUnique(PropertyName);
            }
        }

        for (TFieldIterator<FEnumProperty> Property(Container->GetClass()); Property; ++Property)
        {
            const FString PropertyName = Property->GetName();
            if (!PropertyName.Contains(TEXT("AnimationType"), ESearchCase::IgnoreCase)
                && !PropertyName.Contains(TEXT("ModelType"), ESearchCase::IgnoreCase))
            {
                continue;
            }
            const int64 Value = FindEnumValueContaining(Property->GetEnum(), TEXT("Realistic"));
            if (Value != INDEX_NONE)
            {
                Property->GetUnderlyingProperty()->SetIntPropertyValue(
                    Property->ContainerPtrToValuePtr<void>(Container),
                    Value);
                BoundModeProperties.AddUnique(PropertyName);
            }
        }

        for (TFieldIterator<FByteProperty> Property(Container->GetClass()); Property; ++Property)
        {
            const FString PropertyName = Property->GetName();
            if (!Property->Enum
                || (!PropertyName.Contains(TEXT("AnimationType"), ESearchCase::IgnoreCase)
                    && !PropertyName.Contains(TEXT("ModelType"), ESearchCase::IgnoreCase)))
            {
                continue;
            }
            const int64 Value = FindEnumValueContaining(Property->Enum, TEXT("Realistic"));
            if (Value != INDEX_NONE)
            {
                Property->SetPropertyValue_InContainer(Container, static_cast<uint8>(Value));
                BoundModeProperties.AddUnique(PropertyName);
            }
        }

        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->Struct
                && Property->Struct->IsChildOf(FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
            {
                void* Address = Property->ContainerPtrToValuePtr<void>(Container);
                FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                    static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(Address);
                Node->LipSyncGenerator = InGenerator;
                Node->MorphTargetSet = ERealisticMorphTargetSet::MetaHuman;
                Node->InterpolationSpeed = 45.0f;
                Node->IdleInterpolationSpeed = 20.0f;
                Node->ResetTime = 0.28f;
                bBound = true;
                BoundAnimNodes.AddUnique(Property->GetName());
            }
        }
        return bBound;
    }

    URealisticMetaHumanLipSyncGenerator* CreateConfiguredGenerator()
    {
        FRealisticMetaHumanLipSyncMoodConfig Config;
        Config.IntraOpThreads = 4;
        Config.InterOpThreads = 1;
        Config.LookaheadMs = 40;
        Config.OutputType = ERealisticMetaHumanLipSyncOutputType::FullFace;
        URealisticMetaHumanLipSyncGenerator* NewGenerator =
            URealisticMetaHumanLipSyncGenerator::CreateRealisticMetaHumanLipSyncWithMoodGenerator(Config);
        if (!NewGenerator)
        {
            return nullptr;
        }
        NewGenerator->SetMood(ERealisticMetaHumanLipSyncMood::Confidence);
        NewGenerator->SetMoodIntensity(0.48f);
        NewGenerator->SetLookaheadMs(40);
        NewGenerator->SetOutputType(ERealisticMetaHumanLipSyncOutputType::FullFace);
        NewGenerator->ProcessingChunkSize = 320;
        return NewGenerator;
    }

    void WarmGenerators()
    {
        if (!StudioWorld.IsValid() || CastFaces.IsEmpty())
        {
            return;
        }
        ClearAllGeneratorBindings();
        Generators.Reset();
        bModelReady = false;
        bGeneratorBound = false;
        GeneratorBoundStates.Init(false, CastFaces.Num());
        BoundGeneratorProperties.Reset();
        BoundAnimNodes.Reset();
        BoundModeProperties.Reset();

        for (int32 Index = 0; Index < CastFaces.Num(); ++Index)
        {
            URealisticMetaHumanLipSyncGenerator* NewGenerator = CreateConfiguredGenerator();
            if (!NewGenerator)
            {
                Generators.Reset();
                return;
            }
            Generators.Emplace(NewGenerator);
        }
        ActiveMoodName = TEXT("confidence");
        ActiveMoodIntensity = 0.34f;
        ModelDeadline = FPlatformTime::Seconds() + 60.0;
        StudioWorld->GetTimerManager().SetTimer(
            ModelTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::PollModel),
            0.025f,
            true,
            0.0f);
    }

    void PollModel()
    {
        bool bAllReady = Generators.Num() == CastFaces.Num() && !Generators.IsEmpty();
        bool bAnyFailed = Generators.IsEmpty();
        for (const TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator>& Generator : Generators)
        {
            URealisticMetaHumanLipSyncGenerator* Current = Generator.Get();
            bAllReady = bAllReady && Current && Current->IsModelReady();
            bAnyFailed = bAnyFailed
                || !Current
                || Current->GetModelLoadState() == ELipSyncModelLoadState::Failed;
        }
        if (bAllReady)
        {
            StudioWorld->GetTimerManager().ClearTimer(ModelTimer);
            bModelReady = true;
            BindAllGenerators();
            return;
        }
        if (bAnyFailed || FPlatformTime::Seconds() >= ModelDeadline)
        {
            StudioWorld->GetTimerManager().ClearTimer(ModelTimer);
            bModelReady = false;
        }
    }

    bool BindGeneratorForIndex(const int32 Index)
    {
        URealisticMetaHumanLipSyncGenerator* Current = GetGeneratorForIndex(Index);
        USkeletalMeshComponent* Face = CastFaces.IsValidIndex(Index) ? CastFaces[Index].Get() : nullptr;
        if (!Current || !Face)
        {
            return false;
        }
        bool bBound = BindGenerator(Face->GetAnimInstance(), Current);
        if (CastActors.IsValidIndex(Index) && CastActors[Index].IsValid())
        {
            bBound = BindGenerator(CastActors[Index].Get(), Current) || bBound;
        }
        if (GeneratorBoundStates.IsValidIndex(Index))
        {
            GeneratorBoundStates[Index] = bBound;
        }
        return bBound;
    }

    void RefreshGeneratorBoundState()
    {
        bGeneratorBound = GeneratorBoundStates.Num() == CastFaces.Num()
            && !GeneratorBoundStates.IsEmpty();
        for (const bool bBound : GeneratorBoundStates)
        {
            bGeneratorBound = bGeneratorBound && bBound;
        }
    }

    void BindAllGenerators()
    {
        for (int32 Index = 0; Index < Generators.Num(); ++Index)
        {
            BindGeneratorForIndex(Index);
        }
        RefreshGeneratorBoundState();
    }

    void BindCurrentGenerator()
    {
        BindGeneratorForIndex(ActiveFaceIndex);
        RefreshGeneratorBoundState();
    }

    void StopPlayback(const bool bPreservePendingPerformance = false)
    {
        if (bSpeechActive)
        {
            LastSpeechPeakMouthControl = SpeechPeakMouthControl;
            LastSpeechPeakUpperFaceControl = SpeechPeakUpperFaceControl;
            LastSpeechPeakMouthControlName = SpeechPeakMouthControlName;
            LastSpeechPeakUpperFaceControlName = SpeechPeakUpperFaceControlName;
            LastSpeechSolverChunks = SolverChunks;
            LastSpeechSolverCursor = SolverCursor;
            ++CompletedSpeechCount;
        }
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(SolverTimer);
            StudioWorld->GetTimerManager().ClearTimer(AudioStartTimer);
            StudioWorld->GetTimerManager().ClearTimer(FaceTimer);
            StudioWorld->GetTimerManager().ClearTimer(SpeechEndTimer);
        }
        if (AudioComponent.IsValid())
        {
            AudioComponent->Stop();
            AudioComponent->UnregisterComponent();
        }
        AudioComponent.Reset();
        SpeechWave.Reset();
        FScopeLock Lock(&SpeechMutex);
        SpeechSamples.Reset();
        SolverCursor = 0;
        SolverChunks = 0;
        bSpeechActive = false;
        JawInput = 0.0f;
        JawCurve = 0.0f;
        RawSpeechEnergy = 0.0f;
        SmoothedSpeechEnergy = 0.0f;
        PreviousSpeechEnergy = 0.0f;
        SpeechAccentPulse = 0.0f;
        SpeechPhrasePulse = 0.0f;
        SpeechPeakMouthControl = 0.0f;
        SpeechPeakUpperFaceControl = 0.0f;
        SpeechPeakMouthControlName.Reset();
        SpeechPeakUpperFaceControlName.Reset();
        ActivePerformanceBeats.Reset();
        NextSolverPerformanceBeatIndex = 0;
        NextAudiblePerformanceBeatIndex = 0;
        ActivePerformanceFocus = TEXT("camera");
        ActivePerformanceGesture = TEXT("none");
        PerformanceGestureStartedAt = 0.0;
        SpeechAudioStartsAt = 0.0;
        AppliedPerformanceBeatCount = 0;
        if (!bPreservePendingPerformance)
        {
            PendingPerformanceBeats.Reset();
        }
    }

    void FeedSolverChunk()
    {
        URealisticMetaHumanLipSyncGenerator* Current = GetActiveGenerator();
        if (!Current || !bSpeechActive)
        {
            return;
        }

        AdvanceSolverPerformance(SolverCursor);
        constexpr int32 ChunkSamples = 640;
        TArray<float> FloatingPoint;
        float ChunkEnergy = 0.0f;
        {
            FScopeLock Lock(&SpeechMutex);
            const int32 Remaining = SpeechSamples.Num() - SolverCursor;
            const int32 Count = FMath::Min(Remaining, ChunkSamples);
            if (Count <= 0)
            {
                StudioWorld->GetTimerManager().ClearTimer(SolverTimer);
                return;
            }
            FloatingPoint.SetNumZeroed(ChunkSamples);
            double SumSquares = 0.0;
            for (int32 Index = 0; Index < Count; ++Index)
            {
                FloatingPoint[Index] =
                    static_cast<float>(SpeechSamples[SolverCursor + Index]) / 32768.0f;
                SumSquares += static_cast<double>(FloatingPoint[Index])
                    * static_cast<double>(FloatingPoint[Index]);
            }
            const float Rms = FMath::Sqrt(
                static_cast<float>(SumSquares / FMath::Max(Count, 1)));
            ChunkEnergy = FMath::Clamp((Rms - 0.012f) / 0.145f, 0.0f, 1.0f);
            SolverCursor += Count;
        }
        RawSpeechEnergy = ChunkEnergy;
        const float EnergyDelta = ChunkEnergy - SmoothedSpeechEnergy;
        SmoothedSpeechEnergy = FMath::FInterpTo(
            SmoothedSpeechEnergy,
            ChunkEnergy,
            0.04f,
            ChunkEnergy > SmoothedSpeechEnergy ? 12.0f : 5.5f);
        const double Now = FPlatformTime::Seconds();
        if (EnergyDelta > 0.105f
            && ChunkEnergy > 0.18f
            && Now - LastProsodyAccentAt > 0.24)
        {
            SpeechAccentPulse = FMath::Clamp(
                0.40f + EnergyDelta * 2.25f + ChunkEnergy * 0.20f,
                0.0f,
                1.0f);
            LastProsodyAccentAt = Now;
        }
        if (PreviousSpeechEnergy > 0.16f
            && ChunkEnergy < 0.045f
            && Now - LastPhraseBoundaryAt > 0.42)
        {
            SpeechPhrasePulse = 1.0f;
            LastPhraseBoundaryAt = Now;
        }
        PreviousSpeechEnergy = ChunkEnergy;
        Current->ProcessAudioData(MoveTemp(FloatingPoint), 16000, 1);

        // Mood intensity is intentionally not modulated at the 25 Hz audio
        // chunk rate. The commercial full-face solver already derives facial
        // motion from the audio; adding chunk-energy pulses here made the
        // brows jump several times per second. Semantic performance beats are
        // interpolated separately by AdvanceSolverPerformance().
        ActiveMoodIntensity = PerformanceCurrentIntensity;
        ++SolverChunks;
    }

    void UpdateFaceAudit()
    {
        URealisticMetaHumanLipSyncGenerator* Current = GetActiveGenerator();
        USkeletalMeshComponent* Face = HeroFace.Get();
        if (!Current || !Face)
        {
            return;
        }
        const TMap<FString, float> Controls = Current->GetControlValues();
        CommercialControlCount = Controls.Num();
        CommercialMaxControl = 0.0f;
        CommercialMaxMouthControl = 0.0f;
        CommercialMaxUpperFaceControl = 0.0f;
        CommercialMaxMouthControlName.Reset();
        CommercialMaxUpperFaceControlName.Reset();
        for (const TPair<FString, float>& Control : Controls)
        {
            const float Magnitude = FMath::Abs(Control.Value);
            CommercialMaxControl = FMath::Max(CommercialMaxControl, Magnitude);
            const bool bMouth =
                Control.Key.Contains(TEXT("mouth"), ESearchCase::IgnoreCase)
                || Control.Key.Contains(TEXT("jaw"), ESearchCase::IgnoreCase)
                || Control.Key.Contains(TEXT("tongue"), ESearchCase::IgnoreCase);
            const bool bUpperFace =
                Control.Key.Contains(TEXT("brow"), ESearchCase::IgnoreCase)
                || Control.Key.Contains(TEXT("nose"), ESearchCase::IgnoreCase)
                || Control.Key.Contains(TEXT("cheek"), ESearchCase::IgnoreCase)
                || Control.Key.Contains(TEXT("eye"), ESearchCase::IgnoreCase);
            if (bMouth && Magnitude > CommercialMaxMouthControl)
            {
                CommercialMaxMouthControl = Magnitude;
                CommercialMaxMouthControlName = Control.Key;
            }
            if (bUpperFace && Magnitude > CommercialMaxUpperFaceControl)
            {
                CommercialMaxUpperFaceControl = Magnitude;
                CommercialMaxUpperFaceControlName = Control.Key;
            }
        }
        if (CommercialMaxMouthControl > SpeechPeakMouthControl)
        {
            SpeechPeakMouthControl = CommercialMaxMouthControl;
            SpeechPeakMouthControlName = CommercialMaxMouthControlName;
        }
        if (CommercialMaxUpperFaceControl > SpeechPeakUpperFaceControl)
        {
            SpeechPeakUpperFaceControl = CommercialMaxUpperFaceControl;
            SpeechPeakUpperFaceControlName = CommercialMaxUpperFaceControlName;
        }
        if (const float* Value = Controls.Find(TEXT("CTRL_C_jaw.ty")))
        {
            JawInput = *Value;
        }
        if (UAnimInstance* Anim = Face->GetAnimInstance())
        {
            JawCurve = Anim->GetCurveValue(FName(TEXT("CTRL_expressions_jawOpen")));
        }
    }

    void BeginAudio()
    {
        if (bSpeechActive && AudioComponent.IsValid())
        {
            AudioComponent->Play();
        }
    }

    void FinishSpeech()
    {
        StopPlayback();
    }

    bool BeginSpeech(TArray<uint8> PcmBytes)
    {
        StopPlayback(true);
        if (!StudioWorld.IsValid()
            || !bStageReady
            || !bModelReady
            || !GetActiveGenerator())
        {
            return false;
        }
        const int32 OriginalSampleCount = PcmBytes.Num() / static_cast<int32>(sizeof(int16));
        if (OriginalSampleCount <= 0)
        {
            return false;
        }
        bListeningReactionActive = false;
        const int32 DurationMs = FMath::RoundToInt(
            static_cast<double>(OriginalSampleCount) * 1000.0 / 16000.0);
        {
            FScopeLock Lock(&SpeechMutex);
            SpeechSamples.SetNumUninitialized(OriginalSampleCount + 4000);
            FMemory::Memcpy(SpeechSamples.GetData(), PcmBytes.GetData(), PcmBytes.Num());
            FMemory::Memzero(
                SpeechSamples.GetData() + OriginalSampleCount,
                4000 * sizeof(int16));
        }

        USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(GetTransientPackage());
        Wave->SetSampleRate(16000);
        Wave->NumChannels = 1;
        Wave->Duration = static_cast<float>(DurationMs + 250) / 1000.0f;
        Wave->SoundGroup = SOUNDGROUP_Voice;
        Wave->bLooping = false;
        Wave->QueueAudio(
            reinterpret_cast<const uint8*>(SpeechSamples.GetData()),
            SpeechSamples.Num() * static_cast<int32>(sizeof(int16)));
        SpeechWave = TStrongObjectPtr<USoundWaveProcedural>(Wave);

        UAudioComponent* Audio = NewObject<UAudioComponent>(StudioWorld->GetWorldSettings());
        Audio->bAutoActivate = false;
        Audio->bAutoDestroy = false;
        Audio->bAllowSpatialization = false;
        Audio->SetSound(Wave);
        Audio->RegisterComponentWithWorld(StudioWorld.Get());
        AudioComponent = TStrongObjectPtr<UAudioComponent>(Audio);

        if (!GeneratorBoundStates.IsValidIndex(ActiveFaceIndex)
            || !GeneratorBoundStates[ActiveFaceIndex])
        {
            BindCurrentGenerator();
        }
        ActivePerformanceBeats = MoveTemp(PendingPerformanceBeats);
        PendingPerformanceBeats.Reset();
        NextSolverPerformanceBeatIndex = 0;
        NextAudiblePerformanceBeatIndex = 0;
        AppliedPerformanceBeatCount = 0;
        PerformanceGestureStartedAt = 0.0;
        SpeechAudioStartsAt = FPlatformTime::Seconds() + 0.12;
        bSpeechActive = true;
        FeedSolverChunk();
        StudioWorld->GetTimerManager().SetTimer(
            SolverTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::FeedSolverChunk),
            0.04f,
            true,
            0.04f);
        StudioWorld->GetTimerManager().SetTimer(
            FaceTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::UpdateFaceAudit),
            1.0f / 60.0f,
            true,
            0.0f);
        StudioWorld->GetTimerManager().SetTimer(
            AudioStartTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::BeginAudio),
            0.12f,
            false);
        StudioWorld->GetTimerManager().SetTimer(
            SpeechEndTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaLipSyncBridgeModule::FinishSpeech),
            static_cast<float>(DurationMs + 420) / 1000.0f,
            false);
        return true;
    }

    bool HandleHealth(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
    {
        const FString GeneratorPropertyNames = FString::Join(BoundGeneratorProperties, TEXT(","));
        const FString AnimNodeNames = FString::Join(BoundAnimNodes, TEXT(","));
        const FString ModePropertyNames = FString::Join(BoundModeProperties, TEXT(","));
        FString Body = FString::Printf(
            TEXT("{\"ok\":true,\"service\":\"conclavia-lipsync-bridge\",\"runtimeRevision\":\"commercial-grade1-hero-56-v46-floor-control\",\"profile\":\"lipsync\",\"stageReady\":%s,\"grade1SetReady\":%s,\"grade1PropCount\":%d,\"cameraCount\":3,\"cameraPackage\":\"context,hero,editorial-three-quarter\",\"castCount\":%d,\"activeCamera\":\"%s\",\"lastCueAt\":\"\",\"audioSubjectReady\":false,\"audioSubjectValid\":false,\"faceDrivenByLiveLink\":true,\"commercialLipSyncReady\":%s,\"commercialModelReady\":%s,\"commercialGeneratorBound\":%s,\"commercialGeneratorCount\":%d,\"commercialControlsBound\":true,\"commercialSpeechActive\":%s,\"commercialModel\":\"mood-full-face-sentence-crossfade-gain-1.35\",\"commercialMood\":\"%s\",\"commercialMoodIntensity\":%.2f,\"commercialLookaheadMs\":40,\"commercialControlCount\":%d,\"commercialMaxControl\":%.6f,\"commercialMaxMouthControl\":%.6f,\"commercialMaxMouthControlName\":\"%s\",\"commercialMaxUpperFaceControl\":%.6f,\"commercialMaxUpperFaceControlName\":\"%s\",\"commercialJawInput\":%.6f,\"commercialJawCurve\":%.6f,\"commercialBoundNodeCount\":%d,\"commercialBoundPropertyCount\":%d,\"commercialBoundProperties\":\"%s\",\"commercialBoundNodes\":\"%s\",\"commercialBoundModes\":\"%s\",\"commercialSolverChunksSubmitted\":%d,\"commercialSolverCursor\":%d,\"cinematicLodForced\":%s,\"faceMaterialCount\":%d,\"faceMaterials\":\"%s\",\"bodyAnimationMode\":1,\"bodyAnimClass\":\"metahuman-authored-sequence\",\"bodyAnimInstance\":\"AS_Conclavia_SeatedIdle\",\"pcmBytesReceived\":0,\"activeFaceIndex\":%d,\"naturalBlinkEnabled\":true,\"naturalBlinkDriver\":\"commercial-anim-node\",\"naturalGazeEnabled\":true,\"directCameraGaze\":true,\"oralLookdev\":\"teeth-gums-cavity-v20\",\"naturalBlinkCount\":%d,\"commercialSpeechPeakMouthControl\":%.6f,\"commercialSpeechPeakMouthControlName\":\"%s\",\"commercialSpeechPeakUpperFaceControl\":%.6f,\"commercialSpeechPeakUpperFaceControlName\":\"%s\",\"commercialLastSpeechPeakMouthControl\":%.6f,\"commercialLastSpeechPeakMouthControlName\":\"%s\",\"commercialLastSpeechPeakUpperFaceControl\":%.6f,\"commercialLastSpeechPeakUpperFaceControlName\":\"%s\",\"commercialLastSpeechSolverChunks\":%d,\"commercialLastSpeechSolverCursor\":%d,\"commercialCompletedSpeechCount\":%d,\"cameraCueCount\":%d,\"speakerHandoffCount\":%d,\"performancePlanReady\":%s,\"performanceBeatCount\":%d,\"performanceSolverBeatIndex\":%d,\"performanceAudibleBeatIndex\":%d,\"performanceMood\":\"%s\",\"performanceTargetIntensity\":%.3f,\"performanceFocus\":\"%s\",\"performanceGesture\":\"%s\",\"performanceAppliedBeatCount\":%d,\"prosodyEnergy\":%.3f,\"prosodyAccent\":%.3f,\"prosodyPhraseBoundary\":%.3f,\"facialLifeLayer\":false,\"commercialUpperFaceOwner\":true,\"commercialExpressionGain\":1.35,\"performerStateLayer\":true,\"motionBlurAmount\":0.0}"),
            bStageReady ? TEXT("true") : TEXT("false"),
            bGrade1SetReady ? TEXT("true") : TEXT("false"),
            Grade1PropCount,
            CastActors.Num(),
            *ActiveCameraName,
            (bStageReady && bModelReady && bGeneratorBound) ? TEXT("true") : TEXT("false"),
            bModelReady ? TEXT("true") : TEXT("false"),
            bGeneratorBound ? TEXT("true") : TEXT("false"),
            Generators.Num(),
            bSpeechActive ? TEXT("true") : TEXT("false"),
            *ActiveMoodName,
            ActiveMoodIntensity,
            CommercialControlCount,
            CommercialMaxControl,
            CommercialMaxMouthControl,
            *CommercialMaxMouthControlName,
            CommercialMaxUpperFaceControl,
            *CommercialMaxUpperFaceControlName,
            JawInput,
            JawCurve,
            BoundAnimNodes.Num(),
            BoundGeneratorProperties.Num(),
            *GeneratorPropertyNames,
            *AnimNodeNames,
            *ModePropertyNames,
            SolverChunks,
            SolverCursor,
            bCinematicLodForced ? TEXT("true") : TEXT("false"),
            FaceMaterialNames.Num(),
            *FaceMaterialSummary,
            ActiveFaceIndex,
            BlinkEventCount,
            SpeechPeakMouthControl,
            *SpeechPeakMouthControlName,
            SpeechPeakUpperFaceControl,
            *SpeechPeakUpperFaceControlName,
            LastSpeechPeakMouthControl,
            *LastSpeechPeakMouthControlName,
            LastSpeechPeakUpperFaceControl,
            *LastSpeechPeakUpperFaceControlName,
            LastSpeechSolverChunks,
            LastSpeechSolverCursor,
            CompletedSpeechCount,
            CameraCueCount,
            SpeakerHandoffCount,
            (!PendingPerformanceBeats.IsEmpty() || !ActivePerformanceBeats.IsEmpty())
                ? TEXT("true")
                : TEXT("false"),
            ActivePerformanceBeats.IsEmpty()
                ? PendingPerformanceBeats.Num()
                : ActivePerformanceBeats.Num(),
            NextSolverPerformanceBeatIndex,
            NextAudiblePerformanceBeatIndex,
            *ActiveMoodName,
            PerformanceTargetIntensity,
            *ActivePerformanceFocus,
            *ActivePerformanceGesture,
            AppliedPerformanceBeatCount,
            SmoothedSpeechEnergy,
            SpeechAccentPulse,
            SpeechPhrasePulse);
        Body.RemoveFromEnd(TEXT("}"));
        const int32 ListeningReactionRemainingMs = bListeningReactionActive
            ? FMath::Max(0, FMath::RoundToInt(
                (ListeningReactionExpiresAt - FPlatformTime::Seconds()) * 1000.0))
            : 0;
        Body += FString::Printf(
            TEXT(",\"avatarId\":\"%s\",\"bodyGesture\":\"%s\",\"bodyGestureRequested\":%s,\"bodyGestureAlpha\":0.0,\"bodyGestureDriver\":\"authored-animation-state-machine\",\"listeningReactionActive\":%s,\"listeningReactionRemainingMs\":%d,\"listeningMotionSource\":\"metahuman-authored-animation\"}"),
            *SelectedAvatarId,
            *ActiveBodyGesture,
            bHandRaiseRequested ? TEXT("true") : TEXT("false"),
            bListeningReactionActive ? TEXT("true") : TEXT("false"),
            ListeningReactionRemainingMs);
        // Keep the externally reported revision separate from the very large
        // JSON format literal so camera/set-only Grade 1 iterations remain a
        // small, reviewable diff.
        Body.ReplaceInline(
            TEXT("commercial-grade1-hero-56-v2"),
            TEXT("commercial-grade1-hero-56-v6-semantic-performance"));
        OnComplete(ConclaviaLipSyncBridge::JsonResponse(Body));
        return true;
    }

    bool HandleSpeech(
        const FHttpServerRequest& Request,
        const FHttpResultCallback& OnComplete)
    {
        const int32 DurationMs = FMath::RoundToInt(
            static_cast<double>(Request.Body.Num() / sizeof(int16)) * 1000.0 / 16000.0);
        TArray<uint8> PcmBytes = Request.Body;
        const bool bAccepted = BeginSpeech(MoveTemp(PcmBytes));
        const FString Body = FString::Printf(
            TEXT("{\"ok\":%s,\"accepted\":%s,\"durationMs\":%d}"),
            bAccepted ? TEXT("true") : TEXT("false"),
            bAccepted ? TEXT("true") : TEXT("false"),
            DurationMs);
        OnComplete(ConclaviaLipSyncBridge::JsonResponse(
            Body,
            bAccepted ? EHttpServerResponseCodes::Ok : EHttpServerResponseCodes::ServiceUnavail));
        return true;
    }

    bool HandleAvatar(
        const FHttpServerRequest& Request,
        const FHttpResultCallback& OnComplete)
    {
        FString AvatarId;
        if (Request.Body.Num() > 0)
        {
            FUTF8ToTCHAR Converted(
                reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),
                Request.Body.Num());
            const FString Body(Converted.Length(), Converted.Get());
            TSharedPtr<FJsonObject> Payload;
            const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
            if (FJsonSerializer::Deserialize(Reader, Payload) && Payload.IsValid())
            {
                Payload->TryGetStringField(TEXT("avatarId"), AvatarId);
            }
        }
        AvatarId = AvatarId.TrimStartAndEnd().ToLower();
        if (!AvatarId.Equals(TEXT("aera"))
            && !AvatarId.Equals(TEXT("ada"))
            && !AvatarId.Equals(TEXT("vivian"))
            && !AvatarId.Equals(TEXT("jelena")))
        {
            OnComplete(ConclaviaLipSyncBridge::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"unsupported-avatar\"}"),
                EHttpServerResponseCodes::BadRequest));
            return true;
        }
        {
            FScopeLock Lock(&AvatarSwitchMutex);
            PendingAvatarId = AvatarId;
        }
        OnComplete(ConclaviaLipSyncBridge::JsonResponse(FString::Printf(
            TEXT("{\"ok\":true,\"accepted\":true,\"avatarId\":\"%s\"}"),
            *AvatarId)));
        return true;
    }

    bool HandleCue(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
    {
        bool bCaptureRequested = false;
        if (HeroActor.IsValid() && HeroFace.IsValid() && Request.Body.Num() > 0)
        {
            FUTF8ToTCHAR Converted(
                reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),
                Request.Body.Num());
            const FString Body(Converted.Length(), Converted.Get());
            TSharedPtr<FJsonObject> Payload;
            const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
            FString SpeakerId;
            FString TargetId;
            FString ShotName;
            FString Intent;
            FString BodyGesture;
            FString ListenerMoodName;
            double ListenerMoodIntensity = 0.0;
            double ExpectedDurationMs = 0.0;
            TArray<FPerformanceBeat> ParsedPerformanceBeats;
            if (FJsonSerializer::Deserialize(Reader, Payload) && Payload.IsValid())
            {
                Payload->TryGetStringField(TEXT("speakerId"), SpeakerId);
                Payload->TryGetStringField(TEXT("targetId"), TargetId);
                Payload->TryGetStringField(TEXT("shot"), ShotName);
                Payload->TryGetStringField(TEXT("intent"), Intent);
                Payload->TryGetStringField(TEXT("bodyGesture"), BodyGesture);
                Payload->TryGetStringField(TEXT("listenerMood"), ListenerMoodName);
                Payload->TryGetNumberField(
                    TEXT("listenerMoodIntensity"), ListenerMoodIntensity);
                Payload->TryGetNumberField(TEXT("expectedDurationMs"), ExpectedDurationMs);
                ParsePerformanceBeats(Payload, ParsedPerformanceBeats);
            }
            if (Intent.Equals(TEXT("interrupt"), ESearchCase::IgnoreCase)
                || Intent.Equals(TEXT("stop-speaking"), ESearchCase::IgnoreCase))
            {
                StopPlayback();
                bHandRaiseRequested = false;
                ActiveBodyGesture = TEXT("lower-hand");
                bListeningReactionActive = false;
                SetMoodPreset(
                    ERealisticMetaHumanLipSyncMood::Neutral,
                    TEXT("neutral"),
                    0.0f);
                OnComplete(ConclaviaLipSyncBridge::JsonResponse(
                    TEXT("{\"ok\":true,\"interrupted\":true}")));
                return true;
            }
            const int32 SpeakerIndex = ParticipantIndexFromId(SpeakerId, CastActors.Num());
            int32 TargetIndex = ParticipantIndexFromId(TargetId, CastActors.Num());
            // Five logical talk seats currently fold onto the validated duet.
            // Keep a real addressee on screen when two logical IDs happen to
            // map to the same physical performer.
            if (!TargetId.IsEmpty()
                && CastActors.Num() > 1
                && TargetIndex == SpeakerIndex)
            {
                TargetIndex = (SpeakerIndex + 1) % CastActors.Num();
            }
            ActiveTargetIndex = TargetIndex;
            if (SpeakerIndex != INDEX_NONE)
            {
                SelectSpeaker(SpeakerIndex);
            }
            PendingPerformanceBeats = MoveTemp(ParsedPerformanceBeats);
            if (Intent.Equals(TEXT("listen-react"), ESearchCase::IgnoreCase))
            {
                ERealisticMetaHumanLipSyncMood ListeningMood;
                if (PerformanceMoodFromName(ListenerMoodName, ListeningMood))
                {
                    const float Intensity = FMath::Clamp(
                        static_cast<float>(ListenerMoodIntensity),
                        0.0f,
                        0.68f);
                    SetMoodPreset(ListeningMood, ListenerMoodName, Intensity);
                    PerformanceCurrentIntensity = Intensity;
                    PerformanceTargetIntensity = Intensity;
                    ActivePerformanceFocus = TEXT("target");
                    ActivePerformanceGesture = TEXT("none");
                    ListeningReactionExpiresAt = FPlatformTime::Seconds()
                        + FMath::Clamp(ExpectedDurationMs / 1000.0, 2.0, 15.0);
                    bListeningReactionActive = true;
                }
            }
            if (BodyGesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase)
                || Intent.Equals(TEXT("request-to-speak"), ESearchCase::IgnoreCase))
            {
                bHandRaiseRequested = true;
                ActiveBodyGesture = TEXT("raise-hand");
            }
            else if (BodyGesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase)
                || Intent.Equals(TEXT("listen"), ESearchCase::IgnoreCase)
                || Intent.Equals(TEXT("answer"), ESearchCase::IgnoreCase))
            {
                bHandRaiseRequested = false;
                ActiveBodyGesture = TEXT("lower-hand");
            }
            ++CameraCueCount;

            if (
                ShotName.Equals(TEXT("wide"), ESearchCase::IgnoreCase)
                || ShotName.Equals(TEXT("two-shot"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Context);
            }
            else if (ShotName.Equals(TEXT("reaction"), ESearchCase::IgnoreCase))
            {
                if (TargetIndex != INDEX_NONE && TargetIndex == ActiveFaceIndex)
                {
                    ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Front);
                }
                else
                {
                    ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Listener);
                }
            }
            else if (Body.Contains(TEXT("three-quarter-left"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::ThreeQuarterLeft);
            }
            else if (Body.Contains(TEXT("three-quarter-right"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::ThreeQuarterRight);
            }
            else if (Body.Contains(TEXT("profile-left"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::ProfileLeft);
            }
            else if (Body.Contains(TEXT("profile-right"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::ProfileRight);
            }
            else if (
                Body.Contains(TEXT("close-up"), ESearchCase::IgnoreCase)
                || Body.Contains(TEXT("push-in"), ESearchCase::IgnoreCase)
                || Body.Contains(TEXT("cameraFaceRight"), ESearchCase::IgnoreCase))
            {
                ConfigureCamera(HeroActor.Get(), HeroFace.Get(), ECameraShot::Front);
            }
            if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodNeutral"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Neutral, TEXT("neutral"), 0.0f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodHappiness"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Happiness, TEXT("happiness"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodSadness"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Sadness, TEXT("sadness"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodDisgust"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Disgust, TEXT("disgust"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodAnger"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Anger, TEXT("anger"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodSurprise"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Surprise, TEXT("surprise"), 0.32f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodFear"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Fear, TEXT("fear"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodExcitement"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Excitement, TEXT("excitement"), 0.40f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodBoredom"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Boredom, TEXT("boredom"), 0.34f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodPlayfulness"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Playfulness, TEXT("playfulness"), 0.38f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodConfusion"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Confusion, TEXT("confusion"), 0.32f);
            }
            else if (PendingPerformanceBeats.IsEmpty()
                && Body.Contains(TEXT("moodConfidence"), ESearchCase::IgnoreCase))
            {
                SetMoodPreset(ERealisticMetaHumanLipSyncMood::Confidence, TEXT("confidence"), 0.40f);
            }
            bCaptureRequested = Body.Contains(TEXT("captureFrame"), ESearchCase::IgnoreCase);
        }
        if (bCaptureRequested && GEngine && StudioWorld.IsValid())
        {
            PendingCaptureFrames = 8;
        }
        OnComplete(ConclaviaLipSyncBridge::JsonResponse(
            bCaptureRequested
                ? TEXT("{\"ok\":true,\"captureRequested\":true}")
                : TEXT("{\"ok\":true}")));
        return true;
    }

    uint32 ControlPort = 8081;
    TSharedPtr<IHttpRouter> Router;
    FHttpRouteHandle HealthRoute;
    FHttpRouteHandle SpeechRoute;
    FHttpRouteHandle CueRoute;
    FHttpRouteHandle AvatarRoute;
    FDelegateHandle WorldInitializationHandle;
    FDelegateHandle WorldTickHandle;
    TWeakObjectPtr<UWorld> StudioWorld;
    TArray<TWeakObjectPtr<AActor>> CastActors;
    TArray<TWeakObjectPtr<USkeletalMeshComponent>> CastFaces;
    TWeakObjectPtr<AActor> HeroActor;
    TWeakObjectPtr<USkeletalMeshComponent> HeroFace;
    TWeakObjectPtr<ACameraActor> CameraActor;
    TWeakObjectPtr<APointLight> KeyLight;
    TWeakObjectPtr<APointLight> FillLight;
    TWeakObjectPtr<APointLight> RimLight;
    TArray<TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator>> Generators;
    TArray<bool> GeneratorBoundStates;
    TStrongObjectPtr<USoundWaveProcedural> SpeechWave;
    TStrongObjectPtr<UAudioComponent> AudioComponent;
    FTimerHandle StageDiscoveryTimer;
    FTimerHandle InitialCameraTimer;
    int32 StageDiscoveryAttempts = 0;
    FTimerHandle ModelTimer;
    FTimerHandle SolverTimer;
    FTimerHandle FaceTimer;
    FTimerHandle AudioStartTimer;
    FTimerHandle SpeechEndTimer;
    FTimerHandle CameraBlendTimer;
    FCriticalSection SpeechMutex;
    FCriticalSection AvatarSwitchMutex;
    TArray<int16> SpeechSamples;
    int32 SolverCursor = 0;
    int32 SolverChunks = 0;
    double ModelDeadline = 0.0;
    float JawInput = 0.0f;
    float JawCurve = 0.0f;
    float CommercialMaxControl = 0.0f;
    float CommercialMaxMouthControl = 0.0f;
    float CommercialMaxUpperFaceControl = 0.0f;
    float SpeechPeakMouthControl = 0.0f;
    float SpeechPeakUpperFaceControl = 0.0f;
    float LastSpeechPeakMouthControl = 0.0f;
    float LastSpeechPeakUpperFaceControl = 0.0f;
    int32 CommercialControlCount = 0;
    FString CommercialMaxMouthControlName;
    FString CommercialMaxUpperFaceControlName;
    FString SpeechPeakMouthControlName;
    FString SpeechPeakUpperFaceControlName;
    FString LastSpeechPeakMouthControlName;
    FString LastSpeechPeakUpperFaceControlName;
    TArray<FString> FaceMaterialNames;
    FString FaceMaterialSummary;
    TArray<FString> BoundGeneratorProperties;
    TArray<FString> BoundAnimNodes;
    TArray<FString> BoundModeProperties;
    TArray<FVector> CameraRigTargets;
    TArray<FVector> CameraRigFronts;
    TArray<FVector> CameraRigSides;
    TArray<FPerformanceBeat> PendingPerformanceBeats;
    TArray<FPerformanceBeat> ActivePerformanceBeats;
    FVector CameraRigTarget = FVector::ZeroVector;
    FVector CameraRigFront = FVector::ForwardVector;
    FVector CameraRigSide = FVector::RightVector;
    FVector CameraBlendStartLocation = FVector::ZeroVector;
    FVector CameraBlendTargetLocation = FVector::ZeroVector;
    FQuat CameraBlendStartRotation = FQuat::Identity;
    FQuat CameraBlendTargetRotation = FQuat::Identity;
    float CameraBlendStartFov = 52.0f;
    float CameraBlendTargetFov = 52.0f;
    double CameraBlendStartedAt = 0.0;
    double PerformanceClock = 0.0;
    double SpeakerChangedAt = 0.0;
    double SpeechAudioStartsAt = 0.0;
    double PerformanceGestureStartedAt = 0.0;
    double LastProsodyAccentAt = 0.0;
    double LastPhraseBoundaryAt = 0.0;
    double ListeningReactionExpiresAt = 0.0;
    float CameraBlendDuration = 0.38f;
    FString ActiveCameraName = TEXT("CAM_Grade1_Hero_1");
    FString SelectedAvatarId = TEXT("aera");
    FString ActiveMoodName = TEXT("confidence");
    FString ActivePerformanceFocus = TEXT("camera");
    FString ActivePerformanceGesture = TEXT("none");
    FString ActiveBodyGesture = TEXT("none");
    FString PendingAvatarId;
    int32 ActiveTargetIndex = INDEX_NONE;
    float ActiveMoodIntensity = 0.34f;
    float PerformanceCurrentIntensity = 0.48f;
    float PerformanceTargetIntensity = 0.48f;
    float RawSpeechEnergy = 0.0f;
    float SmoothedSpeechEnergy = 0.0f;
    float PreviousSpeechEnergy = 0.0f;
    float SpeechAccentPulse = 0.0f;
    float SpeechPhrasePulse = 0.0f;
    bool bStageReady = false;
    bool bGrade1SetReady = false;
    bool bModelReady = false;
    bool bGeneratorBound = false;
    bool bSpeechActive = false;
    bool bListeningReactionActive = false;
    bool bCinematicLodForced = false;
    bool bCameraRigCalibrated = false;
    bool bHandRaiseRequested = false;
    int32 Grade1PropCount = 0;
    int32 ActiveFaceIndex = 0;
    int32 LastSpeechSolverChunks = 0;
    int32 LastSpeechSolverCursor = 0;
    int32 CompletedSpeechCount = 0;
    int32 CameraCueCount = 0;
    int32 SpeakerHandoffCount = 0;
    int32 BlinkEventCount = 0;
    int32 PendingCaptureFrames = 0;
    int32 NextSolverPerformanceBeatIndex = 0;
    int32 NextAudiblePerformanceBeatIndex = 0;
    int32 AppliedPerformanceBeatCount = 0;
#if WITH_EDITOR
    FString BuilderAvatarName = TEXT("Vivian");
    FTSTicker::FDelegateHandle VivianBuildTickerHandle;
    TStrongObjectPtr<UMetaHumanCharacter> VivianCharacter;
    TStrongObjectPtr<UMetaHumanCollectionPipeline> VivianPipeline;
    UMetaHumanCharacterEditorSubsystem* VivianSubsystem = nullptr;
    EVivianBuildPhase VivianBuildPhase = EVivianBuildPhase::Initialize;
    double VivianBuildStartedAt = 0.0;
#endif
};

IMPLEMENT_MODULE(FConclaviaLipSyncBridgeModule, ConclaviaLipSyncBridge)
