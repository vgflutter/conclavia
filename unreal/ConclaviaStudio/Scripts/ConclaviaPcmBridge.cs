using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class ConclaviaPcmBridge
{
    private const int WaveMapper = -1;
    private const int WhdrDone = 0x00000001;
    private static readonly object Sync = new object();
    private static readonly List<WaveBuffer> Pending = new List<WaveBuffer>();
    private static IntPtr waveOut = IntPtr.Zero;
    private static long bytesReceived;
    private static long chunksReceived;
    private static DateTime lastAudioAt = DateTime.MinValue;
    private static string expectedToken = "";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct WaveOutCaps
    {
        public ushort ManufacturerId;
        public ushort ProductId;
        public uint DriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Formats;
        public ushort Channels;
        public ushort Reserved;
        public uint Support;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormat
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSecond;
        public uint AverageBytesPerSecond;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort ExtraSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr Data;
        public uint BufferLength;
        public uint BytesRecorded;
        public IntPtr User;
        public uint Flags;
        public uint Loops;
        public IntPtr Next;
        public IntPtr Reserved;
    }

    private sealed class WaveBuffer
    {
        public IntPtr Data;
        public IntPtr Header;
    }

    [DllImport("winmm.dll")]
    private static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Auto)]
    private static extern uint waveOutGetDevCaps(uint deviceId, out WaveOutCaps caps, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutOpen(out IntPtr handle, uint deviceId, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")]
    private static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutReset(IntPtr handle);
    [DllImport("winmm.dll")]
    private static extern uint waveOutClose(IntPtr handle);

    public static void Main(string[] args)
    {
        int port = args.Length > 0 ? Int32.Parse(args[0]) : 8091;
        expectedToken = args.Length > 1 ? args[1] : "";
        OpenCableOutput(48000);
        Thread keepAlive = new Thread(KeepCableAlive) { IsBackground = true, Name = "ConclaviaCableKeepAlive" };
        keepAlive.Start();

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://+:" + port + "/");
        listener.Start();
        Console.WriteLine("CONCLAVIA_PCM_BRIDGE_READY port=" + port);
        try
        {
            while (true)
            {
                HttpListenerContext context = listener.GetContext();
                Task.Run(() => Handle(context));
            }
        }
        finally
        {
            listener.Close();
            CloseWaveOut();
        }
    }

    private static void Handle(HttpListenerContext context)
    {
        try
        {
            string token = context.Request.QueryString["token"] ?? "";
            if (expectedToken.Length > 0 && !String.Equals(token, expectedToken, StringComparison.Ordinal))
            {
                SendJson(context, 401, "{\"ok\":false,\"error\":\"unauthorized\"}");
                return;
            }
            if (context.Request.IsWebSocketRequest && context.Request.Url.AbsolutePath == "/audio")
            {
                ProcessWebSocket(context).GetAwaiter().GetResult();
                return;
            }
            if (context.Request.HttpMethod == "GET" && context.Request.Url.AbsolutePath == "/health")
            {
                string last = lastAudioAt == DateTime.MinValue ? "" : lastAudioAt.ToUniversalTime().ToString("o");
                SendJson(context, 200, "{\"ok\":true,\"service\":\"conclavia-pcm-bridge\",\"bytesReceived\":" + bytesReceived + ",\"chunksReceived\":" + chunksReceived + ",\"lastAudioAt\":\"" + last + "\"}");
                return;
            }
            if (context.Request.HttpMethod == "POST" && context.Request.Url.AbsolutePath == "/pcm")
            {
                using (MemoryStream message = new MemoryStream())
                {
                    context.Request.InputStream.CopyTo(message);
                    if (message.Length == 0 || message.Length > 384000 || message.Length % 4 != 0)
                    {
                        SendJson(context, 400, "{\"ok\":false,\"error\":\"invalid_pcm\"}");
                        return;
                    }
                    byte[] bytes = message.ToArray();
                    QueueMonoFloatAsStereo(bytes);
                    Interlocked.Add(ref bytesReceived, bytes.Length);
                    Interlocked.Increment(ref chunksReceived);
                    lastAudioAt = DateTime.UtcNow;
                }
                SendJson(context, 200, "{\"ok\":true}");
                return;
            }
            SendJson(context, 404, "{\"ok\":false,\"error\":\"not_found\"}");
        }
        catch (Exception error)
        {
            try { SendJson(context, 500, "{\"ok\":false,\"error\":\"" + Escape(error.Message) + "\"}"); } catch { }
        }
    }

    private static async Task ProcessWebSocket(HttpListenerContext context)
    {
        HttpListenerWebSocketContext accepted = await context.AcceptWebSocketAsync(null);
        WebSocket socket = accepted.WebSocket;
        byte[] buffer = new byte[65536];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                using (MemoryStream message = new MemoryStream())
                {
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                        if (result.MessageType == WebSocketMessageType.Close) return;
                        message.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);
                    if (result.MessageType != WebSocketMessageType.Binary || message.Length == 0) continue;
                    QueueMonoFloatAsStereo(message.ToArray());
                    Interlocked.Add(ref bytesReceived, message.Length);
                    Interlocked.Increment(ref chunksReceived);
                    lastAudioAt = DateTime.UtcNow;
                }
            }
        }
        finally
        {
            if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "complete", CancellationToken.None).Wait(1000);
            socket.Dispose();
        }
    }

    private static void OpenCableOutput(int sampleRate)
    {
        uint device = UInt32.MaxValue;
        for (uint index = 0; index < waveOutGetNumDevs(); index++)
        {
            WaveOutCaps caps;
            if (waveOutGetDevCaps(index, out caps, (uint)Marshal.SizeOf(typeof(WaveOutCaps))) == 0 &&
                caps.Name.IndexOf("CABLE Input", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                device = index;
                Console.WriteLine("CONCLAVIA_PCM_DEVICE index=" + index + " name=" + caps.Name);
                break;
            }
        }
        if (device == UInt32.MaxValue) throw new InvalidOperationException("VB-Audio CABLE Input playback endpoint not found.");
        WaveFormat format = new WaveFormat {
            FormatTag = 3, Channels = 2, SamplesPerSecond = (uint)sampleRate,
            BitsPerSample = 32, BlockAlign = 8, AverageBytesPerSecond = (uint)(sampleRate * 8), ExtraSize = 0
        };
        uint result = waveOutOpen(out waveOut, device, ref format, IntPtr.Zero, IntPtr.Zero, 0);
        if (result != 0) throw new InvalidOperationException("waveOutOpen failed: " + result);
    }

    private static void QueueMonoFloatAsStereo(byte[] mono)
    {
        int monoSamples = mono.Length / 4;
        byte[] stereo = new byte[monoSamples * 8];
        for (int index = 0; index < monoSamples; index++)
        {
            Buffer.BlockCopy(mono, index * 4, stereo, index * 8, 4);
            Buffer.BlockCopy(mono, index * 4, stereo, index * 8 + 4, 4);
        }
        lock (Sync)
        {
            ReapCompleted();
            while (Pending.Count >= 24)
            {
                Monitor.Exit(Sync);
                Thread.Sleep(5);
                Monitor.Enter(Sync);
                ReapCompleted();
            }
            WaveBuffer item = new WaveBuffer();
            item.Data = Marshal.AllocHGlobal(stereo.Length);
            Marshal.Copy(stereo, 0, item.Data, stereo.Length);
            WaveHeader header = new WaveHeader { Data = item.Data, BufferLength = (uint)stereo.Length };
            item.Header = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveHeader)));
            Marshal.StructureToPtr(header, item.Header, false);
            uint size = (uint)Marshal.SizeOf(typeof(WaveHeader));
            uint prepared = waveOutPrepareHeader(waveOut, item.Header, size);
            uint written = prepared == 0 ? waveOutWrite(waveOut, item.Header, size) : prepared;
            if (written != 0) { Free(item); throw new InvalidOperationException("waveOutWrite failed: " + written); }
            Pending.Add(item);
        }
    }

    private static void KeepCableAlive()
    {
        // MetaHuman's official media source must see a live capture stream
        // before it can create its subject. Feed short silence packets only
        // while no real speech is arriving; keeping at most two buffers avoids
        // adding a perceptible pre-roll when speech begins.
        byte[] silence = new byte[960 * 4]; // 20 ms, mono float, 48 kHz
        while (waveOut != IntPtr.Zero)
        {
            bool needsSilence;
            lock (Sync)
            {
                ReapCompleted();
                needsSilence = Pending.Count < 2 &&
                    (lastAudioAt == DateTime.MinValue || (DateTime.UtcNow - lastAudioAt).TotalMilliseconds > 35);
            }
            if (needsSilence) QueueMonoFloatAsStereo(silence);
            Thread.Sleep(10);
        }
    }

    private static void ReapCompleted()
    {
        uint size = (uint)Marshal.SizeOf(typeof(WaveHeader));
        for (int index = Pending.Count - 1; index >= 0; index--)
        {
            WaveHeader header = (WaveHeader)Marshal.PtrToStructure(Pending[index].Header, typeof(WaveHeader));
            if ((header.Flags & WhdrDone) == 0) continue;
            waveOutUnprepareHeader(waveOut, Pending[index].Header, size);
            Free(Pending[index]);
            Pending.RemoveAt(index);
        }
    }

    private static void Free(WaveBuffer item)
    {
        if (item.Header != IntPtr.Zero) Marshal.FreeHGlobal(item.Header);
        if (item.Data != IntPtr.Zero) Marshal.FreeHGlobal(item.Data);
    }

    private static void CloseWaveOut()
    {
        lock (Sync)
        {
            if (waveOut == IntPtr.Zero) return;
            waveOutReset(waveOut);
            foreach (WaveBuffer item in Pending) Free(item);
            Pending.Clear();
            waveOutClose(waveOut);
            waveOut = IntPtr.Zero;
        }
    }

    private static void SendJson(HttpListenerContext context, int status, string json)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
        context.Response.OutputStream.Close();
    }

    private static string Escape(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\""); }
}
