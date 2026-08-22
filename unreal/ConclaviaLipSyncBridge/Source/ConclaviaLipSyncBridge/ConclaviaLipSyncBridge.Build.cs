using UnrealBuildTool;

public class ConclaviaLipSyncBridge : ModuleRules
{
    public ConclaviaLipSyncBridge(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "CoreUObject",
            "Engine",
            "HTTPServer",
            "Json",
            "RuntimeMetaHumanLipSync"
        });

        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.AddRange(new[]
            {
                "AssetRegistry",
                "MetaHumanCharacter",
                "MetaHumanCharacterEditor",
                "MetaHumanCharacterPalette",
                "MetaHumanSDKEditor",
                "UnrealEd"
            });
        }
    }
}
