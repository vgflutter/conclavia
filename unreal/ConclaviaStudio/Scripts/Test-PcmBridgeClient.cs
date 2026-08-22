using System;
using System.IO;
using System.Net.WebSockets;
using System.Threading;

internal static class TestPcmBridgeClient
{
    public static void Main(string[] args)
    {
        string token = File.ReadAllText(args[0]).Trim();
        ClientWebSocket socket = new ClientWebSocket();
        socket.ConnectAsync(new Uri("ws://127.0.0.1:8091/audio?token=" + Uri.EscapeDataString(token)), CancellationToken.None).Wait();
        Thread.Sleep(8000);
        const int rate = 48000;
        const int frames = 4800;
        byte[] bytes = new byte[frames * 4];
        for (int chunk = 0; chunk < 900; chunk++)
        {
            for (int index = 0; index < frames; index++)
            {
                float sample = (float)(Math.Sin(2.0 * Math.PI * 220.0 * (chunk * frames + index) / rate) * 0.16);
                Buffer.BlockCopy(BitConverter.GetBytes(sample), 0, bytes, index * 4, 4);
            }
            socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Binary, true, CancellationToken.None).Wait();
            Thread.Sleep(100);
        }
        socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "complete", CancellationToken.None).Wait();
        Console.WriteLine("CONCLAVIA_PCM_TEST_SENT seconds=4");
    }
}
