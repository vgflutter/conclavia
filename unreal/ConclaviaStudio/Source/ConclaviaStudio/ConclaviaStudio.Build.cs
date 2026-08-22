using UnrealBuildTool;

public class ConclaviaStudio : ModuleRules
{
    public ConclaviaStudio(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "AnimGraphRuntime",
            "LiveLink",
            "LiveLinkInterface",
            "MetaHumanCoreTech",
            "MetaHumanPipelineCore",
            "MetaHumanLocalLiveLinkSource",
            "RuntimeMetaHumanLipSync"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "HTTPServer",
            "Json",
            "JsonUtilities",
            "Projects",
            "Slate",
            "SlateCore"
        });

        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.AddRange(new[]
            {
                "MetaHumanCharacter",
                "MetaHumanCharacterEditor",
                "MetaHumanCharacterPalette",
                "LevelEditor",
                "PixelStreaming2Editor",
                "PixelStreaming2Servers",
                "PixelStreaming2Settings",
                "UnrealEd"
            });
        }
    }
}
