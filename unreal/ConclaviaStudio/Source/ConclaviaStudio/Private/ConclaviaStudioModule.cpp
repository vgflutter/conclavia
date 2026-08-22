#include "CoreMinimal.h"
#include "Async/Async.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimInstance.h"
#include "AnimNodes/AnimNode_ModifyCurve.h"
#include "Components/AudioComponent.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "HAL/FileManager.h"
#include "HighResScreenshot.h"
#include "HttpPath.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "ILiveLinkClient.h"
#include "ILiveLinkModule.h"
#include "ILiveLinkSource.h"
#include "Interfaces/IPluginManager.h"
#include "LiveLinkSourceSettings.h"
#include "Roles/LiveLinkAnimationRole.h"
#include "Roles/LiveLinkAnimationTypes.h"
#include "Roles/LiveLinkBasicRole.h"
#include "Roles/LiveLinkBasicTypes.h"
#include "MetaHumanAudioBaseLiveLinkSubject.h"
#include "MetaHumanAudioBaseLiveLinkSubjectSettings.h"
#include "MetaHumanLocalLiveLinkSource.h"
#include "MetaHumanLocalLiveLinkSourceBlueprint.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/DateTime.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "Modules/ModuleManager.h"
#include "Features/IModularFeatures.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Sound/SoundWaveProcedural.h"
#include "TimerManager.h"
#include "Styling/CoreStyle.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SOverlay.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "BlendRealisticMetaHumanLipSyncAnimNode.h"
#include "AnimNode_RuntimeMetaHumanEyesAim.h"
#include "RealisticMetaHumanLipSyncGenerator.h"
#include "UObject/StrongObjectPtr.h"
#include "UObject/UnrealType.h"

#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <Windows.h>
#include <shellapi.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

#if WITH_EDITOR
#include "Editor.h"
#include "HAL/IConsoleManager.h"
#include "IPixelStreaming2EditorModule.h"
#include "LevelEditor.h"
#include "LevelEditorViewport.h"
#include "MetaHumanCharacter.h"
#include "MetaHumanCharacterEditorSubsystem.h"
#include "MetaHumanCharacterGeneratedAssets.h"
#include "Misc/PackageName.h"
#include "Misc/ScopeExit.h"
#include "PixelStreaming2SettingsEnums.h"
#include "UnrealEdGlobals.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogConclaviaStudio, Log, All);

namespace ConclaviaStudio
{
    static int32 SeatIndexFromId(const FString& Id);

#if PLATFORM_WINDOWS && WITH_EDITOR
    using FShellExecuteW = HINSTANCE(WINAPI*)(
        HWND,
        LPCWSTR,
        LPCWSTR,
        LPCWSTR,
        LPCWSTR,
        INT);
    using FShellExecuteExW = BOOL(WINAPI*)(SHELLEXECUTEINFOW*);

    static FShellExecuteW OriginalShellExecuteW = nullptr;
    static FShellExecuteExW OriginalShellExecuteExW = nullptr;
    static bool bCaptureEpicAuthorizationUrl = false;

    static bool CaptureAuthorizationUrl(const wchar_t* Url)
    {
        if (!bCaptureEpicAuthorizationUrl || !Url)
        {
            return false;
        }

        const FString Candidate(Url);
        if (!Candidate.StartsWith(TEXT("http"), ESearchCase::IgnoreCase))
        {
            return false;
        }

        const FString OutputPath = FPaths::Combine(
            FPaths::ProjectSavedDir(),
            TEXT("Logs/EOSDeviceAuth.url"));
        IFileManager::Get().MakeDirectory(*FPaths::GetPath(OutputPath), true);
        if (FFileHelper::SaveStringToFile(Candidate, *OutputPath))
        {
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("CONCLAVIA_EPIC_AUTH_URL_CAPTURED: path=%s"),
                *OutputPath);
            return true;
        }

        UE_LOG(
            LogConclaviaStudio,
            Error,
            TEXT("Could not persist the Epic authorization URL"));
        return false;
    }

    static HINSTANCE WINAPI CaptureShellExecuteW(
        HWND Window,
        LPCWSTR Operation,
        LPCWSTR File,
        LPCWSTR Parameters,
        LPCWSTR Directory,
        INT ShowCommand)
    {
        if (CaptureAuthorizationUrl(File))
        {
            return reinterpret_cast<HINSTANCE>(static_cast<INT_PTR>(33));
        }
        return OriginalShellExecuteW
            ? OriginalShellExecuteW(
                Window,
                Operation,
                File,
                Parameters,
                Directory,
                ShowCommand)
            : reinterpret_cast<HINSTANCE>(static_cast<INT_PTR>(31));
    }

    static BOOL WINAPI CaptureShellExecuteExW(SHELLEXECUTEINFOW* ExecuteInfo)
    {
        if (ExecuteInfo && CaptureAuthorizationUrl(ExecuteInfo->lpFile))
        {
            ExecuteInfo->hInstApp = reinterpret_cast<HINSTANCE>(static_cast<INT_PTR>(33));
            ExecuteInfo->hProcess = nullptr;
            return static_cast<BOOL>(1);
        }
        return OriginalShellExecuteExW
            ? OriginalShellExecuteExW(ExecuteInfo)
            : static_cast<BOOL>(0);
    }

    static bool PatchImportedFunction(
        HMODULE Module,
        const char* FunctionName,
        void* Replacement,
        void** Original)
    {
        if (!Module || !FunctionName || !Replacement || !Original)
        {
            return false;
        }

        auto* Base = reinterpret_cast<uint8*>(Module);
        auto* DosHeader = reinterpret_cast<IMAGE_DOS_HEADER*>(Base);
        if (DosHeader->e_magic != IMAGE_DOS_SIGNATURE)
        {
            return false;
        }

        auto* NtHeaders = reinterpret_cast<IMAGE_NT_HEADERS*>(Base + DosHeader->e_lfanew);
        if (NtHeaders->Signature != IMAGE_NT_SIGNATURE)
        {
            return false;
        }

        const IMAGE_DATA_DIRECTORY& ImportDirectory =
            NtHeaders->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
        if (ImportDirectory.VirtualAddress == 0)
        {
            return false;
        }

        auto* Import = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(
            Base + ImportDirectory.VirtualAddress);
        for (; Import->Name != 0; ++Import)
        {
            auto* OriginalThunk = reinterpret_cast<IMAGE_THUNK_DATA*>(
                Base + Import->OriginalFirstThunk);
            auto* Thunk = reinterpret_cast<IMAGE_THUNK_DATA*>(
                Base + Import->FirstThunk);
            if (!Import->OriginalFirstThunk)
            {
                continue;
            }

            for (; OriginalThunk->u1.AddressOfData != 0; ++OriginalThunk, ++Thunk)
            {
                if (IMAGE_SNAP_BY_ORDINAL(OriginalThunk->u1.Ordinal))
                {
                    continue;
                }

                auto* ImportByName = reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(
                    Base + OriginalThunk->u1.AddressOfData);
                if (FCStringAnsi::Strcmp(
                        reinterpret_cast<const ANSICHAR*>(ImportByName->Name),
                        FunctionName) != 0)
                {
                    continue;
                }

                DWORD PreviousProtection = 0;
                if (!VirtualProtect(
                        &Thunk->u1.Function,
                        sizeof(Thunk->u1.Function),
                        PAGE_READWRITE,
                        &PreviousProtection))
                {
                    return false;
                }
                *Original = reinterpret_cast<void*>(Thunk->u1.Function);
                Thunk->u1.Function = reinterpret_cast<ULONG_PTR>(Replacement);
                DWORD IgnoredProtection = 0;
                VirtualProtect(
                    &Thunk->u1.Function,
                    sizeof(Thunk->u1.Function),
                    PreviousProtection,
                    &IgnoredProtection);
                FlushInstructionCache(
                    GetCurrentProcess(),
                    &Thunk->u1.Function,
                    sizeof(Thunk->u1.Function));
                return true;
            }
        }
        return false;
    }

    static void InstallEpicAuthorizationCapture()
    {
        bCaptureEpicAuthorizationUrl = FParse::Param(
            FCommandLine::Get(),
            TEXT("ConclaviaCaptureAuthUrl"));
        if (!bCaptureEpicAuthorizationUrl)
        {
            return;
        }

        HMODULE CoreModule = GetModuleHandleW(L"UnrealEditor-Core.dll");
        const bool bShellExecutePatched = PatchImportedFunction(
            CoreModule,
            "ShellExecuteW",
            reinterpret_cast<void*>(&CaptureShellExecuteW),
            reinterpret_cast<void**>(&OriginalShellExecuteW));
        const bool bShellExecuteExPatched = PatchImportedFunction(
            CoreModule,
            "ShellExecuteExW",
            reinterpret_cast<void*>(&CaptureShellExecuteExW),
            reinterpret_cast<void**>(&OriginalShellExecuteExW));
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("CONCLAVIA_EPIC_AUTH_CAPTURE_READY: ShellExecuteW=%s ShellExecuteExW=%s"),
            bShellExecutePatched ? TEXT("true") : TEXT("false"),
            bShellExecuteExPatched ? TEXT("true") : TEXT("false"));
    }
#endif

    static FString OnAirName(const FString& Id)
    {
        static const TCHAR* Names[] = {
            TEXT("Elena Riva"),
            TEXT("Lorenzo Vitale"),
            TEXT("Giulia Ferri"),
            TEXT("Marco Bellini"),
            TEXT("Sofia Greco")
        };
        return Names[SeatIndexFromId(Id)];
    }

    static FString IntentLabel(const FString& Intent)
    {
        if (Intent.Contains(TEXT("challenge"), ESearchCase::IgnoreCase) ||
            Intent.Contains(TEXT("contest"), ESearchCase::IgnoreCase))
        {
            return TEXT("CONTESTAZIONE");
        }
        if (Intent.Contains(TEXT("question"), ESearchCase::IgnoreCase) ||
            Intent.Contains(TEXT("domand"), ESearchCase::IgnoreCase))
        {
            return TEXT("DOMANDA DIRETTA");
        }
        if (Intent.Contains(TEXT("reply"), ESearchCase::IgnoreCase) ||
            Intent.Contains(TEXT("replic"), ESearchCase::IgnoreCase))
        {
            return TEXT("REPLICA");
        }
        if (Intent.Contains(TEXT("agree"), ESearchCase::IgnoreCase) ||
            Intent.Contains(TEXT("accord"), ESearchCase::IgnoreCase))
        {
            return TEXT("ACCORDO PARZIALE");
        }
        return TEXT("INTERVENTO");
    }

    static TUniquePtr<FHttpServerResponse> JsonResponse(
        const FString& Body,
        EHttpServerResponseCodes Code = EHttpServerResponseCodes::Ok)
    {
        TUniquePtr<FHttpServerResponse> Response =
            FHttpServerResponse::Create(Body, TEXT("application/json; charset=utf-8"));
        Response->Code = Code;
        Response->Headers.Add(TEXT("Access-Control-Allow-Origin"), {TEXT("*")});
        return Response;
    }

    static int32 SeatIndexFromId(const FString& Id)
    {
        for (int32 Index = Id.Len() - 1; Index >= 0; --Index)
        {
            if (FChar::IsDigit(Id[Index]))
            {
                return FMath::Clamp(Id[Index] - TCHAR('1'), 0, 4);
            }
        }
        return 2;
    }

#if WITH_EDITOR
    static bool ExportPreviewCharacter(const FString& Name)
    {
        const FString CharacterPath = FString::Printf(
            TEXT("/Game/Conclavia/Cast/MHC_%s.MHC_%s"), *Name, *Name);
        UMetaHumanCharacter* Character = LoadObject<UMetaHumanCharacter>(
            nullptr, *CharacterPath);
        UMetaHumanCharacterEditorSubsystem* Subsystem =
            UMetaHumanCharacterEditorSubsystem::Get();
        if (!Character || !Subsystem)
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("Preview export prerequisites missing for %s"),
                *Name);
            return false;
        }

        if (!Subsystem->TryAddObjectToEdit(Character))
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("Could not open MHC_%s for local preview export"),
                *Name);
            return false;
        }

        bool bSucceeded = false;
        ON_SCOPE_EXIT
        {
            if (Subsystem->IsObjectAddedForEditing(Character))
            {
                Subsystem->RemoveObjectToEdit(Character);
            }
        };

        Subsystem->RunCharacterEditorPipelineForPreview(Character);

        const FString PackageName = FString::Printf(
            TEXT("/Game/Conclavia/Cast/Preview/%s/MHC_%s_Preview"),
            *Name,
            *Name);
        UPackage* Package = CreatePackage(*PackageName);
        if (!Package)
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Could not create %s"), *PackageName);
            return false;
        }
        Package->FullyLoad();

        FMetaHumanCharacterGeneratedAssets GeneratedAssets;
        if (!Subsystem->TryGenerateCharacterAssets(
                Character, Package, GeneratedAssets))
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("Local MetaHuman generation failed for %s"),
                *Name);
            return false;
        }

        for (const FMetaHumanGeneratedAssetMetadata& Metadata : GeneratedAssets.Metadata)
        {
            if (!Metadata.Object)
            {
                continue;
            }
            Metadata.Object->SetFlags(RF_Public | RF_Standalone);
            Metadata.Object->MarkPackageDirty();
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("CONCLAVIA_PREVIEW_ASSET: name=%s object=%s preferred=%s/%s"),
                *Name,
                *Metadata.Object->GetPathName(),
                *Metadata.PreferredSubfolderPath,
                *Metadata.PreferredName);
        }

        Package->MarkPackageDirty();
        const FString Filename = FPackageName::LongPackageNameToFilename(
            PackageName, FPackageName::GetAssetPackageExtension());
        FSavePackageArgs SaveArgs;
        SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
        SaveArgs.SaveFlags = SAVE_NoError;
        bSucceeded = UPackage::SavePackage(
            Package,
            GeneratedAssets.FaceMesh,
            *Filename,
            SaveArgs);
        if (bSucceeded)
        {
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("CONCLAVIA_PREVIEW_EXPORT: name=%s saved=true package=%s"),
                *Name,
                *PackageName);
        }
        else
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("CONCLAVIA_PREVIEW_EXPORT: name=%s saved=false package=%s"),
                *Name,
                *PackageName);
        }
        return bSucceeded;
    }

    static void ExportPreviewCast()
    {
        static const TCHAR* Names[] = {
            TEXT("Ada"),
            TEXT("Lorenzo"),
            TEXT("Aera"),
            TEXT("Omari"),
            TEXT("Vivian")
        };
        int32 Exported = 0;
        for (const TCHAR* Name : Names)
        {
            Exported += ExportPreviewCharacter(Name) ? 1 : 0;
        }
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("CONCLAVIA_PREVIEW_CAST_COMPLETE: exported=%d total=%d"),
            Exported,
            UE_ARRAY_COUNT(Names));
    }

    static FAutoConsoleCommand ExportPreviewCastCommand(
        TEXT("Conclavia.ExportPreviewCast"),
        TEXT("Persist the locally assembled UE 5.8 MetaHuman preset cast."),
        FConsoleCommandDelegate::CreateStatic(&ExportPreviewCast));

    static void StartEditorPreviewStream()
    {
        if (IConsoleVariable* UseRemoteSignalling = IConsoleManager::Get().FindConsoleVariable(
                TEXT("PixelStreaming2.Editor.UseRemoteSignallingServer")))
        {
            UseRemoteSignalling->Set(true, ECVF_SetByCode);
        }
        if (IConsoleVariable* NegotiateCodecs = IConsoleManager::Get().FindConsoleVariable(
                TEXT("PixelStreaming2.WebRTC.NegotiateCodecs")))
        {
            NegotiateCodecs->Set(true, ECVF_SetByCode);
        }

        if (GCurrentLevelEditingViewportClient)
        {
            UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
            FString PreviewCamera = FPlatformMisc::GetEnvironmentVariable(
                TEXT("CONCLAVIA_PREVIEW_CAMERA"));
            if (PreviewCamera.IsEmpty())
            {
                PreviewCamera = TEXT("CAM_Wide_Master");
            }
            if (World)
            {
                for (TActorIterator<ACameraActor> It(World); It; ++It)
                {
                    if (!It->ActorHasTag(FName(*PreviewCamera)))
                    {
                        continue;
                    }

                    GCurrentLevelEditingViewportClient->SetViewLocation(It->GetActorLocation());
                    GCurrentLevelEditingViewportClient->SetViewRotation(It->GetActorRotation());
                    const float CameraFov = It->GetCameraComponent()->FieldOfView;
                    GCurrentLevelEditingViewportClient->ViewFOV = CameraFov;
                    GCurrentLevelEditingViewportClient->FOVAngle = CameraFov;
                    GCurrentLevelEditingViewportClient->SetRealtime(true);
                    GCurrentLevelEditingViewportClient->SetViewMode(VMI_Lit);
                    GCurrentLevelEditingViewportClient->SetGameView(true);
                    GCurrentLevelEditingViewportClient->EngineShowFlags.SetGrid(false);
                    GCurrentLevelEditingViewportClient->EngineShowFlags.SetSelectionOutline(false);
                    UE_LOG(
                        LogConclaviaStudio,
                        Display,
                        TEXT("CONCLAVIA_EDITOR_CAMERA: camera=%s fov=%.1f"),
                        *PreviewCamera,
                        CameraFov);
                    break;
                }
            }
        }

        FLevelEditorModule& LevelEditorModule =
            FModuleManager::LoadModuleChecked<FLevelEditorModule>(TEXT("LevelEditor"));
        LevelEditorModule.ToggleImmersiveOnActiveLevelViewport();

        IPixelStreaming2EditorModule::Get().StartStreaming(
            EPixelStreaming2EditorStreamTypes::Editor);
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("CONCLAVIA_EDITOR_STREAM_STARTED: source=Editor immersive=true"));
    }

    static FAutoConsoleCommand StartEditorPreviewStreamCommand(
        TEXT("Conclavia.StartEditorStream"),
        TEXT("Stream the clean level-editor viewport for the MetaHuman POC."),
        FConsoleCommandDelegate::CreateStatic(&StartEditorPreviewStream));
#endif
}

class FConclaviaPcmLiveLinkSubject final : public FMetaHumanAudioBaseLiveLinkSubject
{
public:
    FConclaviaPcmLiveLinkSubject(
        ILiveLinkClient* Client,
        const FGuid& SourceGuid,
        const FName& SubjectName,
        UMetaHumanAudioBaseLiveLinkSubjectSettings* Settings)
        : FMetaHumanAudioBaseLiveLinkSubject(Client, SourceGuid, SubjectName, Settings)
    {
    }

    virtual ~FConclaviaPcmLiveLinkSubject() override
    {
        RequestSamplerStop();
    }

    void FeedMono48k(const TArray<uint8>& Bytes)
    {
        const int32 SampleCount = Bytes.Num() / static_cast<int32>(sizeof(float));
        if (SampleCount <= 0)
        {
            return;
        }
        FAudioSample Sample;
        Sample.NumChannels = 1;
        Sample.SampleRate = 48000;
        Sample.NumSamples = SampleCount;
        Sample.Data.SetNumUninitialized(SampleCount);
        FMemory::Memcpy(Sample.Data.GetData(), Bytes.GetData(), SampleCount * sizeof(float));
        GetSampleTime(FFrameRate(30, 1), Sample.Time, Sample.TimeSource);
        AddAudioSample(MoveTemp(Sample));
    }

protected:
    virtual void MediaSamplerMain() override
    {
        while (!bSamplerStopRequested)
        {
            FPlatformProcess::SleepNoStats(0.01f);
        }
    }

public:
    void RequestSamplerStop() { bSamplerStopRequested = true; }

private:
    TAtomic<bool> bSamplerStopRequested{false};
};

class FConclaviaPcmLiveLinkSource final : public FMetaHumanLocalLiveLinkSource
{
public:
    virtual FText GetSourceType() const override
    {
        return FText::FromString(TEXT("Conclavia PCM"));
    }

    virtual TSubclassOf<ULiveLinkSourceSettings> GetSettingsClass() const override
    {
        return UMetaHumanLocalLiveLinkSourceSettings::StaticClass();
    }

    virtual bool RequestSourceShutdown() override
    {
        if (Subject.IsValid())
        {
            Subject->RequestSamplerStop();
        }
        const bool bShutdown = FMetaHumanLocalLiveLinkSource::RequestSourceShutdown();
        Subject.Reset();
        return bShutdown;
    }

    void Feed(const TArray<uint8>& Bytes)
    {
        if (Subject.IsValid())
        {
            Subject->FeedMono48k(Bytes);
        }
    }

    bool IsSubjectReady() const
    {
        return Subject.IsValid();
    }

    FGuid GetConclaviaSourceGuid() const
    {
        return GetSourceGuid();
    }

protected:
    virtual void OnSourceCreated(bool) override
    {
        UMetaHumanAudioBaseLiveLinkSubjectSettings* SubjectSettings =
            CreateSubjectSettings<UMetaHumanAudioBaseLiveLinkSubjectSettings>();
        // SetLookahead forwards to Settings->Subject; the subject does not
        // exist yet at this lifecycle point. Assign the initial property and
        // let RequestSubjectCreation attach it safely.
        SubjectSettings->Lookahead = 80;
        RequestSubjectCreation(TEXT("ConclaviaVoice"), SubjectSettings);
    }

    virtual TSharedPtr<FMetaHumanLocalLiveLinkSubject> CreateSubject(
        const FName& InSubjectName,
        UMetaHumanLocalLiveLinkSubjectSettings* InSettings) override
    {
        UMetaHumanAudioBaseLiveLinkSubjectSettings* AudioSettings =
            CastChecked<UMetaHumanAudioBaseLiveLinkSubjectSettings>(InSettings);
        Subject = MakeShared<FConclaviaPcmLiveLinkSubject>(
            LiveLinkClient,
            GetSourceGuid(),
            InSubjectName,
            AudioSettings);
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Direct PCM MetaHuman subject ready: %s at 48 kHz"),
            *InSubjectName.ToString());
        return Subject;
    }

private:
    TSharedPtr<FConclaviaPcmLiveLinkSubject> Subject;
};

class FConclaviaStudioModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
#if PLATFORM_WINDOWS && WITH_EDITOR
        ConclaviaStudio::InstallEpicAuthorizationCapture();
#endif
        int32 ConfiguredPort = 8081;
        GConfig->GetInt(TEXT("ConclaviaStudio"), TEXT("ControlPort"), ConfiguredPort, GEngineIni);
        FParse::Value(FCommandLine::Get(), TEXT("ConclaviaControlPort="), ConfiguredPort);
        ControlPort = static_cast<uint32>(FMath::Clamp(ConfiguredPort, 1024, 65535));

        GConfig->GetString(TEXT("ConclaviaStudio"), TEXT("StudioProfile"), StudioProfile, GEngineIni);
        FParse::Value(FCommandLine::Get(), TEXT("ConclaviaStudioProfile="), StudioProfile);
        if (StudioProfile.IsEmpty())
        {
            StudioProfile = TEXT("pop");
        }
        bLipSyncLab = FParse::Param(FCommandLine::Get(), TEXT("ConclaviaLipSyncLab"));
        FParse::Value(FCommandLine::Get(), TEXT("ConclaviaAvatar="), AvatarId);
        AvatarId = AvatarId.ToLower();
        if (AvatarId.IsEmpty())
        {
            AvatarId = TEXT("aera");
        }
        if (!AvatarId.Equals(TEXT("aera"), ESearchCase::IgnoreCase)
            && !AvatarId.Equals(TEXT("ada"), ESearchCase::IgnoreCase)
            && !AvatarId.Equals(TEXT("vivian"), ESearchCase::IgnoreCase)
            && !AvatarId.Equals(TEXT("jelena"), ESearchCase::IgnoreCase))
        {
            UE_LOG(
                LogConclaviaStudio,
                Warning,
                TEXT("Avatar %s is not installed for UE 5.8; using Aera"),
                *AvatarId);
            AvatarId = TEXT("aera");
        }
        bNativeLiveLinkProfile =
            StudioProfile.Equals(TEXT("native"), ESearchCase::IgnoreCase)
            || StudioProfile.Equals(TEXT("native-livelink"), ESearchCase::IgnoreCase);

        WorldInitializationHandle = FWorldDelegates::OnPostWorldInitialization.AddRaw(
            this,
            &FConclaviaStudioModule::HandleWorldInitialization);

        FHttpServerModule& HttpServer =
            FModuleManager::LoadModuleChecked<FHttpServerModule>(TEXT("HTTPServer"));
        Router = HttpServer.GetHttpRouter(ControlPort);
        if (!Router.IsValid())
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Unable to create HTTP router on port %u"), ControlPort);
            return;
        }

        HealthRoute = Router->BindRoute(
            FHttpPath(TEXT("/health")),
            EHttpServerRequestVerbs::VERB_GET,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleHealth));
        CueRoute = Router->BindRoute(
            FHttpPath(TEXT("/director/cue")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleCue));
        OptionsRoute = Router->BindRoute(
            FHttpPath(TEXT("/director/cue")),
            EHttpServerRequestVerbs::VERB_OPTIONS,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleOptions));
        SnapshotRoute = Router->BindRoute(
            FHttpPath(TEXT("/director/snapshot")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleSnapshot));
        PcmRoute = Router->BindRoute(
            FHttpPath(TEXT("/audio/pcm")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandlePcm));
        SpeechRoute = Router->BindRoute(
            FHttpPath(TEXT("/audio/speech")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleSpeech));
        AvatarRoute = Router->BindRoute(
            FHttpPath(TEXT("/avatar")),
            EHttpServerRequestVerbs::VERB_POST,
            FHttpRequestHandler::CreateRaw(this, &FConclaviaStudioModule::HandleAvatar));

        HttpServer.StartAllListeners();
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Control plane listening on 127.0.0.1:%u (%s profile)"),
            ControlPort,
            *StudioProfile);
    }

    virtual void ShutdownModule() override
    {
        FWorldDelegates::OnPostWorldInitialization.Remove(WorldInitializationHandle);
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(StageDiscoveryTimer);
            StudioWorld->GetTimerManager().ClearTimer(LowerThirdTimer);
            StudioWorld->GetTimerManager().ClearTimer(FacialLifeTimer);
            StudioWorld->GetTimerManager().ClearTimer(AudioSourceRetryTimer);
            StudioWorld->GetTimerManager().ClearTimer(LiveLinkAuditTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialFaceTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialModelTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialSolverTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialAudioStartTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialSpeechEndTimer);
            StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
            StudioWorld->GetTimerManager().ClearTimer(ListeningModelTimer);
            StudioWorld->GetTimerManager().ClearTimer(BodyGestureTimer);
        }
        ResetCommercialLipSync();
        if (GEngine && GEngine->GameViewport && BroadcastOverlay.IsValid())
        {
            GEngine->GameViewport->RemoveViewportWidgetContent(BroadcastOverlay.ToSharedRef());
        }
        if (Router.IsValid())
        {
            Router->UnbindRoute(HealthRoute);
            Router->UnbindRoute(CueRoute);
            Router->UnbindRoute(OptionsRoute);
            Router->UnbindRoute(SnapshotRoute);
            Router->UnbindRoute(PcmRoute);
            Router->UnbindRoute(SpeechRoute);
            Router->UnbindRoute(AvatarRoute);
        }
        if (PcmSource.IsValid())
        {
            PcmSource->RequestSourceShutdown();
            if (LiveLinkClient)
            {
                LiveLinkClient->RemoveSource(PcmSource);
            }
            PcmSource.Reset();
        }
        Router.Reset();
    }

private:
    void HandleWorldInitialization(UWorld* World, const UWorld::InitializationValues)
    {
        if (!World || World->WorldType != EWorldType::Game)
        {
            return;
        }

        StudioWorld = World;
        bStageReady = false;
        StageDiscoveryAttempts = 0;
        World->GetTimerManager().SetTimer(
            StageDiscoveryTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::DiscoverStage),
            0.20f,
            true,
            0.05f);
        if (!bLipSyncLab)
        {
            World->GetTimerManager().SetTimer(
                AudioSourceRetryTimer,
                FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::InitializeDirectAudioSource),
                0.25f,
                true,
                0.05f);
            World->GetTimerManager().SetTimer(
                LiveLinkAuditTimer,
                FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::AuditLiveLinkFrame),
                1.0f,
                true,
                1.0f);
        }
    }

    void DiscoverStage()
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }

        Cameras.Reset();
        for (TActorIterator<ACameraActor> It(StudioWorld.Get()); It; ++It)
        {
            for (const FName Tag : It->Tags)
            {
                if (Tag.ToString().StartsWith(TEXT("CAM_")))
                {
                    Cameras.Add(Tag, *It);
                    break;
                }
            }
        }

        ++StageDiscoveryAttempts;
        bStageReady = Cameras.Num() >= 9;
        if (!bStageReady && StageDiscoveryAttempts < 25)
        {
            return;
        }

        StudioWorld->GetTimerManager().ClearTimer(StageDiscoveryTimer);
        if (!bStageReady)
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Premium studio camera package was not found"));
            return;
        }

        // The stock GameMode spawns a visible sphere pawn at the origin. It is
        // irrelevant in a broadcast-only world and otherwise appears at the
        // bottom of the master shot as a bright white orb.
        if (APlayerController* Controller = StudioWorld->GetFirstPlayerController())
        {
            // This is a broadcast-only world: Unreal's default controller must
            // not reclaim the view target for its pawn on the following tick.
            // Without this, the control plane reports the requested close-up
            // while Pixel Streaming keeps showing the master camera.
            Controller->bAutoManageActiveCameraTarget = false;
            if (APawn* Pawn = Controller->GetPawn())
            {
                Pawn->SetActorHiddenInGame(true);
                Pawn->SetActorEnableCollision(false);
            }
        }

        SwitchCamera(
            bLipSyncLab ? TEXT("CAM_Seat_1_Close") : TEXT("CAM_Wide_Master"),
            0.0f,
            true);
        BuildBroadcastOverlay();
        // The validation profile must leave the assembled MetaHuman animation
        // stack untouched. PlayAnimation switches Body to AnimationSingleNode
        // and prevents the LiveLinkInstance selected by the generated
        // MetaHuman Blueprint from ever evaluating the facial subject.
        if (!bLipSyncLab)
        {
            InitializeBodyIdle();
        }
        InitializeFacialLife();
        GetBodyGestureSequence();
        if (bLipSyncLab)
        {
            // A deliberately boring laboratory shot: one hero face, no cut,
            // no listener animation and no competing cast. This makes a
            // frame-by-frame mouth solve auditable before it is allowed back
            // into the five-person broadcast.
            for (int32 Index = 1; Index < ParticipantFaces.Num(); ++Index)
            {
                if (AActor* Actor = ParticipantFaces[Index].Actor.Get())
                {
                    Actor->SetActorHiddenInGame(true);
                }
            }
            ActiveFaceIndex = 0;
            bCommercialFaceReady = ConfigureCommercialFace();
            if (bCommercialFaceReady)
            {
                InitializeBodyIdle();
                WarmCommercialGenerator(false);
            }
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Lip-sync lab ready: one hero, fixed close-up, commercialFace=%s"),
                bCommercialFaceReady ? TEXT("true") : TEXT("false"));
        }
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Premium studio ready: %d cameras, %s profile"),
            Cameras.Num(),
            *StudioProfile);
    }

    struct FParticipantFaceState
    {
        TWeakObjectPtr<AActor> Actor;
        TWeakObjectPtr<USkeletalMeshComponent> Body;
        TWeakObjectPtr<USkeletalMeshComponent> Face;
        double NextBlinkAt = 0.0;
        double BlinkStartedAt = 0.0;
        bool bBlinking = false;
    };

    struct FPerformanceBeat
    {
        int32 AtMs = 0;
        ERealisticMetaHumanLipSyncMood Mood =
            ERealisticMetaHumanLipSyncMood::Confidence;
        FString MoodName = TEXT("confidence");
        float Intensity = 0.48f;
        FString Focus = TEXT("camera");
        FString Gesture = TEXT("none");
    };

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
            double Intensity = 0.48;
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

    static void RefreshMetaHumanComponents(FParticipantFaceState& State)
    {
        AActor* Actor = State.Actor.Get();
        if (!Actor)
        {
            State.Body.Reset();
            State.Face.Reset();
            return;
        }

        USkeletalMeshComponent* Body = nullptr;
        USkeletalMeshComponent* Face = nullptr;
        TArray<USkeletalMeshComponent*> Components;
        Actor->GetComponents<USkeletalMeshComponent>(Components);
        for (USkeletalMeshComponent* Component : Components)
        {
            if (!Component || !IsValid(Component)
                || Component->GetName().StartsWith(TEXT("TRASH_")))
            {
                continue;
            }
            if (Component->GetName() == TEXT("Body"))
            {
                Body = Component;
            }
            else if (Component->GetName() == TEXT("Face"))
            {
                Face = Component;
            }
        }
        State.Body = Body;
        State.Face = Face;
    }

    void InitializeBodyIdle()
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }

        UAnimSequence* SeatedIdle = LoadObject<UAnimSequence>(
            nullptr,
            TEXT("/Game/Conclavia/Studio/Animations/AS_Conclavia_SeatedIdle.AS_Conclavia_SeatedIdle"));
        if (!SeatedIdle)
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Production seated idle was not found"));
            return;
        }

        int32 ParticipantIndex = 0;
        int32 AnimatedComponents = 0;
        const float IdleDuration = FMath::Max(SeatedIdle->GetPlayLength(), 0.1f);
        for (TActorIterator<AActor> It(StudioWorld.Get()); It; ++It)
        {
            if (!It->Tags.Contains(TEXT("ConclaviaProductionCast")))
            {
                continue;
            }

            TArray<USkeletalMeshComponent*> Components;
            It->GetComponents<USkeletalMeshComponent>(Components);
            for (USkeletalMeshComponent* Component : Components)
            {
                // Only the authoritative body mesh owns locomotion. Clothing
                // follows it through LeaderPoseComponent; playing the same
                // sequence on both components made the active guest visibly
                // vibrate as two evaluations fought over the pose.
                if (!Component || Component->GetName() != TEXT("Body"))
                {
                    continue;
                }

                // This asset keeps the analytically-authored seated lower body
                // but takes the entire upper-body performance from Epic's UE
                // 5.8 MetaHuman technical idle.  Running it slowly gives the
                // remote participant breathing, weight shifts and shoulder
                // life without procedural per-bone noise or animation fights.
                Component->PlayAnimation(SeatedIdle, true);
                Component->SetPlayRate(0.58f);
                Component->SetPosition(
                    FMath::Fmod(ParticipantIndex * 7.13f, IdleDuration),
                    false);
                Component->VisibilityBasedAnimTickOption =
                    EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
                ++AnimatedComponents;
            }
            ++ParticipantIndex;
        }

        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Seated body layer ready: %d participants, %d components"),
            ParticipantIndex,
            AnimatedComponents);
    }

    USkeletalMeshComponent* GetActiveBodyComponent()
    {
        if (USkeletalMeshComponent* Face = CommercialFace.Get())
        {
            if (AActor* Owner = Face->GetOwner())
            {
                TArray<USkeletalMeshComponent*> Components;
                Owner->GetComponents<USkeletalMeshComponent>(Components);
                for (USkeletalMeshComponent* Component : Components)
                {
                    if (Component && Component->GetName() == TEXT("Body"))
                    {
                        return Component;
                    }
                }
            }
        }
        return ParticipantFaces.IsValidIndex(ActiveFaceIndex)
            ? ParticipantFaces[ActiveFaceIndex].Body.Get()
            : nullptr;
    }

    UAnimSequence* GetBodyGestureSequence()
    {
        if (!BodyGestureSequence.IsValid())
        {
            BodyGestureSequence = LoadObject<UAnimSequence>(
                nullptr,
                TEXT("/Game/Conclavia/Studio/Animations/AS_Conclavia_MetaHumanHandRaise.AS_Conclavia_MetaHumanHandRaise"));
        }
        bPhysicalGestureReady = BodyGestureSequence.IsValid();
        return BodyGestureSequence.Get();
    }

    static void RefreshAuthoredBodyPose(USkeletalMeshComponent* Body)
    {
        if (!Body)
        {
            return;
        }
        // SetPosition is evaluated lazily by AnimationSingleNode. Force the
        // selected authored frame through the component and render proxy before
        // pausing the hold; otherwise an offscreen Pixel Streaming world can
        // keep drawing the preceding idle pose even though playback telemetry
        // has already advanced to the hand-raise hold.
        Body->TickAnimation(0.0f, false);
        Body->RefreshBoneTransforms();
        Body->UpdateComponentToWorld();
        Body->MarkRenderDynamicDataDirty();
    }

    static int32 RefreshMetaHumanBodyFollowers(USkeletalMeshComponent* Body)
    {
        if (!Body || !Body->GetOwner())
        {
            return 0;
        }
        int32 Refreshed = 0;
        TArray<USkeletalMeshComponent*> Components;
        Body->GetOwner()->GetComponents<USkeletalMeshComponent>(Components);
        for (USkeletalMeshComponent* Component : Components)
        {
            if (!Component || Component == Body
                || Component->GetName() == TEXT("Face"))
            {
                continue;
            }
            // Generated MetaHumans render clothing and shoes on follower
            // skeletal components. LiveLinkSetup may reconstruct Body while
            // leaving those render components attached to its predecessor.
            // Rebind them to the active authored pose, never to hand-authored
            // bone transforms.
            Component->SetLeaderPoseComponent(Body);
            Component->UpdateComponentToWorld();
            Component->MarkRenderDynamicDataDirty();
            ++Refreshed;
        }
        return Refreshed;
    }

    float GetBodyGestureAlpha() const
    {
        const float Elapsed = static_cast<float>(
            FPlatformTime::Seconds() - BodyGesturePhaseStartedAt);
        if (BodyGesturePhase == TEXT("raising"))
        {
            return FMath::Clamp(Elapsed / BodyGestureRaiseSeconds, 0.0f, 1.0f);
        }
        if (BodyGesturePhase == TEXT("held"))
        {
            return 1.0f;
        }
        if (BodyGesturePhase == TEXT("lowering"))
        {
            return 1.0f - FMath::Clamp(
                Elapsed / BodyGestureLowerSeconds,
                0.0f,
                1.0f);
        }
        return 0.0f;
    }

    void FinishLowerHand()
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }
        StudioWorld->GetTimerManager().ClearTimer(BodyGestureTimer);
        BodyGestureComponent.Reset();
        BodyGesturePhase = TEXT("idle");
        ActiveBodyGesture = TEXT("none");
        bBodyGestureLowerQueued = false;
        InitializeBodyIdle();
    }

    void HoldRaisedHand()
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }
        if (USkeletalMeshComponent* Body = BodyGestureComponent.Get())
        {
            Body->SetPosition(BodyGestureHoldSeconds, false);
            Body->SetPlayRate(0.0f);
            RefreshAuthoredBodyPose(Body);
            const int32 RefreshedFollowers = RefreshMetaHumanBodyFollowers(Body);
            BodyGesturePhase = TEXT("held");
            BodyGesturePhaseStartedAt = FPlatformTime::Seconds();
            ActiveBodyGesture = TEXT("raise-hand");
            const FVector HeldHandLocation = Body->GetSocketLocation(TEXT("hand_r"));
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Authored hand-raise held: actor=%s start=%s held=%s followers=%d"),
                Body->GetOwner() ? *Body->GetOwner()->GetPathName() : TEXT("None"),
                *BodyGestureStartHandLocation.ToCompactString(),
                *HeldHandLocation.ToCompactString(),
                RefreshedFollowers);
            if (bBodyGestureLowerQueued)
            {
                bBodyGestureLowerQueued = false;
                StudioWorld->GetTimerManager().SetTimer(
                    BodyGestureTimer,
                    FTimerDelegate::CreateLambda([this]()
                    {
                        StartBodyGesture(TEXT("lower-hand"));
                    }),
                    0.12f,
                    false);
            }
        }
        else
        {
            FinishLowerHand();
        }
    }

    void StartBodyGesture(const FString& Gesture)
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }
        UAnimSequence* Sequence = GetBodyGestureSequence();
        USkeletalMeshComponent* Body = GetActiveBodyComponent();
        if (!Sequence || !Body)
        {
            UE_LOG(
                LogConclaviaStudio,
                Warning,
                TEXT("MetaHuman body gesture unavailable: gesture=%s sequence=%s body=%s"),
                *Gesture,
                Sequence ? TEXT("ready") : TEXT("missing"),
                Body ? TEXT("ready") : TEXT("missing"));
            return;
        }

        if (Gesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase))
        {
            if (BodyGesturePhase == TEXT("raising")
                || BodyGesturePhase == TEXT("held"))
            {
                return;
            }
            StudioWorld->GetTimerManager().ClearTimer(BodyGestureTimer);
            BodyGestureComponent = Body;
            Body->PlayAnimation(Sequence, false);
            Body->SetPosition(0.0f, false);
            Body->SetPlayRate(1.0f);
            Body->VisibilityBasedAnimTickOption =
                EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
            RefreshAuthoredBodyPose(Body);
            const int32 RefreshedFollowers = RefreshMetaHumanBodyFollowers(Body);
            BodyGestureStartHandLocation = Body->GetSocketLocation(TEXT("hand_r"));
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Authored hand-raise routed: actor=%s component=%s mesh=%s sequence=%s start=%s followers=%d"),
                Body->GetOwner() ? *Body->GetOwner()->GetPathName() : TEXT("None"),
                *Body->GetPathName(),
                Body->GetSkeletalMeshAsset()
                    ? *Body->GetSkeletalMeshAsset()->GetPathName()
                    : TEXT("None"),
                *Sequence->GetPathName(),
                *BodyGestureStartHandLocation.ToCompactString(),
                RefreshedFollowers);
            BodyGesturePhase = TEXT("raising");
            BodyGesturePhaseStartedAt = FPlatformTime::Seconds();
            ActiveBodyGesture = TEXT("raise-hand");
            bBodyGestureLowerQueued = false;
            StudioWorld->GetTimerManager().SetTimer(
                BodyGestureTimer,
                FTimerDelegate::CreateRaw(
                    this,
                    &FConclaviaStudioModule::HoldRaisedHand),
                BodyGestureHoldSeconds,
                false);
            return;
        }

        if (!Gesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase))
        {
            return;
        }
        if (BodyGesturePhase == TEXT("raising"))
        {
            bBodyGestureLowerQueued = true;
            return;
        }
        if (BodyGesturePhase != TEXT("held"))
        {
            ActiveBodyGesture = TEXT("none");
            return;
        }

        StudioWorld->GetTimerManager().ClearTimer(BodyGestureTimer);
        BodyGestureComponent = Body;
        Body->SetPosition(BodyGestureLowerStartSeconds, false);
        Body->SetPlayRate(1.0f);
        RefreshAuthoredBodyPose(Body);
        RefreshMetaHumanBodyFollowers(Body);
        BodyGesturePhase = TEXT("lowering");
        BodyGesturePhaseStartedAt = FPlatformTime::Seconds();
        ActiveBodyGesture = TEXT("lower-hand");
        StudioWorld->GetTimerManager().SetTimer(
            BodyGestureTimer,
            FTimerDelegate::CreateRaw(
                this,
                &FConclaviaStudioModule::FinishLowerHand),
            BodyGestureLowerSeconds,
            false);
    }

    static void SetBlinkWeight(USkeletalMeshComponent* Face, const float Weight)
    {
        if (!Face)
        {
            return;
        }

        // Cinematic MetaHumans split the eyelid deformation between the head
        // and cartilage meshes. Updating both curve families avoids the
        // flickering half-blink that a single generic ARKit curve produced.
        static const FName BlinkTargets[] = {
            TEXT("head_lod0_mesh__eye_blink_L"),
            TEXT("head_lod0_mesh__eye_blink_R"),
            TEXT("cartilage_lod0_mesh__eye_blink_L"),
            TEXT("cartilage_lod0_mesh__eye_blink_R")
        };
        for (const FName Target : BlinkTargets)
        {
            Face->SetMorphTarget(Target, Weight, false);
        }
    }

    void InitializeFacialLife()
    {
        ParticipantFaces.Reset();
        ParticipantFaces.SetNum(5);
        if (!StudioWorld.IsValid())
        {
            return;
        }

        const double Now = FPlatformTime::Seconds();
        int32 FaceIndex = 0;
        for (TActorIterator<AActor> It(StudioWorld.Get()); It; ++It)
        {
            if (!It->Tags.Contains(TEXT("ConclaviaProductionCast")))
            {
                continue;
            }
            USkeletalMeshComponent* Face = nullptr;
            USkeletalMeshComponent* Body = nullptr;
            TArray<USkeletalMeshComponent*> Components;
            It->GetComponents<USkeletalMeshComponent>(Components);
            for (USkeletalMeshComponent* Component : Components)
            {
                if (Component && Component->GetName() == TEXT("Face"))
                {
                    Face = Component;
                }
                else if (Component && Component->GetName() == TEXT("Body"))
                {
                    Body = Component;
                }
            }
            if (!Face || !Body)
            {
                continue;
            }

            int32 SeatIndex = FaceIndex;
            for (const FName Tag : It->Tags)
            {
                const FString Value = Tag.ToString();
                if (Value.StartsWith(TEXT("Seat")) && Value.Len() > 4)
                {
                    SeatIndex = FMath::Clamp(FCString::Atoi(*Value.Mid(4)) - 1, 0, 4);
                    break;
                }
            }
            FParticipantFaceState& State = ParticipantFaces[SeatIndex];
            State.Actor = *It;
            State.Body = Body;
            State.Face = Face;
            if (FaceIndex == 0)
            {
                for (TFieldIterator<FProperty> Property(It->GetClass()); Property; ++Property)
                {
                    const FString PropertyName = Property->GetName();
                    if (PropertyName.Contains(TEXT("Live"), ESearchCase::IgnoreCase)
                        || PropertyName.Contains(TEXT("Subject"), ESearchCase::IgnoreCase)
                        || PropertyName.Contains(TEXT("Retarget"), ESearchCase::IgnoreCase))
                    {
                        UE_LOG(
                            LogConclaviaStudio,
                            Display,
                            TEXT("MetaHuman runtime property: %s type=%s"),
                            *PropertyName,
                            *Property->GetClass()->GetName());
                    }
                }
            }
            // Deterministic staggering keeps five listeners from blinking in
            // uncanny unison while still yielding reproducible review runs.
            State.NextBlinkAt = Now + 1.15 + FaceIndex * 0.67;
            ++FaceIndex;
        }

        // Do not write procedural morph targets while MetaHuman Animator owns
        // the facial rig. Listener micro-animation will return only after the
        // official audio pipeline is stable and independently verified.
        StudioWorld->GetTimerManager().ClearTimer(FacialLifeTimer);
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Facial life layer ready: %d Cinematic faces"),
            ParticipantFaces.Num());
    }

    static bool AssignCommercialGenerator(
        UObject* Container,
        URealisticMetaHumanLipSyncGenerator* Generator)
    {
        if (!Container || !Generator)
        {
            return false;
        }

        bool bBound = false;
        for (TFieldIterator<FObjectPropertyBase> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->PropertyClass && Generator->IsA(Property->PropertyClass))
            {
                Property->SetObjectPropertyValue_InContainer(Container, Generator);
                bBound = true;
                UE_LOG(
                    LogConclaviaStudio,
                    Display,
                    TEXT("Commercial lip-sync generator bound to %s.%s"),
                    *Container->GetClass()->GetName(),
                    *Property->GetName());
            }
        }

        // In a compiled Animation Blueprint an exposed anim-node pin is stored
        // inside the node's generated struct rather than as a top-level UObject
        // property. Bind that exact runtime node: this is the same connection
        // documented as the "Lip Sync Generator" pin in the plugin's Anim Graph.
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->Struct
                && Property->Struct->IsChildOf(FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
            {
                void* NodeAddress = Property->ContainerPtrToValuePtr<void>(Container);
                FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                    static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(NodeAddress);
                Node->LipSyncGenerator = Generator;
                UE_LOG(
                    LogConclaviaStudio,
                    Display,
                    TEXT("Commercial lip-sync generator bound to anim node %s.%s"),
                    *Container->GetClass()->GetName(),
                    *Property->GetName());
                bBound = true;
            }
        }
        return bBound;
    }

    static bool ConfigureCommercialModelRoute(UObject* Container)
    {
        if (!Container)
        {
            return false;
        }

        bool bSelectedRealisticRoute = false;
        for (TFieldIterator<FProperty> Property(Container->GetClass()); Property; ++Property)
        {
            UEnum* Enum = nullptr;
            if (const FEnumProperty* EnumProperty = CastField<FEnumProperty>(*Property))
            {
                Enum = EnumProperty->GetEnum();
            }
            else if (const FByteProperty* ByteProperty = CastField<FByteProperty>(*Property))
            {
                Enum = ByteProperty->Enum;
            }
            if (!Enum
                || !Enum->GetPathName().Contains(
                    TEXT("MetaHumanModelType"),
                    ESearchCase::IgnoreCase))
            {
                continue;
            }

            int64 RealisticValue = INDEX_NONE;
            int64 MoodValue = INDEX_NONE;
            for (int32 Index = 0; Index < Enum->NumEnums(); ++Index)
            {
                const FString DisplayName =
                    Enum->GetDisplayNameTextByIndex(Index).ToString();
                const FString EnumName = Enum->GetNameStringByIndex(Index);
                if ((DisplayName.Contains(TEXT("Realistic"), ESearchCase::IgnoreCase)
                        || EnumName.Contains(TEXT("Realistic"), ESearchCase::IgnoreCase))
                    && (DisplayName.Contains(TEXT("Mood"), ESearchCase::IgnoreCase)
                        || EnumName.Contains(TEXT("Mood"), ESearchCase::IgnoreCase)))
                {
                    MoodValue = Enum->GetValueByIndex(Index);
                }
                else if (DisplayName.Equals(TEXT("Realistic"), ESearchCase::IgnoreCase)
                    || EnumName.EndsWith(TEXT("Realistic"), ESearchCase::IgnoreCase))
                {
                    RealisticValue = Enum->GetValueByIndex(Index);
                }
            }
            const int64 SelectedValue = MoodValue != INDEX_NONE
                ? MoodValue
                : RealisticValue;
            if (SelectedValue == INDEX_NONE)
            {
                continue;
            }

            if (FEnumProperty* EnumProperty = CastField<FEnumProperty>(*Property))
            {
                EnumProperty->GetUnderlyingProperty()->SetIntPropertyValue(
                    EnumProperty->ContainerPtrToValuePtr<void>(Container),
                    SelectedValue);
            }
            else if (FByteProperty* ByteProperty = CastField<FByteProperty>(*Property))
            {
                ByteProperty->SetPropertyValue_InContainer(
                    Container,
                    static_cast<uint8>(SelectedValue));
            }
            bSelectedRealisticRoute = true;
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Commercial Face AnimBP route selected: %s.%s = %s"),
                *Container->GetClass()->GetName(),
                *Property->GetName(),
                MoodValue != INDEX_NONE ? TEXT("RealisticWithMood") : TEXT("Realistic"));
        }

        // The reference AnimBP caches this convenience flag for its
        // BlendListByBool. Setting the enum alone is not sufficient when the
        // demo widget that normally fires OnModelTypeChanged is absent.
        for (TFieldIterator<FBoolProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (Property->GetName().Contains(
                TEXT("IsRealisticLipSyncModel"),
                ESearchCase::IgnoreCase))
            {
                Property->SetPropertyValue_InContainer(Container, true);
                UE_LOG(
                    LogConclaviaStudio,
                    Display,
                    TEXT("Commercial Face AnimBP realistic branch enabled: %s.%s"),
                    *Container->GetClass()->GetName(),
                    *Property->GetName());
            }
        }
        return bSelectedRealisticRoute;
    }

    bool ConfigureCommercialEyesAim(UObject* Container)
    {
        if (!Container || !StudioWorld.IsValid())
        {
            return false;
        }

        FVector TargetWorldLocation = FVector::ZeroVector;
        if (const TWeakObjectPtr<ACameraActor>* Camera = Cameras.Find(ActiveCamera))
        {
            if (Camera->IsValid())
            {
                TargetWorldLocation = Camera->Get()->GetActorLocation();
            }
        }
        if (TargetWorldLocation.IsNearlyZero())
        {
            if (APlayerController* Controller = StudioWorld->GetFirstPlayerController())
            {
                if (AActor* ViewTarget = Controller->GetViewTarget())
                {
                    TargetWorldLocation = ViewTarget->GetActorLocation();
                }
            }
        }

        bool bBound = false;
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (!Property->Struct
                || !Property->Struct->IsChildOf(
                    FAnimNode_RuntimeMetaHumanEyesAim::StaticStruct()))
            {
                continue;
            }
            FAnimNode_RuntimeMetaHumanEyesAim* Node =
                static_cast<FAnimNode_RuntimeMetaHumanEyesAim*>(
                    Property->ContainerPtrToValuePtr<void>(Container));
            Node->Mode = ERuntimeMetaHumanEyesAimMode::Curves;
            Node->TargetWorldLocation = TargetWorldLocation;
            Node->bEnabled = true;
            Node->InterpSpeed = 5.5f;
            Node->MaxYawDegrees = 20.0f;
            Node->MaxPitchDegrees = 13.0f;
            Node->bEnableSaccades = true;
            Node->SaccadeYawAmplitudeDeg = 0.65f;
            Node->SaccadePitchAmplitudeDeg = 0.38f;
            Node->MinSaccadeInterval = 1.15f;
            Node->MaxSaccadeInterval = 3.60f;
            bBound = true;
        }
        return bBound;
    }

    bool ConfigureCommercialEyesAimForFace()
    {
        USkeletalMeshComponent* Face = CommercialFace.Get();
        if (!Face)
        {
            bCommercialEyesAimBound = false;
            return false;
        }

        // UE 5.8 hosts MetaHuman facial nodes across the primary AnimBP,
        // linked layers and the post-process instance. Scanning only
        // GetAnimInstance() misses Runtime MetaHuman Eyes Aim on assembled
        // characters even though the node is active in the final graph.
        bool bBound = false;
        Face->ForEachAnimInstance([this, &bBound](UAnimInstance* Instance)
        {
            bBound = ConfigureCommercialEyesAim(Instance) || bBound;
        });
        bCommercialEyesAimBound = bBound;
        return bBound;
    }

    static bool AssignCommercialControls(
        UObject* Container,
        const TMap<FString, float>& Controls)
    {
        if (!Container || Controls.IsEmpty())
        {
            return false;
        }

        bool bAssignedToAnimNode = false;
        for (TFieldIterator<FStructProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (!Property->Struct
                || !Property->Struct->IsChildOf(FAnimNode_ModifyCurve::StaticStruct()))
            {
                continue;
            }
            FAnimNode_ModifyCurve* Node = static_cast<FAnimNode_ModifyCurve*>(
                Property->ContainerPtrToValuePtr<void>(Container));
			Node->CurveMap.Reset();
			Node->CurveMap.Reserve(Controls.Num());
            for (const TPair<FString, float>& Control : Controls)
            {
                Node->CurveMap.Add(FName(*Control.Key), Control.Value);
            }
            Node->Alpha = 1.0f;
            Node->ApplyMode = EModifyCurveApplyMode::Blend;
            bAssignedToAnimNode = true;
        }
        if (bAssignedToAnimNode)
        {
            return true;
        }

        for (TFieldIterator<FMapProperty> Property(Container->GetClass()); Property; ++Property)
        {
            if (!Property->GetName().Contains(TEXT("Control"), ESearchCase::IgnoreCase))
            {
                continue;
            }

            FStrProperty* StringKey = CastField<FStrProperty>(Property->KeyProp);
            FNameProperty* NameKey = CastField<FNameProperty>(Property->KeyProp);
            FFloatProperty* FloatValue = CastField<FFloatProperty>(Property->ValueProp);
            if ((!StringKey && !NameKey) || !FloatValue)
            {
                continue;
            }

            void* MapAddress = Property->ContainerPtrToValuePtr<void>(Container);
            FScriptMapHelper Map(*Property, MapAddress);
            Map.EmptyValues(Controls.Num());
            for (const TPair<FString, float>& Control : Controls)
            {
                const int32 Index = Map.AddDefaultValue_Invalid_NeedsRehash();
                if (StringKey)
                {
                    StringKey->SetPropertyValue(Map.GetKeyPtr(Index), Control.Key);
                }
                else
                {
                    NameKey->SetPropertyValue(Map.GetKeyPtr(Index), FName(*Control.Key));
                }
                FloatValue->SetPropertyValue(Map.GetValuePtr(Index), Control.Value);
            }
            Map.Rehash();
            return true;
        }
        return false;
    }

    bool ConfigureCommercialFace()
    {
        if (!ParticipantFaces.IsValidIndex(0))
        {
            return false;
        }

        if (bLipSyncLab)
        {
            FParticipantFaceState& HeroState = ParticipantFaces[0];
            AActor* ExistingHero = HeroState.Actor.Get();
            const FString AvatarClassPath = AvatarId.Equals(TEXT("ada"))
                ? TEXT("/Game/Conclavia/Production/MetaHumans/MHC_ElenaRiva/MHC_ElenaRiva/BP_MHC_ElenaRiva.BP_MHC_ElenaRiva_C")
                : AvatarId.Equals(TEXT("vivian"))
                    ? TEXT("/Game/Conclavia/Production/MetaHumans/MHC_SofiaGreco/MHC_SofiaGreco/BP_MHC_SofiaGreco.BP_MHC_SofiaGreco_C")
                    : AvatarId.Equals(TEXT("jelena"))
                        ? TEXT("/Game/MetaHumans/Jelena/BP_Jelena.BP_Jelena_C")
                        : TEXT("/Game/MetaHumans/Aera/BP_Aera.BP_Aera_C");
            const FName AvatarTag(*FString::Printf(
                TEXT("ConclaviaAvatar_%s"), *AvatarId));

            AActor* CommercialHero = nullptr;
            if (const TWeakObjectPtr<AActor>* Cached =
                    CommercialAvatarActors.Find(AvatarId))
            {
                CommercialHero = Cached->Get();
            }
            if (!CommercialHero)
            {
                UClass* HeroClass = LoadClass<AActor>(nullptr, *AvatarClassPath);
                if (!HeroClass || !ExistingHero || !StudioWorld.IsValid())
                {
                    UE_LOG(
                        LogConclaviaStudio,
                        Error,
                        TEXT("UE 5.8 avatar asset unavailable: id=%s class=%s"),
                        *AvatarId,
                        *AvatarClassPath);
                    return false;
                }
                FActorSpawnParameters SpawnParameters;
                SpawnParameters.SpawnCollisionHandlingOverride =
                    ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
                CommercialHero = StudioWorld->SpawnActor<AActor>(
                    HeroClass,
                    ExistingHero->GetActorTransform(),
                    SpawnParameters);
                if (!CommercialHero)
                {
                    return false;
                }
                CommercialHero->Tags.AddUnique(TEXT("ConclaviaCommercialHero"));
                CommercialHero->Tags.AddUnique(TEXT("ConclaviaProductionCast"));
                CommercialHero->Tags.AddUnique(TEXT("Seat1"));
                CommercialHero->Tags.AddUnique(AvatarTag);
                CommercialAvatarActors.Add(AvatarId, CommercialHero);
            }
            if (ExistingHero && ExistingHero != CommercialHero)
            {
                ExistingHero->SetActorHiddenInGame(true);
                ExistingHero->SetActorEnableCollision(false);
                ExistingHero->SetActorTickEnabled(false);
            }
            CommercialHero->SetActorHiddenInGame(false);
            CommercialHero->SetActorEnableCollision(false);
            CommercialHero->SetActorTickEnabled(true);
            HeroState.Actor = CommercialHero;
            RefreshMetaHumanComponents(HeroState);
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Commercial UE 5.8 hero active: avatar=%s actor=%s cached=%s"),
                *AvatarId,
                *CommercialHero->GetPathName(),
                CommercialAvatarActors.Contains(AvatarId) ? TEXT("true") : TEXT("false"));
        }

        RefreshMetaHumanComponents(ParticipantFaces[0]);
        USkeletalMeshComponent* Face = ParticipantFaces[0].Face.Get();
        if (!Face)
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Commercial lip sync: hero Face component missing"));
            return false;
        }

        if (!AvatarId.Equals(TEXT("aera"), ESearchCase::IgnoreCase))
        {
            UClass* CommercialFaceAnimClass = LoadClass<UAnimInstance>(
                nullptr,
                TEXT("/Game/RuntimeLipSync/Face/Face_AnimBP.Face_AnimBP_C"));
            if (!CommercialFaceAnimClass)
            {
                UE_LOG(
                    LogConclaviaStudio,
                    Error,
                    TEXT("Commercial Face AnimBP unavailable for avatar=%s"),
                    *AvatarId);
                return false;
            }
            Face->SetAnimInstanceClass(CommercialFaceAnimClass);
        }
        UAnimInstance* AuthoredAnimInstance = Face->GetAnimInstance();
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Commercial avatar authored Face AnimBP: avatar=%s class=%s"),
            *AvatarId,
            AuthoredAnimInstance
                ? *AuthoredAnimInstance->GetClass()->GetPathName()
                : TEXT("None"));
        if (!AuthoredAnimInstance)
        {
            UE_LOG(LogConclaviaStudio, Error, TEXT("Commercial lip sync: Face AnimBP missing"));
            return false;
        }

        Face->SetAnimationMode(EAnimationMode::AnimationBlueprint);
        Face->SetComponentTickEnabled(true);
        Face->VisibilityBasedAnimTickOption =
            EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
        Face->InitAnim(true);
        CommercialFace = Face;

        UAnimInstance* AnimInstance = Face->GetAnimInstance();
        bCommercialModelRouteReady = ConfigureCommercialModelRoute(AnimInstance);
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Commercial Face AnimBP active: %s realisticRoute=%s"),
            AnimInstance ? *AnimInstance->GetClass()->GetPathName() : TEXT("None"),
            bCommercialModelRouteReady ? TEXT("true") : TEXT("false"));
        return AnimInstance != nullptr && bCommercialModelRouteReady;
    }

    bool BindCommercialGenerator()
    {
        URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get();
        USkeletalMeshComponent* Face = CommercialFace.Get();
        if (!Generator || !Face)
        {
            bCommercialGeneratorBound = false;
            return false;
        }

        bool bBound = false;
        if (UAnimInstance* FaceAnim = Face->GetAnimInstance())
        {
            bBound = AssignCommercialGenerator(FaceAnim, Generator);
            ConfigureCommercialEyesAimForFace();
        }
        if (ParticipantFaces.IsValidIndex(0))
        {
            if (AActor* Actor = ParticipantFaces[0].Actor.Get())
            {
                bBound = AssignCommercialGenerator(Actor, Generator) || bBound;
            }
        }
        bCommercialGeneratorBound = bBound;
        return bBound;
    }

    bool BindListeningGenerator()
    {
        URealisticMetaHumanLipSyncGenerator* Generator = ListeningGenerator.Get();
        USkeletalMeshComponent* Face = CommercialFace.Get();
        if (!Generator || !Face)
        {
            return false;
        }

        bool bBound = false;
        if (UAnimInstance* FaceAnim = Face->GetAnimInstance())
        {
            bBound = AssignCommercialGenerator(FaceAnim, Generator);
            ConfigureCommercialEyesAimForFace();
        }
        if (ParticipantFaces.IsValidIndex(0))
        {
            if (AActor* Actor = ParticipantFaces[0].Actor.Get())
            {
                bBound = AssignCommercialGenerator(Actor, Generator) || bBound;
            }
        }
        return bBound;
    }

    void PollCommercialModel()
    {
        URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get();
        if (Generator && Generator->IsModelReady())
        {
            if (StudioWorld.IsValid())
            {
                StudioWorld->GetTimerManager().ClearTimer(CommercialModelTimer);
            }
            bCommercialModelReady = true;
            BindCommercialGenerator();
            WarmListeningGenerator();
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Commercial model prewarmed: FullFaceWithMood generatorBound=%s"),
                bCommercialGeneratorBound ? TEXT("true") : TEXT("false"));
            return;
        }

        if (!Generator
            || Generator->GetModelLoadState() == ELipSyncModelLoadState::Failed
            || FPlatformTime::Seconds() >= CommercialModelDeadline)
        {
            if (StudioWorld.IsValid())
            {
                StudioWorld->GetTimerManager().ClearTimer(CommercialModelTimer);
            }
            bCommercialModelReady = false;
            UE_LOG(LogConclaviaStudio, Error, TEXT("Commercial model prewarm failed"));
        }
    }

    void PollListeningModel()
    {
        URealisticMetaHumanLipSyncGenerator* Generator = ListeningGenerator.Get();
        if (Generator && Generator->IsModelReady())
        {
            if (StudioWorld.IsValid())
            {
                StudioWorld->GetTimerManager().ClearTimer(ListeningModelTimer);
            }
            bListeningModelReady = true;
            if (bListeningVisualActive && !bCommercialSpeechActive)
            {
                BindListeningGenerator();
            }
            UE_LOG(LogConclaviaStudio, Display, TEXT("Listener mood generator ready"));
            return;
        }
        if (!Generator
            || Generator->GetModelLoadState() == ELipSyncModelLoadState::Failed
            || FPlatformTime::Seconds() >= ListeningModelDeadline)
        {
            if (StudioWorld.IsValid())
            {
                StudioWorld->GetTimerManager().ClearTimer(ListeningModelTimer);
            }
            bListeningModelReady = false;
            UE_LOG(LogConclaviaStudio, Error, TEXT("Listener mood generator warm-up failed"));
        }
    }

    void WarmListeningGenerator()
    {
        if (!StudioWorld.IsValid() || ListeningGenerator.IsValid())
        {
            return;
        }
        FRealisticMetaHumanLipSyncMoodConfig Config;
        Config.IntraOpThreads = 2;
        Config.InterOpThreads = 1;
        Config.LookaheadMs = 40;
        Config.OutputType = ERealisticMetaHumanLipSyncOutputType::FullFace;
        URealisticMetaHumanLipSyncGenerator* Generator =
            URealisticMetaHumanLipSyncGenerator::
                CreateRealisticMetaHumanLipSyncWithMoodGenerator(Config);
        if (!Generator)
        {
            return;
        }
        Generator->SetMood(ERealisticMetaHumanLipSyncMood::Neutral);
        Generator->SetMoodIntensity(0.0f);
        Generator->SetLookaheadMs(40);
        Generator->SetOutputType(ERealisticMetaHumanLipSyncOutputType::FullFace);
        Generator->ProcessingChunkSize = 640;
        ListeningGenerator =
            TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator>(Generator);
        bListeningModelReady = false;
        ListeningModelDeadline = FPlatformTime::Seconds() + 30.0;
        StudioWorld->GetTimerManager().SetTimer(
            ListeningModelTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::PollListeningModel),
            0.025f,
            true,
            0.0f);
    }

    void WarmCommercialGenerator(const bool bForceNew)
    {
        if (!StudioWorld.IsValid() || !bCommercialFaceReady)
        {
            return;
        }
        if (!bForceNew && bCommercialModelReady && CommercialGenerator.IsValid())
        {
            BindCommercialGenerator();
            return;
        }

        StudioWorld->GetTimerManager().ClearTimer(CommercialModelTimer);
        CommercialGenerator.Reset();
        bCommercialModelReady = false;
        bCommercialGeneratorBound = false;
        bCommercialControlsBound = false;

        // The with-mood generator is the vendor's full-face model. It owns
        // phonemes and expression in one solve, avoiding a second procedural
        // layer fighting the lips, brows and cheeks.
        FRealisticMetaHumanLipSyncMoodConfig Config;
        Config.IntraOpThreads = 4;
        Config.InterOpThreads = 1;
        Config.LookaheadMs = 40;
        Config.OutputType = ERealisticMetaHumanLipSyncOutputType::FullFace;
        URealisticMetaHumanLipSyncGenerator* Generator =
            URealisticMetaHumanLipSyncGenerator::
                CreateRealisticMetaHumanLipSyncWithMoodGenerator(Config);
        if (!Generator)
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("Commercial full-face mood generator creation failed"));
            return;
        }

        Generator->SetMood(ERealisticMetaHumanLipSyncMood::Confidence);
        Generator->SetMoodIntensity(0.48f);
        Generator->SetLookaheadMs(40);
        Generator->SetOutputType(ERealisticMetaHumanLipSyncOutputType::FullFace);
        Generator->ProcessingChunkSize = 640;
        ActiveMoodName = TEXT("confidence");
        ActiveMoodIntensity = 0.48f;
        CommercialGenerator = TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator>(Generator);
        CommercialModelDeadline = FPlatformTime::Seconds() + 60.0;
        StudioWorld->GetTimerManager().SetTimer(
            CommercialModelTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::PollCommercialModel),
            0.025f,
            true,
            0.0f);
    }

    void StopCommercialPlayback()
    {
        if (bCommercialSpeechActive)
        {
            LastCommercialSpeechPeakMouthControl =
                CommercialSpeechPeakMouthControl;
            LastCommercialSpeechPeakMouthControlName =
                CommercialSpeechPeakMouthControlName;
            LastCommercialSpeechPeakUpperFaceControl =
                CommercialSpeechPeakUpperFaceControl;
            LastCommercialSpeechPeakUpperFaceControlName =
                CommercialSpeechPeakUpperFaceControlName;
            LastCommercialSpeechSolverChunks = CommercialSolverChunksSubmitted;
            LastCommercialSpeechSolverCursor = CommercialSolverCursor;
            ++CommercialCompletedSpeechCount;
        }
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(CommercialFaceTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialSolverTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialAudioStartTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialSpeechEndTimer);
        }
        if (SpeechComponent.IsValid())
        {
            SpeechComponent->Stop();
            SpeechComponent->UnregisterComponent();
        }
        if (SpeechWave.IsValid())
        {
            SpeechWave->OnSoundWaveProceduralUnderflow.Unbind();
        }
        SpeechComponent.Reset();
        SpeechWave.Reset();
        FScopeLock Lock(&CommercialSpeechMutex);
        CommercialSpeechSamples.Reset();
        CommercialSpeechCursor = 0;
        CommercialSolverCursor = 0;
        CommercialSolverChunksSubmitted = 0;
        bCommercialSpeechActive = false;
        LastCommercialControlCount = 0;
        LastCommercialMaxControl = 0.0f;
        LastCommercialMaxMouthControl = 0.0f;
        LastCommercialMaxMouthControlName.Reset();
        LastCommercialMaxUpperFaceControl = 0.0f;
        LastCommercialMaxUpperFaceControlName.Reset();
        LastCommercialJawInput = 0.0f;
        LastCommercialJawCurve = 0.0f;
        LastCommercialBoundNodeCount = 0;
        CommercialSpeechPeakMouthControl = 0.0f;
        CommercialSpeechPeakMouthControlName.Reset();
        CommercialSpeechPeakUpperFaceControl = 0.0f;
        CommercialSpeechPeakUpperFaceControlName.Reset();
    }

    void ResetCommercialLipSync()
    {
        StopCommercialPlayback();
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(CommercialModelTimer);
            StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
            StudioWorld->GetTimerManager().ClearTimer(ListeningModelTimer);
        }
        CommercialGenerator.Reset();
        ListeningGenerator.Reset();
        bCommercialModelReady = false;
        bCommercialGeneratorBound = false;
        bCommercialControlsBound = false;
        bListeningModelReady = false;
        bListeningReactionActive = false;
        bListeningVisualActive = false;
    }

    void FinishCommercialSpeech()
    {
        StopCommercialPlayback();
        // The plugin documents one generator per playback. The model itself is
        // cached, so preparing the next generator here prevents the following
        // speaker from paying the cold-start cost.
        WarmCommercialGenerator(true);
    }

    void SetCommercialMood(
        const ERealisticMetaHumanLipSyncMood Mood,
        const FString& Name,
        const float Intensity)
    {
        if (URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get())
        {
            Generator->SetMood(Mood);
            Generator->SetMoodIntensity(FMath::Clamp(Intensity, 0.0f, 1.0f));
            ActiveMoodName = Name;
            ActiveMoodIntensity = FMath::Clamp(Intensity, 0.0f, 1.0f);
            PerformanceTargetIntensity = ActiveMoodIntensity;
            PerformanceCurrentIntensity = ActiveMoodIntensity;
        }
    }

    void UpdateListeningLife()
    {
        if (!StudioWorld.IsValid() || bCommercialSpeechActive)
        {
            return;
        }
        URealisticMetaHumanLipSyncGenerator* Generator = ListeningGenerator.Get();
        if (!Generator || !bListeningModelReady || !bListeningVisualActive)
        {
            return;
        }

        const double Now = FPlatformTime::Seconds();
        if (bListeningReactionActive && Now >= ListeningReactionExpiresAt)
        {
            // Let the vendor model return to neutral instead of snapping or
            // layering a hand-written facial pose over its 81 controls.
            Generator->SetMood(ERealisticMetaHumanLipSyncMood::Neutral);
            Generator->SetMoodIntensity(0.0f);
            ActiveMoodName = TEXT("neutral");
            ActiveMoodIntensity = 0.0f;
            PerformanceCurrentIntensity = 0.0f;
            PerformanceTargetIntensity = 0.0f;
            bListeningReactionActive = false;
            ListeningVisualEndsAt = Now + 0.72;
        }

        TArray<float> RoomTone;
        RoomTone.SetNumZeroed(640);
        Generator->ProcessAudioData(MoveTemp(RoomTone), 16000, 1);
        ++ListeningSolverChunksSubmitted;
        BindListeningGenerator();

        if (!bListeningReactionActive && Now >= ListeningVisualEndsAt)
        {
            bListeningVisualActive = false;
            StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
            StudioWorld->GetTimerManager().ClearTimer(CommercialFaceTimer);
            BindCommercialGenerator();
        }
    }

    void StartListeningReaction(
        const ERealisticMetaHumanLipSyncMood Mood,
        const FString& Name,
        const float Intensity,
        const float ExpectedDurationSeconds)
    {
        if (!StudioWorld.IsValid() || bCommercialSpeechActive)
        {
            return;
        }
        WarmListeningGenerator();
        if (URealisticMetaHumanLipSyncGenerator* Generator = ListeningGenerator.Get())
        {
            Generator->SetMood(Mood);
            Generator->SetMoodIntensity(FMath::Clamp(Intensity, 0.0f, 0.68f));
        }
        ActiveMoodName = Name;
        ActiveMoodIntensity = FMath::Clamp(Intensity, 0.0f, 0.68f);
        PerformanceCurrentIntensity = ActiveMoodIntensity;
        PerformanceTargetIntensity = ActiveMoodIntensity;
        ActivePerformanceFocus = TEXT("target");
        ActivePerformanceGesture = TEXT("listen");
        ListeningReactionExpiresAt = FPlatformTime::Seconds()
            + FMath::Clamp(ExpectedDurationSeconds, 2.0f, 15.0f);
        ListeningVisualEndsAt = ListeningReactionExpiresAt + 0.72;
        bListeningReactionActive = true;
        bListeningVisualActive = true;
        if (bListeningModelReady)
        {
            BindListeningGenerator();
        }
        StudioWorld->GetTimerManager().SetTimer(
            ListeningLifeTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::UpdateListeningLife),
            0.04f,
            true,
            0.0f);
        StudioWorld->GetTimerManager().SetTimer(
            CommercialFaceTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::UpdateCommercialFace),
            1.0f / 60.0f,
            true,
            0.0f);
    }

    void AdvanceCommercialPerformance(const int32 SampleCursor)
    {
        if (ActivePerformanceBeats.IsEmpty())
        {
            return;
        }
        const int32 SolverTimeMs = FMath::RoundToInt(
            static_cast<double>(SampleCursor) * 1000.0 / 16000.0);
        while (ActivePerformanceBeats.IsValidIndex(NextPerformanceBeatIndex)
            && ActivePerformanceBeats[NextPerformanceBeatIndex].AtMs <= SolverTimeMs)
        {
            const FPerformanceBeat& Beat =
                ActivePerformanceBeats[NextPerformanceBeatIndex];
            SetCommercialMood(Beat.Mood, Beat.MoodName, Beat.Intensity);
            ActivePerformanceFocus = Beat.Focus;
            ActivePerformanceGesture = Beat.Gesture;
            ActiveBodyGesture = Beat.Gesture.Equals(
                TEXT("raise-hand"), ESearchCase::IgnoreCase)
                ? TEXT("raise-hand")
                : Beat.Gesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase)
                    ? TEXT("lower-hand")
                    : ActiveBodyGesture;
            if (Beat.Gesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase)
                || Beat.Gesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase))
            {
                StartBodyGesture(Beat.Gesture);
            }
            ++NextPerformanceBeatIndex;
            ++AppliedPerformanceBeatCount;
        }
        if (URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get())
        {
            PerformanceCurrentIntensity = FMath::FInterpTo(
                PerformanceCurrentIntensity,
                PerformanceTargetIntensity,
                0.04f,
                5.5f);
            Generator->SetMoodIntensity(PerformanceCurrentIntensity);
            ActiveMoodIntensity = PerformanceCurrentIntensity;
        }
    }

    void FeedCommercialSolverChunk()
    {
        URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get();
        if (!Generator || !bCommercialSpeechActive)
        {
            return;
        }

        constexpr int32 SolverChunkSamples = 640;
        TArray<float> FloatingPoint;
        {
            FScopeLock Lock(&CommercialSpeechMutex);
            const int32 Remaining = CommercialSpeechSamples.Num() - CommercialSolverCursor;
            const int32 Count = FMath::Min(Remaining, SolverChunkSamples);
            if (Count <= 0)
            {
                if (StudioWorld.IsValid())
                {
                    StudioWorld->GetTimerManager().ClearTimer(CommercialSolverTimer);
                }
                return;
            }
            FloatingPoint.SetNumZeroed(SolverChunkSamples);
            for (int32 Index = 0; Index < Count; ++Index)
            {
                FloatingPoint[Index] = static_cast<float>(
                    CommercialSpeechSamples[CommercialSolverCursor + Index]) / 32768.0f;
            }
            CommercialSolverCursor += Count;
        }

        AdvanceCommercialPerformance(CommercialSolverCursor);
        Generator->ProcessAudioData(MoveTemp(FloatingPoint), 16000, 1);
        ++CommercialSolverChunksSubmitted;
    }

    void BeginCommercialAudioPlayback()
    {
        if (bCommercialSpeechActive && SpeechComponent.IsValid())
        {
            SpeechComponent->Play(0.0f);
        }
    }

    void UpdateCommercialFace()
    {
        URealisticMetaHumanLipSyncGenerator* Generator =
            bListeningVisualActive && !bCommercialSpeechActive
                ? ListeningGenerator.Get()
                : CommercialGenerator.Get();
        USkeletalMeshComponent* Face = CommercialFace.Get();
        if (!Generator || !Face)
        {
            return;
        }

        UAnimInstance* FaceAnim = Face->GetAnimInstance();
        const TMap<FString, float> Controls = Generator->GetControlValues();
        if (Controls.IsEmpty())
        {
            return;
        }

        // Exposed AnimBP pins are evaluated on the animation thread and can
        // overwrite a runtime assignment. Refresh the exact anim-node pointer
        // while speech is active so the worker-thread copy always sees the
        // current generator.
        if (FaceAnim)
        {
            for (TFieldIterator<FStructProperty> Property(FaceAnim->GetClass()); Property; ++Property)
            {
                if (Property->Struct
                    && Property->Struct->IsChildOf(FAnimNode_BlendRealisticMetaHumanLipSync::StaticStruct()))
                {
                    void* NodeAddress = Property->ContainerPtrToValuePtr<void>(FaceAnim);
                    FAnimNode_BlendRealisticMetaHumanLipSync* Node =
                        static_cast<FAnimNode_BlendRealisticMetaHumanLipSync*>(NodeAddress);
                    Node->LipSyncGenerator = Generator;
                    Node->InterpolationSpeed = 45.0f;
                    Node->IdleInterpolationSpeed = 20.0f;
                    Node->ResetTime = 0.28f;
                    ++LastCommercialBoundNodeCount;
                }
            }
        }

        // The configured AnimBP already owns the official
        // BlendRealisticMetaHumanLipSync node. Mutating every ModifyCurve node
        // on the same graph destroys the author's downstream curve setup and
        // can leave the jaw closed even though the model is producing data.
        // Keep the reflective path only as a fallback for bare/custom graphs.
        bool bAssignedToAnim = false;
        bool bAssignedToActor = false;
        if (!bCommercialGeneratorBound)
        {
            bAssignedToAnim = AssignCommercialControls(FaceAnim, Controls);
            AActor* Actor = ParticipantFaces.IsValidIndex(0)
                ? ParticipantFaces[0].Actor.Get()
                : nullptr;
            bAssignedToActor = AssignCommercialControls(Actor, Controls);
        }
        LastCommercialControlCount = Controls.Num();
        LastCommercialMaxControl = 0.0f;
        LastCommercialMaxMouthControl = 0.0f;
        LastCommercialMaxMouthControlName.Reset();
        LastCommercialMaxUpperFaceControl = 0.0f;
        LastCommercialMaxUpperFaceControlName.Reset();
        for (const TPair<FString, float>& Control : Controls)
        {
            const float Magnitude = FMath::Abs(Control.Value);
            LastCommercialMaxControl = FMath::Max(LastCommercialMaxControl, Magnitude);
            const bool bMouthControl =
                Control.Key.Contains(TEXT("mouth"), ESearchCase::IgnoreCase)
                    || Control.Key.Contains(TEXT("jaw"), ESearchCase::IgnoreCase)
                    || Control.Key.Contains(TEXT("tongue"), ESearchCase::IgnoreCase);
            const bool bUpperFaceControl =
                Control.Key.Contains(TEXT("brow"), ESearchCase::IgnoreCase)
                    || Control.Key.Contains(TEXT("eye"), ESearchCase::IgnoreCase)
                    || Control.Key.Contains(TEXT("cheek"), ESearchCase::IgnoreCase)
                    || Control.Key.Contains(TEXT("nose"), ESearchCase::IgnoreCase);
            if (bMouthControl && Magnitude > LastCommercialMaxMouthControl)
            {
                LastCommercialMaxMouthControl = Magnitude;
                LastCommercialMaxMouthControlName = Control.Key;
            }
            if (bUpperFaceControl && Magnitude > LastCommercialMaxUpperFaceControl)
            {
                LastCommercialMaxUpperFaceControl = Magnitude;
                LastCommercialMaxUpperFaceControlName = Control.Key;
            }
        }
        if (LastCommercialMaxMouthControl > CommercialSpeechPeakMouthControl)
        {
            CommercialSpeechPeakMouthControl = LastCommercialMaxMouthControl;
            CommercialSpeechPeakMouthControlName = LastCommercialMaxMouthControlName;
        }
        if (LastCommercialMaxUpperFaceControl > CommercialSpeechPeakUpperFaceControl)
        {
            CommercialSpeechPeakUpperFaceControl = LastCommercialMaxUpperFaceControl;
            CommercialSpeechPeakUpperFaceControlName =
                LastCommercialMaxUpperFaceControlName;
        }
        if (const float* JawInput = Controls.Find(TEXT("CTRL_C_jaw.ty")))
        {
            LastCommercialJawInput = *JawInput;
        }
        if (FaceAnim)
        {
            LastCommercialJawCurve = FaceAnim->GetCurveValue(
                FName(TEXT("CTRL_expressions_jawOpen")));
        }
        bCommercialControlsBound =
            (bCommercialGeneratorBound && bCommercialModelRouteReady)
            || bAssignedToAnim
            || bAssignedToActor;
    }

    void StartCommercialPlayback(const int32 SpeechDurationMs)
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }
        if (!bCommercialFaceReady)
        {
            bCommercialFaceReady = ConfigureCommercialFace();
        }

        URealisticMetaHumanLipSyncGenerator* Generator = CommercialGenerator.Get();
        USkeletalMeshComponent* Face = CommercialFace.Get();
        if (!Generator || !Face)
        {
            return;
        }
        bListeningReactionActive = false;
        bListeningVisualActive = false;
        StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
        BindCommercialGenerator();

        USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(GetTransientPackage());
        Wave->SetSampleRate(16000);
        Wave->NumChannels = 1;
        Wave->Duration = static_cast<float>(SpeechDurationMs + 250) / 1000.0f;
        Wave->SoundGroup = SOUNDGROUP_Voice;
        Wave->bLooping = false;
        {
            // Queue playback independently of inference. The audio-render
            // callback must never drive an asynchronous ML model.
            FScopeLock Lock(&CommercialSpeechMutex);
            if (!CommercialSpeechSamples.IsEmpty())
            {
                Wave->QueueAudio(
                    reinterpret_cast<const uint8*>(CommercialSpeechSamples.GetData()),
                    CommercialSpeechSamples.Num() * static_cast<int32>(sizeof(int16)));
                CommercialSpeechCursor = CommercialSpeechSamples.Num();
            }
        }
        SpeechWave = TStrongObjectPtr<USoundWaveProcedural>(Wave);

        UAudioComponent* Audio = NewObject<UAudioComponent>(StudioWorld->GetWorldSettings());
        Audio->bAutoActivate = false;
        Audio->bAutoDestroy = false;
        Audio->bAllowSpatialization = false;
        Audio->SetSound(Wave);
        Audio->RegisterComponentWithWorld(StudioWorld.Get());
        SpeechComponent = TStrongObjectPtr<UAudioComponent>(Audio);

        StudioWorld->GetTimerManager().SetTimer(
            CommercialFaceTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::UpdateCommercialFace),
            1.0f / 60.0f,
            true,
            0.0f);
        bCommercialSpeechActive = true;

        // Prime one inference chunk immediately, then maintain exact realtime
        // cadence. Audio begins after a short visual pre-roll so the first
        // phoneme is not displayed on a neutral face.
        FeedCommercialSolverChunk();
        StudioWorld->GetTimerManager().SetTimer(
            CommercialSolverTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::FeedCommercialSolverChunk),
            0.04f,
            true,
            0.04f);
        StudioWorld->GetTimerManager().SetTimer(
            CommercialAudioStartTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::BeginCommercialAudioPlayback),
            0.12f,
            false);
        StudioWorld->GetTimerManager().SetTimer(
            CommercialSpeechEndTimer,
            FTimerDelegate::CreateRaw(this, &FConclaviaStudioModule::FinishCommercialSpeech),
            static_cast<float>(SpeechDurationMs + 620) / 1000.0f,
            false);
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Commercial speech started: durationMs=%d model=FullFaceWithMood chunkSamples=640 sampleRate=16000"),
            SpeechDurationMs);
    }

    bool PrepareCommercialSpeech(TArray<uint8> PcmBytes)
    {
        StopCommercialPlayback();
        if (!bCommercialFaceReady)
        {
            bCommercialFaceReady = ConfigureCommercialFace();
        }
        if (!bCommercialFaceReady
            || !bCommercialModelReady
            || !CommercialGenerator.IsValid()
            || !StudioWorld.IsValid())
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Commercial speech rejected after accept: renderer not ready"));
            return false;
        }

        const int32 OriginalSampleCount = PcmBytes.Num() / static_cast<int32>(sizeof(int16));
        const int32 SpeechDurationMs = FMath::RoundToInt(
            static_cast<double>(OriginalSampleCount) * 1000.0 / 16000.0);
        ActivePerformanceBeats = PendingPerformanceBeats;
        PendingPerformanceBeats.Reset();
        NextPerformanceBeatIndex = 0;
        AppliedPerformanceBeatCount = 0;
        if (ActivePerformanceBeats.IsEmpty())
        {
            SetCommercialMood(
                ERealisticMetaHumanLipSyncMood::Confidence,
                TEXT("confidence"),
                0.48f);
            ActivePerformanceFocus = TEXT("camera");
            ActivePerformanceGesture = TEXT("none");
        }
        else if (ActivePerformanceBeats[0].AtMs == 0)
        {
            const FPerformanceBeat& FirstBeat = ActivePerformanceBeats[0];
            SetCommercialMood(FirstBeat.Mood, FirstBeat.MoodName, FirstBeat.Intensity);
            ActivePerformanceFocus = FirstBeat.Focus;
            ActivePerformanceGesture = FirstBeat.Gesture;
            if (FirstBeat.Gesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase)
                || FirstBeat.Gesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase))
            {
                StartBodyGesture(FirstBeat.Gesture);
            }
            NextPerformanceBeatIndex = 1;
            AppliedPerformanceBeatCount = 1;
        }
        {
            FScopeLock Lock(&CommercialSpeechMutex);
            CommercialSpeechSamples.SetNumUninitialized(OriginalSampleCount + 4000);
            FMemory::Memcpy(
                CommercialSpeechSamples.GetData(),
                PcmBytes.GetData(),
                PcmBytes.Num());
            FMemory::Memzero(
                CommercialSpeechSamples.GetData() + OriginalSampleCount,
                4000 * sizeof(int16));
            CommercialSpeechCursor = 0;
            CommercialSolverCursor = 0;
            CommercialSolverChunksSubmitted = 0;
        }

        StartCommercialPlayback(SpeechDurationMs);
        return bCommercialSpeechActive;
    }

    void InitializeDirectAudioSource()
    {
        if (bOfficialAudioSubjectReady)
        {
            return;
        }
        // Conclavia loads at the default phase; force the runtime Live Link
        // module to register its modular client instead of depending on plugin
        // load order (which differs between editor and -game runs).
        ILiveLinkModule::Get();
        if (!IModularFeatures::Get().IsModularFeatureAvailable(ILiveLinkClient::ModularFeatureName))
        {
            return;
        }
        LiveLinkClient = &IModularFeatures::Get().GetModularFeature<ILiveLinkClient>(ILiveLinkClient::ModularFeatureName);

        TArray<FMetaHumanLiveLinkAudioDevice> Devices;
        UMetaHumanLocalLiveLinkSourceBlueprint::GetAudioDevices(Devices, false);
        const FMetaHumanLiveLinkAudioDevice* CableDevice = Devices.FindByPredicate(
            [](const FMetaHumanLiveLinkAudioDevice& Device)
            {
                return Device.Name.Contains(TEXT("CABLE Output"), ESearchCase::IgnoreCase);
            });
        if (!CableDevice)
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Official MetaHuman Audio: VB-Cable capture device is not ready"));
            return;
        }

        bool bTimedOut = false;
        TArray<FMetaHumanLiveLinkAudioTrack> Tracks;
        UMetaHumanLocalLiveLinkSourceBlueprint::GetAudioTracks(*CableDevice, Tracks, bTimedOut, 4.0f);
        if (bTimedOut || Tracks.IsEmpty())
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Official MetaHuman Audio: no live track from %s"), *CableDevice->Name);
            return;
        }

        TArray<FMetaHumanLiveLinkAudioFormat> Formats;
        UMetaHumanLocalLiveLinkSourceBlueprint::GetAudioFormats(Tracks[0], Formats, bTimedOut, 4.0f);
        const FMetaHumanLiveLinkAudioFormat* Format = Formats.FindByPredicate(
            [](const FMetaHumanLiveLinkAudioFormat& Candidate)
            {
                return Candidate.SampleRate == 48000 && Candidate.NumChannels == 1;
            });
        if (!Format)
        {
            Format = Formats.FindByPredicate(
                [](const FMetaHumanLiveLinkAudioFormat& Candidate)
                {
                    return Candidate.SampleRate == 48000;
                });
        }
        if (bTimedOut || !Format)
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Official MetaHuman Audio: 48 kHz format is unavailable"));
            return;
        }

        bool bSucceeded = false;
        UMetaHumanLocalLiveLinkSourceBlueprint::CreateAudioSource(OfficialAudioSource, bSucceeded);
        if (!bSucceeded)
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Official MetaHuman Audio: source creation failed"));
            return;
        }
        UMetaHumanLocalLiveLinkSourceBlueprint::CreateAudioSubject(
            OfficialAudioSource,
            *Format,
            TEXT("ConclaviaVoice"),
            OfficialAudioSubject,
            bSucceeded,
            8.0f,
            0.15f,
            8.0f);
        bOfficialAudioSubjectReady = bSucceeded;
        if (bSucceeded)
        {
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Official MetaHuman Audio subject: READY device=%s format=%s"),
                *CableDevice->Name,
                *Format->Name);
        }
        else
        {
            UE_LOG(
                LogConclaviaStudio,
                Warning,
                TEXT("Official MetaHuman Audio subject: FAILED device=%s format=%s"),
                *CableDevice->Name,
                *Format->Name);
        }
        if (bSucceeded && StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(AudioSourceRetryTimer);
            // Stage discovery can finish before the asynchronous MetaHuman
            // audio source has published its subject. LiveLinkSetup resolves
            // the subject when it is called; bind again now that the subject
            // is guaranteed to exist instead of leaving ABP_Face attached to
            // the empty startup state.
            if (ActiveFaceIndex >= 0)
            {
                SelectLiveLinkSpeaker(ActiveFaceIndex);
                UE_LOG(
                    LogConclaviaStudio,
                    Display,
                    TEXT("Live Link speaker rebound after audio subject became ready: seat=%d"),
                    ActiveFaceIndex + 1);
            }
        }
    }

    void SelectLiveLinkSpeaker(const int32 SpeakerIndex)
    {
        for (int32 Index = 0; Index < ParticipantFaces.Num(); ++Index)
        {
            FParticipantFaceState& State = ParticipantFaces[Index];
            AActor* Actor = State.Actor.Get();
            if (!Actor)
            {
                continue;
            }
            const bool bIsActiveSpeaker = Index == SpeakerIndex;
            // These are the public properties shown in the assembled
            // MetaHuman's Details > Live Link section. Changing either one can
            // rerun the generated construction script and replace Body/Face,
            // so never retain component pointers across these writes.
            if (FStructProperty* SubjectProperty = FindFProperty<FStructProperty>(
                    Actor->GetClass(), TEXT("LiveLinkSubject")))
            {
                FLiveLinkSubjectName* Subject =
                    SubjectProperty->ContainerPtrToValuePtr<FLiveLinkSubjectName>(Actor);
                *Subject = FLiveLinkSubjectName(TEXT("ConclaviaVoice"));
            }
            if (FBoolProperty* UseProperty = FindFProperty<FBoolProperty>(
                    Actor->GetClass(), TEXT("UseLiveLink")))
            {
                UseProperty->SetPropertyValue_InContainer(Actor, bIsActiveSpeaker);
            }

            RefreshMetaHumanComponents(State);
            USkeletalMeshComponent* Body = State.Body.Get();
            USkeletalMeshComponent* Face = State.Face.Get();
            UFunction* Setup = Actor->FindFunction(TEXT("LiveLinkSetup"));
            if (!Setup || !Body || !Face)
            {
                continue;
            }
            uint8* Params = static_cast<uint8*>(FMemory_Alloca(Setup->ParmsSize));
            FMemory::Memzero(Params, Setup->ParmsSize);
            for (TFieldIterator<FProperty> Property(Setup); Property && Property->HasAnyPropertyFlags(CPF_Parm); ++Property)
            {
                FString Name = Property->GetName().ToLower();
                Name.ReplaceInline(TEXT("_"), TEXT(""));
                if (Name == TEXT("skeletalmesh"))
                {
                    // The generated MetaHuman Blueprint routes the subject
                    // from ABP_MH_LiveLink on Body into ABP_Face. Passing Face
                    // bypasses that assembly graph and leaves the visible rig
                    // at its neutral pose.
                    CastFieldChecked<FObjectPropertyBase>(*Property)->SetObjectPropertyValue_InContainer(Params, Body);
                }
                else if (Name == TEXT("subjectname"))
                {
                    if (FStructProperty* StructProperty = CastField<FStructProperty>(*Property))
                    {
                        FLiveLinkSubjectName* SubjectName = StructProperty->ContainerPtrToValuePtr<FLiveLinkSubjectName>(Params);
                        *SubjectName = FLiveLinkSubjectName(TEXT("ConclaviaVoice"));
                    }
                }
                else if (Name == TEXT("retargetasset"))
                {
                    // MetaHuman Audio already emits RigLogic control names.
                    // A generic remap class makes the Live Link graph treat
                    // them as external-skeleton data and suppresses the face.
                    CastFieldChecked<FClassProperty>(*Property)
                        ->SetPropertyValue_InContainer(Params, nullptr);
                }
                else if (Name == TEXT("uselivelink"))
                {
                    CastFieldChecked<FBoolProperty>(*Property)->SetPropertyValue_InContainer(Params, bIsActiveSpeaker);
                }
            }
            Actor->ProcessEvent(Setup, Params);

            // LiveLinkSetup is a generated Blueprint function and is allowed
            // to reconstruct the assembled character. Reacquire the live
            // components before changing their animation mode or auditing
            // their instances; the old pointers are named TRASH_*.
            RefreshMetaHumanComponents(State);
            Body = State.Body.Get();
            Face = State.Face.Get();
            if (!Body || !Face)
            {
                continue;
            }
            if (bIsActiveSpeaker)
            {
                // LiveLinkSetup assigns LiveLinkInstance as Body's animation
                // class, but an earlier PlayAnimation call can leave the mode
                // on AnimationSingleNode. Explicitly re-enter Blueprint mode
                // so the class and ConclaviaVoice subject actually tick.
                UClass* LiveLinkAnimClass = Body->GetAnimClass();
                if (!LiveLinkAnimClass
                    || !LiveLinkAnimClass->GetPathName().Contains(
                        TEXT("LiveLink"), ESearchCase::IgnoreCase))
                {
                    LiveLinkAnimClass = LoadClass<UAnimInstance>(
                        nullptr,
                        TEXT("/Script/LiveLinkAnimationCore.LiveLinkInstance"));
                }
                Body->SetAnimationMode(EAnimationMode::AnimationBlueprint);
                Body->SetAnimInstanceClass(LiveLinkAnimClass);
                Body->SetComponentTickEnabled(true);
                Body->VisibilityBasedAnimTickOption =
                    EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
                Body->InitAnim(true);
                Face->SetComponentTickEnabled(true);
                Face->VisibilityBasedAnimTickOption =
                    EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
            }
            if (Index == SpeakerIndex)
            {
                UE_LOG(
                    LogConclaviaStudio,
                    Display,
                    TEXT("Live Link speaker bound: seat=%d bodyMode=%d bodyClass=%s bodyAnim=%s faceAnim=%s subject=ConclaviaVoice"),
                    Index + 1,
                    static_cast<int32>(Body->GetAnimationMode()),
                    Body->GetAnimClass()
                        ? *Body->GetAnimClass()->GetPathName()
                        : TEXT("None"),
                    Body->GetAnimInstance()
                        ? *Body->GetAnimInstance()->GetClass()->GetPathName()
                        : TEXT("None"),
                    Face->GetAnimInstance()
                        ? *Face->GetAnimInstance()->GetClass()->GetPathName()
                        : TEXT("None"));
                if (UAnimInstance* FaceAnim = Face->GetAnimInstance())
                {
                    for (TFieldIterator<FProperty> Property(FaceAnim->GetClass()); Property; ++Property)
                    {
                        const FString PropertyName = Property->GetName();
                        if (!PropertyName.Contains(TEXT("Live"), ESearchCase::IgnoreCase)
                            && !PropertyName.Contains(TEXT("Subject"), ESearchCase::IgnoreCase)
                            && !PropertyName.Contains(TEXT("Audio"), ESearchCase::IgnoreCase))
                        {
                            continue;
                        }
                        FString Value;
                        Property->ExportText_InContainer(
                            0,
                            Value,
                            FaceAnim,
                            FaceAnim,
                            FaceAnim,
                            PPF_None);
                        UE_LOG(
                            LogConclaviaStudio,
                            Display,
                            TEXT("Face AnimBP property: %s type=%s value=%s"),
                            *PropertyName,
                            *Property->GetClass()->GetName(),
                            *Value);
                    }
                }
            }
        }
        ActiveFaceIndex = SpeakerIndex;
    }

    bool IsActiveFaceDrivenByLiveLink() const
    {
        if (!ParticipantFaces.IsValidIndex(ActiveFaceIndex))
        {
            return false;
        }
        const USkeletalMeshComponent* Body =
            ParticipantFaces[ActiveFaceIndex].Body.Get();
        if (!Body || Body->GetAnimationMode() != EAnimationMode::AnimationBlueprint)
        {
            return false;
        }
        const UAnimInstance* BodyAnim = Body->GetAnimInstance();
        if (!BodyAnim)
        {
            return false;
        }
        const FString AnimPath = BodyAnim->GetClass()->GetPathName();
        return AnimPath.Contains(TEXT("LiveLink"), ESearchCase::IgnoreCase);
    }

    void AuditLiveLinkFrame()
    {
        if (!LiveLinkClient || !bOfficialAudioSubjectReady)
        {
            return;
        }
        const TSubclassOf<ULiveLinkRole> ActualRole =
            LiveLinkClient->GetSubjectRole_AnyThread(OfficialAudioSubject);
        const bool bKeyValid = LiveLinkClient->IsSubjectValid(OfficialAudioSubject);
        const bool bSupportsAnimation = LiveLinkClient->DoesSubjectSupportsRole_AnyThread(
            OfficialAudioSubject,
            ULiveLinkAnimationRole::StaticClass());
        const bool bSupportsBasic = LiveLinkClient->DoesSubjectSupportsRole_AnyThread(
            OfficialAudioSubject,
            ULiveLinkBasicRole::StaticClass());
        FLiveLinkSubjectFrameData Frame;
        const bool bEvaluated = LiveLinkClient->EvaluateFrame_AnyThread(
            FLiveLinkSubjectName(TEXT("ConclaviaVoice")),
            ULiveLinkBasicRole::StaticClass(),
            Frame);
        int32 CurveCount = 0;
        float MaxCurve = 0.0f;
        FString MaxCurveName;
        float JawOpen = 0.0f;
        float MouthClose = 0.0f;
        float MaxMouthCurve = 0.0f;
        FString MaxMouthCurveName;
        TArray<FString> MouthCurves;
        if (bEvaluated)
        {
            const FLiveLinkBaseStaticData* StaticData =
                Frame.StaticData.Cast<FLiveLinkBaseStaticData>();
            const FLiveLinkBaseFrameData* AnimationData =
                Frame.FrameData.Cast<FLiveLinkBaseFrameData>();
            if (StaticData && AnimationData)
            {
                CurveCount = FMath::Min(
                    StaticData->PropertyNames.Num(),
                    AnimationData->PropertyValues.Num());
                for (int32 Index = 0; Index < CurveCount; ++Index)
                {
                    const FString CurveName = StaticData->PropertyNames[Index].ToString();
                    if (CurveName.Equals(TEXT("CTRL_expressions_jawOpen"), ESearchCase::IgnoreCase))
                    {
                        JawOpen = AnimationData->PropertyValues[Index];
                    }
                    if (CurveName.Equals(TEXT("CTRL_expressions_mouthClose"), ESearchCase::IgnoreCase))
                    {
                        MouthClose = AnimationData->PropertyValues[Index];
                    }
                    if (CurveName.Contains(TEXT("jaw"), ESearchCase::IgnoreCase) ||
                        CurveName.Contains(TEXT("mouth"), ESearchCase::IgnoreCase) ||
                        CurveName.Contains(TEXT("lip"), ESearchCase::IgnoreCase))
                    {
                        const float MouthMagnitude = FMath::Abs(AnimationData->PropertyValues[Index]);
                        if (MouthMagnitude > MaxMouthCurve)
                        {
                            MaxMouthCurve = MouthMagnitude;
                            MaxMouthCurveName = CurveName;
                        }
                        MouthCurves.Add(FString::Printf(
                            TEXT("%s=%.4f"),
                            *CurveName,
                            AnimationData->PropertyValues[Index]));
                    }
                    const float Magnitude = FMath::Abs(AnimationData->PropertyValues[Index]);
                    if (Magnitude > MaxCurve)
                    {
                        MaxCurve = Magnitude;
                        MaxCurveName = StaticData->PropertyNames[Index].ToString();
                    }
                }
            }
        }
        LastLiveLinkCurveCount = CurveCount;
        LastLiveLinkMaxCurve = MaxCurve;
        LastLiveLinkMaxCurveName = MaxCurveName;
        UE_LOG(
            LogConclaviaStudio,
            Display,
            TEXT("Live Link audit: keyValid=%s role=%s supportsBasic=%s supportsAnimation=%s evaluated=%s curves=%d jawOpen=%.4f mouthClose=%.4f mouthMax=%s:%.4f max=%s:%.4f activeSeat=%d"),
            bKeyValid ? TEXT("true") : TEXT("false"),
            ActualRole ? *ActualRole->GetPathName() : TEXT("None"),
            bSupportsBasic ? TEXT("true") : TEXT("false"),
            bSupportsAnimation ? TEXT("true") : TEXT("false"),
            bEvaluated ? TEXT("true") : TEXT("false"),
            CurveCount,
            JawOpen,
            MouthClose,
            *MaxMouthCurveName,
            MaxMouthCurve,
            *MaxCurveName,
            MaxCurve,
            ActiveFaceIndex + 1);
        static bool bLoggedMouthCurveNames = false;
        if (!bLoggedMouthCurveNames && !MouthCurves.IsEmpty())
        {
            bLoggedMouthCurveNames = true;
            UE_LOG(
                LogConclaviaStudio,
                Display,
                TEXT("Live Link mouth curve map: %s"),
                *FString::Join(MouthCurves, TEXT(", ")));
        }
    }

    void UpdateFacialLife()
    {
        const double Now = FPlatformTime::Seconds();
        for (int32 Index = 0; Index < ParticipantFaces.Num(); ++Index)
        {
            FParticipantFaceState& State = ParticipantFaces[Index];
            USkeletalMeshComponent* Face = State.Face.Get();
            if (!Face)
            {
                continue;
            }

            // Audio Live Link owns the active speaker's face. Writing our
            // listener blink curves on the same frame can fight the solver
            // and produce the characteristic eyelid/lip flicker.
            if (Index == ActiveFaceIndex)
            {
                if (State.bBlinking)
                {
                    SetBlinkWeight(Face, 0.0f);
                    State.bBlinking = false;
                }
                State.NextBlinkAt = Now + 2.4;
                continue;
            }

            if (!State.bBlinking && Now >= State.NextBlinkAt)
            {
                State.bBlinking = true;
                State.BlinkStartedAt = Now;
            }

            if (!State.bBlinking)
            {
                continue;
            }

            constexpr double BlinkDuration = 0.19;
            const double Phase = (Now - State.BlinkStartedAt) / BlinkDuration;
            if (Phase >= 1.0)
            {
                SetBlinkWeight(Face, 0.0f);
                State.bBlinking = false;
                // A stable pseudo-random cadence per seat reads naturally and
                // never introduces a frame-dependent source of test flakiness.
                const double Cadence =
                    2.65 + FMath::Fmod((Index + 1) * 1.731 + Now * 0.173, 3.35);
                State.NextBlinkAt = Now + Cadence;
                continue;
            }

            const float Weight = static_cast<float>(
                FMath::Sin(FMath::Clamp(Phase, 0.0, 1.0) * PI));
            SetBlinkWeight(Face, Weight);
        }
    }

    void BuildBroadcastOverlay()
    {
        if (!GEngine || !GEngine->GameViewport || BroadcastOverlay.IsValid())
        {
            return;
        }

        const FSlateFontInfo BrandFont = FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 19);
        const FSlateFontInfo LiveFont = FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 13);
        const FSlateFontInfo NameFont = FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 20);
        const FSlateFontInfo MetaFont = FCoreStyle::GetDefaultFontStyle(TEXT("Regular"), 11);
        const FSlateFontInfo IntentFont = FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), 10);

        TSharedRef<SWidget> Brand =
            SNew(SBorder)
            .Padding(FMargin(18.0f, 10.0f))
            .BorderBackgroundColor(FLinearColor(0.015f, 0.035f, 0.065f, 0.88f))
            [
                SNew(STextBlock)
                .Font(BrandFont)
                .ColorAndOpacity(FLinearColor(0.94f, 0.98f, 1.0f, 1.0f))
                .Text(FText::FromString(TEXT("•  C O N C L A V I A")))
            ];

        TSharedRef<SWidget> LiveBadge =
            SNew(SBorder)
            .Padding(FMargin(15.0f, 8.0f))
            .BorderBackgroundColor(FLinearColor(0.72f, 0.015f, 0.035f, 0.95f))
            [
                SNew(STextBlock)
                .Font(LiveFont)
                .ColorAndOpacity(FLinearColor::White)
                .Text(FText::FromString(TEXT("●  IN ONDA")))
            ];

        TSharedRef<SWidget> LowerThird =
            SAssignNew(LowerThirdContainer, SBorder)
            .Visibility(EVisibility::Collapsed)
            .Padding(FMargin(14.0f, 9.0f))
            .BorderBackgroundColor(FLinearColor(0.015f, 0.025f, 0.05f, 0.84f))
            [
                SNew(SVerticalBox)
                + SVerticalBox::Slot().AutoHeight()
                [
                    SAssignNew(IntentText, STextBlock)
                    .Font(IntentFont)
                    .ColorAndOpacity(FLinearColor(0.10f, 0.82f, 0.94f, 1.0f))
                ]
                + SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
                [
                    SAssignNew(SpeakerText, STextBlock)
                    .Font(NameFont)
                    .ColorAndOpacity(FLinearColor::White)
                ]
                + SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
                [
                    SAssignNew(TargetText, STextBlock)
                    .Font(MetaFont)
                    .ColorAndOpacity(FLinearColor(0.68f, 0.75f, 0.84f, 1.0f))
                ]
            ];

        SAssignNew(BroadcastOverlay, SOverlay)
        + SOverlay::Slot()
          .HAlign(HAlign_Left)
          .VAlign(VAlign_Top)
          .Padding(FMargin(30.0f, 26.0f, 0.0f, 0.0f))
          [ Brand ]
        + SOverlay::Slot()
          .HAlign(HAlign_Right)
          .VAlign(VAlign_Top)
          .Padding(FMargin(0.0f, 26.0f, 30.0f, 0.0f))
          [ LiveBadge ]
        + SOverlay::Slot()
          .HAlign(HAlign_Left)
          .VAlign(VAlign_Bottom)
          .Padding(FMargin(28.0f, 0.0f, 0.0f, 28.0f))
          [
              SNew(SBox)
              .WidthOverride(340.0f)
              [ LowerThird ]
          ];

        GEngine->GameViewport->AddViewportWidgetContent(BroadcastOverlay.ToSharedRef(), 100);
    }

    void ShowLowerThird(
        const FString& SpeakerId,
        const FString& TargetId,
        const FString& SpeakerName,
        const FString& TargetName,
        const FString& Intent)
    {
        if (!LowerThirdContainer.IsValid())
        {
            return;
        }

        const FString ResolvedSpeaker =
            SpeakerName.IsEmpty() ? ConclaviaStudio::OnAirName(SpeakerId) : SpeakerName;
        const FString ResolvedTarget =
            TargetName.IsEmpty() && !TargetId.IsEmpty()
                ? ConclaviaStudio::OnAirName(TargetId)
                : TargetName;

        IntentText->SetText(FText::FromString(ConclaviaStudio::IntentLabel(Intent)));
        SpeakerText->SetText(FText::FromString(ResolvedSpeaker));
        TargetText->SetText(FText::FromString(
            ResolvedTarget.IsEmpty()
                ? TEXT("Ospite virtuale")
                : FString::Printf(TEXT("→ %s"), *ResolvedTarget)));
        LowerThirdContainer->SetVisibility(EVisibility::Visible);

        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(LowerThirdTimer);
            StudioWorld->GetTimerManager().SetTimer(
                LowerThirdTimer,
                FTimerDelegate::CreateLambda([this]()
                {
                    if (LowerThirdContainer.IsValid())
                    {
                        LowerThirdContainer->SetVisibility(EVisibility::Collapsed);
                    }
                }),
                3.1f,
                false);
        }
    }

    FName CameraForCue(const FString& SpeakerId, const FString& TargetId, const FString& Shot) const
    {
        if (bLipSyncLab)
        {
            return TEXT("CAM_Seat_1_Close");
        }
        const int32 Speaker = ConclaviaStudio::SeatIndexFromId(SpeakerId);
        const int32 Target = ConclaviaStudio::SeatIndexFromId(TargetId);

        if (Shot.Contains(TEXT("detail"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("desk"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("insert"), ESearchCase::IgnoreCase))
        {
            // Keep the procedural console as set dressing, but never promote
            // it to an automatic broadcast insert. Until a production prop is
            // available, a human reaction close-up is the stronger and safer
            // editorial detail.
            return FName(*FString::Printf(TEXT("CAM_Seat_%d_Close"), Speaker + 1));
        }
        if (Shot.Contains(TEXT("close"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("first"), ESearchCase::IgnoreCase))
        {
            return FName(*FString::Printf(TEXT("CAM_Seat_%d_Close"), Speaker + 1));
        }
        if (Shot.Contains(TEXT("profile"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("side"), ESearchCase::IgnoreCase))
        {
            return Speaker < 3 ? TEXT("CAM_Wide_Slider_Left") : TEXT("CAM_Wide_Slider_Right");
        }
        if (Shot.Contains(TEXT("two"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("confront"), ESearchCase::IgnoreCase))
        {
            const int32 FirstSeat = FMath::Min(Speaker, Target);
            const int32 SecondSeat = FMath::Max(Speaker, Target);
            if (SecondSeat - FirstSeat == 1)
            {
                return FName(*FString::Printf(
                    TEXT("CAM_TwoShot_%d_%d"),
                    FirstSeat + 1,
                    SecondSeat + 1));
            }
            return Speaker < 3 ? TEXT("CAM_Wide_Slider_Left") : TEXT("CAM_Wide_Slider_Right");
        }
        if (Shot.Contains(TEXT("dolly"), ESearchCase::IgnoreCase) ||
            Shot.Contains(TEXT("push"), ESearchCase::IgnoreCase))
        {
            return Speaker < 3 ? TEXT("CAM_Wide_Slider_Left") : TEXT("CAM_Wide_Slider_Right");
        }
        return TEXT("CAM_Wide_Master");
    }

    void SwitchCamera(const FName CameraName, float BlendSeconds, bool bForce)
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }

        const TWeakObjectPtr<ACameraActor>* Camera = Cameras.Find(CameraName);
        if (!Camera || !Camera->IsValid())
        {
            UE_LOG(LogConclaviaStudio, Warning, TEXT("Unknown camera cue: %s"), *CameraName.ToString());
            return;
        }

        const double Now = FPlatformTime::Seconds();
        if (!bForce && CameraName == ActiveCamera && Now - LastCameraCutAt < 0.55)
        {
            return;
        }

        if (APlayerController* Controller = StudioWorld->GetFirstPlayerController())
        {
            Controller->bAutoManageActiveCameraTarget = false;
            // Pixel Streaming must receive the selected broadcast camera on
            // the same frame as the director cue. Editor-hosted game worlds
            // can keep the outgoing target during a blend, leaving the stream
            // visually stuck on the master shot. A clean vision cut is both
            // deterministic and closer to a live multicamera production.
            Controller->SetViewTarget(Camera->Get());
            ActiveCamera = CameraName;
            LastCameraCutAt = Now;
            ConfigureCommercialEyesAimForFace();
        }
    }

    void ClearCameraSequence()
    {
        if (!StudioWorld.IsValid())
        {
            return;
        }
        StudioWorld->GetTimerManager().ClearTimer(CameraOpeningTimer);
        StudioWorld->GetTimerManager().ClearTimer(CameraContextTimer);
        StudioWorld->GetTimerManager().ClearTimer(CameraHandoffTimer);
    }

    void ApplyCameraCue(
        const FString& SpeakerId,
        const FString& TargetId,
        const FString& Shot,
        float ExpectedDurationSeconds)
    {
        if (!bStageReady)
        {
            return;
        }

        ClearCameraSequence();
        if (bLipSyncLab)
        {
            // Keep ordinary listening and speech on the stable portrait, but
            // reveal the complete solver-authored arm when Mary requests the
            // floor. The old unconditional close-up made a healthy hand-raise
            // animation invisible while telemetry incorrectly looked green.
            // Reuse the authored studio slider instead of moving a camera or
            // a body bone procedurally at runtime.
            const bool bNeedsGestureFraming =
                Shot.Contains(TEXT("wide"), ESearchCase::IgnoreCase)
                && (ActiveBodyGesture == TEXT("raise-hand")
                    || BodyGesturePhase == TEXT("raising")
                    || BodyGesturePhase == TEXT("held"));
            SwitchCamera(
                bNeedsGestureFraming
                    ? TEXT("CAM_Wide_Slider_Left")
                    : TEXT("CAM_Seat_1_Close"),
                0.0f,
                true);
            return;
        }
        const FName RequestedCamera = CameraForCue(SpeakerId, TargetId, Shot);
        const int32 Speaker = ConclaviaStudio::SeatIndexFromId(SpeakerId);
        const int32 Target = ConclaviaStudio::SeatIndexFromId(TargetId);
        const bool bHasDirectTarget =
            !TargetId.IsEmpty() && SpeakerId != TargetId && Speaker != Target;
        const float Duration = FMath::Clamp(ExpectedDurationSeconds, 2.0f, 60.0f);
        const FName ContextCamera =
            Speaker < 3 ? TEXT("CAM_Wide_Slider_Left") : TEXT("CAM_Wide_Slider_Right");
        const FName HandoffCamera = bHasDirectTarget
            ? CameraForCue(SpeakerId, TargetId, TEXT("two-shot"))
            : TEXT("CAM_Wide_Master");

        // A direct answer first establishes both people, then moves to the
        // speaker. Very short replies remain in the two-shot so the edit never
        // feels more important than the sentence.
        if (bHasDirectTarget)
        {
            SwitchCamera(HandoffCamera, 0.30f, false);
            if (Duration >= 5.5f)
            {
                StudioWorld->GetTimerManager().SetTimer(
                    CameraOpeningTimer,
                    FTimerDelegate::CreateLambda([this, RequestedCamera]()
                    {
                        SwitchCamera(RequestedCamera, 0.26f, false);
                    }),
                    1.15f,
                    false);
            }
        }
        else
        {
            const float BlendSeconds =
                RequestedCamera == TEXT("CAM_Wide_Master") ? 0.42f :
                RequestedCamera.ToString().Contains(TEXT("Close")) ? 0.24f : 0.32f;
            SwitchCamera(RequestedCamera, BlendSeconds, false);
        }

        // Long answers get one motivated contextual breath. This is bounded to
        // a single cutaway and never fires close to the handoff.
        if (Duration >= 13.0f)
        {
            const float ContextAt = FMath::Min(Duration * 0.66f, Duration - 3.0f);
            StudioWorld->GetTimerManager().SetTimer(
                CameraContextTimer,
                FTimerDelegate::CreateLambda([this, ContextCamera]()
                {
                    SwitchCamera(ContextCamera, 0.38f, false);
                }),
                ContextAt,
                false);
        }

        // Prepare the next exchange instead of ending on an isolated talking
        // head. The next cue cancels this timer if speech ends early.
        if (Duration >= 6.0f)
        {
            StudioWorld->GetTimerManager().SetTimer(
                CameraHandoffTimer,
                FTimerDelegate::CreateLambda([this, HandoffCamera]()
                {
                    SwitchCamera(HandoffCamera, 0.34f, false);
                }),
                Duration - 0.8f,
                false);
        }
    }

    bool HandleHealth(const FHttpServerRequest&, const FHttpResultCallback& OnComplete) const
    {
        const bool bAudioSubjectValid = LiveLinkClient && LiveLinkClient->IsSubjectValid(
            FLiveLinkSubjectName(TEXT("ConclaviaVoice")));
        const bool bFaceDrivenByLiveLink = IsActiveFaceDrivenByLiveLink();
        const bool bFaceDriverReady = bLipSyncLab
            ? bCommercialFaceReady
                && bCommercialModelReady
                && bCommercialModelRouteReady
            : bFaceDrivenByLiveLink;
        FString BodyAnimClass = TEXT("");
        FString BodyAnimInstance = TEXT("");
        int32 BodyAnimationMode = -1;
        if (ParticipantFaces.IsValidIndex(ActiveFaceIndex))
        {
            if (USkeletalMeshComponent* ActiveBody =
                    ParticipantFaces[ActiveFaceIndex].Body.Get())
            {
                BodyAnimationMode = static_cast<int32>(ActiveBody->GetAnimationMode());
                if (ActiveBody->GetAnimClass())
                {
                    BodyAnimClass = ActiveBody->GetAnimClass()->GetPathName();
                }
                if (ActiveBody->GetAnimInstance())
                {
                    BodyAnimInstance = ActiveBody->GetAnimInstance()->GetClass()->GetPathName();
                }
            }
        }
        const FString RuntimeRevision = bLipSyncLab
            ? TEXT("ue58-commercial-lipsync-v14-attentive-idle")
            : TEXT("commercial-lipsync-v9");
        const FString EngineVersion = FEngineVersion::Current().ToString();
        const FString CameraPackage = bLipSyncLab
            ? TEXT("premium-studio-58")
            : TEXT("production-studio-58");
        const int32 CastCount = bLipSyncLab ? 1 : ParticipantFaces.Num();
        FString Body = FString::Printf(
            TEXT("{\"ok\":true,\"service\":\"conclavia-studio\",\"runtimeRevision\":\"%s\",\"engineVersion\":\"%s\",\"profile\":\"%s\",\"avatarId\":\"%s\",\"stageReady\":%s,\"cameraCount\":%d,\"cameraPackage\":\"%s\",\"castCount\":%d,\"activeCamera\":\"%s\",\"lastCueAt\":\"%s\",\"audioSubjectReady\":%s,\"audioSubjectValid\":%s,\"faceDrivenByLiveLink\":%s,\"commercialLipSyncReady\":%s,\"commercialModelReady\":%s,\"commercialModelRouteReady\":%s,\"commercialGeneratorBound\":%s,\"commercialControlsBound\":%s,\"commercialSpeechActive\":%s,\"commercialControlCount\":%d,\"commercialMaxControl\":%.6f,\"commercialMaxMouthControl\":%.6f,\"commercialMaxMouthControlName\":\"%s\",\"commercialJawInput\":%.6f,\"commercialJawCurve\":%.6f,\"commercialBoundNodeCount\":%d,\"commercialSolverChunksSubmitted\":%d,\"commercialSolverCursor\":%d,\"bodyAnimationMode\":%d,\"bodyAnimClass\":\"%s\",\"bodyAnimInstance\":\"%s\",\"pcmBytesReceived\":%lld,\"activeFaceIndex\":%d}"),
            *RuntimeRevision.ReplaceCharWithEscapedChar(),
            *EngineVersion.ReplaceCharWithEscapedChar(),
            *StudioProfile.ReplaceCharWithEscapedChar(),
            *AvatarId.ReplaceCharWithEscapedChar(),
            bStageReady ? TEXT("true") : TEXT("false"),
            Cameras.Num(),
            *CameraPackage.ReplaceCharWithEscapedChar(),
            CastCount,
            *ActiveCamera.ToString().ReplaceCharWithEscapedChar(),
            *LastCueAt.ToIso8601(),
            bOfficialAudioSubjectReady ? TEXT("true") : TEXT("false"),
            bAudioSubjectValid ? TEXT("true") : TEXT("false"),
            bFaceDriverReady ? TEXT("true") : TEXT("false"),
            bFaceDriverReady ? TEXT("true") : TEXT("false"),
            bCommercialModelReady ? TEXT("true") : TEXT("false"),
            bCommercialModelRouteReady ? TEXT("true") : TEXT("false"),
            bCommercialGeneratorBound ? TEXT("true") : TEXT("false"),
            bCommercialControlsBound ? TEXT("true") : TEXT("false"),
            bCommercialSpeechActive ? TEXT("true") : TEXT("false"),
            LastCommercialControlCount,
            LastCommercialMaxControl,
            LastCommercialMaxMouthControl,
            *LastCommercialMaxMouthControlName.ReplaceCharWithEscapedChar(),
            LastCommercialJawInput,
            LastCommercialJawCurve,
            LastCommercialBoundNodeCount,
            CommercialSolverChunksSubmitted,
            CommercialSolverCursor,
            BodyAnimationMode,
            *BodyAnimClass.ReplaceCharWithEscapedChar(),
            *BodyAnimInstance.ReplaceCharWithEscapedChar(),
            PcmBytesReceived,
            ActiveFaceIndex);
        Body.RemoveFromEnd(TEXT("}"));
        Body += FString::Printf(
            TEXT(",\"commercialModel\":\"mood-full-face\",\"commercialMood\":\"%s\",\"commercialMoodIntensity\":%.3f,\"commercialLookaheadMs\":40,\"commercialMaxUpperFaceControl\":%.6f,\"commercialMaxUpperFaceControlName\":\"%s\",\"commercialSpeechPeakMouthControl\":%.6f,\"commercialSpeechPeakMouthControlName\":\"%s\",\"commercialSpeechPeakUpperFaceControl\":%.6f,\"commercialSpeechPeakUpperFaceControlName\":\"%s\",\"commercialLastSpeechPeakMouthControl\":%.6f,\"commercialLastSpeechPeakMouthControlName\":\"%s\",\"commercialLastSpeechPeakUpperFaceControl\":%.6f,\"commercialLastSpeechPeakUpperFaceControlName\":\"%s\",\"commercialLastSpeechSolverChunks\":%d,\"commercialLastSpeechSolverCursor\":%d,\"commercialCompletedSpeechCount\":%d,\"performancePlanReady\":%s,\"performanceBeatCount\":%d,\"performanceSolverBeatIndex\":%d,\"performanceMood\":\"%s\",\"performanceTargetIntensity\":%.3f,\"performanceFocus\":\"%s\",\"performanceGesture\":\"%s\",\"performanceAppliedBeatCount\":%d,\"bodyGesture\":\"%s\",\"bodyGestureAlpha\":%.3f,\"bodyGesturePhase\":\"%s\",\"physicalGestureReady\":%s,\"physicalGestureDriver\":\"%s\",\"bodyIdleDriver\":\"ue58-metahuman-authored-attentive-loop\",\"bodyIdlePlayRate\":0.58,\"listeningReactionActive\":%s,\"listeningModelReady\":%s,\"listeningSolverChunks\":%d,\"naturalGazeEnabled\":%s,\"naturalGazeDriver\":\"runtime-metahuman-eyes-aim\"}"),
            *ActiveMoodName.ReplaceCharWithEscapedChar(),
            ActiveMoodIntensity,
            LastCommercialMaxUpperFaceControl,
            *LastCommercialMaxUpperFaceControlName.ReplaceCharWithEscapedChar(),
            CommercialSpeechPeakMouthControl,
            *CommercialSpeechPeakMouthControlName.ReplaceCharWithEscapedChar(),
            CommercialSpeechPeakUpperFaceControl,
            *CommercialSpeechPeakUpperFaceControlName.ReplaceCharWithEscapedChar(),
            LastCommercialSpeechPeakMouthControl,
            *LastCommercialSpeechPeakMouthControlName.ReplaceCharWithEscapedChar(),
            LastCommercialSpeechPeakUpperFaceControl,
            *LastCommercialSpeechPeakUpperFaceControlName.ReplaceCharWithEscapedChar(),
            LastCommercialSpeechSolverChunks,
            LastCommercialSpeechSolverCursor,
            CommercialCompletedSpeechCount,
            !ActivePerformanceBeats.IsEmpty() || !PendingPerformanceBeats.IsEmpty()
                ? TEXT("true")
                : TEXT("false"),
            ActivePerformanceBeats.IsEmpty()
                ? PendingPerformanceBeats.Num()
                : ActivePerformanceBeats.Num(),
            NextPerformanceBeatIndex,
            *ActiveMoodName.ReplaceCharWithEscapedChar(),
            PerformanceTargetIntensity,
            *ActivePerformanceFocus.ReplaceCharWithEscapedChar(),
            *ActivePerformanceGesture.ReplaceCharWithEscapedChar(),
            AppliedPerformanceBeatCount,
            *ActiveBodyGesture.ReplaceCharWithEscapedChar(),
            GetBodyGestureAlpha(),
            *BodyGesturePhase.ReplaceCharWithEscapedChar(),
            bPhysicalGestureReady ? TEXT("true") : TEXT("false"),
            bPhysicalGestureReady
                ? TEXT("ue58-metahuman-control-rig-backwards-solve-ik-bake")
                : TEXT("unavailable"),
            bListeningReactionActive ? TEXT("true") : TEXT("false"),
            bListeningModelReady ? TEXT("true") : TEXT("false"),
            ListeningSolverChunksSubmitted,
            bCommercialEyesAimBound ? TEXT("true") : TEXT("false"));
        OnComplete(ConclaviaStudio::JsonResponse(Body));
        return true;
    }

    bool HandleCue(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
    {
        const FUTF8ToTCHAR Converter(
            reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),
            Request.Body.Num());
        const FString Body(Converter.Length(), Converter.Get());
        TSharedPtr<FJsonObject> Json;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
        if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"invalid_json\"}"),
                EHttpServerResponseCodes::BadRequest));
            return true;
        }

        Json->TryGetStringField(TEXT("speakerId"), LastSpeakerId);
        Json->TryGetStringField(TEXT("targetId"), LastTargetId);
        Json->TryGetStringField(TEXT("shot"), LastShot);
        Json->TryGetStringField(TEXT("intent"), LastIntent);
        Json->TryGetStringField(TEXT("speakerName"), LastSpeakerName);
        Json->TryGetStringField(TEXT("targetName"), LastTargetName);
        FString BodyGesture;
        FString ListenerMoodName;
        double ListenerMoodIntensity = 0.0;
        Json->TryGetStringField(TEXT("bodyGesture"), BodyGesture);
        Json->TryGetStringField(TEXT("listenerMood"), ListenerMoodName);
        Json->TryGetNumberField(TEXT("listenerMoodIntensity"), ListenerMoodIntensity);
        TArray<FPerformanceBeat> ParsedPerformanceBeats;
        ParsePerformanceBeats(Json, ParsedPerformanceBeats);
        double ExpectedDurationMs = 8000.0;
        Json->TryGetNumberField(TEXT("expectedDurationMs"), ExpectedDurationMs);
        const float ExpectedDurationSeconds = static_cast<float>(
            FMath::Clamp(ExpectedDurationMs / 1000.0, 2.0, 60.0));
        LastCueAt = FDateTime::UtcNow();

        const FString CueSpeaker = LastSpeakerId;
        const FString CueTarget = LastTargetId;
        const FString CueShot = LastShot;
        const FString CueIntent = LastIntent;
        const FString CueSpeakerName = LastSpeakerName;
        const FString CueTargetName = LastTargetName;
        const FString CueBodyGesture = BodyGesture;
        const FString CueListenerMoodName = ListenerMoodName;
        const float CueListenerMoodIntensity = FMath::Clamp(
            static_cast<float>(ListenerMoodIntensity), 0.0f, 0.68f);
        const TArray<FPerformanceBeat> CuePerformanceBeats =
            MoveTemp(ParsedPerformanceBeats);
        AsyncTask(ENamedThreads::GameThread, [
            this,
            CueSpeaker,
            CueTarget,
            CueShot,
            CueIntent,
            CueSpeakerName,
            CueTargetName,
            CueBodyGesture,
            CueListenerMoodName,
            CueListenerMoodIntensity,
            CuePerformanceBeats,
            ExpectedDurationSeconds]()
        {
            if (CueIntent.Equals(TEXT("interrupt"), ESearchCase::IgnoreCase)
                || CueIntent.Equals(TEXT("stop-speaking"), ESearchCase::IgnoreCase))
            {
                StopCommercialPlayback();
                if (StudioWorld.IsValid())
                {
                    StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
                }
                PendingPerformanceBeats.Reset();
                ActivePerformanceBeats.Reset();
                StartBodyGesture(TEXT("lower-hand"));
                ActivePerformanceGesture = TEXT("none");
                bListeningReactionActive = false;
                bListeningVisualActive = false;
                SetCommercialMood(
                    ERealisticMetaHumanLipSyncMood::Neutral,
                    TEXT("neutral"),
                    0.0f);
                return;
            }
            PendingPerformanceBeats = CuePerformanceBeats;
            if (CueIntent.Equals(TEXT("listen-react"), ESearchCase::IgnoreCase))
            {
                ERealisticMetaHumanLipSyncMood ListeningMood;
                if (PerformanceMoodFromName(CueListenerMoodName, ListeningMood))
                {
                    StartListeningReaction(
                        ListeningMood,
                        CueListenerMoodName,
                        CueListenerMoodIntensity,
                        ExpectedDurationSeconds);
                }
            }
            if (CueBodyGesture.Equals(TEXT("raise-hand"), ESearchCase::IgnoreCase)
                || CueIntent.Equals(TEXT("request-to-speak"), ESearchCase::IgnoreCase))
            {
                StartBodyGesture(TEXT("raise-hand"));
            }
            else if (CueBodyGesture.Equals(TEXT("lower-hand"), ESearchCase::IgnoreCase)
                || CueIntent.Equals(TEXT("listen"), ESearchCase::IgnoreCase)
                || CueIntent.Equals(TEXT("answer"), ESearchCase::IgnoreCase))
            {
                StartBodyGesture(TEXT("lower-hand"));
            }
            // The lip-sync laboratory deliberately renders only seat 1. Talk
            // messages still retain their original participant indexes, so
            // following CueSpeaker here would animate a hidden actor and turn
            // Live Link off on the face under test.
            if (!bLipSyncLab)
            {
                SelectLiveLinkSpeaker(ConclaviaStudio::SeatIndexFromId(CueSpeaker));
            }
            ApplyCameraCue(
                CueSpeaker,
                CueTarget,
                CueShot,
                ExpectedDurationSeconds);
            ShowLowerThird(
                CueSpeaker,
                CueTarget,
                CueSpeakerName,
                CueTargetName,
                CueIntent);
        });

        OnComplete(ConclaviaStudio::JsonResponse(TEXT("{\"ok\":true,\"accepted\":true}")));
        return true;
    }

    bool HandlePcm(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
    {
        if (!PcmSource.IsValid() || Request.Body.Num() == 0 || Request.Body.Num() > 384000 || Request.Body.Num() % sizeof(float) != 0)
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"invalid_pcm\"}"),
                EHttpServerResponseCodes::BadRequest));
            return true;
        }
        PcmSource->Feed(Request.Body);
        PcmBytesReceived += Request.Body.Num();
        OnComplete(ConclaviaStudio::JsonResponse(TEXT("{\"ok\":true}")));
        return true;
    }

    bool HandleSpeech(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
    {
        if (!bLipSyncLab
            || Request.Body.Num() == 0
            || Request.Body.Num() > 4 * 1024 * 1024
            || Request.Body.Num() % sizeof(int16) != 0)
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"invalid_pcm16_speech\"}"),
                EHttpServerResponseCodes::BadRequest));
            return true;
        }

        if (!bCommercialFaceReady
            || !bCommercialModelReady
            || !CommercialGenerator.IsValid())
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"commercial_model_warming\"}"),
                EHttpServerResponseCodes::ServiceUnavail));
            return true;
        }

        TArray<uint8> PcmBytes = Request.Body;
        const int32 SpeechDurationMs = FMath::RoundToInt(
            static_cast<double>(PcmBytes.Num() / sizeof(int16)) * 1000.0 / 16000.0);
        // Complete the HTTP request while its callback is still valid. The old
        // implementation retained this callback until the async model load
        // finished, which caused the renderer crash and black WebRTC frame.
        const FString ResponseBody = FString::Printf(
            TEXT("{\"ok\":true,\"accepted\":true,\"durationMs\":%d}"),
            SpeechDurationMs);
        OnComplete(ConclaviaStudio::JsonResponse(ResponseBody));
        AsyncTask(ENamedThreads::GameThread, [
            this,
            PcmBytes = MoveTemp(PcmBytes)]() mutable
        {
            PrepareCommercialSpeech(MoveTemp(PcmBytes));
        });
        return true;
    }

    void SwitchCommercialAvatar(const FString& RequestedAvatarId)
    {
        if (!bLipSyncLab
            || RequestedAvatarId.Equals(AvatarId, ESearchCase::IgnoreCase))
        {
            return;
        }
        const FString PreviousAvatarId = AvatarId;
        // The commercial generators are independent from the MetaHuman that
        // consumes their controls. Keep the already-warmed ONNX sessions alive
        // while swapping the visible actor; destroying them here turned an
        // otherwise instant face rebind into a multi-minute cold start and a
        // quick second selection could strand both generators in loading.
        StopCommercialPlayback();
        if (StudioWorld.IsValid())
        {
            StudioWorld->GetTimerManager().ClearTimer(ListeningLifeTimer);
        }
        bListeningReactionActive = false;
        bListeningVisualActive = false;
        AvatarId = RequestedAvatarId;
        bCommercialFaceReady = false;
        bCommercialModelRouteReady = false;
        bCommercialFaceReady = ConfigureCommercialFace();
        if (!bCommercialFaceReady)
        {
            UE_LOG(
                LogConclaviaStudio,
                Error,
                TEXT("UE 5.8 avatar switch failed: requested=%s restoring=%s"),
                *RequestedAvatarId,
                *PreviousAvatarId);
            AvatarId = PreviousAvatarId;
            bCommercialFaceReady = ConfigureCommercialFace();
        }
        else
        {
            if (StudioWorld.IsValid())
            {
                StudioWorld->GetTimerManager().ClearTimer(BodyGestureTimer);
            }
            BodyGestureComponent.Reset();
            BodyGesturePhase = TEXT("idle");
            bBodyGestureLowerQueued = false;
            ActiveBodyGesture = TEXT("none");
            ActivePerformanceGesture = TEXT("none");
            InitializeBodyIdle();
            SwitchCamera(TEXT("CAM_Seat_1_Close"), 0.0f, true);
        }
        if (bCommercialFaceReady)
        {
            if (bCommercialModelReady && CommercialGenerator.IsValid())
            {
                SetCommercialMood(
                    ERealisticMetaHumanLipSyncMood::Neutral,
                    TEXT("neutral"),
                    0.0f);
                BindCommercialGenerator();
            }
            else
            {
                WarmCommercialGenerator(false);
            }
        }
    }

    bool HandleAvatar(
        const FHttpServerRequest& Request,
        const FHttpResultCallback& OnComplete)
    {
        FString RequestedAvatarId;
        if (Request.Body.Num() > 0)
        {
            const FUTF8ToTCHAR Converter(
                reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()),
                Request.Body.Num());
            const FString Body(Converter.Length(), Converter.Get());
            TSharedPtr<FJsonObject> Json;
            const TSharedRef<TJsonReader<>> Reader =
                TJsonReaderFactory<>::Create(Body);
            if (FJsonSerializer::Deserialize(Reader, Json) && Json.IsValid())
            {
                Json->TryGetStringField(TEXT("avatarId"), RequestedAvatarId);
            }
        }
        RequestedAvatarId = RequestedAvatarId.TrimStartAndEnd().ToLower();
        if (!RequestedAvatarId.Equals(TEXT("aera"))
            && !RequestedAvatarId.Equals(TEXT("ada"))
            && !RequestedAvatarId.Equals(TEXT("vivian"))
            && !RequestedAvatarId.Equals(TEXT("jelena")))
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"avatar-not-installed-on-ue58\"}"),
                EHttpServerResponseCodes::BadRequest));
            return true;
        }

        const FString AvatarToActivate = RequestedAvatarId;
        OnComplete(ConclaviaStudio::JsonResponse(FString::Printf(
            TEXT("{\"ok\":true,\"accepted\":true,\"avatarId\":\"%s\"}"),
            *AvatarToActivate)));
        AsyncTask(ENamedThreads::GameThread, [this, AvatarToActivate]()
        {
            SwitchCommercialAvatar(AvatarToActivate);
        });
        return true;
    }

    bool HandleOptions(const FHttpServerRequest&, const FHttpResultCallback& OnComplete) const
    {
        TUniquePtr<FHttpServerResponse> Response = ConclaviaStudio::JsonResponse(TEXT("{}"));
        Response->Headers.Add(TEXT("Access-Control-Allow-Methods"), {TEXT("POST, OPTIONS")});
        Response->Headers.Add(TEXT("Access-Control-Allow-Headers"), {TEXT("Content-Type")});
        OnComplete(MoveTemp(Response));
        return true;
    }

    bool HandleSnapshot(const FHttpServerRequest&, const FHttpResultCallback& OnComplete)
    {
        if (!bStageReady || !StudioWorld.IsValid())
        {
            OnComplete(ConclaviaStudio::JsonResponse(
                TEXT("{\"ok\":false,\"error\":\"stage_not_ready\"}"),
                EHttpServerResponseCodes::ServiceUnavail));
            return true;
        }

        const FString Directory = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Screenshots/Director"));
        IFileManager::Get().MakeDirectory(*Directory, true);
        const FString FilePath = FPaths::Combine(Directory, TEXT("latest.png"));
        AsyncTask(ENamedThreads::GameThread, [FilePath]()
        {
            FScreenshotRequest::RequestScreenshot(FilePath, true, false);
        });

        const FString Body = FString::Printf(
            TEXT("{\"ok\":true,\"path\":\"%s\"}"),
            *FilePath.ReplaceCharWithEscapedChar());
        OnComplete(ConclaviaStudio::JsonResponse(Body));
        return true;
    }

    uint32 ControlPort = 8081;
    FString StudioProfile = TEXT("pop");
    FString AvatarId = TEXT("aera");
    TSharedPtr<IHttpRouter> Router;
    FHttpRouteHandle HealthRoute;
    FHttpRouteHandle CueRoute;
    FHttpRouteHandle OptionsRoute;
    FHttpRouteHandle SnapshotRoute;
    FHttpRouteHandle PcmRoute;
    FHttpRouteHandle SpeechRoute;
    FHttpRouteHandle AvatarRoute;
    FDelegateHandle WorldInitializationHandle;
    TWeakObjectPtr<UWorld> StudioWorld;
    TMap<FName, TWeakObjectPtr<ACameraActor>> Cameras;
    FTimerHandle StageDiscoveryTimer;
    FTimerHandle LowerThirdTimer;
    FTimerHandle CameraOpeningTimer;
    FTimerHandle CameraContextTimer;
    FTimerHandle CameraHandoffTimer;
    FTimerHandle FacialLifeTimer;
    FTimerHandle AudioSourceRetryTimer;
    FTimerHandle LiveLinkAuditTimer;
    FTimerHandle CommercialFaceTimer;
    FTimerHandle CommercialModelTimer;
    FTimerHandle CommercialSolverTimer;
    FTimerHandle CommercialAudioStartTimer;
    FTimerHandle CommercialSpeechEndTimer;
    FTimerHandle ListeningLifeTimer;
    FTimerHandle ListeningModelTimer;
    FTimerHandle BodyGestureTimer;
    TArray<FParticipantFaceState> ParticipantFaces;
    ILiveLinkClient* LiveLinkClient = nullptr;
    TSharedPtr<FConclaviaPcmLiveLinkSource> PcmSource;
    FLiveLinkSourceHandle OfficialAudioSource;
    FLiveLinkSubjectKey OfficialAudioSubject;
    bool bOfficialAudioSubjectReady = false;
    int32 LastLiveLinkCurveCount = 0;
    float LastLiveLinkMaxCurve = 0.0f;
    FString LastLiveLinkMaxCurveName;
    int64 PcmBytesReceived = 0;
    TWeakObjectPtr<USkeletalMeshComponent> CommercialFace;
    TWeakObjectPtr<USkeletalMeshComponent> BodyGestureComponent;
    FVector BodyGestureStartHandLocation = FVector::ZeroVector;
    TWeakObjectPtr<UAnimSequence> BodyGestureSequence;
    TMap<FString, TWeakObjectPtr<AActor>> CommercialAvatarActors;
    TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator> CommercialGenerator;
    TStrongObjectPtr<URealisticMetaHumanLipSyncGenerator> ListeningGenerator;
    TStrongObjectPtr<USoundWaveProcedural> SpeechWave;
    TStrongObjectPtr<UAudioComponent> SpeechComponent;
    FCriticalSection CommercialSpeechMutex;
    TArray<int16> CommercialSpeechSamples;
    int32 CommercialSpeechCursor = 0;
    int32 CommercialSolverCursor = 0;
    int32 CommercialSolverChunksSubmitted = 0;
    int32 LastCommercialControlCount = 0;
    float LastCommercialMaxControl = 0.0f;
    float LastCommercialMaxMouthControl = 0.0f;
    FString LastCommercialMaxMouthControlName;
    float LastCommercialMaxUpperFaceControl = 0.0f;
    FString LastCommercialMaxUpperFaceControlName;
    float CommercialSpeechPeakMouthControl = 0.0f;
    FString CommercialSpeechPeakMouthControlName;
    float CommercialSpeechPeakUpperFaceControl = 0.0f;
    FString CommercialSpeechPeakUpperFaceControlName;
    float LastCommercialSpeechPeakMouthControl = 0.0f;
    FString LastCommercialSpeechPeakMouthControlName;
    float LastCommercialSpeechPeakUpperFaceControl = 0.0f;
    FString LastCommercialSpeechPeakUpperFaceControlName;
    int32 LastCommercialSpeechSolverChunks = 0;
    int32 LastCommercialSpeechSolverCursor = 0;
    int32 CommercialCompletedSpeechCount = 0;
    float LastCommercialJawInput = 0.0f;
    float LastCommercialJawCurve = 0.0f;
    int32 LastCommercialBoundNodeCount = 0;
    TArray<FPerformanceBeat> PendingPerformanceBeats;
    TArray<FPerformanceBeat> ActivePerformanceBeats;
    int32 NextPerformanceBeatIndex = 0;
    int32 AppliedPerformanceBeatCount = 0;
    FString ActiveMoodName = TEXT("confidence");
    float ActiveMoodIntensity = 0.48f;
    float PerformanceCurrentIntensity = 0.48f;
    float PerformanceTargetIntensity = 0.48f;
    FString ActivePerformanceFocus = TEXT("camera");
    FString ActivePerformanceGesture = TEXT("none");
    FString ActiveBodyGesture = TEXT("none");
    FString BodyGesturePhase = TEXT("idle");
    static constexpr float BodyGestureRaiseSeconds = 1.6f;
    static constexpr float BodyGestureHoldSeconds = 2.4f;
    static constexpr float BodyGestureLowerStartSeconds = 3.5f;
    static constexpr float BodyGestureLowerSeconds = 1.2f;
    double BodyGesturePhaseStartedAt = 0.0;
    double CommercialModelDeadline = 0.0;
    double ListeningModelDeadline = 0.0;
    double ListeningReactionExpiresAt = 0.0;
    double ListeningVisualEndsAt = 0.0;
    bool bCommercialFaceReady = false;
    bool bCommercialModelReady = false;
    bool bCommercialModelRouteReady = false;
    bool bCommercialGeneratorBound = false;
    bool bCommercialControlsBound = false;
    bool bCommercialSpeechActive = false;
    bool bListeningModelReady = false;
    bool bListeningReactionActive = false;
    bool bListeningVisualActive = false;
    bool bCommercialEyesAimBound = false;
    bool bPhysicalGestureReady = false;
    bool bBodyGestureLowerQueued = false;
    int32 ListeningSolverChunksSubmitted = 0;
    int32 ActiveFaceIndex = -1;
    bool bLipSyncLab = false;
    bool bNativeLiveLinkProfile = false;
    int32 StageDiscoveryAttempts = 0;
    bool bStageReady = false;
    FName ActiveCamera;
    double LastCameraCutAt = 0.0;
    FString LastSpeakerId;
    FString LastTargetId;
    FString LastShot;
    FString LastIntent;
    FString LastSpeakerName;
    FString LastTargetName;
    FDateTime LastCueAt;
    TSharedPtr<SOverlay> BroadcastOverlay;
    TSharedPtr<SBorder> LowerThirdContainer;
    TSharedPtr<STextBlock> IntentText;
    TSharedPtr<STextBlock> SpeakerText;
    TSharedPtr<STextBlock> TargetText;
};

IMPLEMENT_PRIMARY_GAME_MODULE(FConclaviaStudioModule, ConclaviaStudio, "ConclaviaStudio");
