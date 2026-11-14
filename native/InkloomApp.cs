using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Inklet;

[assembly: System.Reflection.AssemblyTitle("Inkloom 墨图")]
[assembly: System.Reflection.AssemblyProduct("Inkloom")]
[assembly: System.Reflection.AssemblyCompany("泰安市岱岳区清云智数企业管理咨询工作室")]
[assembly: System.Reflection.AssemblyCopyright("版权所有 © 2026 泰安市岱岳区清云智数企业管理咨询工作室。保留所有权利。")]
[assembly: System.Reflection.AssemblyVersion("3.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("3.1.0.0")]

namespace Inkloom {
    public sealed class InkloomApplication : ApplicationContext {
        public readonly FileStore Store;
        public readonly WorkspaceStore Workspace;
        public readonly VaultStore Vault;
        public readonly ReadingHistory Reading;
        public readonly SemaphoreSlim Messages = new SemaphoreSlim(1, 1);
        public readonly List<InkloomWindow> Windows = new List<InkloomWindow>();
        public readonly string Profile, DebugPort;
        private readonly string settingsPath;
        private Dictionary<string, object> settings = new Dictionary<string, object>();
        private Task<CoreWebView2Environment> environment;

        public InkloomApplication(string profile, string file, string port) {
            Profile = profile;
            DebugPort = port;
            Store = new FileStore(profile);
            Reading = new ReadingHistory(profile);
            Workspace = new WorkspaceStore(Store);
            Vault = new VaultStore(Store);
            settingsPath = Path.Combine(profile, "settings.json");
            if (File.Exists(settingsPath)) {
                try { settings = Store.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settingsPath)) ?? settings; }
                catch { }
            }
            OpenWindow(file, false, "note", "", "主工作区", "");
        }

        public InkloomWindow OpenWindow(string file, bool isSecondary, string targetType, string targetId, string title, string querySuffix) {
            string windowId = Guid.NewGuid().ToString("N");
            var scoped = Workspace.ForWindow(windowId);
            if (!isSecondary) scoped.ClaimRecovered();
            var window = new InkloomWindow(this, scoped, file, windowId, isSecondary, targetType, targetId, title, querySuffix);
            Windows.Add(window);
            window.FormClosed += (sender, args) => {
                Windows.Remove(window);
                if (!isSecondary) CloseAllSecondaryWindows();
                BroadcastWindowRegistry();
                if (Windows.Count == 0) ExitThread();
            };
            window.Show();
            BroadcastWindowRegistry();
            return window;
        }

        public void CloseAllSecondaryWindows() {
            foreach (var sub in Windows.Where(w => w.IsSecondary).ToArray()) {
                sub.ForceCloseWindow();
            }
        }

        public object[] DescribeWindows() {
            return Windows.Select(w => w.DescribeWindowInfo()).ToArray();
        }

        public void BroadcastEvent(string eventName, object payload, string excludeWindowId = null) {
            foreach (var win in Windows.ToArray()) {
                if (!String.IsNullOrEmpty(excludeWindowId) && win.WindowId == excludeWindowId) continue;
                win.DeliverBroadcast(eventName, payload);
            }
        }

        public void BroadcastWindowRegistry() {
            BroadcastEvent("windowRegistryChanged", new {
                activeWindowCount = Windows.Count,
                windows = DescribeWindows()
            });
        }

        public Task<CoreWebView2Environment> Environment() {
            if (environment == null) {
                var options = new CoreWebView2EnvironmentOptions();
                if (!String.IsNullOrEmpty(DebugPort)) {
                    options.AdditionalBrowserArguments = "--remote-debugging-port=" + DebugPort + " --remote-debugging-address=127.0.0.1";
                }
                environment = CoreWebView2Environment.CreateAsync(null, Path.Combine(Profile, "webview"), options);
            }
            return environment;
        }

        public object Settings() { return new Dictionary<string, object>(settings); }

        public void SaveSettings(Dictionary<string, object> values) {
            var next = new Dictionary<string, object>(values);
            next.Remove("documentId");
            FileStore.AtomicWrite(settingsPath, Encoding.UTF8.GetBytes(Store.Json.Serialize(next)));
            settings = next;
        }
    }

    public sealed class InkloomWindow : Form {
        private readonly InkloomApplication application;
        public readonly string WindowId;
        public readonly bool IsSecondary;
        public string TargetType;
        public string TargetId;
        public string WindowTitle;
        private readonly string startupQuerySuffix;
        private readonly WebView2 browser = new WebView2();
        private ResourcePack resources;
        private readonly FileStore store;
        private readonly WorkspaceStore workspace;
        private readonly VaultStore vault;
        private string activeDocumentId;
        private bool workspaceReady;
        private bool frontendReady;
        private bool initialized;
        private bool allowClose;
        private bool closeRequested;
        private readonly string startupFile;
        private readonly SemaphoreSlim messages;
        private FileSystemWatcher vaultWatcher;
        private readonly System.Windows.Forms.Timer watcherTimer = new System.Windows.Forms.Timer { Interval = 600 };
        private int vaultChanges;
        private bool watcherOverflow;
        private string pendingIdentityJson;
        private Process localLlmProcess;
        private readonly Dictionary<string, CancellationTokenSource> speechRequests = new Dictionary<string, CancellationTokenSource>();
        private readonly System.Web.Script.Serialization.JavaScriptSerializer messageJson = new System.Web.Script.Serialization.JavaScriptSerializer {
            MaxJsonLength = 64 * 1024 * 1024,
            RecursionLimit = 128
        };
        [DllImport("user32.dll")] private static extern uint GetDpiForSystem();

        public InkloomWindow(InkloomApplication context, WorkspaceStore documents, string file, string windowId, bool isSecondary = false, string targetType = "note", string targetId = "", string title = "", string querySuffix = "") {
            application = context;
            WindowId = windowId;
            IsSecondary = isSecondary;
            TargetType = String.IsNullOrWhiteSpace(targetType) ? "note" : targetType;
            TargetId = targetId ?? "";
            WindowTitle = String.IsNullOrWhiteSpace(title) ? (isSecondary ? "独立副窗口" : "主工作区") : title;
            startupQuerySuffix = querySuffix ?? "";
            store = context.Store;
            workspace = documents;
            vault = context.Vault;
            messages = context.Messages;
            startupFile = file;
            Text = isSecondary ? (WindowTitle + " — Inkloom 墨图 (副窗口)") : "Inkloom 墨图 — 一念落笔，万象成图。";
            double scale = 1;
            try { scale = GetDpiForSystem() / 96.0; } catch { }
            var available = Screen.PrimaryScreen.WorkingArea;
            int baseW = isSecondary ? 1160 : 1440;
            int baseH = isSecondary ? 820 : 900;
            ClientSize = new Size(Math.Min((int)(baseW * scale), available.Width - 80), Math.Min((int)(baseH * scale), available.Height - 100));
            MinimumSize = new Size(Math.Min((int)(880 * scale), available.Width - 100), Math.Min((int)(580 * scale), available.Height - 120));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(243, 247, 242);
            AutoScaleMode = AutoScaleMode.Dpi;
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Inkloom.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            ApplyWindowIcon((Dictionary<string, object>)context.Settings());
            browser.Dock = DockStyle.Fill;
            browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser);
            Shown += async (sender, args) => await Initialize();
            watcherTimer.Tick += (sender, args) => {
                if (frontendReady && Interlocked.Exchange(ref vaultChanges, 0) != 0) {
                    Reply(new { @event = "vaultChanged", data = new { rescanRequired = watcherOverflow } });
                    watcherOverflow = false;
                }
            };
            FormClosed += (sender, args) => { foreach (var request in speechRequests.Values.ToArray()) request.Cancel(); watcherTimer.Dispose(); if (vaultWatcher != null) vaultWatcher.Dispose(); StopLocalLlm(); };
            FormClosing += (sender, args) => {
                if (allowClose || !frontendReady) return;
                args.Cancel = true;
                if (closeRequested) return;
                closeRequested = true;
                Reply(new { @event = "closeWorkspace", data = (object)null });
            };
        }

        public void ForceCloseWindow() {
            allowClose = true;
            if (!IsDisposed && !Disposing) {
                try { Close(); } catch { }
            }
        }

        public object DescribeWindowInfo() {
            return new {
                windowId = WindowId,
                isSecondary = IsSecondary,
                targetType = TargetType,
                targetId = TargetId,
                title = WindowTitle,
                activeDocumentId = activeDocumentId
            };
        }

        public void DeliverBroadcast(string eventName, object payload) {
            if (!frontendReady || IsDisposed || Disposing) return;
            try {
                BeginInvoke(new Action(() => Reply(new { @event = eventName, data = payload })));
            } catch { }
        }

        private async Task Initialize() {
            try {
                var environment = await application.Environment();
                if (IsDisposed || Disposing) return;
                await browser.EnsureCoreWebView2Async(environment);
                var core = browser.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = !String.IsNullOrEmpty(application.DebugPort);
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Settings.AreDefaultScriptDialogsEnabled = false;
                resources = new ResourcePack(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Inkloom.resources"));
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                core.WebResourceRequested += ResourceRequested;
                core.WebMessageReceived += MessageReceived;
                core.NavigationStarting += (sender, args) => {
                    Uri uri;
                    if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || uri.Host != "inkloom.local" || uri.Scheme != "https") args.Cancel = true;
                };
                core.NewWindowRequested += (sender, args) => { args.Handled = true; };
                core.PermissionRequested += (sender, args) => { args.State = CoreWebView2PermissionState.Deny; };
                core.DownloadStarting += (sender, args) => { args.Cancel = true; };
                initialized = true;
                string navUrl = "https://inkloom.local/index.html?window=" + WindowId + (String.IsNullOrEmpty(startupQuerySuffix) ? "" : "&" + startupQuerySuffix);
                core.Navigate(navUrl);
            } catch (Exception error) {
                if (IsDisposed || Disposing) return;
                MessageBox.Show(this, "无法启动 Inkloom 墨图。\n\n" + error.Message, "Inkloom 墨图", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void ResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs args) {
            Uri uri;
            if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out uri)) return;
            if (uri.Scheme == "blob" || uri.Scheme == "data") return;
            if (uri.Host == "inkloom.local" && uri.Scheme == "https") {
                try {
                    string contentType;
                    string name = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
                    Stream content = resources.Open(name, out contentType);
                    if (content != null) {
                        string caching = name.StartsWith("assets/", StringComparison.Ordinal) ? "public, max-age=31536000, immutable" : "no-store";
                        args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(content, 200, "OK", "Content-Type: " + contentType + "\r\nCache-Control: " + caching + "\r\nX-Content-Type-Options: nosniff");
                        return;
                    }
                } catch { }
                args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 404, "Not found", "Content-Type: text/plain");
                return;
            }
            if (uri.Host == "inkloom-files.local" && uri.Scheme == "https") {
                try {
                    var query = System.Web.HttpUtility.ParseQueryString(uri.Query, Encoding.UTF8);
                    string documentId = query["document"];
                    string relative = query["path"];
                    var owner = workspace.Store(documentId);
                    string path = owner.ResolveImagePath(relative);
                    string extension = Path.GetExtension(path).ToLowerInvariant();
                    var types = new Dictionary<string, string> { { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" }, { ".gif", "image/gif" }, { ".bmp", "image/bmp" }, { ".svg", "image/svg+xml" } };
                    if (types.ContainsKey(extension) && File.Exists(path) && new FileInfo(path).Length <= 32 * 1024 * 1024) {
                        var stream = new MemoryStream(File.ReadAllBytes(path), false);
                        args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: " + types[extension]);
                        return;
                    }
                } catch { }
            }
            args.Response = browser.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Blocked", "Content-Type: text/plain");
        }

        private static string StringValue(IDictionary<string, object> values, string key, string fallback = "") {
            object value;
            return values.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
        }

        private void StartVaultWatcher() {
            if (vaultWatcher != null) vaultWatcher.Dispose();
            vaultWatcher = new FileSystemWatcher(vault.CurrentVaultPath) {
                IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                InternalBufferSize = 32 * 1024
            };
            FileSystemEventHandler changed = (sender, args) => {
                string extension = Path.GetExtension(args.FullPath);
                if (extension != "" && !String.Equals(extension, ".md", StringComparison.OrdinalIgnoreCase) && !String.Equals(extension, ".markdown", StringComparison.OrdinalIgnoreCase)) return;
                vault.Invalidate(args.FullPath, args.ChangeType == WatcherChangeTypes.Deleted); Interlocked.Exchange(ref vaultChanges, 1);
            };
            vaultWatcher.Changed += changed; vaultWatcher.Created += changed; vaultWatcher.Deleted += changed;
            vaultWatcher.Renamed += (sender, args) => { vault.Invalidate(null); Interlocked.Exchange(ref vaultChanges, 1); };
            vaultWatcher.Error += (sender, args) => { vault.Invalidate(null); watcherOverflow = true; Interlocked.Exchange(ref vaultChanges, 1); };
            vaultWatcher.EnableRaisingEvents = true; watcherTimer.Start();
        }
        private static bool BooleanValue(IDictionary<string, object> values, string key) {
            object value;
            return values.TryGetValue(key, out value) && value is bool && (bool)value;
        }

        private void Reply(object message) {
            if (!initialized || IsDisposed) return;
            try { browser.CoreWebView2.PostWebMessageAsJson(messageJson.Serialize(message)); }
            catch { }
        }

        private async void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs) {
            Uri source;
            if (!Uri.TryCreate(eventArgs.Source, UriKind.Absolute, out source) || source.Host != "inkloom.local" || source.Scheme != "https") return;
            object id = null;
            bool acquired = false;
            try {
                var request = messageJson.Deserialize<Dictionary<string, object>>(eventArgs.WebMessageAsJson);
                id = request["id"];
                string command = Convert.ToString(request["command"]);
                var args = request.ContainsKey("args") ? (Dictionary<string, object>)request["args"] : new Dictionary<string, object>();
                if (command == "synthesizeSpeech") {
                    object speech = await SynthesizeSpeech(args);
                    Reply(new { id = id, result = speech });
                    return;
                }
                if (command == "cancelSpeech") {
                    CancellationTokenSource pending;
                    if (speechRequests.TryGetValue(StringValue(args, "requestId"), out pending)) pending.Cancel();
                    Reply(new { id = id, result = true });
                    return;
                }
                await messages.WaitAsync();
                acquired = true;
                object result = await Execute(command, args);
                Reply(new { id = id, result = result });
            } catch (Exception error) {
                Reply(new { id = id, error = error.Message });
            } finally { if (acquired) messages.Release(); }
        }

        private async Task<object> SynthesizeSpeech(Dictionary<string, object> args) {
            string documentId = StringValue(args, "documentId");
            if (documentId != activeDocumentId) throw new IOException("朗读笔记已切换，请重新开始。");
            string provider = StringValue(args, "provider", "system");
            bool consent = BooleanValue(args, "consent");
            if (!args.ContainsKey("source")) throw new IOException("缺少朗读源笔记。");
            SpeechService.AssertAccess(StringValue(args, "source"), provider, consent);
            string file = workspace.Store(documentId).CurrentPath;
            if (!String.IsNullOrEmpty(file) && File.Exists(file)) SpeechService.AssertAccess(File.ReadAllText(file), provider, consent);
            string requestId = StringValue(args, "requestId");
            if (String.IsNullOrEmpty(requestId) || speechRequests.ContainsKey(requestId) || speechRequests.Count >= 4) throw new IOException("朗读请求过多，请稍后重试。");
            var cancellation = new CancellationTokenSource();
            speechRequests.Add(requestId, cancellation);
            string endpoint = StringValue(args, "endpoint");
            string secret = ReadSpeechSecret(endpoint);
            try {
                return await Task.Run(() => SpeechService.SynthesizeAsync(StringValue(args, "text"), StringValue(args, "voice"), StringValue(args, "rate", "1"),
                    StringValue(args, "pitch", "+0Hz"), provider, endpoint, StringValue(args, "model"), StringValue(args, "customVoice"), secret, cancellation.Token));
            } finally { speechRequests.Remove(requestId); cancellation.Dispose(); }
        }

        private string SpeechSecretPath() { return Path.Combine(application.Store.DataDirectory, "speech-credentials.bin"); }

        private string ReadSpeechSecret(string endpoint) {
            string file = SpeechSecretPath();
            if (!File.Exists(file)) return "";
            try {
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser);
                var stored = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(plain));
                return StringValue(stored, "endpoint") == endpoint ? StringValue(stored, "key") : "";
            } catch { throw new IOException("无法解密已保存的语音凭据，请重新保存或清除。"); }
        }

        private Dictionary<string, object> OpenAndRegisterFile(string fullPath) {
            var doc = workspace.Add(fullPath);
            var loaded = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(workspace.Load(doc.Id)));
            loaded["id"] = doc.Id;
            if (fullPath.StartsWith(vault.CurrentVaultPath.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) {
                loaded["relativePath"] = fullPath.Substring(vault.CurrentVaultPath.TrimEnd('\\').Length + 1).Replace('\\', '/');
                loaded["noteId"] = vault.NoteId(fullPath);
                vault.RememberActiveNote(fullPath);
            }
            return loaded;
        }

        private object DescribeVault() {
            return vault.DescribeVault();
        }

        private void ApplyWindowIcon(Dictionary<string, object> values) {
            string theme = StringValue(values, "interfaceTheme");
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, new[] { "graphite", "pine", "plum" }.Contains(theme) ? "Inkloom-dark.ico" : "Inkloom.ico");
            if (File.Exists(iconPath)) { var previous = Icon; Icon = new Icon(iconPath); if (previous != null) previous.Dispose(); }
        }

        private async Task<object> Execute(string command, Dictionary<string, object> args) {
            string documentId = StringValue(args, "documentId");
            if (command == "speechSecretStatus") return new { configured = !String.IsNullOrEmpty(ReadSpeechSecret(StringValue(args, "endpoint"))) };
            if (command == "saveSpeechSecret") {
                string endpoint = StringValue(args, "endpoint");
                SpeechService.ValidateEndpoint(endpoint);
                string secret = StringValue(args, "key").Trim();
                if (secret.Length == 0 || secret.Length > 4096 || secret.Contains("\n") || secret.Contains("\r")) throw new IOException("语音凭据为空或格式不合法。");
                byte[] plain = Encoding.UTF8.GetBytes(messageJson.Serialize(new { endpoint = endpoint, key = secret }));
                FileStore.AtomicWrite(SpeechSecretPath(), ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser));
                return new { configured = true };
            }
            if (command == "clearSpeechSecret") { if (File.Exists(SpeechSecretPath())) File.Delete(SpeechSecretPath()); return new { configured = false }; }
            if (command == "ready") { frontendReady = true; StartVaultWatcher(); return true; }
            if (command == "runtimeMetrics") {
                var identifiers = new HashSet<int> { Process.GetCurrentProcess().Id };
                foreach (var information in browser.CoreWebView2.Environment.GetProcessInfos()) identifiers.Add(information.ProcessId);
                var processes = new List<object>(); long privateBytes = 0; long workingSetBytes = 0;
                foreach (int id in identifiers) {
                    try {
                        using (var process = Process.GetProcessById(id)) {
                            process.Refresh(); privateBytes += process.PrivateMemorySize64; workingSetBytes += process.WorkingSet64;
                            processes.Add(new { id = id, name = process.ProcessName, privateBytes = process.PrivateMemorySize64, workingSetBytes = process.WorkingSet64, handles = process.HandleCount, threads = process.Threads.Count });
                        }
                    } catch (InvalidOperationException) { } catch (ArgumentException) { }
                }
                return new { measuredAt = DateTime.UtcNow.ToString("o"), privateBytes = privateBytes, workingSetBytes = workingSetBytes, processes = processes.ToArray(), scope = "Inkloom process and its WebView2 environment" };
            }
            if (command == "hello") {
                object document = null;
                if (!workspaceReady) {
                    workspaceReady = true;
                    string initialFile = startupFile;
                    if (!workspace.Documents.Any(item => item.Recovered) && (String.IsNullOrEmpty(initialFile) || !File.Exists(initialFile))) initialFile = await Task.Run(() => vault.ResolveStartupNote());
                    if (workspace.Documents.Any(item => item.Recovered)) {
                        var recovered = workspace.Documents.First(item => item.Recovered);
                        activeDocumentId = recovered.Id;
                        document = await Task.Run(() => workspace.Load(recovered.Id));
                    } else if (!String.IsNullOrEmpty(initialFile) && File.Exists(initialFile)) {
                        var opened = await Task.Run(() => OpenAndRegisterFile(initialFile));
                        activeDocumentId = Convert.ToString(opened["id"]);
                        document = opened;
                    } else {
                        activeDocumentId = workspace.Add(null).Id;
                        document = await Task.Run(() => workspace.Load(activeDocumentId));
                    }
                } else {
                    var active = workspace.Documents.FirstOrDefault(item => item.Id == activeDocumentId) ?? workspace.Documents.FirstOrDefault();
                    if (active == null) active = workspace.Add(null);
                    activeDocumentId = active.Id;
                    if (String.IsNullOrEmpty(active.Path)) document = await Task.Run(() => workspace.Load(activeDocumentId));
                    else document = await Task.Run(() => OpenAndRegisterFile(active.Path));
                }
                return new {
                    settings = application.Settings(),
                    document = document,
                    documents = workspace.List(),
                    vault = await Task.Run(() => DescribeVault()),
                    workspace = true,
                    multipleWindows = true,
                    isSecondary = IsSecondary,
                    activeWindowCount = application.Windows.Count,
                    windows = application.DescribeWindows(),
                    windowId = WindowId
                };
            }
            if (command == "openSecondaryWindow") {
                string targetType = StringValue(args, "targetType", "note");
                string targetId = StringValue(args, "targetId");
                string title = StringValue(args, "title", "独立副窗口");
                string rel = StringValue(args, "relativePath");
                string pathArg = StringValue(args, "path");
                string page = StringValue(args, "readerPage");
                string cfi = StringValue(args, "readerCfi");
                string initialFile = null;
                if (targetType == "note" || targetType == "whiteboard") {
                    try {
                        string candidate = !String.IsNullOrWhiteSpace(pathArg) && File.Exists(pathArg)
                            ? pathArg
                            : (!String.IsNullOrWhiteSpace(rel) ? Path.Combine(vault.CurrentVaultPath, rel.Replace('/', Path.DirectorySeparatorChar)) : null);
                        if (!String.IsNullOrWhiteSpace(candidate)) {
                            candidate = vault.SafeNotePath(candidate);
                            if (File.Exists(candidate)) initialFile = candidate;
                        }
                    } catch { }
                }
                string querySuffix = "secondary=1&targetType=" + Uri.EscapeDataString(targetType)
                    + "&targetId=" + Uri.EscapeDataString(targetId)
                    + "&title=" + Uri.EscapeDataString(title)
                    + (String.IsNullOrEmpty(rel) ? "" : "&relativePath=" + Uri.EscapeDataString(rel))
                    + (String.IsNullOrEmpty(page) ? "" : "&page=" + Uri.EscapeDataString(page))
                    + (String.IsNullOrEmpty(cfi) ? "" : "&cfi=" + Uri.EscapeDataString(cfi));
                object createdInfo = Invoke(new Func<object>(() => {
                    var sub = application.OpenWindow(initialFile, true, targetType, targetId, title, querySuffix);
                    return sub.DescribeWindowInfo();
                }));
                return new {
                    window = createdInfo,
                    multipleWindows = true,
                    activeWindowCount = application.Windows.Count,
                    windows = application.DescribeWindows()
                };
            }
            if (command == "listWindows") {
                return new {
                    multipleWindows = true,
                    activeWindowCount = application.Windows.Count,
                    windows = application.DescribeWindows()
                };
            }
            if (command == "broadcastWindowEvent") {
                application.BroadcastEvent("crossWindowSync", args, WindowId);
                return new {
                    delivered = Math.Max(0, application.Windows.Count - 1),
                    activeWindowCount = application.Windows.Count
                };
            }
            if (command == "closeSecondaryWindow") {
                string targetWindowId = StringValue(args, "targetWindowId", "all");
                Invoke(new Action(() => {
                    if (String.Equals(targetWindowId, "all", StringComparison.OrdinalIgnoreCase)) {
                        application.CloseAllSecondaryWindows();
                    } else {
                        var match = application.Windows.FirstOrDefault(w => w.IsSecondary && w.WindowId == targetWindowId);
                        if (match != null) match.ForceCloseWindow();
                    }
                }));
                return new {
                    activeWindowCount = application.Windows.Count,
                    windows = application.DescribeWindows()
                };
            }
            if (command == "vaultInfo") return await Task.Run(() => DescribeVault());
            if (command == "exportAppearance") {
                string json = StringValue(args, "json"); string name = Path.GetFileName(StringValue(args, "name", "appearance.json"));
                if (json.Length > 4 * 1024 * 1024 || !name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new IOException("外观包文件无效或超过4 MiB。");
                var package = store.Json.Deserialize<Dictionary<string, object>>(json);
                if (package == null || !new[] { "inkloom.appearance", "inkloom.icons" }.Contains(StringValue(package, "format"))) throw new IOException("不支持的外观包格式。");
                using (var dialog = new SaveFileDialog { Title = "导出外观包", Filter = "JSON外观包|*.json", FileName = name, DefaultExt = "json", AddExtension = true, OverwritePrompt = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                    using (var output = new FileStream(dialog.FileName, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { byte[] bytes = Encoding.UTF8.GetBytes(json); output.Write(bytes, 0, bytes.Length); output.Flush(true); }
                    return new { path = dialog.FileName };
                }
            }
            if (command == "rescanVault") return await Task.Run(() => vault.DescribeVault(true));
            if (command == "vaultWorkspacePreferences") return await Task.Run(() => vault.WorkspacePreferences());
            if (command == "setVaultStartup") return await Task.Run(() => vault.SetStartupPreference(StringValue(args, "mode"), StringValue(args, "noteId")));
            if (command == "forgetRecentVault") return await Task.Run(() => vault.ForgetRecentVault(StringValue(args, "path")));
            if (command == "exportVaultIdentity") {
                var manifest = await Task.Run(() => vault.ExportIdentity());
                string path = StringValue(args, "path");
                if (String.IsNullOrWhiteSpace(path)) using (var dialog = new SaveFileDialog { Title = "导出知识库身份清单", Filter = "Inkloom 身份清单|*.inkloom-identity.json", FileName = "vault.inkloom-identity.json", AddExtension = true, OverwritePrompt = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return null; path = dialog.FileName;
                }
                if (!Path.IsPathRooted(path) || !path.EndsWith(".inkloom-identity.json", StringComparison.OrdinalIgnoreCase)) throw new IOException("请选择绝对路径且以.inkloom-identity.json结尾的新文件。");
                byte[] bytes = Encoding.UTF8.GetBytes(store.Json.Serialize(manifest));
                using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { file.Write(bytes, 0, bytes.Length); file.Flush(true); }
                return new { path = path, noteCount = manifest.notes.Count };
            }
            if (command == "previewVaultIdentity") {
                string path = StringValue(args, "path");
                if (String.IsNullOrWhiteSpace(path)) using (var dialog = new OpenFileDialog { Title = "选择知识库身份清单", Filter = "Inkloom 身份清单|*.inkloom-identity.json|JSON|*.json", Multiselect = false }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return null; path = dialog.FileName;
                }
                if (!Path.IsPathRooted(path) || !path.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new IOException("身份清单路径必须是JSON文件的绝对路径。");
                var info = new FileInfo(path); if (info.Length > 8 * 1024 * 1024) throw new IOException("身份清单超过8 MiB。");
                pendingIdentityJson = File.ReadAllText(path, new UTF8Encoding(false, true));
                return await Task.Run(() => vault.PreviewIdentity(pendingIdentityJson));
            }
            if (command == "importVaultIdentity") {
                if (workspace.Documents.Any(item => item.Dirty)) throw new IOException("有未保存笔记，请先保存后迁移身份。");
                if (pendingIdentityJson == null) throw new IOException("请先选择并预览身份清单。");
                var imported = await Task.Run(() => vault.ImportIdentity(pendingIdentityJson, StringValue(args, "token"))); pendingIdentityJson = null;
                return new { vault = await Task.Run(() => DescribeVault()), imported = imported };
            }
            if (command == "listVaultRecovery") {
                int offset, limit;
                if (!Int32.TryParse(StringValue(args, "offset", "0"), out offset) || !Int32.TryParse(StringValue(args, "limit", "25"), out limit)) throw new IOException("恢复记录分页参数无效。");
                return await Task.Run(() => vault.ListRecovery(offset, limit, StringValue(args, "filter", "pending")));
            }
            if (command == "previewVaultRecovery") return await Task.Run(() => vault.PreviewRecovery(StringValue(args, "id")));
            if (command == "openRecoveryDirectory") {
                string directory = vault.RecoveryDirectory(StringValue(args, "id"));
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(directory) { UseShellExecute = true });
                return true;
            }
            if (command == "restoreVaultRecovery") {
                if (workspace.Documents.Any(item => item.Dirty)) throw new IOException("有未保存笔记，请先保存或关闭后恢复。");
                object restored = await Task.Run(() => vault.RestoreRecovery(StringValue(args, "id"), StringValue(args, "token")));
                var record = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(restored));
                string[] invalidated = workspace.Documents.Select(item => item.Id).ToArray(); workspace.Close(invalidated, false); activeDocumentId = null;
                object document = null; string openingWarning = null;
                try { var opened = await Task.Run(() => OpenAndRegisterFile(Convert.ToString(record["path"]))); activeDocumentId = Convert.ToString(opened["id"]); document = opened; }
                catch (Exception error) { openingWarning = "原文已恢复，但文档打开失败：" + error.Message; }
                if (document == null) { activeDocumentId = workspace.Add(null).Id; document = await Task.Run(() => workspace.Load(activeDocumentId)); }
                return new { vault = await Task.Run(() => DescribeVault()), document = document, invalidatedIds = invalidated, restoredFiles = record["restoredFiles"], openingWarning = openingWarning };
            }
            if (command == "reloadVaultNote") {
                var existing = workspace.Get(documentId);
                if (existing.Dirty) throw new IOException("笔记有未保存修改，未替换当前会话。");
                string full = vault.SafeNotePath(StringValue(args, "path"));
                var loaded = await Task.Run(() => store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(workspace.Store(documentId).Open(full))));
                existing.Path = full; existing.Name = Path.GetFileName(full); existing.Loaded = true;
                loaded["id"] = documentId; loaded["noteId"] = vault.NoteId(full);
                loaded["relativePath"] = full.Substring(vault.CurrentVaultPath.TrimEnd('\\').Length + 1).Replace('\\', '/');
                return loaded;
            }
            if (command == "openVault") {
                if (workspace.Documents.Any(item => item.Dirty)) throw new IOException("有未保存笔记，请先保存或关闭后切换知识库。");
                string folder = StringValue(args, "path");
                if (String.IsNullOrWhiteSpace(folder)) {
                    using (var dialog = new FolderBrowserDialog { Description = "选择作为 Inkloom 墨图知识库的本地文件夹", SelectedPath = vault.CurrentVaultPath }) {
                        if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                        folder = dialog.SelectedPath;
                    }
                }
                object description = await Task.Run(() => vault.SetVaultDirectory(folder));
                string[] invalidated = workspace.Documents.Select(item => item.Id).ToArray(); workspace.Close(invalidated, false); activeDocumentId = null;
                StartVaultWatcher();
                string initialFile = await Task.Run(() => vault.ResolveStartupNote());
                object document = null; string openingWarning = null;
                try {
                    if (initialFile == null) { activeDocumentId = workspace.Add(null).Id; document = await Task.Run(() => workspace.Load(activeDocumentId)); }
                    else { var opened = await Task.Run(() => OpenAndRegisterFile(initialFile)); activeDocumentId = Convert.ToString(opened["id"]); document = opened; }
                } catch (Exception error) { openingWarning = "知识库已切换，但文档打开失败：" + error.Message; }
                if (document == null) { activeDocumentId = workspace.Add(null).Id; document = await Task.Run(() => workspace.Load(activeDocumentId)); }
                return new { vault = await Task.Run(() => DescribeVault()), document = document, invalidatedIds = invalidated, openingWarning = openingWarning };
            }
            if (command == "openVaultNote") {
                string path = StringValue(args, "path");
                string rel = StringValue(args, "relativePath");
                string full = !String.IsNullOrWhiteSpace(path) && File.Exists(path)
                    ? path
                    : Path.Combine(vault.CurrentVaultPath, rel.Replace('/', Path.DirectorySeparatorChar));
                full = vault.SafeNotePath(full);
                var opened = await Task.Run(() => OpenAndRegisterFile(full));
                activeDocumentId = Convert.ToString(opened["id"]);
                return new { documents = new object[] { opened }, vault = await Task.Run(() => DescribeVault()) };
            }
            if (command == "createVaultNote") {
                string createdPath = await Task.Run(() => vault.CreateNoteFile(StringValue(args, "title"), StringValue(args, "folder"), StringValue(args, "source"), BooleanValue(args, "exclusive"), BooleanValue(args, "overwrite")));
                string createdRel = createdPath.Substring(vault.CurrentVaultPath.Length).TrimStart(Path.DirectorySeparatorChar).Replace('\\', '/');
                if (BooleanValue(args, "background")) return new { note = new { id = vault.NoteId(createdPath), name = Path.GetFileName(createdPath), path = createdPath, relativePath = createdRel }, vault = await Task.Run(() => DescribeVault()) };
                var opened = await Task.Run(() => OpenAndRegisterFile(createdPath));
                activeDocumentId = Convert.ToString(opened["id"]);
                return new {
                    note = new {
                        id = vault.NoteId(createdPath),
                        name = Path.GetFileName(createdPath),
                        path = createdPath,
                        relativePath = createdRel,
                        source = Convert.ToString(opened["text"]),
                    },
                    vault = await Task.Run(() => DescribeVault()),
                    document = opened
                };
            }
            if (command == "createVaultFolder") {
                string folder = await Task.Run(() => vault.CreateVaultFolder(StringValue(args, "folder")));
                return new { folder = folder, vault = await Task.Run(() => vault.DescribeVault(true)) };
            }
            if (command == "revealVaultItem") {
                string rel = StringValue(args, "relativePath");
                string pathArg = StringValue(args, "path");
                bool isFolder = BooleanValue(args, "isFolder");
                string full;
                if (isFolder) {
                    full = vault.SafeDirectoryPath(!String.IsNullOrWhiteSpace(rel) ? rel : pathArg, true);
                    if (!Directory.Exists(full)) Directory.CreateDirectory(full);
                } else {
                    full = !String.IsNullOrWhiteSpace(pathArg) && File.Exists(pathArg) ? vault.SafeNotePath(pathArg) : vault.SafeNotePath(rel);
                }
                bool exists = isFolder ? Directory.Exists(full) : File.Exists(full);
                if (exists && String.IsNullOrEmpty(application.DebugPort) && !BooleanValue(args, "dryRun")) {
                    var psi = isFolder
                        ? new ProcessStartInfo("explorer.exe", "\"" + full + "\"") { UseShellExecute = true }
                        : new ProcessStartInfo("explorer.exe", "/select,\"" + full + "\"") { UseShellExecute = true };
                    Process.Start(psi);
                }
                return new { revealed = exists, fullPath = full, relativePath = rel, isFolder = isFolder, exists = exists };
            }
            if (command == "deleteVaultItems") {
                var dirtyDocs = workspace.Documents.Where(item => item.Dirty).ToArray();
                if (dirtyDocs.Length > 0) throw new IOException("有未保存修改的笔记，请先保存后再执行删除。");
                var deletedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (args.ContainsKey("deletedNotes") && args["deletedNotes"] is IEnumerable) {
                    foreach (Dictionary<string, object> del in ((IEnumerable)args["deletedNotes"]).Cast<Dictionary<string, object>>()) {
                        string rawTarget = Convert.ToString(del.ContainsKey("path") && del["path"] != null && !Convert.ToString(del["path"]).StartsWith("vault://", StringComparison.OrdinalIgnoreCase) ? del["path"] : del["relativePath"]);
                        deletedPaths.Add(vault.SafeNotePath(rawTarget));
                    }
                }
                var updatedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (args.ContainsKey("updates") && args["updates"] is IEnumerable) {
                    foreach (Dictionary<string, object> upd in ((IEnumerable)args["updates"]).Cast<Dictionary<string, object>>()) {
                        string rawUpd = Convert.ToString(upd.ContainsKey("path") && upd["path"] != null && !Convert.ToString(upd["path"]).StartsWith("vault://", StringComparison.OrdinalIgnoreCase) ? upd["path"] : upd["relativePath"]);
                        updatedPaths.Add(vault.SafeNotePath(rawUpd));
                    }
                }
                string[] invalidated = workspace.Documents
                    .Where(doc => !String.IsNullOrEmpty(doc.Path) && (deletedPaths.Contains(doc.Path) || updatedPaths.Contains(doc.Path)))
                    .Select(doc => doc.Id)
                    .ToArray();
                object summary = await Task.Run(() => vault.ApplyDeletePlan(args));
                if (invalidated.Length > 0) workspace.Close(invalidated, true);
                var remainingDoc = workspace.Documents.FirstOrDefault();
                object activeDocObj = null;
                if (remainingDoc != null && !String.IsNullOrEmpty(remainingDoc.Path) && File.Exists(remainingDoc.Path)) {
                    var opened = await Task.Run(() => OpenAndRegisterFile(remainingDoc.Path));
                    activeDocumentId = Convert.ToString(opened["id"]);
                    activeDocObj = opened;
                } else {
                    string fallbackNote = await Task.Run(() => vault.ResolveStartupNote());
                    if (!String.IsNullOrEmpty(fallbackNote) && File.Exists(fallbackNote)) {
                        var opened = await Task.Run(() => OpenAndRegisterFile(fallbackNote));
                        activeDocumentId = Convert.ToString(opened["id"]);
                        activeDocObj = opened;
                    } else {
                        activeDocumentId = workspace.Add(null).Id;
                        activeDocObj = await Task.Run(() => workspace.Load(activeDocumentId));
                    }
                }
                return new {
                    summary = summary,
                    invalidatedIds = invalidated,
                    document = activeDocObj,
                    vault = await Task.Run(() => vault.DescribeVault(true))
                };
            }
            if (command == "scanRawFiles") {
                return new { rawFiles = await Task.Run(() => vault.ScanRawFiles()) };
            }
            if (command == "listReadingDocuments") {
                return new { rawFiles = await Task.Run(() => vault.ListReadingDocuments()) };
            }
            if (command == "readRawFile") {
                return await Task.Run(() => vault.ReadRawFile(StringValue(args, "relativePath")));
            }
            if (command == "importRawFile") {
                return await Task.Run(() => vault.ImportRawFile(StringValue(args, "fileName"), StringValue(args, "base64Data"), StringValue(args, "source")));
            }
            if (command == "openDailyNote") {
                string dailyPath = await Task.Run(() => vault.EnsureDailyNoteFile(StringValue(args, "date")));
                var opened = await Task.Run(() => OpenAndRegisterFile(dailyPath));
                activeDocumentId = Convert.ToString(opened["id"]);
                return new {
                    note = new { id = vault.NoteId(dailyPath), name = Path.GetFileName(dailyPath), path = dailyPath },
                    vault = await Task.Run(() => DescribeVault()),
                    document = opened
                };
            }
            if (command == "updateVaultNoteSource") {
                string path = StringValue(args, "path");
                string rel = StringValue(args, "relativePath");
                string full = !String.IsNullOrWhiteSpace(path) && File.Exists(path)
                    ? path
                    : Path.Combine(vault.CurrentVaultPath, rel.Replace('/', Path.DirectorySeparatorChar));
                full = vault.SafeNotePath(full);
                var existing = workspace.FindPath(full);
                if (existing != null && existing.Dirty) throw new IOException("目标笔记仍有未保存修改，请先保存该笔记。");
                string updatedText = StringValue(args, "source");
                await Task.Run(() => vault.UpdateFileSource(full, updatedText, StringValue(args, "expectedSource", null)));
                object loaded = existing == null ? null : await Task.Run(() => workspace.Store(existing.Id).Open(full));
                string textHash = FileStore.TextHash(updatedText);
                string relNormalized = full.StartsWith(vault.CurrentVaultPath.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)
                    ? full.Substring(vault.CurrentVaultPath.TrimEnd('\\').Length + 1).Replace('\\', '/')
                    : rel;
                application.BroadcastEvent("crossWindowSync", new {
                    eventType = "note-saved",
                    sourceWindowId = WindowId,
                    payload = new {
                        noteId = vault.NoteId(full),
                        path = full,
                        relativePath = relNormalized,
                        source = updatedText,
                        hash = textHash
                    }
                }, WindowId);
                return new { vault = await Task.Run(() => DescribeVault()), document = loaded, hash = textHash };
            }
            if (command == "toggleVaultStar") {
                bool starred = vault.ToggleStarred(StringValue(args, "path"));
                return new { starred = starred, vault = await Task.Run(() => DescribeVault()) };
            }
            if (command == "renameVaultNote") {
                var affected = ((IEnumerable)args["updates"]).Cast<Dictionary<string, object>>().Select(update => workspace.FindPath(StringValue(update, "path"))).Where(item => item != null).ToArray();
                if (affected.Any(item => item.Dirty)) throw new IOException("涉及的笔记有未保存修改，请保存后重试，未执行重命名。");
                object committed = await Task.Run(() => vault.ApplyRenamePlan(args));
                var transaction = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(committed));
                string newFull = Convert.ToString(transaction["path"]);
                string[] invalidated = affected.Select(item => item.Id).ToArray();
                workspace.Close(invalidated, false);
                var opened = await Task.Run(() => OpenAndRegisterFile(newFull));
                activeDocumentId = Convert.ToString(opened["id"]);
                return new {
                    note = new {
                        id = vault.NoteId(newFull),
                        name = Path.GetFileName(newFull),
                        path = newFull,
                        relativePath = StringValue(args, "newRelativePath"),
                        source = Convert.ToString(opened["text"])
                    },
                    vault = await Task.Run(() => DescribeVault()),
                    document = opened,
                    invalidatedIds = invalidated,
                    backupDirectory = transaction["backupDirectory"],
                    rewrittenLinks = args["rewrittenLinks"], affectedNotes = args["affectedNotes"]
                };
            }
            if (command == "moveVaultNote") {
                var affected = ((IEnumerable)args["updates"]).Cast<Dictionary<string, object>>().Select(update => workspace.FindPath(StringValue(update, "path"))).Where(item => item != null).ToArray();
                if (affected.Any(item => item.Dirty)) throw new IOException("涉及的笔记有未保存修改，请保存后重试，未执行移动。");
                object committed = await Task.Run(() => vault.ApplyMovePlan(args));
                var transaction = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(committed));
                string newFull = Convert.ToString(transaction["path"]);
                string[] invalidated = affected.Select(item => item.Id).ToArray();
                if (invalidated.Length > 0) workspace.Close(invalidated, false);
                var opened = await Task.Run(() => OpenAndRegisterFile(newFull));
                activeDocumentId = Convert.ToString(opened["id"]);
                return new {
                    note = new {
                        id = vault.NoteId(newFull),
                        name = Path.GetFileName(newFull),
                        path = newFull,
                        relativePath = StringValue(args, "newRelativePath"),
                        source = Convert.ToString(opened["text"])
                    },
                    vault = await Task.Run(() => DescribeVault()),
                    document = opened,
                    invalidatedIds = invalidated,
                    rewrittenLinks = args["rewrittenLinks"],
                    affectedNotes = args["affectedNotes"]
                };
            }
            if (command == "moveVaultFolder") {
                if (workspace.Documents.Any(item => item.Dirty)) throw new IOException("涉及的笔记有未保存修改，请保存后重试，未执行目录移动。");
                var activeEntry = workspace.Documents.FirstOrDefault(item => item.Id == activeDocumentId);
                string currentActivePath = activeEntry != null && activeEntry.Path != null ? activeEntry.Path : "";
                string reopenedTargetFull = "";
                var movedNotesList = args.ContainsKey("movedNotes") && args["movedNotes"] is IEnumerable
                    ? ((IEnumerable)args["movedNotes"]).Cast<Dictionary<string, object>>().ToArray()
                    : new Dictionary<string, object>[0];
                var updatesList = args.ContainsKey("updates") && args["updates"] is IEnumerable
                    ? ((IEnumerable)args["updates"]).Cast<Dictionary<string, object>>().ToArray()
                    : new Dictionary<string, object>[0];
                var affectedDocs = new List<string>();
                foreach (var m in movedNotesList) {
                    string oldFull = vault.SafeNotePath(StringValue(m, "oldRelativePath"));
                    string newFull = vault.SafeNotePath(StringValue(m, "newRelativePath"));
                    var doc = workspace.FindPath(oldFull);
                    if (doc != null) affectedDocs.Add(doc.Id);
                    if (!String.IsNullOrEmpty(currentActivePath) && String.Equals(currentActivePath, oldFull, StringComparison.OrdinalIgnoreCase)) {
                        reopenedTargetFull = newFull;
                    }
                }
                foreach (var u in updatesList) {
                    string uFull = vault.SafeNotePath(StringValue(u, "relativePath"));
                    var doc = workspace.FindPath(uFull);
                    if (doc != null && !affectedDocs.Contains(doc.Id)) affectedDocs.Add(doc.Id);
                    if (String.IsNullOrEmpty(reopenedTargetFull) && !String.IsNullOrEmpty(currentActivePath) && String.Equals(currentActivePath, uFull, StringComparison.OrdinalIgnoreCase)) {
                        reopenedTargetFull = uFull;
                    }
                }
                await Task.Run(() => vault.ApplyFolderMovePlan(args));
                string[] invalidated = affectedDocs.Distinct().ToArray();
                if (invalidated.Length > 0) workspace.Close(invalidated, false);
                Dictionary<string, object> opened = null;
                if (!String.IsNullOrEmpty(reopenedTargetFull) && File.Exists(reopenedTargetFull)) {
                    opened = await Task.Run(() => OpenAndRegisterFile(reopenedTargetFull));
                    activeDocumentId = Convert.ToString(opened["id"]);
                }
                return new {
                    oldFolder = StringValue(args, "sourceFolder"),
                    newFolder = StringValue(args, "newFolderPath"),
                    movedCount = movedNotesList.Length,
                    rewrittenLinks = args["rewrittenLinks"],
                    invalidatedIds = invalidated,
                    document = opened,
                    vault = await Task.Run(() => DescribeVault())
                };
            }
            if (command == "workspaceList") return workspace.List();
            if (command == "loadDocument") return await Task.Run(() => workspace.Load(documentId));
            if (command == "activateDocument") { var active = workspace.Get(documentId); activeDocumentId = documentId; await Task.Run(() => vault.RememberActiveNote(active.Path)); return true; }
            if (command == "storeSession") return await Task.Run(() => workspace.SaveSession(documentId, (Dictionary<string, object>)args["snapshot"]));
            if (command == "readSession") return await Task.Run(() => workspace.ReadSession(documentId));
            if (command == "releaseDocument") { if (workspace.Documents.Any(item => item.Id == documentId)) workspace.Store(documentId).ReleaseRecoveryCache(); return true; }
            if (command == "closeDocuments") {
                string[] ids = ((IEnumerable)args["ids"]).Cast<object>().Select(Convert.ToString).ToArray();
                workspace.Close(ids, BooleanValue(args, "discard"));
                return true;
            }
            if (command == "finishClose") {
                bool discard = BooleanValue(args, "discard");
                if (!discard && workspace.Documents.Any(item => item.Dirty)) throw new IOException("仍有未保存文档，关闭已取消。");
                workspace.Close(workspace.Documents.Select(item => item.Id).ToArray(), discard);
                if (!IsSecondary) Invoke(new Action(() => application.CloseAllSecondaryWindows()));
                allowClose = true; BeginInvoke(new Action(Close)); return true;
            }
            if (command == "cancelClose") { closeRequested = false; return true; }
            if (command == "readReadingPosition") return await Task.Run(() => application.Reading.Read(workspace.Get(documentId).Path));
            if (command == "saveReadingPosition") {
                object value;
                if (!args.TryGetValue("position", out value)) return false;
                var point = store.Json.Deserialize<ReadingPosition>(store.Json.Serialize(value));
                point.Path = workspace.Get(documentId).Path;
                await Task.Run(() => application.Reading.Record(point));
                return true;
            }
            if (command == "settings") { application.SaveSettings(args); ApplyWindowIcon(args); return true; }
            if (command == "state") {
                if (!String.IsNullOrEmpty(documentId)) workspace.MarkDirty(documentId, BooleanValue(args, "dirty"));
                Text = (BooleanValue(args, "dirty") ? "* " : "") + StringValue(args, "name") + " - Inkloom 墨图";
                return true;
            }
            if (command == "searchState") return true;
            if (command == "draft") {
                workspace.EnsureWritable(documentId);
                await Task.Run(() => workspace.Store(documentId).SaveRecovery(args));
                workspace.MarkDirty(documentId, true);
                return new { persisted = true, documentId = documentId, revision = args["revision"] };
            }
            if (command == "draftDelta") {
                workspace.EnsureWritable(documentId);
                object result = await Task.Run(() => workspace.Store(documentId).AppendRecovery(args));
                workspace.MarkDirty(documentId, true);
                return result;
            }
            if (command == "open") {
                using (var dialog = new OpenFileDialog { Title = "打开 Markdown", Filter = "Markdown 文档|*.md;*.markdown;*.txt|所有文件|*.*", CheckFileExists = true, Multiselect = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                    var list = new List<object>();
                    foreach (string f in dialog.FileNames) list.Add(OpenAndRegisterFile(f));
                    return new { documents = list.ToArray() };
                }
            }
            if (command == "save") {
                workspace.EnsureWritable(documentId);
                var owner = workspace.Store(documentId);
                string path = owner.CurrentPath;
                if (path == null || BooleanValue(args, "saveAs")) {
                    using (var dialog = new SaveFileDialog { Title = "保存 Markdown", Filter = "Markdown 文档|*.md", FileName = StringValue(args, "name", "未命名.md"), DefaultExt = "md", AddExtension = true, OverwritePrompt = true }) {
                        if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                        path = dialog.FileName;
                    }
                }
                var annotations = args.ContainsKey("annotations") ? (Dictionary<string, object>)args["annotations"] : new Dictionary<string, object>();
                var resources = args.ContainsKey("resources") ? ((IEnumerable)args["resources"]).Cast<object>().Select(Convert.ToString).ToArray() : new string[0];
                string savedText = StringValue(args, "text");
                var result = await Task.Run(() => workspace.Save(documentId, path, savedText, annotations, resources));
                await Task.Run(() => vault.RememberActiveNote(path));
                if (!String.IsNullOrEmpty(path) && path.StartsWith(vault.CurrentVaultPath.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) {
                    string relNormalized = path.Substring(vault.CurrentVaultPath.TrimEnd('\\').Length + 1).Replace('\\', '/');
                    application.BroadcastEvent("crossWindowSync", new {
                        eventType = "note-saved",
                        sourceWindowId = WindowId,
                        payload = new {
                            noteId = vault.NoteId(path),
                            path = path,
                            relativePath = relNormalized,
                            source = savedText,
                            hash = FileStore.TextHash(savedText)
                        }
                    }, WindowId);
                }
                return result;
            }
            if (command == "importImage") { workspace.EnsureWritable(documentId); return workspace.Store(documentId).ImportImage(StringValue(args, "data"), StringValue(args, "mime")); }
            if (command == "readAsset") return workspace.Store(documentId).ReadImage(StringValue(args, "path"));
            if (command == "export") {
                if (StringValue(args, "format") == "epub") {
                    string epubName = Path.GetFileNameWithoutExtension(StringValue(args, "name", "电子书"));
                    if (String.IsNullOrWhiteSpace(epubName)) epubName = "电子书";
                    byte[] epubBytes = Convert.FromBase64String(StringValue(args, "data"));
                    if (epubBytes.Length < 4 || epubBytes[0] != 80 || epubBytes[1] != 75) throw new IOException("EPUB 电子书文件生成失败。");
                    string destination;
                    if (!String.IsNullOrEmpty(application.DebugPort)) {
                        string exportDir = Path.Combine(vault.CurrentVaultPath, "raw");
                        Directory.CreateDirectory(exportDir);
                        destination = Path.Combine(exportDir, epubName + ".epub");
                    } else {
                        using (var dialog = new SaveFileDialog {
                            Title = "导出 EPUB 3.0 电子书", FileName = epubName + ".epub",
                            Filter = "EPUB 3.0 电子书|*.epub",
                            DefaultExt = "epub", AddExtension = true, OverwritePrompt = true,
                        }) {
                            if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                            destination = Path.GetFullPath(dialog.FileName);
                        }
                    }
                    FileStore.AtomicWrite(destination, epubBytes, true);
                    return new { path = destination, format = "epub" };
                }
                return await ExportService.Export(this, browser, workspace.Store(documentId), args);
            }
            if (command == "aiSecretStatus") return await Task.Run(() => ReadAiSecretStatus());
            if (command == "aiSaveSecret") return await Task.Run(() => SaveAiSecret(StringValue(args, "apiKey"), BooleanValue(args, "clear")));
            if (command == "aiLocalLlmStatus") return await Task.Run(() => ReadLocalLlmStatus());
            if (command == "aiStartLocalLlm") return await Task.Run(() => EnsureLocalLlmStarted());
            if (command == "aiStopLocalLlm") return await Task.Run(() => { StopLocalLlm(); return ReadLocalLlmStatus(); });
            if (command == "aiCompleteHttp") return await Task.Run(() => ExecuteAiHttp(args));
            if (command == "oneNoteGetHierarchy") return await Task.Run(() => QueryOneNoteComHierarchy());
            if (command == "oneNoteGetPageContent") return await Task.Run(() => QueryOneNoteComPageContent(StringValue(args, "pageId")));
            if (command == "oneNoteSaveBinaryAsset") return await Task.Run(() => SaveOneNoteBinaryAsset(StringValue(args, "relativePath"), StringValue(args, "base64Data")));
            if (command == "external") {
                Uri uri;
                if (Uri.TryCreate(StringValue(args, "url"), UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http")) {
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                }
                return true;
            }
            throw new IOException("未知的本地操作：" + command);
        }

        private string AiSecretPath() {
            return Path.Combine(application.Store.DataDirectory, "ai-credentials.bin");
        }

        private string UnprotectAiSecret() {
            string path = AiSecretPath();
            if (!File.Exists(path)) return "";
            try {
                byte[] encrypted = File.ReadAllBytes(path);
                byte[] plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain).Trim();
            } catch {
                return "";
            }
        }

        private static string MaskSecret(string secret) {
            if (String.IsNullOrEmpty(secret)) return "";
            if (secret.Length <= 8) return "••••";
            return secret.Substring(0, 3) + "••••" + secret.Substring(secret.Length - 3);
        }

        private object ReadAiSecretStatus() {
            string secret = UnprotectAiSecret();
            return new { hasKey = !String.IsNullOrEmpty(secret), maskedKey = MaskSecret(secret), storage = "Windows DPAPI CurrentUser", localLlm = ReadLocalLlmStatus() };
        }

        private string ResolveLocalLlmRoot() {
            string profileDir = Path.Combine(application.Store.DataDirectory, "local-llm");
            if (File.Exists(Path.Combine(profileDir, "bin", "llama-server.exe"))) return profileDir;
            string sharedDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "Inkloom", "local-llm");
            return sharedDir;
        }

        private static bool ProbeLocalLlmHealth() {
            try {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:11435/health");
                req.Proxy = null;
                req.KeepAlive = false;
                req.Method = "GET";
                req.Timeout = 1200;
                using (var resp = (HttpWebResponse)req.GetResponse()) {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            } catch {
                return false;
            }
        }

        private object ReadLocalLlmStatus() {
            string root = ResolveLocalLlmRoot();
            string serverExe = Path.Combine(root, "bin", "llama-server.exe");
            string modelFile = Path.Combine(root, "models", "smollm2-135m-instruct-q4_0.gguf");
            bool installed = File.Exists(serverExe) && File.Exists(modelFile);
            long modelBytes = File.Exists(modelFile) ? new FileInfo(modelFile).Length : 0;
            bool running = ProbeLocalLlmHealth();
            return new {
                installed = installed,
                running = running,
                modelName = "smollm2:135m-instruct-q4_0",
                modelFile = Path.GetFileName(modelFile),
                modelBytes = modelBytes,
                endpoint = "http://127.0.0.1:11435/v1/chat/completions"
            };
        }

        private object EnsureLocalLlmStarted() {
            if (ProbeLocalLlmHealth()) return ReadLocalLlmStatus();
            string root = ResolveLocalLlmRoot();
            string serverExe = Path.Combine(root, "bin", "llama-server.exe");
            string modelFile = Path.Combine(root, "models", "smollm2-135m-instruct-q4_0.gguf");
            if (!File.Exists(serverExe) || !File.Exists(modelFile)) {
                throw new IOException("未找到本地最小模型文件（smollm2-135m-instruct-q4_0.gguf）或推理引擎。");
            }
            if (localLlmProcess == null || localLlmProcess.HasExited) {
                var startInfo = new ProcessStartInfo {
                    FileName = serverExe,
                    Arguments = "-m \"" + modelFile + "\" --host 127.0.0.1 --port 11435 -c 2048 -ngl 0",
                    WorkingDirectory = Path.GetDirectoryName(serverExe),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                localLlmProcess = Process.Start(startInfo);
            }
            for (int i = 0; i < 30; i++) {
                if (ProbeLocalLlmHealth()) break;
                Thread.Sleep(250);
            }
            if (!ProbeLocalLlmHealth()) throw new IOException("本地小模型推理服务启动超时。");
            return ReadLocalLlmStatus();
        }

        private void StopLocalLlm() {
            try {
                if (localLlmProcess != null && !localLlmProcess.HasExited) {
                    localLlmProcess.Kill();
                    localLlmProcess.WaitForExit(2000);
                }
            } catch { }
            finally { localLlmProcess = null; }
        }

        private object SaveAiSecret(string apiKey, bool clear) {
            string path = AiSecretPath();
            if (clear) {
                if (File.Exists(path)) File.Delete(path);
                return new { hasKey = false, maskedKey = "", storage = "Windows DPAPI CurrentUser", localLlm = ReadLocalLlmStatus() };
            }
            string trimmed = (apiKey ?? "").Trim();
            if (String.IsNullOrEmpty(trimmed)) return ReadAiSecretStatus();
            if (trimmed.Length > 512 || trimmed.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new IOException("API 密钥格式无效。");
            byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(trimmed), null, DataProtectionScope.CurrentUser);
            FileStore.AtomicWrite(path, encrypted, true);
            return new { hasKey = true, maskedKey = MaskSecret(trimmed), storage = "Windows DPAPI CurrentUser", localLlm = ReadLocalLlmStatus() };
        }

        private object ExecuteAiHttp(Dictionary<string, object> args) {
            string provider = StringValue(args, "provider", "openai-compatible");
            string endpoint = StringValue(args, "endpoint");
            string model = StringValue(args, "model", "gemini-4");
            string systemPrompt = StringValue(args, "systemPrompt");
            string userPrompt = StringValue(args, "userPrompt");
            if (provider == "local-gguf") {
                EnsureLocalLlmStarted();
                if (String.IsNullOrWhiteSpace(endpoint)) endpoint = "http://127.0.0.1:11435/v1/chat/completions";
            }
            Uri uri;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !String.IsNullOrEmpty(uri.UserInfo)) {
                throw new IOException("模型接口地址无效或包含内嵌凭据。");
            }
            var sw = Stopwatch.StartNew();
            string secret = UnprotectAiSecret();
            int maxTokens = 64;
            object rawMax;
            if (args != null && args.TryGetValue("maxTokens", out rawMax) && rawMax != null) {
                try { maxTokens = Math.Max(16, Math.Min(512, Convert.ToInt32(rawMax))); } catch { maxTokens = 64; }
            }
            var req = (HttpWebRequest)WebRequest.Create(uri);
            if (uri.IsLoopback) req.Proxy = null;
            req.KeepAlive = false;
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Timeout = 25000;
            req.ReadWriteTimeout = 25000;
            if (!String.IsNullOrEmpty(secret) && provider != "local-gguf") req.Headers["Authorization"] = "Bearer " + secret;
            object bodyObj = provider == "ollama"
                ? (object)new { model = model, stream = false, messages = new object[] { new { role = "system", content = systemPrompt }, new { role = "user", content = userPrompt } } }
                : (object)new { model = model, temperature = 0.2, max_tokens = maxTokens, messages = new object[] { new { role = "system", content = systemPrompt }, new { role = "user", content = userPrompt } } };
            byte[] payload = Encoding.UTF8.GetBytes(store.Json.Serialize(bodyObj));
            using (var reqStream = req.GetRequestStream()) { reqStream.Write(payload, 0, payload.Length); }
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                var parsed = store.Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                sw.Stop();
                string answer = "";
                if (parsed != null && parsed.ContainsKey("choices")) {
                    var choices = ((IEnumerable)parsed["choices"]).Cast<Dictionary<string, object>>().FirstOrDefault();
                    if (choices != null && choices.ContainsKey("message")) {
                        var msg = (Dictionary<string, object>)choices["message"];
                        if (msg != null && msg.ContainsKey("content")) answer = Convert.ToString(msg["content"]);
                    }
                } else if (parsed != null && parsed.ContainsKey("message")) {
                    var msg = (Dictionary<string, object>)parsed["message"];
                    if (msg != null && msg.ContainsKey("content")) answer = Convert.ToString(msg["content"]);
                }
                return new { answer = answer, model = model, provider = provider, latencyMs = sw.ElapsedMilliseconds };
            }
        }

        private static Type ResolveOneNoteComType() {
            foreach (string progId in new[] { "OneNote.Application", "OneNote.Application.16", "OneNote.Application.15", "OneNote.Application.14" }) {
                try {
                    Type t = Type.GetTypeFromProgID(progId, false);
                    if (t != null) return t;
                } catch { }
            }
            return null;
        }

        private object QueryOneNoteComHierarchy() {
            try {
                Type comType = ResolveOneNoteComType();
                if (comType != null) {
                    object app = Activator.CreateInstance(comType);
                    try {
                        object[] invokeArgs = new object[] { null, 4 /* hsPages */, "" };
                        var mod = new System.Reflection.ParameterModifier(3);
                        mod[2] = true;
                        comType.InvokeMember(
                            "GetHierarchy",
                            System.Reflection.BindingFlags.InvokeMethod,
                            null,
                            app,
                            invokeArgs,
                            new[] { mod },
                            null,
                            null
                        );
                        string xml = Convert.ToString(invokeArgs[2] ?? "");
                        if (!String.IsNullOrWhiteSpace(xml) && xml.IndexOf("Notebook", StringComparison.OrdinalIgnoreCase) >= 0) {
                            return new { liveComConnected = true, xml = xml, provider = "Windows OneNote.Application COM (Live)" };
                        }
                    } finally {
                        if (Marshal.IsComObject(app)) Marshal.ReleaseComObject(app);
                    }
                }
            } catch { }
            return new { liveComConnected = false, xml = "", provider = "OneNote 2016/365 COM XML Schema Channel" };
        }

        private object QueryOneNoteComPageContent(string pageId) {
            if (!String.IsNullOrWhiteSpace(pageId)) {
                try {
                    Type comType = ResolveOneNoteComType();
                    if (comType != null) {
                        object app = Activator.CreateInstance(comType);
                        try {
                            object[] invokeArgs = new object[] { pageId, "", 7 /* piAll */ };
                            var mod = new System.Reflection.ParameterModifier(3);
                            mod[1] = true;
                            comType.InvokeMember(
                                "GetPageContent",
                                System.Reflection.BindingFlags.InvokeMethod,
                                null,
                                app,
                                invokeArgs,
                                new[] { mod },
                                null,
                                null
                            );
                            string pageXml = Convert.ToString(invokeArgs[1] ?? "");
                            if (!String.IsNullOrWhiteSpace(pageXml) && pageXml.IndexOf("Page", StringComparison.OrdinalIgnoreCase) >= 0) {
                                return new { liveComConnected = true, xml = pageXml };
                            }
                        } finally {
                            if (Marshal.IsComObject(app)) Marshal.ReleaseComObject(app);
                        }
                    }
                } catch { }
            }
            return new { liveComConnected = false, xml = "" };
        }

        private object SaveOneNoteBinaryAsset(string relativePath, string base64Data) {
            string normRel = (relativePath ?? "").Replace('\\', '/').TrimStart('/');
            if (String.IsNullOrWhiteSpace(normRel) || normRel.Contains("..") || normRel.Contains(":") ||
                (!normRel.StartsWith("assets/onenote/", StringComparison.OrdinalIgnoreCase) &&
                 !normRel.StartsWith("attachments/onenote/", StringComparison.OrdinalIgnoreCase))) {
                throw new IOException("OneNote 资源落盘路径必须位于 assets/onenote/ 或 attachments/onenote/ 目录下。");
            }
            string vaultRoot = Path.GetFullPath(vault.CurrentVaultPath);
            string fullTarget = Path.GetFullPath(Path.Combine(vaultRoot, normRel.Replace('/', Path.DirectorySeparatorChar)));
            if (!fullTarget.StartsWith(vaultRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) {
                throw new IOException("资源目标路径越出当前知识库根目录。");
            }
            string cleanB64 = (base64Data ?? "").Trim();
            byte[] bytes = String.IsNullOrEmpty(cleanB64) ? new byte[0] : Convert.FromBase64String(cleanB64);
            if (bytes.Length > 16 * 1024 * 1024) throw new IOException("单个 OneNote 附件或图像超过 16 MiB 上限。");
            Directory.CreateDirectory(Path.GetDirectoryName(fullTarget));
            FileStore.AtomicWrite(fullTarget, bytes, false);
            return new { saved = true, relativePath = normRel, bytes = bytes.Length };
        }
    }

    public static class Program {
        [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [STAThread]
        public static void Main(string[] args) {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Inkloom");
            string file = null;
            string port = null;
            for (int index = 0; index < args.Length; index++) {
                if (args[index] == "--profile" && index + 1 < args.Length) profile = Path.GetFullPath(args[++index]);
                else if (args[index] == "--debug-port" && index + 1 < args.Length) {
                    int value;
                    if (Int32.TryParse(args[++index], out value) && value >= 1024 && value <= 65535) port = value.ToString();
                } else if (File.Exists(args[index])) file = Path.GetFullPath(args[index]);
            }
            Directory.CreateDirectory(profile);
            Application.Run(new InkloomApplication(profile, file, port));
        }
    }
}
