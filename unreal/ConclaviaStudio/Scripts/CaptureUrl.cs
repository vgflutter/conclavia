using System;
using System.IO;

internal static class CaptureUrl
{
    private const string OutputPath = @"C:\ConclaviaStudio\Saved\Logs\EOSDeviceAuth.url";

    public static int Main(string[] args)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(OutputPath));
            File.WriteAllText(OutputPath, string.Join(" ", args));
            return 0;
        }
        catch (Exception exception)
        {
            File.WriteAllText(OutputPath + ".error", exception.ToString());
            return 1;
        }
    }
}
