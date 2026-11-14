using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Speech.Synthesis;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Inkloom {
    public static class SpeechService {
        private const string Host = "speech.platform.bing.com";
        private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
        private const string ChromiumFullVersion = "143.0.3650.75";
        private const long WinEpoch = 11644473600L;
        private const int MaxAudioBytes = 8 * 1024 * 1024;
        private static readonly SemaphoreSlim Workers = new SemaphoreSlim(2, 2);
        private static readonly HashSet<string> AllowedVoices = new HashSet<string>(StringComparer.Ordinal) {
            "zh-CN-YunxiNeural", "zh-CN-YunyangNeural", "zh-CN-XiaoxiaoNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiaNeural",
            "zh-CN-liaoning-XiaobeiNeural", "zh-CN-shaanxi-XiaoniNeural", "zh-TW-HsiaoChenNeural", "zh-TW-YunJheNeural", "zh-TW-HsiaoYuNeural", "zh-HK-HiuMaanNeural",
            "en-US-AvaMultilingualNeural", "en-US-AndrewMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-US-BrianMultilingualNeural"
        };
        private static readonly uint[] Sha256Initial = { 0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au, 0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u };
        private static readonly uint[] Sha256State = { 0xFD9FBEA2u, 0x91243CE7u, 0xBE499094u, 0xCD2E1E0Au, 0x6C006F49u, 0x04BD35ABu, 0xFEB0A7E4u, 0x03EFFBD2u };
        private static readonly uint[] Sha256Schedule = { 0xEB24BF9Eu, 0x1558691Fu, 0xA0C09EE2u, 0x0CFA32BAu, 0xA622EE8Cu, 0xD1DD9491u, 0xC0DD25A0u, 0xF9E70AB6u, 0xF0C31573u, 0x7058CE4Eu, 0x7188E606u, 0x00E5AB33u, 0xD258B060u, 0x72766564u };
        private static readonly uint[] Sha256RoundConstants = {
            0x428A2F98u, 0x71374491u, 0xB5C0FBCFu, 0xE9B5DBA5u, 0x3956C25Bu, 0x59F111F1u, 0x923F82A4u, 0xAB1C5ED5u,
            0xD807AA98u, 0x12835B01u, 0x243185BEu, 0x550C7DC3u, 0x72BE5D74u, 0x80DEB1FEu, 0x9BDC06A7u, 0xC19BF174u,
            0xE49B69C1u, 0xEFBE4786u, 0x0FC19DC6u, 0x240CA1CCu, 0x2DE92C6Fu, 0x4A7484AAu, 0x5CB0A9DCu, 0x76F988DAu,
            0x983E5152u, 0xA831C66Du, 0xB00327C8u, 0xBF597FC7u, 0xC6E00BF3u, 0xD5A79147u, 0x06CA6351u, 0x14292967u,
            0x27B70A85u, 0x2E1B2138u, 0x4D2C6DFCu, 0x53380D13u, 0x650A7354u, 0x766A0ABBu, 0x81C2C92Eu, 0x92722C85u,
            0xA2BFE8A1u, 0xA81A664Bu, 0xC24B8B70u, 0xC76C51A3u, 0xD192E819u, 0xD6990624u, 0xF40E3585u, 0x106AA070u,
            0x19A4C116u, 0x1E376C08u, 0x2748774Cu, 0x34B0BCB5u, 0x391C0CB3u, 0x4ED8AA4Au, 0x5B9CCA4Fu, 0x682E6FF3u,
            0x748F82EEu, 0x78A5636Fu, 0x84C87814u, 0x8CC70208u, 0x90BEFFFAu, 0xA4506CEBu, 0xBEF9A3F7u, 0xC67178F2u
        };
        private static readonly uint[,] Cs64Coefficients = {
            { 0xE82E91B1u, 0xB32700D0u }, { 0x44DE24C6u, 0x88DFF51Du }, { 0x3BEB65BCu, 0x29514038u }, { 0xC89C5933u, 0xB328CBDFu },
            { 0x8D1EC211u, 0xD405B4D5u }, { 0x314EF5D5u, 0x26E55F3Cu }, { 0xE92491B1u, 0x607801C6u }, { 0xF0A5B9D5u, 0x82B2C1FBu },
            { 0x06064CF3u, 0xFA51A3DAu }, { 0xDA79FA60u, 0x207CC464u }, { 0xBED20560u, 0x3C3C74F3u }, { 0x89F9C9F8u, 0xD2D14B61u },
            { 0x35FA38C6u, 0xBB04A2C1u }, { 0xCB49E3C6u, 0xC5626167u }
        };
        private static uint Rol16(uint value) { return (value << 16) | (value >> 16); }
        private static uint Rotate(uint value, int bits) { return (value >> bits) | (value << (32 - bits)); }
        private static uint Sigma0(uint value) { return Rotate(value, 7) ^ Rotate(value, 18) ^ (value >> 3); }
        private static uint Sigma1(uint value) { return Rotate(value, 17) ^ Rotate(value, 19) ^ (value >> 10); }
        private static void Expand(uint[] words, int firstWord) {
            unchecked { for (int index = firstWord; index < 64; index++) words[index] = Sigma1(words[index - 2]) + words[index - 7] + Sigma0(words[index - 15]) + words[index - 16]; }
        }
        private static uint[] Rounds(uint[] state, uint[] words, int firstRound) {
            unchecked {
                uint first = state[0], second = state[1], third = state[2], fourth = state[3], fifth = state[4], sixth = state[5], seventh = state[6], eighth = state[7];
                for (int index = firstRound; index < 64; index++) {
                    uint round = firstRound == 14 && index == 14 ? 0xC9DC06A7u : Sha256RoundConstants[index];
                    uint sum = Rotate(fifth, 6) ^ Rotate(fifth, 11) ^ Rotate(fifth, 25);
                    uint choose = seventh ^ (fifth & (sixth ^ seventh));
                    uint temp1 = eighth + sum + choose + round + words[index];
                    uint major = (first & second) | (third & (first | second));
                    uint temp2 = (Rotate(first, 2) ^ Rotate(first, 13) ^ Rotate(first, 22)) + major;
                    eighth = seventh; seventh = sixth; sixth = fifth; fifth = fourth + temp1;
                    fourth = third; third = second; second = first; first = temp1 + temp2;
                }
                return new[] { first, second, third, fourth, fifth, sixth, seventh, eighth };
            }
        }
        private static uint[] InitializeDigest(byte[] data) {
            unchecked {
                uint[] words = new uint[64];
                words[14] = ((uint)data[0] << 16) | ((uint)data[1] << 8) | data[2];
                words[15] = ((uint)data[3] << 24) | ((uint)data[4] << 16) | ((uint)data[5] << 8) | data[6];
                for (int index = 16; index < 30; index++) {
                    uint value = Sha256Schedule[index - 16];
                    if (index - 2 >= 14) value += index == 16 ? Sigma1(words[index - 2]) ^ 0x000B92C0u : Sigma1(words[index - 2]);
                    if (index - 7 >= 14) value += words[index - 7];
                    if (index - 15 >= 14) value += index == 29 ? Sigma0(words[index - 15]) ^ 0x059C0B80u : Sigma0(words[index - 15]);
                    words[index] = value;
                }
                words[30] = Sigma1(words[28]) + words[23] + Sigma0(words[15]) + words[14] + 0xC9DC06A7u - Sha256RoundConstants[14];
                Expand(words, 31);
                uint[] working = Rounds(Sha256State, words, 14);
                return Sha256Initial.Select((value, index) => value + working[index]).ToArray();
            }
        }
        private static byte[] Digest(byte[] data) {
            unchecked {
                int length = 57 + data.Length;
                int padding = ((55 - length) % 64 + 64) % 64;
                int tail = data.Length - 7;
                byte[] padded = new byte[tail + 1 + padding + 8];
                Buffer.BlockCopy(data, 7, padded, 0, tail); padded[tail] = 0x80;
                ulong bits = (ulong)length * 8UL;
                for (int index = 0; index < 8; index++) padded[padded.Length - 1 - index] = (byte)(bits >> (index * 8));
                uint[] state = InitializeDigest(data);
                for (int offset = 0; offset < padded.Length; offset += 64) {
                    uint[] words = new uint[64];
                    for (int index = 0; index < 16; index++) {
                        int position = offset + index * 4;
                        words[index] = ((uint)padded[position] << 24) | ((uint)padded[position + 1] << 16) | ((uint)padded[position + 2] << 8) | padded[position + 3];
                    }
                    Expand(words, 16);
                    uint[] working = Rounds(state, words, 0);
                    for (int index = 0; index < 8; index++) state[index] += working[index];
                }
                byte[] digest = new byte[32];
                for (int index = 0; index < 8; index++) for (int part = 0; part < 4; part++) digest[index * 4 + part] = (byte)(state[index] >> (24 - part * 8));
                return digest;
            }
        }
        private static byte[] Cs64Digest(byte[] data, byte[] digest) {
            unchecked {
                uint keyA = BitConverter.ToUInt32(digest, 0) | 1u, keyB = BitConverter.ToUInt32(digest, 4) | 1u;
                uint factor0 = keyA * 0x82893933u, factor1 = keyB * 0x82893933u;
                var terms = new List<uint>(); var offsets = new List<uint>();
                for (int index = 0; index < 14; index++) { terms.Add(Cs64Coefficients[index, 0] * (index % 2 == 0 ? factor0 : factor1)); offsets.Add(Cs64Coefficients[index, 1]); }
                byte[] padded = new byte[(1 + data.Length + 3) & ~3]; Buffer.BlockCopy(data, 0, padded, 1, data.Length);
                var words = new List<uint>();
                for (int index = 0; index < padded.Length / 4; index++) words.Add(BitConverter.ToUInt32(padded, index * 4));
                if (words.Count % 2 != 0) words.Add(0u);
                for (int index = 0; index < words.Count; index++) {
                    uint word = words[index]; uint term = word * (index % 2 == 0 ? keyA : keyB);
                    uint offset = Rol16(word) * (index % 2 == 0 ? 0xEF0569FBu : 0xC31713DBu);
                    if (index == 0) { term += 0xF2F90B1Au * factor0; offset += 0x0B1A0000u; }
                    terms.Add(term); offsets.Add(offset);
                }
                uint swapAcc = 0u, swapLast = 0u, state = 0u, accumulator = 0u;
                for (int index = 0; index < terms.Count; index += 2) {
                    uint first = terms[index], second = terms[index + 1];
                    uint temp = Rol16(offsets[index] + first); uint product = temp * 0x76F50F34u;
                    swapAcc += Rol16(product) * 0xC3EFEA97u + product;
                    temp = Rol16(offsets[index + 1] + second); product = temp * 0x1881CE3Cu;
                    swapLast = Rol16(product) * 0x35BD1EC9u + product; swapAcc += swapLast;
                    state = state * keyA + first;
                    state = Rol16(state) * 0xCF98B111u; state = Rol16(state) * 0x87085B9Fu;
                    state = Rol16(state) * 0x12CEB96Du; state = Rol16(state) * 0x257E1D83u;
                    accumulator += state; temp = state * keyB + second;
                    temp = Rol16(temp) * 0xA27416F5u; temp = Rol16(temp) * 0xD38396FFu;
                    state = Rol16(Rol16(temp) * 0x7C932B89u) * 0xBFA49F69u; accumulator += state;
                }
                byte[] result = new byte[8];
                Buffer.BlockCopy(BitConverter.GetBytes(swapLast ^ state), 0, result, 0, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(swapAcc ^ accumulator), 0, result, 4, 4);
                return result;
            }
        }
        public static string GenerateSecMsGecV2(double? unixTimestamp = null) {
            double unix = unixTimestamp ?? (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
            long seconds = (long)Math.Floor(unix) + WinEpoch; seconds -= seconds % 300L;
            byte[] data = Encoding.ASCII.GetBytes((seconds * 10000000L).ToString(CultureInfo.InvariantCulture) + TrustedClientToken);
            byte[] digest = Digest(data);
            return BitConverter.ToString(Cs64Digest(data, digest)).Replace("-", "") + "-" + BitConverter.ToString(digest).Replace("-", "");
        }
        public static string NormalizeVoice(string voice) { return voice != null && AllowedVoices.Contains(voice) ? voice : "zh-CN-YunxiNeural"; }
        public static double NormalizeRate(string rate) {
            double value;
            return Double.TryParse(rate, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && !Double.IsNaN(value) && !Double.IsInfinity(value) ? Math.Max(0.75, Math.Min(2, value)) : 1;
        }
        public static string FormatSsml(string text, string voice, string rate, string pitch = "+0Hz") {
            string clean = Regex.Replace(text ?? "", "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", " ");
            string escaped = System.Security.SecurityElement.Escape(clean);
            string normalizedVoice = NormalizeVoice(voice);
            string language = normalizedVoice.StartsWith("zh-TW") ? "zh-TW" : normalizedVoice.StartsWith("zh-HK") ? "zh-HK" : "zh-CN";
            string safePitch = new[] { "+0Hz", "-3Hz", "-6Hz", "+4Hz" }.Contains(pitch) ? pitch : "+0Hz";
            int percent = (int)Math.Round((NormalizeRate(rate) - 1) * 100);
            return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + language + "'><voice name='" + normalizedVoice + "'><prosody pitch='" + safePitch + "' rate='" + (percent >= 0 ? "+" : "") + percent.ToString(CultureInfo.InvariantCulture) + "%' volume='+0%'>" + escaped + "</prosody></voice></speak>";
        }
        public static void AssertAccess(string source, string provider, bool consent) {
            if (provider != "system" && provider != "edge" && provider != "openai") throw new IOException("未知的语音服务。");
            string clean = (source ?? "").TrimStart('\uFEFF');
            if (clean.Contains("```inkloom-aes256gcm") || Regex.IsMatch(clean, @"(?im)^\s*@privacy\s*:\s*locked\b")) throw new IOException("加密或锁定笔记不能朗读。");
            if (clean.StartsWith("---\n") || clean.StartsWith("---\r\n")) {
                var header = Regex.Match(clean, @"\A---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)");
                if (!header.Success) throw new IOException("笔记属性未闭合。");
                string attributes = header.Groups[1].Value;
                var fields = Regex.Matches(attributes, "(?im)^[ \\t]*[\"']?(privacy|encrypted|cipher_alg)[\"']?[ \\t]*:[ \\t]*([^\\r\\n]*)");
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (Match field in fields) {
                    string key = field.Groups[1].Value.ToLowerInvariant();
                    string value = field.Groups[2].Value.Split('#')[0].Trim().Trim('\'', '"').ToLowerInvariant();
                    if (!seen.Add(key)) throw new IOException("隐私属性重复，已阻止朗读。");
                    if ((key == "encrypted" && value != "false") || key == "cipher_alg" || (key == "privacy" && value == "locked")) throw new IOException("加密或锁定笔记不能朗读。");
                    if (key == "privacy" && value != "public" && provider != "system") throw new IOException("内控或机密笔记只能使用本机系统语音。");
                }
                if (provider != "system" && (attributes.Contains("<<:") || Regex.IsMatch(attributes, @"[{}&*!]"))) throw new IOException("复杂属性需要先规范化，未向语音服务发送正文。");
            }
            if (provider != "system" && !consent) throw new IOException("尚未确认向语音服务发送本次朗读文本。");
        }
        public static Uri ValidateEndpoint(string endpoint) {
            Uri uri;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || !String.IsNullOrEmpty(uri.UserInfo) || !(uri.Scheme == "https" || (uri.Scheme == "http" && (uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]")))) throw new IOException("语音接口须使用 HTTPS；仅本机地址允许 HTTP。");
            return uri;
        }
        public static async Task<object> SynthesizeAsync(string text, string voice, string rate, string pitch, string provider, string endpoint, string model, string customVoice, string apiKey, CancellationToken cancellation) {
            string trimmed = (text ?? "").Trim();
            if (trimmed.Length == 0 || trimmed.Length > 1800) throw new IOException("朗读分段须为 1 至 1800 个字符。");
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
                deadline.CancelAfter(30000);
                await Workers.WaitAsync(deadline.Token);
                try {
                    if (provider == "system") return await SystemSpeech(trimmed, rate, deadline.Token);
                    byte[] audio = provider == "openai"
                        ? await CompatibleSpeech(trimmed, endpoint, model, customVoice, apiKey, rate, deadline.Token)
                        : await EdgeSpeech(trimmed, NormalizeVoice(voice), rate, pitch, deadline.Token);
                    deadline.Token.ThrowIfCancellationRequested();
                    return new { mime = "audio/mpeg", data = Convert.ToBase64String(audio), voice = voice, engine = provider == "openai" ? "openai-compatible" : "edge-neural" };
                } finally { Workers.Release(); }
            }
        }
        private static async Task<object> SystemSpeech(string text, string rate, CancellationToken cancellation) {
            using (var synth = new SpeechSynthesizer())
            using (var stream = new MemoryStream()) {
                var voices = synth.GetInstalledVoices().Where(voice => voice.Enabled).ToArray();
                var chosen = voices.FirstOrDefault(voice => voice.VoiceInfo.Culture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase)) ?? voices.FirstOrDefault();
                if (chosen == null) throw new IOException("Windows 未安装可用语音，请在系统设置中安装语音包。");
                synth.SelectVoice(chosen.VoiceInfo.Name);
                synth.Rate = (int)Math.Round(Math.Log(NormalizeRate(rate), 2) * 6);
                synth.SetOutputToWaveStream(stream);
                var completed = new TaskCompletionSource<SpeakCompletedEventArgs>();
                synth.SpeakCompleted += (sender, args) => completed.TrySetResult(args);
                using (cancellation.Register(() => { try { synth.SpeakAsyncCancelAll(); } catch { } completed.TrySetCanceled(); })) {
                    cancellation.ThrowIfCancellationRequested();
                    synth.SpeakAsync(text);
                    var result = await completed.Task;
                    cancellation.ThrowIfCancellationRequested();
                    if (result.Error != null) throw new IOException("系统语音合成失败。", result.Error);
                    if (result.Cancelled) throw new OperationCanceledException();
                    synth.SetOutputToNull();
                    return new { mime = "audio/wav", data = Convert.ToBase64String(stream.ToArray()), voice = chosen.VoiceInfo.Name, engine = "windows-system" };
                }
            }
        }
        private static async Task<byte[]> CompatibleSpeech(string text, string endpoint, string model, string voice, string apiKey, string rate, CancellationToken cancellation) {
            var request = (HttpWebRequest)WebRequest.Create(ValidateEndpoint(endpoint));
            request.Method = "POST"; request.ContentType = "application/json; charset=utf-8"; request.Accept = "audio/*"; request.AllowAutoRedirect = false;
            request.Timeout = 25000; request.ReadWriteTimeout = 25000;
            if (!String.IsNullOrEmpty(apiKey)) request.Headers["Authorization"] = "Bearer " + apiKey;
            byte[] body = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new { model = String.IsNullOrWhiteSpace(model) ? "tts-1" : model, input = text, voice = String.IsNullOrWhiteSpace(voice) ? "alloy" : voice, speed = NormalizeRate(rate), response_format = "mp3" }));
            using (cancellation.Register(request.Abort)) {
                using (var stream = await request.GetRequestStreamAsync()) await stream.WriteAsync(body, 0, body.Length, cancellation);
                using (var response = (HttpWebResponse)await request.GetResponseAsync())
                using (var input = response.GetResponseStream())
                using (var output = new MemoryStream()) {
                    if ((int)response.StatusCode != 200) throw new IOException("语音接口未返回成功响应。");
                    var buffer = new byte[16384]; int count;
                    while ((count = await input.ReadAsync(buffer, 0, buffer.Length, cancellation)) > 0) {
                        if (output.Length + count > MaxAudioBytes) throw new IOException("语音响应超过大小上限。");
                        output.Write(buffer, 0, count);
                    }
                    if (output.Length == 0) throw new IOException("语音接口返回空音频。");
                    return output.ToArray();
                }
            }
        }
        private static async Task<TcpClient> Connect(CancellationToken cancellation) {
            var target = new Uri("https://" + Host + ":443/"); Uri proxy = null;
            var system = WebRequest.GetSystemWebProxy();
            if (system != null && !system.IsBypassed(target)) { var candidate = system.GetProxy(target); if (candidate.Host != Host) proxy = candidate; }
            if (proxy == null) Uri.TryCreate(Environment.GetEnvironmentVariable("HTTPS_PROXY") ?? Environment.GetEnvironmentVariable("HTTP_PROXY"), UriKind.Absolute, out proxy);
            var client = new TcpClient();
            try {
                using (cancellation.Register(client.Close)) {
                    await client.ConnectAsync(proxy == null ? Host : proxy.Host, proxy == null ? 443 : proxy.Port);
                    if (proxy != null) {
                        var stream = client.GetStream();
                        byte[] request = Encoding.ASCII.GetBytes("CONNECT " + Host + ":443 HTTP/1.1\r\nHost: " + Host + ":443\r\nProxy-Connection: Keep-Alive\r\n\r\n");
                        await stream.WriteAsync(request, 0, request.Length, cancellation);
                        string response = await ReadHeader(stream, cancellation);
                        if (!response.Contains(" 200 ")) throw new IOException("系统代理未允许语音连接。");
                    }
                    cancellation.ThrowIfCancellationRequested();
                    return client;
                }
            } catch { client.Close(); throw; }
        }
        private static async Task<string> ReadHeader(Stream stream, CancellationToken cancellation) {
            var bytes = new List<byte>(); var one = new byte[1];
            while (bytes.Count < 16384) {
                if (await stream.ReadAsync(one, 0, 1, cancellation) == 0) throw new EndOfStreamException();
                bytes.Add(one[0]); int count = bytes.Count;
                if (count >= 4 && bytes[count - 4] == 13 && bytes[count - 3] == 10 && bytes[count - 2] == 13 && bytes[count - 1] == 10) return Encoding.ASCII.GetString(bytes.ToArray());
            }
            throw new IOException("语音握手响应过长。");
        }
        private static async Task ReadExact(Stream stream, byte[] buffer, CancellationToken cancellation) {
            int total = 0;
            while (total < buffer.Length) { int read = await stream.ReadAsync(buffer, total, buffer.Length - total, cancellation); if (read == 0) throw new EndOfStreamException("语音连接提前中断。"); total += read; }
        }
        private static async Task SendFrame(Stream stream, int opcode, byte[] payload, CancellationToken cancellation) {
            var mask = new byte[4]; using (var random = RandomNumberGenerator.Create()) random.GetBytes(mask);
            using (var frame = new MemoryStream()) {
                frame.WriteByte((byte)(0x80 | opcode));
                if (payload.Length <= 125) frame.WriteByte((byte)(0x80 | payload.Length));
                else { frame.WriteByte(0xFE); frame.WriteByte((byte)(payload.Length >> 8)); frame.WriteByte((byte)payload.Length); }
                frame.Write(mask, 0, 4);
                for (int index = 0; index < payload.Length; index++) frame.WriteByte((byte)(payload[index] ^ mask[index & 3]));
                byte[] bytes = frame.ToArray(); await stream.WriteAsync(bytes, 0, bytes.Length, cancellation);
            }
        }
        private static async Task<byte[]> EdgeSpeech(string text, string voice, string rate, string pitch, CancellationToken cancellation) {
            string connection = Guid.NewGuid().ToString("N");
            string path = "/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TrustedClientToken + "&ConnectionId=" + connection + "&Sec-MS-GEC=" + GenerateSecMsGecV2() + "&Sec-MS-GEC-Version=2-" + ChromiumFullVersion;
            byte[] keyBytes = new byte[16]; using (var random = RandomNumberGenerator.Create()) random.GetBytes(keyBytes);
            string key = Convert.ToBase64String(keyBytes);
            using (var tcp = await Connect(cancellation))
            using (cancellation.Register(tcp.Close))
            using (var ssl = new SslStream(tcp.GetStream(), false)) {
                await ssl.AuthenticateAsClientAsync(Host, null, SslProtocols.Tls12, true);
                string request = "GET " + path + " HTTP/1.1\r\nHost: " + Host + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: " + key + "\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0\r\nCookie: muid=" + Guid.NewGuid().ToString("N").ToUpperInvariant() + ";\r\n\r\n";
                var requestBytes = Encoding.ASCII.GetBytes(request); await ssl.WriteAsync(requestBytes, 0, requestBytes.Length, cancellation);
                string header = await ReadHeader(ssl, cancellation);
                string accept;
                using (var hash = SHA1.Create()) accept = Convert.ToBase64String(hash.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                if (!header.StartsWith("HTTP/1.1 101") || !header.Contains(accept)) throw new IOException("在线语音握手失败，未开始播放。");
                string timestamp = DateTime.UtcNow.ToString("ddd MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", CultureInfo.InvariantCulture);
                string config = "X-Timestamp:" + timestamp + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"true\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n";
                await SendFrame(ssl, 1, Encoding.UTF8.GetBytes(config), cancellation);
                string ssml = "X-RequestId:" + Guid.NewGuid().ToString("N") + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + timestamp + "Z\r\nPath:ssml\r\n\r\n" + FormatSsml(text, voice, rate, pitch);
                await SendFrame(ssl, 1, Encoding.UTF8.GetBytes(ssml), cancellation);
                using (var audio = new MemoryStream())
                using (var fragments = new MemoryStream()) {
                    int fragmentOpcode = 0; bool completed = false;
                    while (!completed) {
                        var head = new byte[2]; await ReadExact(ssl, head, cancellation);
                        bool final = (head[0] & 0x80) != 0; int opcode = head[0] & 15; bool masked = (head[1] & 0x80) != 0;
                        long length = head[1] & 127;
                        if (length == 126) { var extension = new byte[2]; await ReadExact(ssl, extension, cancellation); length = (extension[0] << 8) | extension[1]; }
                        else if (length == 127) { var extension = new byte[8]; await ReadExact(ssl, extension, cancellation); length = 0; foreach (byte value in extension) length = (length << 8) | value; }
                        if (length < 0 || length > MaxAudioBytes) throw new IOException("语音帧超限。");
                        var mask = new byte[4]; if (masked) await ReadExact(ssl, mask, cancellation);
                        var payload = new byte[(int)length]; await ReadExact(ssl, payload, cancellation);
                        if (masked) for (int index = 0; index < payload.Length; index++) payload[index] ^= mask[index & 3];
                        if (opcode == 8) throw new IOException("在线语音在完成前断开。");
                        if (opcode == 9) { await SendFrame(ssl, 10, payload, cancellation); continue; }
                        if (opcode == 10) continue;
                        if (opcode != 0) { fragmentOpcode = opcode; fragments.SetLength(0); }
                        if (fragments.Length + payload.Length > MaxAudioBytes) throw new IOException("语音消息超限。");
                        fragments.Write(payload, 0, payload.Length); if (!final) continue;
                        byte[] message = fragments.ToArray();
                        if (fragmentOpcode == 2 && message.Length >= 2) {
                            int headerLength = (message[0] << 8) | message[1];
                            if (headerLength + 2 <= message.Length && Encoding.ASCII.GetString(message, 2, headerLength).IndexOf("Path:audio", StringComparison.OrdinalIgnoreCase) >= 0) {
                                int count = message.Length - headerLength - 2;
                                if (audio.Length + count > MaxAudioBytes) throw new IOException("语音音频超限。");
                                audio.Write(message, headerLength + 2, count);
                            }
                        } else if (fragmentOpcode == 1) completed = Encoding.UTF8.GetString(message).IndexOf("Path:turn.end", StringComparison.OrdinalIgnoreCase) >= 0;
                    }
                    if (audio.Length == 0) throw new IOException("未收到有效语音。");
                    return audio.ToArray();
                }
            }
        }
    }
}