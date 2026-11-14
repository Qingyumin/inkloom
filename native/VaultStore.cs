using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Inklet;

namespace Inkloom {
    public sealed class VaultStore {
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly HashSet<string> IgnoredFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".git", "node_modules", ".vs", ".vscode", ".inklet-assets", ".inklet-backups", ".inkloom-assets", ".inkloom-backups", "bin", "obj"
        };
        private readonly FileStore hostStore;
        private readonly string stateFilePath;
        private HashSet<string> starredPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private List<string> recentVaults = new List<string>();
        private string startupWarning = "";
        private readonly object registryLock = new object();
        private IdentityRegistry registry;
        private string registryPath;
        private readonly Dictionary<string, CachedNote> cachedNotes = new Dictionary<string, CachedNote>(StringComparer.OrdinalIgnoreCase);
    #if INKLOOM_TEST
        internal Action<string> RenameCheckpoint { get; set; }
        internal Action<string> SourceVerifiedCheckpoint { get; set; }
    #endif
        public string VaultId { get { lock (registryLock) { EnsureRegistry(); return registry.Id; } } }
        public string CurrentVaultPath { get; private set; }

        public sealed class IdentityRecord {
            public string Id, RelativePath, NativeId;
            public bool Starred, Deleted;
        }
        public sealed class IdentityRegistry {
            public int Version = 1;
            public string Id = Guid.NewGuid().ToString("N");
            public List<IdentityRecord> Notes = new List<IdentityRecord>();
            public string StartupMode = "first", StartupNoteId, LastNoteId;
        }
        public sealed class RecoveryFile {
            public string path, backup, originalSha256, outputSha256;
        }
        public sealed class RecoveryJournal {
            public int format;
            public string vaultPath, vaultId, noteId, createdAt, oldPath, newPath, annotationsSha256;
            public RecoveryFile[] files;
        }
        public sealed class RecoveryRow {
            public string path, relativePath, state, reason;
            internal string observedPath, observedHash;
            internal byte[] original;
        }
        public sealed class RecoveryPreview {
            public string id, state, message, token, oldPath, newPath, vaultPath;
            public bool canRestore;
            public List<RecoveryRow> files = new List<RecoveryRow>();
            internal RecoveryJournal journal;
            internal string annotationsPath, annotationsHash;
            internal byte[] annotations;
        }
        public sealed class PortableIdentity {
            public int format = 1;
            public string vaultId, startupMode, startupNoteId, lastNoteId;
            public List<PortableNoteIdentity> notes = new List<PortableNoteIdentity>();
        }
        public sealed class PortableNoteIdentity { public string id, relativePath, sha256; public bool starred; }
        public sealed class IdentityPreview {
            public string token, vaultId, message;
            public int noteCount;
            public bool canImport;
            internal PortableIdentity manifest;
        }
        private sealed class CachedNote { public long Length, Ticks; public string Source, Hash; }
        [StructLayout(LayoutKind.Sequential)]
        private struct FileIdentityInfo {
            public uint Attributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle, out FileIdentityInfo information);

        private static string NativeFileId(string path) {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                FileIdentityInfo information;
                return GetFileInformationByHandle(stream.SafeFileHandle, out information)
                    ? information.Volume.ToString("x8") + information.IndexHigh.ToString("x8") + information.IndexLow.ToString("x8") : null;
            }
        }

        private void EnsureRegistry() {
            string destination = Path.Combine(hostStore.DataDirectory, "vaults", StableNoteId(CurrentVaultPath), "identity.json");
            if (registryPath == destination && registry != null) return;
            IdentityRegistry loaded;
            if (File.Exists(destination)) {
                try { loaded = hostStore.Json.Deserialize<IdentityRegistry>(File.ReadAllText(destination, Utf8)); }
                catch (Exception error) { throw new IOException("笔记身份登记损坏，原文件保留于 " + destination, error); }
                if (loaded == null || loaded.Version != 1 || loaded.Notes == null || String.IsNullOrEmpty(loaded.Id) || loaded.Notes.Any(note => String.IsNullOrEmpty(note.Id) || String.IsNullOrEmpty(note.RelativePath)) || loaded.Notes.Select(note => note.Id).Distinct().Count() != loaded.Notes.Count)
                    throw new IOException("笔记身份登记格式无效，未重建或覆盖：" + destination);
            } else loaded = new IdentityRegistry();
            registry = loaded; registryPath = destination; cachedNotes.Clear();
        }

        private void SaveRegistry() {
            Directory.CreateDirectory(Path.GetDirectoryName(registryPath));
            FileStore.AtomicWrite(registryPath, Utf8.GetBytes(hostStore.Json.Serialize(registry)), true);
        }

        private IdentityRecord Identify(string file) {
            string relative = file.Substring(CurrentVaultPath.TrimEnd('\\', '/').Length).TrimStart('\\', '/').Replace('\\', '/');
            string nativeId = NativeFileId(file);
            var record = registry.Notes.FirstOrDefault(note => !note.Deleted && String.Equals(note.RelativePath, relative, StringComparison.OrdinalIgnoreCase));
            if (record == null && nativeId != null) {
                var candidates = registry.Notes.Where(note => note.NativeId == nativeId && !File.Exists(Path.Combine(CurrentVaultPath, note.RelativePath.Replace('/', Path.DirectorySeparatorChar)))).ToArray();
                if (candidates.Length == 1) record = candidates[0];
            }
            if (record == null) {
                record = new IdentityRecord { Id = Guid.NewGuid().ToString("N"), Starred = starredPaths.Contains(relative) };
                registry.Notes.Add(record);
            }
            record.RelativePath = relative; record.NativeId = nativeId; record.Deleted = false;
            return record;
        }

        public string NoteId(string path) {
            lock (registryLock) { EnsureRegistry(); var record = Identify(SafeNotePath(path)); SaveRegistry(); return record.Id; }
        }

        private void MoveIdentity(string oldFull, string newFull) {
            lock (registryLock) {
                EnsureRegistry();
                string oldRelative = oldFull.Substring(CurrentVaultPath.TrimEnd('\\', '/').Length).TrimStart('\\', '/').Replace('\\', '/');
                var record = registry.Notes.FirstOrDefault(note => String.Equals(note.RelativePath, oldRelative, StringComparison.OrdinalIgnoreCase));
                if (record == null) { Identify(newFull); SaveRegistry(); return; }
                string previousNativeId = record.NativeId; bool previousDeleted = record.Deleted;
                record.RelativePath = newFull.Substring(CurrentVaultPath.TrimEnd('\\', '/').Length).TrimStart('\\', '/').Replace('\\', '/');
                record.NativeId = NativeFileId(newFull);
                record.Deleted = false;
                try { SaveRegistry(); } catch { record.RelativePath = oldRelative; record.NativeId = previousNativeId; record.Deleted = previousDeleted; throw; }
                cachedNotes.Remove(oldFull); cachedNotes.Remove(newFull);
            }
        }

        public VaultStore(FileStore store) {
            hostStore = store;
            stateFilePath = Path.Combine(hostStore.DataDirectory, "vault-state.json");
            LoadVaultState();
            if (String.IsNullOrWhiteSpace(CurrentVaultPath) || !Directory.Exists(CurrentVaultPath)) {
                if (!String.IsNullOrWhiteSpace(CurrentVaultPath)) startupWarning = "上次知识库目录不可用，已打开示例知识库；原路径保留在最近列表。";
                CurrentVaultPath = EnsureStarterVault();
                AddRecentVault(CurrentVaultPath);
                SaveVaultState();
            }
        }

        private void LoadVaultState() {
            if (!File.Exists(stateFilePath)) return;
            try {
                var data = hostStore.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(stateFilePath, Utf8));
                if (data == null) return;
                object pathVal;
                if (data.TryGetValue("vaultPath", out pathVal) && pathVal is string) CurrentVaultPath = Convert.ToString(pathVal);
                object starsVal;
                if (data.TryGetValue("starred", out starsVal) && starsVal is IEnumerable) {
                    foreach (object item in (IEnumerable)starsVal) {
                        if (item != null) starredPaths.Add(Convert.ToString(item));
                    }
                }
                object recent;
                if (data.TryGetValue("recentVaults", out recent) && recent is IEnumerable) {
                    foreach (object item in (IEnumerable)recent) {
                        if (!(item is string) || String.IsNullOrWhiteSpace((string)item)) continue;
                        string path = Path.GetFullPath((string)item);
                        if (!recentVaults.Contains(path, StringComparer.OrdinalIgnoreCase)) recentVaults.Add(path);
                        if (recentVaults.Count == 12) break;
                    }
                }
                if (!String.IsNullOrWhiteSpace(CurrentVaultPath)) AddRecentVault(CurrentVaultPath);
            } catch { }
        }

        private void SaveVaultState(bool required = false) {
            try {
                var payload = new {
                    vaultPath = CurrentVaultPath,
                    starred = starredPaths.ToArray(),
                    recentVaults = recentVaults.ToArray(),
                };
                FileStore.AtomicWrite(stateFilePath, Utf8.GetBytes(hostStore.Json.Serialize(payload)));
            } catch { if (required) throw; }
        }

        private void AddRecentVault(string path) {
            string full = Path.GetFullPath(path);
            recentVaults.RemoveAll(item => String.Equals(item, full, StringComparison.OrdinalIgnoreCase));
            recentVaults.Insert(0, full); if (recentVaults.Count > 12) recentVaults.RemoveRange(12, recentVaults.Count - 12);
        }

        public object WorkspacePreferences() {
            lock (registryLock) {
                EnsureRegistry();
                return new {
                    startupMode = new[] { "first", "last", "blank", "note" }.Contains(registry.StartupMode) ? registry.StartupMode : "first",
                    startupNoteId = registry.StartupNoteId,
                    recentVaults = recentVaults.Select(path => new { path = path, name = new DirectoryInfo(path).Name, available = Directory.Exists(path), current = String.Equals(path, CurrentVaultPath, StringComparison.OrdinalIgnoreCase) }).ToArray()
                };
            }
        }

        public PortableIdentity ExportIdentity() {
            lock (registryLock) {
                var description = hostStore.Json.Deserialize<Dictionary<string, object>>(hostStore.Json.Serialize(DescribeVault(true)));
                if (Convert.ToBoolean(description["incomplete"])) throw new IOException("知识库扫描未完整，请先处理警告再导出身份清单。");
                var result = new PortableIdentity { vaultId = VaultId, startupMode = registry.StartupMode, startupNoteId = registry.StartupNoteId, lastNoteId = registry.LastNoteId };
                foreach (var note in registry.Notes.Where(note => !note.Deleted).OrderBy(note => note.RelativePath, StringComparer.OrdinalIgnoreCase)) {
                    string path = SafeNotePath(note.RelativePath);
                    result.notes.Add(new PortableNoteIdentity { id = note.Id, relativePath = note.RelativePath.Replace('\\', '/'), sha256 = BytesHash(ReadSourceBytes(path)), starred = note.Starred });
                }
                return result;
            }
        }

        public IdentityPreview PreviewIdentity(string json) {
            lock (registryLock) {
                var result = new IdentityPreview { canImport = false, token = "", message = "" };
                try {
                    if (String.IsNullOrEmpty(json) || Utf8.GetByteCount(json) > 8 * 1024 * 1024) throw new IOException("身份清单为空或超过8 MiB。");
                    var manifest = hostStore.Json.Deserialize<PortableIdentity>(json); Guid identity;
                    if (manifest == null || manifest.format != 1 || !Guid.TryParseExact(manifest.vaultId, "N", out identity) || manifest.notes == null || manifest.notes.Count > 20000) throw new IOException("身份清单格式无效。");
                    var current = hostStore.Json.Deserialize<Dictionary<string, object>>(hostStore.Json.Serialize(DescribeVault(true)));
                    if (Convert.ToBoolean(current["incomplete"])) throw new IOException("目标知识库扫描未完整，未导入身份。");
                    var ids = new HashSet<string>(StringComparer.Ordinal); var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var hashes = new List<string>();
                    foreach (var note in manifest.notes) {
                        if (note == null || !Guid.TryParseExact(note.id, "N", out identity) || !ids.Add(note.id) || String.IsNullOrWhiteSpace(note.relativePath) || Path.IsPathRooted(note.relativePath) || !paths.Add(note.relativePath.Replace('\\', '/'))) throw new IOException("身份清单含重复、缺失或非法记录。");
                        string path = SafeNotePath(note.relativePath); string hash = BytesHash(ReadSourceBytes(path));
                        if (hash != note.sha256) throw new IOException("目标笔记内容与清单不一致：" + note.relativePath);
                        hashes.Add(note.relativePath + ":" + hash);
                    }
                    if (registry.Notes.Count(note => !note.Deleted) != manifest.notes.Count || registry.Notes.Any(note => !note.Deleted && !paths.Contains(note.RelativePath.Replace('\\', '/')))) throw new IOException("目标知识库文件集合与清单不一致。");
                    if (!new[] { "first", "last", "blank", "note" }.Contains(manifest.startupMode ?? "first") || (!String.IsNullOrEmpty(manifest.startupNoteId) && !ids.Contains(manifest.startupNoteId)) || (!String.IsNullOrEmpty(manifest.lastNoteId) && !ids.Contains(manifest.lastNoteId))) throw new IOException("身份清单启动偏好无效。");
                    result.manifest = manifest; result.vaultId = manifest.vaultId; result.noteCount = manifest.notes.Count;
                    result.token = BytesHash(Utf8.GetBytes(BytesHash(Utf8.GetBytes(json)) + "\n" + CurrentVaultPath + "\n" + VaultId + "\n" + String.Join("\n", hashes)));
                    result.canImport = true; result.message = "文件与清单一致；仅恢复身份、星标和启动偏好，不写入笔记正文。";
                } catch (Exception error) { result.message = error.Message; }
                return result;
            }
        }

        public object ImportIdentity(string json, string token) {
            lock (registryLock) {
                var preview = PreviewIdentity(json);
                if (!preview.canImport || String.IsNullOrEmpty(token) || token != preview.token) throw new IOException("身份迁移预览已变化或未通过校验。" + preview.message);
                var previous = registry; var manifest = preview.manifest;
                var replacement = new IdentityRegistry { Id = manifest.vaultId, StartupMode = manifest.startupMode ?? "first", StartupNoteId = manifest.startupNoteId, LastNoteId = manifest.lastNoteId };
                foreach (var note in manifest.notes) replacement.Notes.Add(new IdentityRecord { Id = note.id, RelativePath = note.relativePath.Replace('\\', '/'), NativeId = NativeFileId(SafeNotePath(note.relativePath)), Starred = note.starred, Deleted = false });
                registry = replacement;
                try { SaveRegistry(); } catch { registry = previous; throw; }
                cachedNotes.Clear(); return new { importedNotes = replacement.Notes.Count, vaultId = replacement.Id };
            }
        }

        public object ForgetRecentVault(string path) {
            lock (registryLock) {
                var previous = new List<string>(recentVaults);
                recentVaults.RemoveAll(item => String.Equals(item, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
                try { SaveVaultState(true); } catch { recentVaults = previous; throw; }
                return WorkspacePreferences();
            }
        }

        public object SetStartupPreference(string mode, string noteId) {
            lock (registryLock) {
                EnsureRegistry();
                if (!new[] { "first", "last", "blank", "note" }.Contains(mode)) throw new IOException("启动模式无效。");
                if (mode == "note") {
                    var note = registry.Notes.FirstOrDefault(item => item.Id == noteId && !item.Deleted);
                    if (note == null || !File.Exists(SafeNotePath(note.RelativePath))) throw new IOException("启动笔记不存在或不属于当前知识库。");
                }
                string previousMode = registry.StartupMode; string previousNote = registry.StartupNoteId;
                registry.StartupMode = mode; registry.StartupNoteId = mode == "note" ? noteId : null;
                try { SaveRegistry(); } catch { registry.StartupMode = previousMode; registry.StartupNoteId = previousNote; throw; }
                startupWarning = "";
                return WorkspacePreferences();
            }
        }

        public void RememberActiveNote(string path) {
            if (String.IsNullOrWhiteSpace(path)) return;
            lock (registryLock) {
                string full;
                try { full = SafeNotePath(path); } catch (IOException) { return; }
                if (!File.Exists(full)) return;
                IdentityRecord note;
                try { EnsureRegistry(); note = Identify(full); }
                catch (Exception) { startupWarning = "上次笔记位置无法记录，本次编辑内容不受影响。"; return; }
                if (registry.LastNoteId == note.Id) return;
                string previous = registry.LastNoteId; registry.LastNoteId = note.Id;
                try { SaveRegistry(); } catch { registry.LastNoteId = previous; startupWarning = "上次笔记位置无法保存，本次编辑内容不受影响。"; }
            }
        }

        public string ResolveStartupNote() {
            lock (registryLock) {
                DescribeVault();
                string mode = registry.StartupMode ?? "first";
                if (mode == "blank") return null;
                if (mode == "last" || mode == "note") {
                    string id = mode == "last" ? registry.LastNoteId : registry.StartupNoteId;
                    var selected = registry.Notes.FirstOrDefault(note => note.Id == id && !note.Deleted);
                    if (selected != null) {
                        try { string full = SafeNotePath(selected.RelativePath); if (File.Exists(full)) { ReadSource(full); return full; } } catch (Exception error) { startupWarning = "启动笔记不可用：" + error.Message; }
                    }
                    if (!String.IsNullOrEmpty(id) && String.IsNullOrEmpty(startupWarning)) startupWarning = "启动笔记已不可用，已回退到首篇可用笔记。";
                }
                foreach (var note in registry.Notes.Where(note => !note.Deleted).OrderBy(note => note.RelativePath, StringComparer.OrdinalIgnoreCase)) {
                    try { string full = SafeNotePath(note.RelativePath); ReadSource(full); return full; } catch (Exception) { }
                }
                return null;
            }
        }

        public string EnsureStarterVault() {
            string starterDir = Path.Combine(hostStore.DataDirectory, "StarterVault");
            Directory.CreateDirectory(starterDir);
            Directory.CreateDirectory(Path.Combine(starterDir, "journals"));
            Directory.CreateDirectory(Path.Combine(starterDir, "notes"));

            var seeds = new Dictionary<string, string> {
                { "00-墨图导览与万象星图.md", "---\ntitle: 墨图导览与万象星图\naliases: [墨图导览, Inkloom总览]\ntags: [墨图核心, 知识图谱, 双链笔记]\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 墨图导览与万象星图\n\n> [!IMPORTANT] 📚 全套交互式教程已就绪：[[00-Inkloom使用方法总目录|👉 点击打开《00-Inkloom使用方法总目录》（多层级分章实操手册）]]\n> 左侧目录树已内置 **「Inkloom使用方法」** 多层级文件夹（涵盖 `01-界面全景`、`02-高效笔记`、`03-原位AI副驾驶`、`04-专业工作台`、`05-阅读研究与智识` 五大模块共 12 篇分章教程），支持通过双链在总目录与各子文件夹章节间自由跳转与实操测试！\n\n> [!TIP] 一念落笔，万象成图\n> 在任意空行输入 `/` 即可唤起 **Notion 式斜杠命令菜单**，输入 `[[` 即可关联全库笔记；点击顶部「数据库」按钮可切换 **多维表格与状态看板视图**。\n\n**Inkloom 墨图**（「一念落笔，万象成图。」）是一款站在 **Inklet 墨点**、Notion、Quartz、Foam、SilverBullet 与 Logseq 肩膀上打造的**纯本地 Markdown 双链与知识图谱个人知识库**。\n\n## 一、 核心能力全景\n\n在保持 4.5MB 级轻量机身与清透书卷排版的同时，墨图将单篇深度写作与全库知识网络无缝融合：\n\n1. **全维双向链接**：支持 `[[笔记名]]`、`[[笔记名#章节|别名]]` 跨篇精准跳转，例如直接前往 [[01-双链笔记与卡片盒方法]] 或查看 [[02-知识图谱与局部星图#双层星图架构|双层星图设计]]。\n2. **局部星图与万象星图**：右侧常驻 **1~2 跳局部星图**，主舞台可一键展开全库 **万象星图**，并支持排查孤岛笔记与待建节点（例如尚未创建的 [[卡片写作十诫]]）。\n3. **长文排版与纯净导出**：完整继承 [[03-长文写作与工业级导出]] 的双栏同步、大表格虚拟化、公式与图表渲染，以及 [[04-YAML属性与标签体系]]。\n\n## 二、 架构流转示意\n\n```mermaid\nflowchart LR\n  A[Markdown 本地文件夹] --> B[增量双链与标签索引]\n  B --> C[双栏书卷编辑器]\n  B --> D[右侧 1~2 跳局部星图]\n  B --> E[全屏万象知识图谱]\n  C --> F[Word / PDF / HTML 净化导出]\n```\n\n## 三、 标杆特性融合对照表\n\n| 维度 | 传统大纲双链软件 | 云端块数据库笔记 | Inkloom 墨图 |\n| --- | --- | --- | --- |\n| 存储格式 | 本地 Markdown（强制圆点列表） | 云端私有数据库 | 纯本地标准 Markdown 文件夹 |\n| 长文与表格 | 弱（不适合写连续技术长文） | 较强（但大文档易卡顿） | 强（大表虚拟化 + 双栏同步） |\n| 知识图谱 | 全局图易成乱麻 | 通常无原生局部图谱 | 右侧局部星图 + 全局四维筛选 |\n| 工业级导出 | Word 导出格式简陋 | 导出 Markdown 易丢结构 | 双链自动净化导出 Word / PDF / HTML |\n" },
                { "01-双链笔记与卡片盒方法.md", "---\ntitle: 双链笔记与卡片盒方法\naliases: [卡片盒方法, Zettelkasten, 双链机制]\ntags: [双链笔记, 方法论, 墨图核心]\nstatus: 已就绪\ndate: 2026-10-21\n---\n\n# 双链笔记与卡片盒方法\n\n卢曼卡片盒（Zettelkasten）的精髓不在于收集，而在于**让笔记之间发生对话**。在 [[00-墨图导览与万象星图|墨图导览]] 中，每一篇笔记既是独立的文章，也是知识网络中的一颗星辰。\n\n## 双链语法与自动补全\n\n在编辑器任意位置输入 `[[` 即可唤起全库模糊补全菜单：\n\n- **基础双链**：直接输入 `[[02-知识图谱与局部星图]]` 即可建立双向引用；\n- **章节级双链**：输入 `#` 可继续补全目标笔记内的标题，如 [[03-长文写作与工业级导出#双链智能净化导出]]；\n- **待建主题（断链）**：先写下 [[卡片写作十诫]] 埋下思考线索，后续在图谱或悬停卡片中一键创建。\n\n## 显式反链与潜在提及\n\n在阅读区底部，墨图会自动为您梳理两类脉络：\n\n1. **引用此篇的笔记（Linked References）**：所有显式使用 `[[...]]` 指向本篇的上下文段落；\n2. **潜在提及（Unlinked Mentions）**：即使您在旧文中只写了「YAML属性与标签体系」而忘了加方括号，系统也会自动识别并提供一键关联。\n" },
                { "02-知识图谱与局部星图.md", "---\ntitle: 知识图谱与局部星图\naliases: [局部星图, 万象星图]\ntags: [知识图谱, 可视化, 墨图核心]\nstatus: 已就绪\ndate: 2026-10-21\n---\n\n# 知识图谱与局部星图\n\n传统知识图谱在笔记超过百篇后容易沦为「观赏性毛线球」。墨图参考 Quartz v4 与图论中心性模型，采用**双层星图架构**，让图谱真正服务于思考与整理。\n\n## 双层星图架构\n\n我们将个人知识库视为有向图 $G = (V, E)$，每个节点的引力半径随入度与出度之和动态增长：\n\n$$\nR(v) = R_0 + \\alpha \\cdot \\ln\\bigl(1 + \\deg^{+}(v) + \\deg^{-}(v)\\bigr)\n$$\n\n### 1. 右侧常驻：局部星图（Local Graph）\n\n写作时无需离开当前文档，右侧栏上半区实时展示当前笔记的 **1 跳或 2 跳邻居**。当您在 [[01-双链笔记与卡片盒方法]] 与 [[04-YAML属性与标签体系]] 之间建立引用时，星图连线即刻生长。\n\n### 2. 主视图切换：万象星图（Global Graph）\n\n点击顶部「万象星图」按钮，即可进入全屏图谱漫游，支持四项生产力筛选：\n\n- **全部节点**：纵览以 [[00-墨图导览与万象星图]] 为代表的核心枢纽；\n- **当前目录**：聚焦特定文件夹内的专题笔记；\n- **孤岛笔记**：快速定位零连接笔记（如示例中的孤岛速记），及时归档串联；\n- **待建节点**：高亮尚未落笔的 [[卡片写作十诫]] 等断链节点。\n" },
                { "03-长文写作与工业级导出.md", "---\ntitle: 长文写作与工业级导出\naliases: [工业级导出, 双栏写作]\ntags: [长文排版, 导出引擎]\nstatus: 已就绪\ndate: 2026-10-21\n---\n\n# 长文写作与工业级导出\n\n与强制使用大纲圆点的工具不同，墨图完整保留了 Inklet 备受好评的**长文读写与排版底座**，让您在 [[00-墨图导览与万象星图]] 与 [[01-双链笔记与卡片盒方法]] 之间自由切换。\n\n## 十五款清透外框与九款书卷纸张\n\n直接内置玉露绿、纯白、蜜橙、浅蓝、石墨、松墨、烟墨、莫兰迪与糖果色系，源码栏与阅读栏可分别设定纯白、天青纸、宣纸白或淡墨纸背景。\n\n## 双链智能净化导出\n\n在个人知识库内，您可以尽情使用 [[02-知识图谱与局部星图#双层星图架构|双层星图架构]] 进行网状思考；而当需要对外交付文档时，导出为 **Word (.docx)**、**PDF** 或 **HTML** 会自动把双链语法净化为自然正文，且不夹带底部反链抽屉。\n\n此外，本文在正文中直接提及 墨图导览 和 知识图谱与局部星图 而不加方括号，用于展示「潜在提及」的自动发现能力。\n" },
                { "04-YAML属性与标签体系.md", "---\ntitle: YAML属性与标签体系\naliases: [YAML属性, 标签管理]\ntags: [标签体系, 方法论, 知识图谱]\nstatus: 已就绪\ndate: 2026-10-21\n---\n\n# YAML属性与标签体系\n\n墨图兼容标准 Markdown 头部的 **YAML Frontmatter** 与正文内的 `#标签`（例如 #标签体系 #知识图谱 #方法论），无需将笔记迁入封闭数据库即可获得结构化元数据。\n\n## 顶部属性胶囊栏与书卷属性表\n\n每篇笔记顶部的 YAML 元数据（如 `title`、`aliases`、`tags`、`status`、`date`）不仅在阅读区渲染为清爽的属性表格，还会自动汇总到文档顶栏与左侧「标签」树中。\n\n## 别名与跨篇检索\n\n通过在 YAML 中声明 `aliases: [YAML属性, 标签管理]`，在其他笔记（如 [[00-墨图导览与万象星图]] 或 [[02-知识图谱与局部星图]]）中无论输入原文件名还是别名，都能精准命中同一篇笔记。\n" },
                { "journals/2026-10-21.md", "---\ntitle: 今日手记 · 2026-10-21\naliases: [今日手记]\ntags: [今日手记, 日常思考]\nstatus: 记录中\ndate: 2026-10-21\n---\n\n# 📅 今日手记 · 2026-10-21\n\n通过顶部栏的「今日手记」按钮，可以随时一键打开或创建当日的思绪记录，把零散灵感沉淀到 [[00-墨图导览与万象星图]]。\n\n## 今日进展与灵感连接\n\n- 完成了 **Inkloom 墨图** 第一阶段核心架构，将 [[01-双链笔记与卡片盒方法]] 与 [[02-知识图谱与局部星图]] 融入双栏书卷编辑器；\n- 校验了 [[03-长文写作与工业级导出]] 的 Word/PDF 双链净化逻辑；\n- 待整理专题：构思 [[卡片写作十诫]] 的具体章节。\n" },
                { "notes/99-灵感速记（孤岛示例）.md", "---\ntitle: 灵感速记（孤岛示例）\ntags: [灵感速记]\nstatus: 待整理\ndate: 2026-10-21\n---\n\n# 灵感速记（孤岛示例）\n\n这是一篇尚未与其他笔记建立任何正向或反向双链的**孤岛笔记（Orphan Note）**。\n\n当您切换到「万象星图」并点击上方的 **「孤岛笔记」** 筛选胶囊时，就能一眼发现这类被遗忘在角落的碎片笔记，从而将其串联进您的知识脉络中。\n" },
                { "Inkloom使用方法/00-Inkloom使用方法总目录.md", "---\ntitle: 00-Inkloom使用方法总目录\naliases: [Inkloom使用方法, 使用教程总目录]\ntags: [使用指南, 教程目录]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 📚 00-Inkloom使用方法总目录（互动双链手册）\n\n> 🧭 **快速返回**：[[00-墨图导览与万象星图|🏠 返回《00-墨图导览与万象星图》]]  \n> 💡 **如何使用本文件夹**：本目录采用 **「总目录 MOC ↔ 分层子文件夹章节」** 双向双链构建。直接点击下方表格中的任意绿色双链，即可跳转到对应子文件夹的实操笔记；在每篇实操笔记顶部和底部点击 `[[00-Inkloom使用方法总目录]]` 即可一键返回本总目录。\n\n---\n\n## 一、 全站分章双链导航地图（点击直达）\n\n| 章节层级与文件夹 | 教程笔记（点击双链直接跳转） | 覆盖的核心功能与实操测试点 |\n| --- | --- | --- |\n| **第 01 章 · 界面全景与水泡周界** | [[01.1-外置水泡周界UI与五区布局详解]] | 从上到下、从左到右五区全景拆解、左侧 30px 外置水泡栏、右侧外置水泡快切条 |\n| **第 01 章 · 界面全景与水泡周界** | [[01.2-顶部多页签水泡与右上边角折叠切换]] | 顶栏激活水泡页签、相邻页签快切、右上角圆弧 `+N 折叠页签 ▾` 下拉菜单与 `Ctrl+K` 全域跳转 |\n| **第 02 章 · 高效笔记与双链编辑** | [[02.1-双链语法、章节块引用与分屏对照]] | `[[双链]]` 自动补全、`![[章节/块嵌入]]` 只读预览、右侧分屏对照参考笔记与一键引文 |\n| **第 02 章 · 高效笔记与双链编辑** | [[02.2-顶栏原位属性胶囊与6套动态模板中心]] | 顶栏状态/`#标签` 原位快切弹窗、`✨ AI 填充属性`、新建笔记 6 套动态变量模板与 `/模板` |\n| **第 02 章 · 高效笔记与双链编辑** | [[02.3-Excel粘贴自动成表与表格列一键排序]] | **Excel / WPS / 网页表格直接粘贴自动转 Markdown 表格**、表格按当前列一键升序 ↑ / 降序 ↓ |\n| **第 03 章 · 原位AI副驾驶与闪念捕获** | [[03.1-鼠标划词AI浮条与斜杠ai原位起草]] | 鼠标拖拽划词弹出 6 项 AI 胶囊（润色/精简/扩写/互译/待办/闪卡）、`/ai` 四大指令原位续写 |\n| **第 03 章 · 原位AI副驾驶与闪念捕获** | [[03.2-右侧实时语义灵感副驾驶与全局闪念快记]] | 右侧栏「灵感」128 维向量共鸣推荐、不打断当前写作的「⚡ 闪念静默快记」 |\n| **第 04 章 · 专业工作台与知识图谱** | [[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]] | 六模块拖拽网格工作台、三态任务看板、RRule 重复日程、星标智能书签与底栏 `🍅 25:00` 番茄钟 |\n| **第 04 章 · 专业工作台与知识图谱** | [[04.2-多维属性视图、万象知识星图与Excalidraw手绘白板]] | 多维表分组与派生公式列、万象星图三类物理布局、Excalidraw 手绘白板与手帐月历联动 |\n| **第 05 章 · 阅读研究与智识进阶** | [[05.1-五色高亮批注中心、文献札记与长稿联排出版]] | 五色客观底色高亮批注聚合、文献阅读状态与摘录、长稿自动编号目录与参考文献联排出版 |\n| **第 05 章 · 阅读研究与智识进阶** | [[05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照]] | 本地小模型 `SmolLM2` 与 `Gemini 4`、三模三引擎自动补链、SM-2 记忆闪卡、时光机快照恢复 |\n| **第 06 章 · 成果演示与微站发布** | [[06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚]] | `---`/`##` 一键全屏幻灯片演示、单文件离线知识微站 `.html` 导出、逐行历史 Diff 与按块局部回滚 |\n\n---\n\n## 二、 建议体验路线（3 分钟上手）\n\n1. **先看布局**：点击进入 [[01.1-外置水泡周界UI与五区布局详解]] 与 [[01.2-顶部多页签水泡与右上边角折叠切换]]，熟悉顶部水泡页签、右上折叠菜单与右侧外置水泡条；\n2. **再试表格与模板**：进入 [[02.3-Excel粘贴自动成表与表格列一键排序]]，从 Excel 复制任意单元格直接 `Ctrl+V` 体验自动转表，或点击工具栏 `↑/↓` 排序现成表格；\n3. **体验原位 AI 副驾驶**：进入 [[03.1-鼠标划词AI浮条与斜杠ai原位起草]]，用鼠标选中一段话点击「✨ 润色 / ✨ 转为闪卡」，或在空行输入 `/ai` 体验原位续写！\n" },
                { "Inkloom使用方法/01-界面全景与水泡周界/01.1-外置水泡周界UI与五区布局详解.md", "---\ntitle: 01.1-外置水泡周界UI与五区布局详解\ntags: [使用指南, 界面布局]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 01.1 外置水泡周界 UI 与五区布局详解\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ➡ 下一节：[[01.2-顶部多页签水泡与右上边角折叠切换]]\n\nInkloom 采用 **「外置轻薄水泡周界 + 最大化中央工作框」** 的空间架构，把超过 **94.5%** 的屏幕面积留给您的核心思考与阅读。\n\n## 一、 从上到下、从左到右五区拆解\n\n1. **顶部外置水泡栏（高 40px）**：\n   - 最左侧与最右侧对称排布 `28px × 28px` 的左侧栏开关与右侧栏开关；\n   - 中间为当前打开的笔记水泡页签与右上角圆弧折叠页签（详见 [[01.2-顶部多页签水泡与右上边角折叠切换]]）；\n   - 右侧依次为 **保存 (`Ctrl+S`)**、**净化导出（Word / PDF / HTML）**、**文件菜单 (`...`)**。\n2. **左外侧圆润水泡活动栏（宽 42px）**：\n   - 悬浮在中央主框体左外侧，包含 `30px × 30px` 独立圆润水泡按钮：知识库、标签、星标、工作台、笔记视图、白板、研究、智识、万象星图、快速搜索 (`Ctrl+K`)、刷新知识库与设置。\n3. **左侧次级导航抽屉（宽 224px，可收起）**：\n   - 支持层级目录树（带竖向缩进引导线）、`#标签` 列表、**星标与智能书签**（详见 [[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]]）以及本文档章节大纲。\n4. **中央双栏同步编辑器舞台**：\n   - 左侧为 **CodeMirror 6 源码窗格**，右侧为 **ProseMirror 所见即所得书卷窗格**；可通过笔记右上角的视图按钮切换为「仅阅读编辑」、「仅源码」或「双栏同步滚动」。\n5. **右侧关联栏与外置水泡快切条**：\n   - 展开时：上半区为 **1~2 跳局部星图**，下半区为 **「入链 / 出链 / 章节 / 提及 / 灵感」** 五维页签；\n   - **当您点击右上角按钮收起右侧栏时**：主编辑区向右撑满，右外侧自动浮现竖向轻薄水泡条（`入链`、`出链`、`章节`、`提及`、`灵感`），点击任一水泡即可一键唤醒对应脉络！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n1. 请点击界面**最右上角的右侧栏收起图标**，观察右侧关联栏收起后，右外侧边缘浮现的 **5 枚竖向轻薄水泡**；\n2. 点击右外侧的 **「灵感」** 或 **「入链」** 水泡，体验一键展开右侧栏并直达对应页签！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ➡ 下一节：[[01.2-顶部多页签水泡与右上边角折叠切换]]\n" },
                { "Inkloom使用方法/01-界面全景与水泡周界/01.2-顶部多页签水泡与右上边角折叠切换.md", "---\ntitle: 01.2-顶部多页签水泡与右上边角折叠切换\ntags: [使用指南, 页签导航]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 01.2 顶部多页签水泡与右上边角折叠切换\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[01.1-外置水泡周界UI与五区布局详解]] · ➡ 下一节：[[02.1-双链语法、章节块引用与分屏对照]]\n\n当知识库中的笔记逐渐增多时，传统多标签栏会挤压成看不清文字的细条。Inkloom 独创了 **「顶部轻薄水泡页签 + 右上边角同心圆弧折叠水泡」**。\n\n## 一、 核心交互方式\n\n1. **当前激活水泡页签**：顶栏左侧第一枚带绿色圆点的水泡即为当前正在阅读或编辑的笔记；若有未保存修改，水泡内会自动亮起提示点。\n2. **相邻快捷水泡页签**：紧随其后展示 2 枚常用兄弟笔记水泡，点击即可零延迟切换。\n3. **右上边角折叠水泡（`+N 折叠页签 ▾`）**：\n   - 超出顶部可见槽位的其余笔记，会自动顺着主工作区右上角圆弧收纳进 **`+N 折叠页签 ▾`** 水泡中；\n   - 点击该边角水泡，即刻展开下拉列表（显示笔记标题与所属文件夹），点击任意条目即可直达！\n4. **`Ctrl+K` 全域五维语义胶囊命令中心**：\n   - 按快捷键 `Ctrl+K`（或点击左侧活动栏放大镜图标），可通过 **「全部 / 笔记 / 章节标题 / 工作台命令 / 待建主题」** 五枚彩色胶囊（支持按 `Tab` 键循环切换分类）跨全库秒级寻址。\n\n---\n\n## 🧪 本节交互实操沙盒\n\n1. 点击窗口顶栏右上方的 **`+16 折叠页签 ▾`** 边角水泡，查看收纳在其中的全部教程章节；\n2. 按下键盘 **`Ctrl+K`**，然后按 **`Tab` 键** 切换到「章节标题」胶囊，输入 `实操沙盒` 体验跨笔记直达任意 `H2` 章节！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[01.1-外置水泡周界UI与五区布局详解]] · ➡ 下一节：[[02.1-双链语法、章节块引用与分屏对照]]\n" },
                { "Inkloom使用方法/02-高效笔记与双链编辑/02.1-双链语法、章节块引用与分屏对照.md", "---\ntitle: 02.1-双链语法、章节块引用与分屏对照\ntags: [使用指南, 双链笔记]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 02.1 双链语法、章节块引用与分屏对照\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[01.2-顶部多页签水泡与右上边角折叠切换]] · ➡ 下一节：[[02.2-顶栏原位属性胶囊与6套动态模板中心]]\n\n## 一、 四种双链与块级嵌入语法\n\n| 语法形式 | 写法示例 | 实际渲染与交互效果 |\n| --- | --- | --- |\n| **整篇双链** | `[[00-Inkloom使用方法总目录]]` | 点击跳转至目标笔记，悬停弹出摘要预览卡 |\n| **显示别名** | `[[00-Inkloom使用方法总目录\\|返回总目录]]` | 正文只显示「返回总目录」，底层保持完整链接 |\n| **章节锚点双链** | `[[02.3-Excel粘贴自动成表与表格列一键排序#一、 为什么从 Excel / WPS / 网页复制表格能直接转为 Markdown 表？]]` | 跳转并精准滚动定位到目标章节 |\n| **只读嵌入预览** | `![[01-双链笔记与卡片盒方法#双链语法与自动补全]]` | 在当前笔记内直接展开目标章节的只读卡片预览 |\n\n## 二、 分屏对照参考笔记（边看参考卡片、边写当前文章）\n\n1. 点击当前笔记顶栏右侧的 **「分屏对照参考笔记」（双列图标）**，或将鼠标悬停在任意 `[[双链]]` 上点击弹出卡片的 **「设为分屏对照」**；\n2. 编辑器右侧会展开独立的参考窗格，可通过下拉框切换任意笔记；\n3. 点击参考段落右下角的 **「引用此段」**，即可将 `> 摘录内容 — [[来源笔记]]` 自动插入当前光标处！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n- 将鼠标悬停在此链接上：[[01-双链笔记与卡片盒方法]]，在弹出的预览卡中点击 **「设为分屏对照」**；\n- 在分屏窗格中点击任意一段的 **「引用此段」**，观察引文自动插入本篇末尾！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[01.2-顶部多页签水泡与右上边角折叠切换]] · ➡ 下一节：[[02.2-顶栏原位属性胶囊与6套动态模板中心]]\n" },
                { "Inkloom使用方法/02-高效笔记与双链编辑/02.2-顶栏原位属性胶囊与6套动态模板中心.md", "---\ntitle: 02.2-顶栏原位属性胶囊与6套动态模板中心\ntags: [使用指南, 模板中心]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 02.2 顶栏原位属性胶囊与 6 套动态模板中心\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[02.1-双链语法、章节块引用与分屏对照]] · ➡ 下一节：[[02.3-Excel粘贴自动成表与表格列一键排序]]\n\n## 一、 顶栏原位属性胶囊与「✨ AI 填充属性」\n\n在当前笔记标题下方，您会看到一排彩色圆角胶囊：\n1. **点击 `状态 · 持续演进` 胶囊**：无需打开复杂的表单，直接在原位弹出 **「草稿 / 未开始 / 进行中 / 已完成 / 归档」** 五色胶囊，点击即刻写回文件头部元数据；\n2. **点击 `+ 标签` 胶囊**：可一键点选全库高频标签或输入新标签回车添加；\n3. **点击 `✨ AI 填充属性` 胶囊（`1.1.0` 新增）**：系统自动扫描本篇正文内容、任务完成度与高频词，一键推断并写回 `status`、`tags`、`aliases`（核心术语别名）、`category` 与 **`summary`（百字题要胶囊）**！\n\n## 二、 6 套动态变量场景化笔记模板（`EFF-001`）\n\n内置 **原子概念卡、康奈尔读书笔记、会议纪要与行动项、学术文献精读、项目复盘周报、长稿角色与设定卡** 6 套模板，自动替换 `{{date}}`、`{{time}}`、`{{weekday}}`、`{{title}}`：\n- **方式 A（新建笔记时套用）**：点击左侧导航栏顶部的「新建笔记 `+`」按钮，在弹窗下方的彩色胶囊栏点选任一模板，输入标题确定即可生成完整结构；\n- **方式 B（正文中原位插入）**：在编辑器空行输入 `/模板`（或 `/template`），即可将任意模板结构直接插入当前光标处！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n1. 点击本篇笔记顶栏的 **`✨ AI 填充属性`** 按钮，观察顶栏立即自动生成绿色的 **`题要 · ...`** 胶囊；\n2. 点击本篇顶栏的 **`状态 · ...`** 胶囊，在弹出浮层中体验一键快切状态！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[02.1-双链语法、章节块引用与分屏对照]] · ➡ 下一节：[[02.3-Excel粘贴自动成表与表格列一键排序]]\n" },
                { "Inkloom使用方法/02-高效笔记与双链编辑/02.3-Excel粘贴自动成表与表格列一键排序.md", "---\ntitle: 02.3-Excel粘贴自动成表与表格列一键排序\ntags: [使用指南, 表格编辑]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 02.3 Excel 粘贴自动成表与表格列一键排序\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[02.2-顶栏原位属性胶囊与6套动态模板中心]] · ➡ 下一节：[[03.1-鼠标划词AI浮条与斜杠ai原位起草]]\n\n## 一、 为什么从 Excel / WPS / 网页复制表格能直接转为 Markdown 表？\n\n当您在 **Excel、WPS 表格或 Numbers** 中复制单元格区域时，系统剪贴板会同时塞入三种数据：`text/html`（HTML `<table>`）、`text/plain`（Tab 分隔文本）以及一张 `image/png` 单元格截图。\n- **智能优先级识别**：Inkloom 会**优先解析剪贴板中的 HTML `<table>` 结构与 Tab/CSV 分隔文本**，自动将其转换为干净的标准 Markdown 表格（哪怕只复制了单行多列也能成表）；\n- 只有当剪贴板中**不包含表格数据**且包含纯图片时，才会按图片导入。\n\n## 二、 表格按列一键升序 / 降序排列\n\n1. 将光标点入下方任意 Markdown 表格的某一列（例如点在「耗时ms」或「内存占用MB」列）；\n2. 点击笔记右上角 `I` 图标展开格式工具栏（或在阅读视图点击表格唤起悬浮表格工具条），点击 **`↑`（当前列升序）** 或 **`↓`（当前列降序）**，即可按数值大小或中文拼音自动重排整张表！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n### 实操 1：直接点击下方表格的「耗时ms」列，再点工具栏 `↑ / ↓` 排序\n\n| 核心模块 | 耗时ms | 内存占用MB | 状态说明 |\n| --- | --- | --- | --- |\n| 万象星图布局 | 198 | 24.5 | 后台 Worker 并行计算 |\n| 增量双链索引 | 35 | 12.1 | 仅重算变更笔记 |\n| 混合向量检索 | 82 | 18.6 | 128维余弦 + BM25 |\n| 冷启动水合 | 240 | 19.3 | IndexedDB 校验恢复 |\n\n### 实操 2：从您的 Excel / WPS 复制任意单元格（或复制下方文本）在本篇空行按 `Ctrl+V`\n\n```text\n功能名称\t触发方式\t核心价值\nExcel智能转表\tCtrl+V直接粘贴\t优先识别HTML表格与TSV，不被Excel附带截图干扰\n表格列排序\t点击工具栏上下箭头\t支持数值列与中文列一键升序或降序\n```\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[02.2-顶栏原位属性胶囊与6套动态模板中心]] · ➡ 下一节：[[03.1-鼠标划词AI浮条与斜杠ai原位起草]]\n" },
                { "Inkloom使用方法/03-原位AI副驾驶与闪念捕获/03.1-鼠标划词AI浮条与斜杠ai原位起草.md", "---\ntitle: 03.1-鼠标划词AI浮条与斜杠ai原位起草\ntags: [使用指南, 原位AI]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 03.1 鼠标划词 AI 浮条与斜杠 `/ai` 原位起草\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[02.3-Excel粘贴自动成表与表格列一键排序]] · ➡ 下一节：[[03.2-右侧实时语义灵感副驾驶与全局闪念快记]]\n\n为了让您在写作心流中无需频繁切换到全屏 AI 页面，Inkloom 将 AI 辅助直接下沉到了**鼠标划词浮条**与**`/` 斜杠命令菜单**中。\n\n## 一、 鼠标划词浮条 6 大原位 AI 动作（`AIA-001`）\n\n用鼠标左键在编辑器内**拖拽选中一段文字**（或双击选词），弹出的悬浮工具条右侧提供 6 枚彩色胶囊：\n- **✨ 润色**：优化语序与学术表达，完整保留原有的 `[[双链]]` 与 `#标签`；\n- **✨ 精简**：提炼为 2~3 条高密度要点；\n- **✨ 扩写**：结合当前笔记主题补充底层机理与适用边界提示块；\n- **✨ 互译**：生成中英双语对照与核心专业术语标注；\n- **✨ 待办**：将段落中的行动项一键转化为 Markdown 任务清单；\n- **✨ 闪卡**：自动提炼为符合 SM-2 规范的 `Q: ... / A: ...` 问答闪卡。\n- **安全预览确认**：点击任一胶囊后，会在选区下方弹出可编辑预览框，您可选择 **「替换选区」**、**「插入到下方」** 或 **「放弃」**。\n\n## 二、 斜杠 `/ai` 原位续写与结构起草（`AIA-002`）\n\n在编辑器任意空行输入 `/ai`，即可呼出 4 项原位起草指令：\n1. **`✨ /ai 续写下文`**：承接光标前文语境与双链脉络继续推演；\n2. **`📋 /ai 提炼本章要点`**：将当前章节段落归纳为结构化要点提示块；\n3. **`⚖️ /ai 生成正反论点`**：生成正方支撑论据与反方适用边界对照；\n4. **`📊 /ai 转为对比表格`**：从当前章节自动生成多维评估 Markdown 表格。\n\n---\n\n## 🧪 本节交互实操沙盒\n\n> 请用鼠标左键**拖拽选中下面这段话**，然后点击弹出浮条上的 **「✨ 互译」** 或 **「✨ 闪卡」**：\n\n双链笔记的核心价值在于通过显式的双向引用降低知识图谱的信息熵，并结合间隔重复记忆闪卡与语义检索，让零散阅读笔记转化为可长期复用的第二大脑。\n\n> 请在下方空行点击光标，输入 **`/ai`** 并回车，体验原位续写或转为对比表格：\n\n\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[02.3-Excel粘贴自动成表与表格列一键排序]] · ➡ 下一节：[[03.2-右侧实时语义灵感副驾驶与全局闪念快记]]\n" },
                { "Inkloom使用方法/03-原位AI副驾驶与闪念捕获/03.2-右侧实时语义灵感副驾驶与全局闪念快记.md", "---\ntitle: 03.2-右侧实时语义灵感副驾驶与全局闪念快记\ntags: [使用指南, 灵感副驾驶]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 03.2 右侧实时语义灵感副驾驶与全局闪念快记\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[03.1-鼠标划词AI浮条与斜杠ai原位起草]] · ➡ 下一节：[[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]]\n\n## 一、 右侧栏「灵感」：实时语义灵感副驾驶（`AIA-004`）\n\n当您正在撰写一篇新文章时，常常记不清半年前哪张卡片写过类似观点。\n1. 点击右侧关联栏的 **「灵感」** 页签（若右侧栏已收起，可直接点击右外侧边缘的 **「灵感」水泡**）；\n2. 系统会基于您当前光标所在段落，通过 **128 维特征哈希向量余弦相似度 + 中文二元分词 BM25**，实时静默匹配知识库中最相关的 **Top 3 历史卡片段落**；\n3. 每张灵感卡均展示综合得分、余弦值与共振词，点击 **「引用段落」** 即可将摘录与双链出处插入当前位置，点击 **「插入双链」** 即可快速织网。\n\n## 二、 全局闪念静默快记（`EFF-002` · 不打断当前写作）\n\n正在深度撰写长文时突然闪过一个念头或待办事项，不想离开当前笔记？\n1. 按 `Ctrl+K` 选择第一项 **「⚡ 闪念静默快记」**（或点击顶栏文件菜单 `...` → **「闪念静默快记」**）；\n2. 选择追加目标（默认 **「📅 今日手记（后台静默追加，不切页）」**），输入一句话并可勾选「作为待办任务」；\n3. 点击 **「⚡ 静默追加」**，系统会自动附带 `[HH:mm]` 时间戳写入今日手记的 `## ⚡ 今日闪念与快记` 章节，您当前的写作光标与滚动位置丝毫不受影响！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n1. 点击右侧关联栏的 **「灵感 (3)」** 页签，查看系统为本篇自动匹配出的跨笔记共鸣段落，并点击一次 **「引用段落」**；\n2. 点击顶栏 `...` 菜单 → **「闪念静默快记」**，输入一条灵感提交，再前往今日手记查看自动生成的 `[HH:mm]` 记录！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[03.1-鼠标划词AI浮条与斜杠ai原位起草]] · ➡ 下一节：[[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]]\n" },
                { "Inkloom使用方法/04-专业工作台与知识图谱/04.1-可组合工作台、任务看板、RRule日历与心流番茄钟.md", "---\ntitle: 04.1-可组合工作台、任务看板、RRule日历与心流番茄钟\ntags: [使用指南, 任务日历]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 04.1 可组合工作台、任务看板、RRule 日历与心流番茄钟\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[03.2-右侧实时语义灵感副驾驶与全局闪念快记]] · ➡ 下一节：[[04.2-多维属性视图、万象知识星图与Excalidraw手绘白板]]\n\n## 一、 可组合工作台（Workspace Home）\n\n点击左侧外置水泡栏的 **「工作台」** 图标，即可进入由 `GridStack` 驱动的六模块可定制主页：\n- **六大组件**：快速收集（支持 Memo / 任务 / 项目 / 阅读札记且带自动草稿恢复）、任务清单与三态看板、Memo 列表（支持全文检索与归档恢复）、FullCalendar 月历、项目进度条、星标快捷入口；\n- **布局定制与模板导出**：支持切换「日常 / 专注任务 / 阅读写作」预设，支持拖拽调整卡片位置与大小，并可导出 `.inkloom-workspace.json` 模板包。\n\n## 二、 任务三列看板、日历拖拽改期与 RRule 重复任务\n\n- 在工作台「任务」卡片中切换 **「清单 / 看板」**，可按「未开始 / 进行中 / 已完成」拖拽流转，修改直接同步回原 Markdown 笔记；\n- 点击任务右侧编辑按钮，可设置截止日、提醒时间、优先级以及 **RRule 重复规则**（每天 / 工作日 / 每周 / 每月 / 自定义星期组合）；在月历上可直接用鼠标把任务拖到另一天改期。\n\n## 三、 智能视图/章节书签与底栏心流番茄钟（`EFF-004`）\n\n1. **智能书签栏**：切换到左侧导航栏的 **「星标」** 页签，顶部提供 **「📌 智能视图与章节书签 → + 收藏当前位置」**，可将当前正在读的 `笔记#章节` 或 `#标签筛选` 存为快捷书签；\n2. **底栏心流番茄钟**：窗口底部状态栏常驻 **`🍅 25:00 · 今日 +N 字`** 胶囊，点击即可启动或暂停 25 分钟专注倒计时，并实时统计今日净增字数！\n\n---\n\n## 🧪 本节交互实操沙盒\n\n1. 点击窗口底部状态栏的 **`🍅 25:00 · 今日 +0 字`** 胶囊，启动一次心流番茄钟；\n2. 点击左侧导航栏的 **「星标」** 页签，点击 **「+ 收藏当前位置」**，将本节加入智能书签！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[03.2-右侧实时语义灵感副驾驶与全局闪念快记]] · ➡ 下一节：[[04.2-多维属性视图、万象知识星图与Excalidraw手绘白板]]\n" },
                { "Inkloom使用方法/04-专业工作台与知识图谱/04.2-多维属性视图、万象知识星图与Excalidraw手绘白板.md", "---\ntitle: 04.2-多维属性视图、万象知识星图与Excalidraw手绘白板\ntags: [使用指南, 星图白板]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 04.2 多维属性视图、万象知识星图与 Excalidraw 手绘白板\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]] · ➡ 下一节：[[05.1-五色高亮批注中心、文献札记与长稿联排出版]]\n\n## 一、 多维笔记属性视图（Database Table & Kanban Board）\n\n点击左侧外置水泡栏的 **「笔记视图」（表格图标）**：\n- **表格与状态看板双模式**：支持按文件夹、标签、状态筛选，或在看板模式下直接把笔记卡片拖入不同状态列；\n- **分组汇总与 5 项内置派生公式列**：支持按「状态 / 目录 / 分类 / 项目」一键分组统计；属性列下拉框内置 **任务完成率、字数达成率、正文字数、项目关联数、反向链接数** 五大自动计算列，并支持自定义属性单元格内联编辑。\n\n## 二、 万象知识星图（Global Graph · `Ctrl+G`）\n\n点击左侧水泡栏的 **「万象知识图谱」**（或按 `Ctrl+G`）：\n- **四维语义胶囊筛选**：全部节点、当前目录、**孤岛笔记**（快速揪出全库 0 连接卡片，如示例中的 `99-灵感速记`）、**待建节点**（高亮尚未创建的断链主题）；\n- **三类布局与三套视觉风格**：在「设置 → 工作台与插件」中可切换 **力导向 / 环形径向 / 目录聚类** 布局与 **图集 / 星图 / 极简** 视觉样式。\n\n## 三、 Excalidraw 手绘白板与手绘手帐\n\n点击左侧水泡栏的 **「白板」（尺规图标）**：\n- 完整内嵌 **Excalidraw 0.18** 手绘画布，场景数据直接保存在标准 Markdown 文件中；\n- 点击 **「今日手绘手帐」** 可创建带日期绑定的视觉手帐并自动同步到工作台月历；在普通笔记中使用 `![[白板名称]]` 即可内嵌渲染清晰的 SVG 矢量缩略图！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[04.1-可组合工作台、任务看板、RRule日历与心流番茄钟]] · ➡ 下一节：[[05.1-五色高亮批注中心、文献札记与长稿联排出版]]\n" },
                { "Inkloom使用方法/05-阅读研究与智识进阶/05.1-五色高亮批注中心、文献札记与长稿联排出版.md", "---\ntitle: 05.1-五色高亮批注中心、文献札记与长稿联排出版\ntags: [使用指南, 阅读研究]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 05.1 五色高亮批注中心、文献札记与长稿联排出版\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[04.2-多维属性视图、万象知识星图与Excalidraw手绘白板]] · ➡ 下一节：[[05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照]]\n\n点击左侧外置水泡栏的 **「研究」（书本图标）**，即可使用面向深度阅读、文献管理与长篇写作的四大研究工具。\n\n## 一、 全库五色高亮批注与引文聚合中心\n\n1. **自由划词五色高亮**：在阅读或编辑任意笔记时，用鼠标左键拖拽选中文字，点击弹出浮条上的 **淡黄 / 浅绿 / 天蓝 / 浅粉 / 淡橙** 任一色块即可高亮标记（亦支持 `==高亮文本==` 语法）；\n2. **客观底色分类聚合**：进入「研究 → 高亮批注」，顶部提供 **「全部批注 / 淡黄高亮 / 浅绿高亮 / 天蓝高亮 / 浅粉高亮 / 淡橙高亮 / 引文与提示块」** 七枚彩色胶囊（不强绑固定语义，完全尊重您的色彩习惯）；\n3. **一键汇编精读笔记**：支持按颜色筛选全库所有高亮段落，点击「跳转原文」直达出处，或点击 **「汇编当前筛选为精读笔记」** 一键生成带双链出处的读书摘录卡。\n\n## 二、 研究资料库、选段摘录与长稿多章联排出版\n\n- **资料登记与札记**：在「研究 → 资料」中登记论文/书籍元数据、维护「未读/阅读中/已读」状态并一键创建关联阅读札记；\n- **选段摘录**：在正文中选中关键段落，点击顶栏 `...` → **「选段摘录到研究」**，自动为原段生成 `^block-id` 锚点并保存摘录卡片；\n- **长稿多章联排出版**：在「研究 → 长稿」中管理多章节长文，支持一键新增章节、上下调整章节序号，以及点击 **「生成出版联排成稿」** 自动按序汇编全部章节、生成带字数统计的 `## 全稿目录 (TOC)`、净化正文双链并在文末汇总生成 `## 参考文献与关联索引`！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[04.2-多维属性视图、万象知识星图与Excalidraw手绘白板]] · ➡ 下一节：[[05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照]]\n" },
                { "Inkloom使用方法/05-阅读研究与智识进阶/05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照.md", "---\ntitle: 05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照\ntags: [使用指南, 智识与闪卡]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 05.2 智识问答、三模三引擎智能双链、SM-2 闪卡与时光机快照\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[05.1-五色高亮批注中心、文献札记与长稿联排出版]] · ➡ 下一节：[[06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚]]\n\n点击左侧外置水泡栏的 **「智识」（星光图标）**，即可使用全库 AI 知识合成与健康保障中心。\n\n## 一、 多模型配置（本地 `SmolLM2-135M` + 在线 `Gemini 4`）与有据问答\n\n1. **模型与凭据**：预置 **本地最小模型 `SmolLM2-135M-Instruct GGUF`（本机离线推理）**、**在线 `Gemini 4`**、**本地 Ollama `Qwen2.5-0.5B`** 与 **内置离线有据引擎** 四套配置档，API 密钥经 Windows DPAPI 加密存储；\n2. **有据问答与受控修订**：支持按「全库 / 当前笔记 / 当前目录 / 选区」检索，所有回答均附带精确到行号的 `[[笔记#章节]]` 出处卡片；「差异修订」先展示逐行 Diff 预览，人工确认后才写入草稿。\n\n## 二、 三模 × 三引擎智能双链（告别手动敲方括号）\n\n在右侧关联栏的 **「提及」** 页签顶部：\n- **三档模式**：半自动提醒双链、全自动保存时补链、纯手工双链；\n- **三类引擎**：离线余弦相似度+词法、本地小模型 `SmolLM2`、在线大模型 `Gemini 4`；点击 **「智能扫描」** 后即可单条或 **「一键自动补链」**。\n\n## 三、 SM-2 间隔重复记忆闪卡与时光机全库快照\n\n1. **记忆闪卡（14 天负荷预测 + 候选勾选制卡）**：\n   - 支持在笔记中书写问答卡或概念定义卡（语法示例如下），或在「智识 → 记忆闪卡」中点击 **「预览候选闪卡」** 勾选粗体概念一键制卡，复习后按「重来 / 困难 / 良好 / 简单」自动计算下次到期日：\n```markdown\nQ: 卢曼卡片盒（Zettelkasten）的核心原则是什么？\nA: 以原子化概念为单位，并通过 [[01-双链笔记与卡片盒方法]] 建立上下文网络。\n\n双层星图架构 :: 右侧常驻 1~2 跳局部星图与主舞台全屏万象星图的协同可视化模型\n```\n2. **孤岛织网、周报综述与全库时光机快照**：\n   - 在「孤岛织网与周报」中可一键将零连接孤岛卡织入主干节点，或按近 7/30 天汇总手记生成周报；\n   - 在「健康与兼容」中可一键创建带 64 位 SHA-256 签名的 `.inkloom-vault-snapshot.json` 全库快照，随时与当前库做五维胶囊对比并无损回滚恢复！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[05.1-五色高亮批注中心、文献札记与长稿联排出版]]\n" },
                { "Inkloom使用方法/06-成果演示与微站发布/06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚.md", "---\ntitle: 06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚\ntags: [使用指南, 演示与发布]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 06.1 幻灯片全屏演示、单文件微站导出与逐行 Diff 局部回滚\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照]] · ➡ 下一节：[[07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡]]\n\n本节为您介绍 `1.2.0` 新增的三大成果交付与版本保护能力（**本篇自身已使用 `---` 分页，可直接点击顶栏「幻灯片全屏演示」按钮体验放映画布**）。\n<!-- note: 欢迎体验 Inkloom 1.2.0 幻灯片演示模式！您可以使用键盘左右方向键或空格键翻页，点击右上角可开关本演讲备注。 -->\n\n---\n\n## 一、 Markdown 一键全屏幻灯片演示（`PUB-001`）\n\n无需把笔记复制到 PowerPoint，任何包含 `---` 分隔线或 `##` 二级标题的 Markdown 笔记均可一键变为高颜值演示文稿：\n1. **一键开启**：点击当前笔记顶栏右侧的 **「幻灯片全屏演示」（四角展开图标）**，或按 `Ctrl+K` 选择「📽️ 开启当前笔记全屏幻灯片演示」；\n2. **双模式智能分页**：若正文中包含 `---` 水平分隔线，按 `---` 精确分页；若无 `---`，则自动按 `##` 二级标题分页；\n3. **演讲者备注与页码水泡**：在段落中写入 `<!-- note: 备注内容 -->` 即可作为演讲者提示词；支持顶部水泡页码点击跳页、键盘 `← / → / Space` 翻页、明暗主题切换与双链直达。\n<!-- note: 第二页重点演示 --- 与 ## 自动分页机制，以及顶部水泡页码条的零延迟跳页能力。 -->\n\n---\n\n## 二、 单文件完全离线知识微站导出（`PUB-002`）\n\n想要把整理好的专题笔记发给同事或读者阅读，又不想对方安装任何软件？\n1. 点击窗口顶栏的 **「导出文档」（下载图标）**；\n2. 在「文件格式」下拉框中选择 **「单文件离线知识微站 (.html)」**；\n3. 选择收录范围（**当前笔记及一跳双链邻居 / 当前目录全部笔记 / 全库全部笔记**）并点击「导出」；\n4. 生成的单个 `.html` 文件**零外部 CDN 依赖**，双击即可在任意电脑离线打开，自带**左侧目录树、页内实时搜索框、五色高亮与 Callout 保真渲染、本篇章节大纲及跨篇 `[[双链]]` 页内无刷新跳转**！\n<!-- note: 第三页展示单文件离线知识微站导出，一个 HTML 文件即可打包整个专题目录。 -->\n\n---\n\n## 三、 当前笔记逐行历史 Diff 与段落级局部回滚（`PUB-003`）\n\n改乱了某一段落，但不想撤销整篇文档的其他修改？\n1. 点击当前笔记顶栏右侧的 **「版本对比与段落局部回滚」（历史时钟图标）**；\n2. 可自由切换对比基线：**「💾 已保存磁盘基线版」** 或 **「🕒 本次打开初始版」**；\n3. 系统以红绿逐行高亮展示每一个变更块（`@@ -旧行 +新行 @@`），点击任意变更块右上角的 **「还原此更改块」**，即可精准回滚该段落而不影响其他段落（且支持 `Ctrl+Z` 撤销）！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[05.2-智识问答、三模三引擎智能双链、SM-2闪卡与时光机快照]] · ➡ 下一节：[[07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡]]\n" },
                { "Inkloom使用方法/07-空间画布与图谱寻路/07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡.md", "---\ntitle: 07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡\ntags: [使用指南, 空间画布]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 07.1 星图最短路径寻路、PageRank 社区聚类与白板混排笔记卡\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚]] · ➡ 下一节：[[08.1-受控MCP智能体六大工具与双目录SHA256增量同步]]\n\n本节为您介绍 `1.3.0` 新增的三大空间知识画布与高阶图谱分析能力（`CANVAS-001 ~ CANVAS-003`）。\n\n## 一、 万象星图最短路径寻路（`CANVAS-001` · 发现任意两张卡片间的隐藏桥梁）\n\n1. 按 `Ctrl+G`（或点击左侧外置水泡栏的 **「万象知识图谱」**）打开全库星图；\n2. 在星图顶部的分析条右侧，选择 **「寻路起点」** 与 **「寻路终点」** 两篇笔记，点击 **`🧭 寻路`**；\n3. 系统立即基于**双向广度优先搜索（Bidirectional BFS）**计算出最短跳数桥梁链路：\n   - 星图画布上自动以 **琥珀金双环 + 加粗连线** 高亮整条最短路径，并自动淡化无关节点；\n   - 底部实时生成可点击的跳数路径条（如 `起点 ➔ 桥梁卡 ➔ 终点`），点击任一节点即可直接打开该桥梁笔记！\n\n## 二、 PageRank 枢纽识别与标签传播社区聚类着色（`CANVAS-002`）\n\n- **标签传播社区聚类（Label Propagation）**：星图自动识别全库紧密相连的知识簇，并在分析条左侧生成 **「全部簇 / 社区簇 1 · ... (N) / 跨簇桥梁 (M)」** 彩色胶囊；\n- **一键聚焦知识簇与桥梁节点**：点击任一社区簇胶囊，画布立即聚光灯高亮该主题簇；点击 **「🌉 跨簇桥梁」** 胶囊，即可一眼识别连接不同学科领域的枢纽卡片（节点大小亦融合了 **PageRank 中心度权重**）。\n\n## 三、 Excalidraw 白板混排真实笔记卡片（`CANVAS-003`）\n\n1. 点击左侧外置水泡栏的 **「白板」** 进入手绘画布；\n2. 在白板顶栏右侧的 **「选择笔记卡片插入白板」** 下拉框中点选任意笔记，点击 **`📌 插入笔记卡`**；\n3. 系统自动在 Excalidraw 画布中生成带标题、标签与正文摘要的**手绘知识卡片框**（若画布已有卡片，还会自动生成手绘连线箭头），并在顶栏下方生成 **「📌 画布已挂载笔记卡片」** 快捷条，点击即可一键跳回对应 Markdown 原文！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[06.1-幻灯片全屏演示、单文件微站导出与逐行Diff局部回滚]] · ➡ 下一节：[[08.1-受控MCP智能体六大工具与双目录SHA256增量同步]]\n" },
                { "Inkloom使用方法/08-受控Agent与多端同步/08.1-受控MCP智能体六大工具与双目录SHA256增量同步.md", "---\ntitle: 08.1-受控MCP智能体六大工具与双目录SHA256增量同步\ntags: [使用指南, 智能体与同步]\ncategory: 使用教程\nstatus: 持续演进\ndate: 2026-10-21\n---\n\n# 08.1 受控 MCP 智能体六大工具与双目录 SHA-256 增量同步\n\n> 🧭 **章节导航**：[[00-Inkloom使用方法总目录|🏠 返回总目录]] · ⬅ 上一节：[[07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡]] · 🏠 [[00-墨图导览与万象星图|返回墨图导览]]\n\n本节为您介绍 `1.4.0` 新增的两大收口能力：**受控本地 MCP Agent 多步推理工具箱（`AIA-005`）**与**本地双目录 SHA-256 增量同步及三方冲突合并台（`SYNC-001`）**。\n\n## 一、 本地受控 MCP Agent 六大工具与多步推理轨迹（`AIA-005`）\n\n1. 点击左侧外置水泡栏的 **「智识」（星光图标）**，在默认的 **「问答与检索」** 面板下半区，即可看到 **「本地受控 MCP Agent 多步推理工具箱」**；\n2. **六大受控本地工具胶囊**：\n   - **只读分析工具（4 项）**：`search_notes`（跨库混合检索）、`read_section`（章节原文精读）、`find_knowledge_gaps`（知识盲区诊断）、`summarize_project`（项目进展汇总）；\n   - **受控写提案工具（2 项，强制人工 Diff 审批）**：`propose_note`（草拟原子新卡提案）、`batch_tag_update`（批量标签整理提案）；\n3. **可视化推理轨迹与人工批准门禁**：输入目标指令并点击 **`✨ 启动多步推理与工具调用`**，系统会逐条生成彩色步骤轨迹卡片（规划 → 检索 → 精读 → 诊断 → 提案），并在下方展示完整 Diff 预览；只有当您点击 **`✓ 批准并执行写操作提案`** 后，变更才会真正写入知识库！\n\n## 二、 本地双目录 SHA-256 增量同步与三方冲突合并台（`SYNC-001`）\n\n1. 在「智识」工作台点击顶部 **`健康与迁移诊断`** 胶囊，向下滚动至 **「本地双目录 SHA-256 增量同步与三方冲突合并台」**；\n2. 点击 **`扫描双目录增量与冲突`**，系统会对当前主知识库与镜像目录（如坚果云、OneDrive、局域网共享目录或加密 U 盘备份仓）逐文件计算 **64 位 SHA-256 哈希**，并以五枚彩色胶囊展示：**比对路径、SHA-256 一致、待推送镜像、待拉取入库、双端冲突**；\n3. **三种无损冲突合并策略**：支持选择 **「智能合并双端段落（保留主库并汇入镜像端新增段落） / 保留主知识库版本 / 采用镜像目录版本」**，实时预览合并结果（100% 保留 UTF-8 BOM 与 CRLF），点击 **`✓ 执行增量同步与冲突合并`** 即可一键对齐双端！\n\n> ↩ [[00-Inkloom使用方法总目录|🏠 返回《00-Inkloom使用方法总目录》]] · ⬅ 上一节：[[07.1-星图最短路径寻路、PageRank社区聚类与白板混排笔记卡]]\n" },
            };

            foreach (var pair in seeds) {
                string full = Path.Combine(starterDir, pair.Key.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(full)) {
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    FileStore.AtomicWrite(full, Utf8.GetBytes(pair.Value));
                }
            }
            var rawSeeds = new Dictionary<string, string> {
                { "raw/供应链安全库存与动态服务水平白皮书.html", "<!DOCTYPE html>\n<html><head><title>供应链安全库存与动态服务水平白皮书</title></head><body>\n<h1>供应链安全库存与动态服务水平白皮书</h1>\n<h2>一、 核心机制与安全库存公式</h2>\n<p>在多级制造与分销网络中，<strong>安全库存模型</strong>直接决定订单满足率与资金占用的平衡。安全库存必须依据<strong>需求波动标准差</strong>与<strong>供应提前期</strong>动态计算，严禁使用静态经验常数替代实时预测。</p>\n<p>当<strong>需求波动标准差</strong>上升时，系统通过<strong>动态服务水平策略</strong>自动调整安全库存缓冲，并关联双链笔记与卡片盒方法沉淀排产决策规则。</p>\n<h2>二、 策略对比基准表</h2>\n<table>\n<tr><th>策略类型</th><th>适用需求场景</th><th>平均缺货率</th><th>库存周转天数</th></tr>\n<tr><td>静态固定缓冲</td><td>稳定大宗标准件</td><td>4.8%</td><td>42 天</td></tr>\n<tr><td>动态服务水平模型</td><td>季节性与促销波动件</td><td>1.1%</td><td>26 天</td></tr>\n</table>\n</body></html>\n" },
                { "raw/知识图谱与混合检索性能基准测试.csv", "评测模块,算法机制,百篇耗时ms,千篇耗时ms,准确率提升\n混合向量检索,128维特征哈希余弦+BM25二元分词,18.4,72.6,+24.5%\n知识图谱寻路,双向BFS最短路径+PageRank中心度,11.2,48.0,+31.0%\nKarpathy知识编译,raw只读解析+wiki增量双链合成,29.5,115.2,+38.2%\n" },
                { "raw/Karpathy-LLM-Wiki增量编译工程手稿.txt", "# Karpathy LLM Wiki 增量编译工程手稿\n\n## 1. 原始资料层 (raw/) 与只读铁律\n用户将 PDF、Word (.docx)、PPT (.pptx)、Excel (.xlsx)、CSV 与网页文章放入 **raw/ 原始资料仓**。**Karpathy 知识编译器**通过只读解析器提取章节、表格与幻灯片大纲，绝不覆写原始文件。\n\n## 2. 知识百科层 (wiki/) 与增量连接\n每次摄取新资料时，编译器自动生成或更新 **文献解析笔记**（存入 `wiki/sources/`）、提炼 **概念实体百科**（存入 `wiki/entities/`），并在匹配到知识库既有主题（如《双链笔记与卡片盒方法》与《知识图谱与局部星图》）时自动建立双向 `[[双链]]` 与 `wiki/index.md` 路由索引。\n" }
            };
            foreach (var rPair in rawSeeds) {
                string rFull = Path.Combine(starterDir, rPair.Key.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(rFull)) {
                    Directory.CreateDirectory(Path.GetDirectoryName(rFull));
                    FileStore.AtomicWrite(rFull, Utf8.GetBytes(rPair.Value));
                }
            }
            starredPaths.Add("00-墨图导览与万象星图.md");
            starredPaths.Add("01-双链笔记与卡片盒方法.md");
            starredPaths.Add("Inkloom使用方法/00-Inkloom使用方法总目录.md");
            return starterDir;
        }

        public static string StableNoteId(string fullPath) {
            using (var sha = SHA256.Create()) {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(fullPath).ToLowerInvariant()));
                var sb = new StringBuilder(32);
                for (int i = 0; i < 16; i++) sb.Append(hash[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public object SetVaultDirectory(string folderPath) {
            string full = Path.GetFullPath(folderPath);
            if (!Directory.Exists(full)) throw new DirectoryNotFoundException("知识库目录不存在。");
            lock (registryLock) {
                string previousPath = CurrentVaultPath; string previousRegistryPath = registryPath;
                var previousRegistry = registry; var previousStars = starredPaths;
                var previousRecent = new List<string>(recentVaults); string previousWarning = startupWarning;
                var previousCache = new Dictionary<string, CachedNote>(cachedNotes, StringComparer.OrdinalIgnoreCase);
                try {
                    CurrentVaultPath = full;
                    starredPaths = String.Equals(full, previousPath, StringComparison.OrdinalIgnoreCase)
                        ? new HashSet<string>(previousStars, StringComparer.OrdinalIgnoreCase) : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    registry = null; registryPath = null; cachedNotes.Clear();
                    EnsureRegistry();
                    object description = DescribeVault(true);
                    AddRecentVault(full); startupWarning = "";
                    SaveVaultState(true);
                    return description;
                } catch {
                    CurrentVaultPath = previousPath; registryPath = previousRegistryPath; registry = previousRegistry; starredPaths = previousStars;
                    recentVaults = previousRecent; startupWarning = previousWarning;
                    cachedNotes.Clear(); foreach (var entry in previousCache) cachedNotes.Add(entry.Key, entry.Value);
                    throw;
                }
            }
        }

        public object DescribeVault(bool force = false) {
            lock (registryLock) {
                EnsureRegistry();
                if (force) cachedNotes.Clear();
                foreach (var record in registry.Notes) if (!File.Exists(Path.Combine(CurrentVaultPath, record.RelativePath.Replace('/', Path.DirectorySeparatorChar)))) record.Deleted = true;
                string root = Path.GetFullPath(CurrentVaultPath);
                var notes = new List<object>(); var folders = new List<string>(); var warnings = new List<string>(); long sourceBytes = 0;
                if (!String.IsNullOrEmpty(startupWarning)) warnings.Add(startupWarning);
                ScanDirectory(root, root, notes, folders, warnings, ref sourceBytes, 0);
                SaveRegistry();
                return new {
                    vaultId = registry.Id,
                    vaultName = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
                    vaultPath = root, notes = notes.ToArray(), folders = folders.ToArray(), warnings = warnings.ToArray(),
                    incomplete = warnings.Count > 0, noteLimit = 20000, sourceByteLimit = 48 * 1024 * 1024,
                    pendingRecovery = PendingRecovery(),
                };
            }
        }

        private void ScanDirectory(string root, string current, List<object> output, List<string> folders, List<string> warnings, ref long sourceBytes, int depth) {
            if (output.Count >= 20000 || folders.Count >= 20000 || sourceBytes >= 48 * 1024 * 1024 || depth > 64) { if (!warnings.Contains("扫描达到保护上限，未加载全部笔记。")) warnings.Add("扫描达到保护上限，未加载全部笔记。"); return; }
            string[] files, directories;
            try { files = Directory.GetFiles(current); directories = Directory.GetDirectories(current); }
            catch (Exception error) { warnings.Add(current + ": " + error.Message); return; }
            if (current != root) folders.Add(current.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/'));
            foreach (string file in files.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)) {
                if (output.Count >= 20000 || sourceBytes >= 48 * 1024 * 1024) { warnings.Add("扫描达到保护上限，未加载全部笔记。"); return; }
                string ext = Path.GetExtension(file);
                if (!String.Equals(ext, ".md", StringComparison.OrdinalIgnoreCase) && !String.Equals(ext, ".markdown", StringComparison.OrdinalIgnoreCase)) continue;
                string rel = file.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                try {
                    SafeNotePath(file);
                    var info = new FileInfo(file);
                    if (info.Length > 24 * 1024 * 1024) { warnings.Add(rel + ": 超过 24 MB，未加载。"); continue; }
                    CachedNote cached;
                    string text = ReadSource(file); string hash = FileStore.TextHash(text);
                    if (!cachedNotes.TryGetValue(file, out cached) || cached.Length != info.Length || cached.Ticks != info.LastWriteTimeUtc.Ticks || cached.Hash != hash) {
                        cached = new CachedNote { Length = info.Length, Ticks = info.LastWriteTimeUtc.Ticks, Source = text, Hash = hash };
                        cachedNotes[file] = cached;
                    }
                    var identity = Identify(file); sourceBytes += cached.Source.Length * 2L;
                    output.Add(new { id = identity.Id, name = Path.GetFileName(file), relativePath = rel, path = file, source = cached.Source, hash = cached.Hash, starred = identity.Starred });
                } catch (Exception error) { warnings.Add(rel + ": " + error.Message); }
            }
            foreach (string sub in directories.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)) {
                string name = Path.GetFileName(sub);
                if (name.StartsWith(".", StringComparison.Ordinal) || IgnoredFolders.Contains(name)) continue;
                try { if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0) { warnings.Add(sub + ": 目录联接未扫描。"); continue; } }
                catch (Exception error) { warnings.Add(sub + ": " + error.Message); continue; }
                ScanDirectory(root, sub, output, folders, warnings, ref sourceBytes, depth + 1);
            }
        }

        public void Invalidate(string path, bool deleted = false) {
            lock (registryLock) {
                if (path == null) cachedNotes.Clear(); else cachedNotes.Remove(Path.GetFullPath(path));
            }
        }

        public string[] PendingRecovery() {
            string root = Path.Combine(hostStore.DataDirectory, "rename-journals");
            if (!Directory.Exists(root)) return new string[0];
            return Directory.GetDirectories(root).Where(path => !File.Exists(Path.Combine(path, "COMMITTED")) && !File.Exists(Path.Combine(path, "ROLLED_BACK"))).ToArray();
        }

        public string CreateNoteFile(string title, string folder, string source, bool exclusive = false, bool overwrite = false) {
            string rawTitle = String.IsNullOrWhiteSpace(title) ? "新建笔记" : title.Trim();
            if (rawTitle.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) rawTitle = rawTitle.Substring(0, rawTitle.Length - 3);
            foreach (char invalid in Path.GetInvalidFileNameChars()) rawTitle = rawTitle.Replace(invalid, '-');
            string targetDir = CurrentVaultPath;
            if (!String.IsNullOrWhiteSpace(folder) && folder != "根目录" && folder != "待建节点") {
                targetDir = Path.Combine(CurrentVaultPath, folder.Replace('/', Path.DirectorySeparatorChar));
            }
            string fullPath = SafeNotePath(Path.Combine(targetDir, rawTitle + ".md"));
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath));
            if (exclusive && !overwrite) {
                if (String.IsNullOrEmpty(source)) throw new IOException("新笔记正文不能为空。");
                if (File.Exists(fullPath)) { if (ReadSource(fullPath) == source) return fullPath; throw new IOException("同名笔记已存在且正文不同，未覆盖。"); }
                string temporary = Path.Combine(Path.GetDirectoryName(fullPath), ".inkloom-" + Guid.NewGuid().ToString("N") + ".tmp");
                try {
                    using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { byte[] bytes = Utf8.GetBytes(source); stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                    File.Move(temporary, fullPath);
                } finally { if (File.Exists(temporary)) File.Delete(temporary); }
                return fullPath;
            }
            if (!File.Exists(fullPath) || overwrite) {
                string today = DateTime.Now.ToString("yyyy-MM-dd");
                string body = String.IsNullOrWhiteSpace(source)
                    ? "---\ntitle: " + rawTitle + "\ntags: [墨图笔记]\nstatus: 草稿\ndate: " + today + "\n---\n\n# " + rawTitle + "\n\n在此输入正文，使用 `[[` 可随时关联知识库中的其他笔记。\n"
                    : source;
                FileStore.AtomicWrite(fullPath, Utf8.GetBytes(body), true);
                cachedNotes.Remove(fullPath);
            }
            return fullPath;
        }

        public string EnsureDailyNoteFile(string date) {
            string day = String.IsNullOrWhiteSpace(date) ? DateTime.Now.ToString("yyyy-MM-dd") : date.Trim();
            foreach (char invalid in Path.GetInvalidFileNameChars()) day = day.Replace(invalid, '-');
            string journalsDir = Path.Combine(CurrentVaultPath, "journals");
            Directory.CreateDirectory(journalsDir);
            string fullPath = Path.Combine(journalsDir, day + ".md");
            if (!File.Exists(fullPath)) {
                string content = "---\ntitle: 今日手记 · " + day + "\naliases: [今日手记]\ntags: [今日手记, 日常思考]\nstatus: 记录中\ndate: " + day + "\n---\n\n# 📅 今日手记 · " + day + "\n\n## 今日进展与思考脉络\n\n- 关联核心笔记：[[00-墨图导览与万象星图]]\n";
                FileStore.AtomicWrite(fullPath, Utf8.GetBytes(content));
            }
            return fullPath;
        }

        public string SafeNotePath(string value) {
            string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string full = Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(root, value.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("路径必须位于当前知识库内。");
            string extension = Path.GetExtension(full);
            if (!String.Equals(extension, ".md", StringComparison.OrdinalIgnoreCase) && !String.Equals(extension, ".markdown", StringComparison.OrdinalIgnoreCase)) throw new IOException("目标必须是 Markdown 文件。");
            for (string current = full; current != null && current.Length >= root.Length; current = Path.GetDirectoryName(current)) {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("不通过符号链接或目录联接写入知识库。");
            }
            return full;
        }

        public string ReadSource(string file) {
            return DecodeSource(ReadSourceBytes(file));
        }

        private byte[] ReadSourceBytes(string file) {
            var info = new FileInfo(SafeNotePath(file));
            if (!info.Exists || info.Length > 24 * 1024 * 1024) throw new IOException("笔记不存在或超过 24 MB。");
            byte[] bytes = File.ReadAllBytes(info.FullName);
            if (bytes.Length > 24 * 1024 * 1024) throw new IOException("笔记超过 24 MB，未读取。");
            return bytes;
        }

        private static string DecodeSource(byte[] bytes) {
            int offset = bytes.Length >= 3 && bytes[0] == 239 && bytes[1] == 187 && bytes[2] == 191 ? 3 : 0;
            return Utf8.GetString(bytes, offset, bytes.Length - offset).Replace("\r\n", "\n");
        }

        private byte[] ReadVerifiedSource(string file, string expectedSource) {
            byte[] original = ReadSourceBytes(file);
            if (expectedSource == null || DecodeSource(original) != expectedSource.Replace("\r\n", "\n")) throw new IOException("磁盘笔记已变化，请重新读取后操作，未覆盖任何内容。");
#if INKLOOM_TEST
            if (SourceVerifiedCheckpoint != null) SourceVerifiedCheckpoint(file);
#endif
            return original;
        }

        private static byte[] EncodeLike(byte[] original, string source) {
            bool bom = original.Length >= 3 && original[0] == 239 && original[1] == 187 && original[2] == 191;
            string raw = Utf8.GetString(original, bom ? 3 : 0, original.Length - (bom ? 3 : 0));
            string text = (source ?? "").Replace("\r\n", "\n");
            if (raw.Contains("\r\n")) text = text.Replace("\n", "\r\n");
            byte[] encoded = Utf8.GetBytes(text);
            if (encoded.Length > 24 * 1024 * 1024) throw new IOException("笔记超过 24 MB，未保存。");
            return bom ? new byte[] { 239, 187, 191 }.Concat(encoded).ToArray() : encoded;
        }

        public void UpdateFileSource(string fullPath, string source, string expectedSource) {
            string normalized = SafeNotePath(fullPath);
            byte[] original = ReadVerifiedSource(normalized, expectedSource);
            byte[] output = EncodeLike(original, source);
            if (!File.ReadAllBytes(normalized).SequenceEqual(original)) throw new IOException("笔记正在被其他程序修改，操作已取消。");
            FileStore.AtomicWrite(normalized, output, true);
        }

        public object ApplyRenamePlan(Dictionary<string, object> plan) {
            string oldFull = SafeNotePath(Convert.ToString(plan["path"]));
            string newFull = SafeNotePath(Convert.ToString(plan["newRelativePath"]));
            if (!String.Equals(Path.GetDirectoryName(oldFull), Path.GetDirectoryName(newFull), StringComparison.OrdinalIgnoreCase)) throw new IOException("本操作只重命名文件，不移动目录。");
            if (String.Equals(oldFull, newFull, StringComparison.OrdinalIgnoreCase)) throw new IOException("请输入不同的新文件名；本版不执行仅大小写变更。");
            if (File.Exists(newFull) || Directory.Exists(newFull)) throw new IOException("目标文件已存在，未执行重命名。");
            string oldMarks = oldFull + ".inklet.json";
            string newMarks = newFull + ".inklet.json";
            if (File.Exists(newMarks)) throw new IOException("目标高亮文件已存在，未执行重命名。");
            byte[] marks = File.Exists(oldMarks) ? File.ReadAllBytes(oldMarks) : null;
            var originals = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            var outputs = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> update in (IEnumerable)plan["updates"]) {
                string file = SafeNotePath(Convert.ToString(update["path"]));
                if (originals.ContainsKey(file)) throw new IOException("重命名计划含重复文件。");
                string expected = Convert.ToString(update["expectedSource"]);
                byte[] original = ReadVerifiedSource(file, expected);
                originals.Add(file, original);
                outputs.Add(file, EncodeLike(original, Convert.ToString(update["source"])));
            }
            if (!originals.ContainsKey(oldFull)) throw new IOException("重命名计划缺少原笔记。");
            string journal = Path.Combine(hostStore.DataDirectory, "rename-journals", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(journal);
            var backups = new List<RecoveryFile>();
            foreach (var entry in originals) {
                string backup = backups.Count.ToString("D4") + ".bak";
                File.WriteAllBytes(Path.Combine(journal, backup), entry.Value);
                backups.Add(new RecoveryFile { path = entry.Key, backup = backup, originalSha256 = BytesHash(entry.Value), outputSha256 = BytesHash(outputs[entry.Key]) });
            }
            var manifest = new RecoveryJournal { format = 2, vaultPath = CurrentVaultPath, vaultId = VaultId, noteId = NoteId(oldFull), createdAt = DateTime.UtcNow.ToString("o"), oldPath = oldFull, newPath = newFull, files = backups.ToArray(), annotationsSha256 = marks == null ? null : BytesHash(marks) };
            FileStore.AtomicWrite(Path.Combine(journal, "plan.json"), Utf8.GetBytes(hostStore.Json.Serialize(manifest)));
            if (marks != null) File.WriteAllBytes(Path.Combine(journal, "annotations.bak"), marks);
            var written = new List<string>();
            bool moved = false;
            bool marksMoved = false;
            try {
                foreach (var entry in originals) if (!File.ReadAllBytes(entry.Key).SequenceEqual(entry.Value)) throw new IOException("提交前检测到磁盘变化，操作已取消。");
                foreach (var entry in outputs) {
                    if (entry.Value.SequenceEqual(originals[entry.Key])) continue;
                    if (!File.ReadAllBytes(entry.Key).SequenceEqual(originals[entry.Key])) throw new IOException("提交时检测到磁盘变化。");
                    FileStore.AtomicWrite(entry.Key, entry.Value, true);
                    written.Add(entry.Key);
                }
#if INKLOOM_TEST
                if (RenameCheckpoint != null) RenameCheckpoint("files-written");
#endif
                File.Move(oldFull, newFull); moved = true;
                if (marks != null) {
                    if (!File.ReadAllBytes(oldMarks).SequenceEqual(marks)) throw new IOException("高亮文件已变化。");
                    File.Move(oldMarks, newMarks); marksMoved = true;
                }
                MoveIdentity(oldFull, newFull);
#if INKLOOM_TEST
                if (RenameCheckpoint != null) RenameCheckpoint("identity-moved");
#endif
                FileStore.AtomicWrite(Path.Combine(journal, "COMMITTED"), Utf8.GetBytes(DateTime.UtcNow.ToString("o")));
                string oldRel = Convert.ToString(plan["relativePath"]);
                if (starredPaths.Remove(oldRel)) { starredPaths.Add(Convert.ToString(plan["newRelativePath"])); SaveVaultState(); }
                return new { path = newFull, backupDirectory = journal };
            } catch (Exception failure) {
                var recoveryErrors = new List<string>();
                TryRollbackStep(() => {
                    if (marksMoved && File.Exists(newMarks) && !File.Exists(oldMarks) && File.ReadAllBytes(newMarks).SequenceEqual(marks)) File.Move(newMarks, oldMarks);
                }, recoveryErrors);
                TryRollbackStep(() => {
                    if (moved && File.Exists(newFull) && !File.Exists(oldFull) && File.ReadAllBytes(newFull).SequenceEqual(outputs[oldFull])) File.Move(newFull, oldFull);
                }, recoveryErrors);
                foreach (string file in written.AsEnumerable().Reverse()) {
                    TryRollbackStep(() => {
                        if (File.Exists(file) && File.ReadAllBytes(file).SequenceEqual(outputs[file])) FileStore.AtomicWrite(file, originals[file]);
                    }, recoveryErrors);
                }
                TryRollbackStep(() => {
                    if (moved && File.Exists(oldFull) && !File.Exists(newFull)) MoveIdentity(newFull, oldFull);
                }, recoveryErrors);
                bool restored = false;
                TryRollbackStep(() => {
                    restored = !File.Exists(newFull) && !File.Exists(newMarks)
                        && originals.All(entry => File.Exists(entry.Key) && File.ReadAllBytes(entry.Key).SequenceEqual(entry.Value))
                        && (marks == null || (File.Exists(oldMarks) && File.ReadAllBytes(oldMarks).SequenceEqual(marks)));
                }, recoveryErrors);
                if (restored && recoveryErrors.Count == 0) TryRollbackStep(() => {
                    FileStore.AtomicWrite(Path.Combine(journal, "ROLLED_BACK"), Utf8.GetBytes(DateTime.UtcNow.ToString("o")));
                }, recoveryErrors);
                if (!restored || recoveryErrors.Count > 0) TryRollbackStep(() => {
                    FileStore.AtomicWrite(Path.Combine(journal, "recovery.json"), Utf8.GetBytes(hostStore.Json.Serialize(new {
                        state = "pending", checkedAt = DateTime.UtcNow.ToString("o"), cause = failure.Message, rollbackErrors = recoveryErrors.ToArray()
                    })));
                }, recoveryErrors);
                Invalidate(null);
                string outcome = restored && recoveryErrors.Count == 0 ? "重命名未完成，已完整回滚；" : "重命名未完成，仍有待恢复内容，请核对备份；";
                throw new IOException(outcome + "原文件备份保留于 " + journal, failure);
            }
        }

        private static void TryRollbackStep(Action rollback, List<string> errors) {
            try { rollback(); } catch (Exception error) { errors.Add(error.Message); }
        }

        private static string BytesHash(byte[] bytes) {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        private static void CheckRecoveryPath(string path, string root) {
            string boundary = Path.GetFullPath(root).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
            string full = Path.GetFullPath(path);
            if (!full.StartsWith(boundary, StringComparison.OrdinalIgnoreCase)) throw new IOException("恢复路径越界，未执行操作。");
            for (string current = full; current != null && current.Length >= boundary.Length - 1; current = Path.GetDirectoryName(current)) {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("恢复记录不通过符号链接或目录联接读取。");
            }
        }

        public string RecoveryDirectory(string id) {
            Guid parsed;
            if (!Guid.TryParseExact(id, "N", out parsed)) throw new IOException("恢复记录编号无效。");
            string directory = Path.Combine(hostStore.DataDirectory, "rename-journals", id);
            CheckRecoveryPath(directory, hostStore.DataDirectory);
            if (!Directory.Exists(directory)) throw new IOException("恢复记录不存在。");
            return directory;
        }

        private byte[] ReadRecoveryFile(string path, string boundary, int maximumBytes) {
            CheckRecoveryPath(path, boundary);
            var info = new FileInfo(path);
            if (!info.Exists || info.Length > maximumBytes) throw new IOException("恢复文件缺失或超过读取上限：" + Path.GetFileName(path));
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length > maximumBytes) throw new IOException("恢复文件超过读取上限。");
            return bytes;
        }

        public object ListRecovery(int offset = 0, int limit = 25, string filter = "pending") {
            if (offset < 0 || limit < 1 || limit > 100 || (filter != "pending" && filter != "all")) throw new IOException("恢复记录分页参数无效。");
            string root = Path.Combine(hostStore.DataDirectory, "rename-journals");
            var items = new List<object>();
            string[] directories = Directory.Exists(root) ? Directory.GetDirectories(root)
                .Where(directory => filter == "all" || (!File.Exists(Path.Combine(directory, "COMMITTED")) && !File.Exists(Path.Combine(directory, "ROLLED_BACK"))))
                .OrderByDescending(Directory.GetCreationTimeUtc).ThenBy(directory => directory, StringComparer.OrdinalIgnoreCase).ToArray() : new string[0];
            foreach (string directory in directories.Skip(offset).Take(limit)) {
                string id = Path.GetFileName(directory);
                try {
                    string safe = RecoveryDirectory(id);
                    var journal = hostStore.Json.Deserialize<RecoveryJournal>(Utf8.GetString(ReadRecoveryFile(Path.Combine(safe, "plan.json"), safe, 8 * 1024 * 1024)));
                    if (journal == null) throw new IOException("恢复记录格式无效。");
                    string state = File.Exists(Path.Combine(safe, "COMMITTED")) ? "committed" : File.Exists(Path.Combine(safe, "ROLLED_BACK")) ? "rolled-back" : "pending";
                    items.Add(new { id = id, state = state, oldPath = journal.oldPath, newPath = journal.newPath, vaultPath = journal.vaultPath, createdAt = journal.createdAt, format = journal.format, message = journal.format == 2 ? "" : "旧版日志仅支持查看备份" });
                } catch (Exception error) { items.Add(new { id = id, state = "blocked", message = error.Message }); }
            }
            return new { items = items.ToArray(), total = directories.Length, limit = limit, offset = offset };
        }

        public RecoveryPreview PreviewRecovery(string id) {
            lock (registryLock) {
                var preview = new RecoveryPreview { id = id, state = "blocked", token = "", message = "" };
                try {
                    string directory = RecoveryDirectory(id);
                    byte[] manifestBytes = ReadRecoveryFile(Path.Combine(directory, "plan.json"), directory, 8 * 1024 * 1024);
                    var journal = hostStore.Json.Deserialize<RecoveryJournal>(Utf8.GetString(manifestBytes));
                    if (journal == null) throw new IOException("恢复记录格式无效。");
                    preview.journal = journal; preview.oldPath = journal.oldPath; preview.newPath = journal.newPath; preview.vaultPath = journal.vaultPath;
                    if (File.Exists(Path.Combine(directory, "COMMITTED")) || File.Exists(Path.Combine(directory, "ROLLED_BACK"))) throw new IOException("事务已有终态，不再次执行恢复。");
                    if (journal.format != 2) throw new IOException("旧版日志缺少输出校验值，仅支持查看备份。");
                    if (!String.Equals(journal.vaultPath, CurrentVaultPath, StringComparison.OrdinalIgnoreCase) || journal.vaultId != VaultId) throw new IOException("此恢复记录属于其他知识库，请先打开对应知识库。");
                    string oldFull = SafeNotePath(journal.oldPath); string newFull = SafeNotePath(journal.newPath);
                    if (String.Equals(oldFull, newFull, StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetDirectoryName(oldFull), Path.GetDirectoryName(newFull), StringComparison.OrdinalIgnoreCase)) throw new IOException("恢复记录的文件名或目录无效。");
                    if (File.Exists(oldFull) == File.Exists(newFull) || Directory.Exists(oldFull) || Directory.Exists(newFull)) throw new IOException("原文件和目标文件同时存在或同时缺失，需人工核对。");
                    var identity = registry.Notes.FirstOrDefault(note => note.Id == journal.noteId);
                    if (identity == null || !new[] { oldFull, newFull }.Contains(Path.Combine(CurrentVaultPath, identity.RelativePath.Replace('/', Path.DirectorySeparatorChar)), StringComparer.OrdinalIgnoreCase)) throw new IOException("笔记身份登记与恢复记录不一致。");
                    if (journal.files == null || journal.files.Length == 0 || journal.files.Length > 20000) throw new IOException("恢复文件清单无效。");
                    var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long totalBytes = 0;
                    foreach (var file in journal.files) {
                        if (file == null || String.IsNullOrEmpty(file.backup) || Path.GetFileName(file.backup) != file.backup) throw new IOException("备份文件名无效。");
                        string full = SafeNotePath(file.path);
                        if (!paths.Add(full) || String.Equals(full, newFull, StringComparison.OrdinalIgnoreCase)) throw new IOException("恢复清单含重复或冲突路径。");
                        byte[] original = ReadRecoveryFile(Path.Combine(directory, file.backup), directory, 24 * 1024 * 1024);
                        totalBytes += original.Length; if (totalBytes > 96 * 1024 * 1024) throw new IOException("恢复备份超过96 MB检查上限。");
                        if (BytesHash(original) != file.originalSha256 || file.outputSha256 == null || file.outputSha256.Length != 64 || !file.outputSha256.All(Uri.IsHexDigit)) throw new IOException("恢复备份或校验值损坏。");
                        string observedPath = String.Equals(full, oldFull, StringComparison.OrdinalIgnoreCase) && !File.Exists(oldFull) ? newFull : full;
                        var row = new RecoveryRow { path = full, relativePath = full.Substring(CurrentVaultPath.TrimEnd('\\', '/').Length).TrimStart('\\', '/'), observedPath = observedPath, original = original };
                        try {
                            row.observedHash = BytesHash(ReadRecoveryFile(observedPath, CurrentVaultPath, 24 * 1024 * 1024));
                            row.state = row.observedHash == file.originalSha256 ? "unchanged" : row.observedHash == file.outputSha256 ? "restore" : "blocked";
                            row.reason = row.state == "unchanged" ? "已是原文" : row.state == "restore" ? "可撤回此次修改" : "磁盘存在外部版本，未覆盖";
                        } catch (Exception error) { row.state = "blocked"; row.reason = error.Message; }
                        preview.files.Add(row);
                    }
                    if (!paths.Contains(oldFull)) throw new IOException("恢复清单缺少原笔记。");
                    string oldMarks = oldFull + ".inklet.json"; string newMarks = newFull + ".inklet.json";
                    CheckRecoveryPath(oldMarks, CurrentVaultPath); CheckRecoveryPath(newMarks, CurrentVaultPath);
                    if (Directory.Exists(oldMarks) || Directory.Exists(newMarks)) throw new IOException("高亮路径存在目录冲突。");
                    if (journal.annotationsSha256 != null) {
                        preview.annotations = ReadRecoveryFile(Path.Combine(directory, "annotations.bak"), directory, 24 * 1024 * 1024);
                        if (BytesHash(preview.annotations) != journal.annotationsSha256 || File.Exists(oldMarks) == File.Exists(newMarks)) throw new IOException("高亮备份或磁盘状态不一致。");
                        preview.annotationsPath = File.Exists(oldMarks) ? oldMarks : newMarks;
                        preview.annotationsHash = BytesHash(ReadRecoveryFile(preview.annotationsPath, CurrentVaultPath, 24 * 1024 * 1024));
                        if (preview.annotationsHash != journal.annotationsSha256) throw new IOException("高亮文件存在外部修改，需人工核对。");
                    } else if (File.Exists(oldMarks) || File.Exists(newMarks)) throw new IOException("发现事务之外的高亮文件，需人工核对。");
                    preview.canRestore = preview.files.All(file => file.state != "blocked");
                    preview.state = preview.canRestore ? "ready" : "blocked";
                    preview.message = preview.canRestore ? "可恢复到改名前版本；原始备份保留。" : "存在外部修改、缺失或无法读取的文件，未执行恢复。";
                    preview.token = BytesHash(Utf8.GetBytes(hostStore.Json.Serialize(new { manifest = BytesHash(manifestBytes), vaultId = VaultId, files = preview.files.Select(file => new { path = file.observedPath, hash = file.observedHash }).ToArray(), annotationsPath = preview.annotationsPath, annotationsHash = preview.annotationsHash })));
                } catch (Exception error) { preview.canRestore = false; preview.message = error.Message; }
                return preview;
            }
        }

        public object RestoreRecovery(string id, string expectedToken) {
            lock (registryLock) {
                var preview = PreviewRecovery(id);
                if (!preview.canRestore || String.IsNullOrEmpty(expectedToken) || preview.token != expectedToken) throw new IOException("恢复预览已变化或存在冲突，请重新预览。" + preview.message);
                string directory = RecoveryDirectory(id); int restoredFiles = 0;
                try {
                    string oldFull = preview.oldPath; string newFull = preview.newPath;
                    var renamed = preview.files.Single(file => String.Equals(file.path, oldFull, StringComparison.OrdinalIgnoreCase));
                    if (BytesHash(ReadRecoveryFile(renamed.observedPath, CurrentVaultPath, 24 * 1024 * 1024)) != renamed.observedHash) throw new IOException("恢复前笔记已变化。");
                    if (String.Equals(renamed.observedPath, newFull, StringComparison.OrdinalIgnoreCase)) {
                        if (File.Exists(oldFull) || Directory.Exists(oldFull)) throw new IOException("原文件名已被占用。");
                        File.Move(newFull, oldFull); renamed.observedPath = oldFull;
                    }
                    MoveIdentity(newFull, oldFull);
                    if (preview.annotations != null) {
                        if (BytesHash(ReadRecoveryFile(preview.annotationsPath, CurrentVaultPath, 24 * 1024 * 1024)) != preview.annotationsHash) throw new IOException("恢复前高亮文件已变化。");
                        string oldMarks = oldFull + ".inklet.json";
                        if (!String.Equals(preview.annotationsPath, oldMarks, StringComparison.OrdinalIgnoreCase)) File.Move(preview.annotationsPath, oldMarks);
                    }
                    foreach (var file in preview.files) {
                        string currentHash = BytesHash(ReadRecoveryFile(file.path, CurrentVaultPath, 24 * 1024 * 1024));
                        if (currentHash != file.observedHash) throw new IOException("恢复期间文件已变化：" + file.relativePath);
                        if (currentHash != BytesHash(file.original)) { FileStore.AtomicWrite(file.path, file.original, true); restoredFiles++; }
                    }
                    if (File.Exists(newFull) || File.Exists(newFull + ".inklet.json") || preview.files.Any(file => !File.ReadAllBytes(file.path).SequenceEqual(file.original))) throw new IOException("恢复后文件回读不一致。");
                    if (preview.annotations != null && !File.ReadAllBytes(oldFull + ".inklet.json").SequenceEqual(preview.annotations)) throw new IOException("恢复后高亮回读不一致。");
                    if (NoteId(oldFull) != preview.journal.noteId) throw new IOException("恢复后笔记身份不一致。");
                    FileStore.AtomicWrite(Path.Combine(directory, "ROLLED_BACK"), Utf8.GetBytes(DateTime.UtcNow.ToString("o")));
                    return new { id = id, path = oldFull, restoredFiles = restoredFiles, state = "rolled-back", backupDirectory = directory };
                } catch (Exception failure) {
                    var errors = new List<string>();
                    TryRollbackStep(() => FileStore.AtomicWrite(Path.Combine(directory, "recovery.json"), Utf8.GetBytes(hostStore.Json.Serialize(new { state = "pending", checkedAt = DateTime.UtcNow.ToString("o"), cause = failure.Message }))), errors);
                    throw new IOException("恢复未全部完成，请重新预览；现有文件和备份已保留。" + failure.Message, failure);
                } finally { Invalidate(null); }
            }
        }

        public bool ToggleStarred(string fullOrRelPath) {
            if (String.IsNullOrWhiteSpace(fullOrRelPath)) return false;
            lock (registryLock) {
                EnsureRegistry();
                var record = Identify(SafeNotePath(fullOrRelPath));
                record.Starred = !record.Starred;
                try { SaveRegistry(); } catch { record.Starred = !record.Starred; throw; }
                return record.Starred;
            }
        }

        private bool LegacyToggleStarred(string fullOrRelPath) {
            string rel = fullOrRelPath;
            string root = Path.GetFullPath(CurrentVaultPath);
            if (Path.IsPathRooted(fullOrRelPath) && Path.GetFullPath(fullOrRelPath).StartsWith(root, StringComparison.OrdinalIgnoreCase)) {
                rel = Path.GetFullPath(fullOrRelPath).Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            rel = rel.Replace('\\', '/');
            bool starred;
            if (starredPaths.Contains(rel)) { starredPaths.Remove(rel); starred = false; }
            else { starredPaths.Add(rel); starred = true; }
            SaveVaultState();
            return starred;
        }

        public string MoveNoteFile(string oldPathOrRel, string newTitle) {
            string root = Path.GetFullPath(CurrentVaultPath);
            string oldFull = Path.IsPathRooted(oldPathOrRel)
                ? Path.GetFullPath(oldPathOrRel)
                : Path.GetFullPath(Path.Combine(root, oldPathOrRel.Replace('/', Path.DirectorySeparatorChar)));
            if (!oldFull.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("只能重命名当前知识库内的笔记。");
            if (!File.Exists(oldFull)) throw new FileNotFoundException("原笔记文件不存在。", oldFull);

            string cleanName = (newTitle ?? "").Trim();
            if (cleanName.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) cleanName = cleanName.Substring(0, cleanName.Length - 3);
            foreach (char invalid in Path.GetInvalidFileNameChars()) cleanName = cleanName.Replace(invalid, '-');
            if (String.IsNullOrWhiteSpace(cleanName)) throw new IOException("笔记新名称不能为空。");

            string dir = Path.GetDirectoryName(oldFull);
            string newFull = Path.Combine(dir, cleanName + ".md");
            if (!String.Equals(oldFull, newFull, StringComparison.OrdinalIgnoreCase)) {
                if (File.Exists(newFull)) throw new IOException("同目录下已存在同名笔记。");
                File.Move(oldFull, newFull);
                string oldRel = oldFull.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                string newRel = newFull.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                if (starredPaths.Remove(oldRel)) {
                    starredPaths.Add(newRel);
                    SaveVaultState();
                }
            }
            return newFull;
        }

        public string SafeDirectoryPath(string folderValue, bool allowRoot = false) {
            string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string cleaned = (folderValue ?? "").Trim().Replace('\\', '/').Trim('/');
            if (String.IsNullOrEmpty(cleaned) || cleaned == "根目录") {
                if (allowRoot) return root;
                throw new IOException("目录名称不能为空。");
            }
            foreach (string part in cleaned.Split('/')) {
                if (String.IsNullOrWhiteSpace(part) || part == "." || part == "..") throw new IOException("目录路径包含无效的 . 或 .. 段。");
                if (part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new IOException("目录名称包含非法字符：" + part);
                if (part.StartsWith(".", StringComparison.Ordinal) || IgnoredFolders.Contains(part)) throw new IOException("该目录名称为系统保留名称：" + part);
            }
            string full = Path.GetFullPath(Path.Combine(root, cleaned.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("目录必须位于当前知识库内。");
            for (string current = full; current != null && current.Length >= root.Length; current = Path.GetDirectoryName(current)) {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("不通过符号链接或目录联接操作知识库。");
            }
            return full;
        }

        public string CreateVaultFolder(string relativeFolder) {
            lock (registryLock) {
                string full = SafeDirectoryPath(relativeFolder, false);
                if (File.Exists(full)) throw new IOException("同名文件已存在，无法创建目录。");
                Directory.CreateDirectory(full);
                string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                return full.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
            }
        }

        public object ApplyMovePlan(Dictionary<string, object> plan) {
            lock (registryLock) {
                EnsureRegistry();
                string oldFull = SafeNotePath(Convert.ToString(plan["path"]));
                string newFull = SafeNotePath(Convert.ToString(plan["newRelativePath"]));
                if (String.Equals(oldFull, newFull, StringComparison.OrdinalIgnoreCase)) throw new IOException("笔记已位于该目录中，无需移动。");
                if (File.Exists(newFull) || Directory.Exists(newFull)) throw new IOException("目标目录下已存在同名文件，未执行移动。");
                string oldMarks = oldFull + ".inklet.json";
                string newMarks = newFull + ".inklet.json";
                if (File.Exists(newMarks)) throw new IOException("目标高亮文件已存在，未执行移动。");

                var originals = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                var outputs = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                foreach (Dictionary<string, object> update in ((IEnumerable)plan["updates"]).Cast<Dictionary<string, object>>()) {
                    string rawPath = Convert.ToString(update.ContainsKey("path") && update["path"] != null && !Convert.ToString(update["path"]).StartsWith("vault://", StringComparison.OrdinalIgnoreCase) ? update["path"] : update["relativePath"]);
                    string file = SafeNotePath(rawPath);
                    if (originals.ContainsKey(file)) continue;
                    string expected = Convert.ToString(update["expectedSource"]);
                    byte[] original = ReadVerifiedSource(file, expected);
                    originals.Add(file, original);
                    outputs.Add(file, EncodeLike(original, Convert.ToString(update["source"])));
                }

                foreach (var entry in originals) {
                    if (!File.ReadAllBytes(entry.Key).SequenceEqual(entry.Value)) throw new IOException("移动提交前检测到磁盘变化，操作已取消。");
                }
                foreach (var entry in outputs) {
                    if (entry.Value.SequenceEqual(originals[entry.Key])) continue;
                    FileStore.AtomicWrite(entry.Key, entry.Value, true);
                    cachedNotes.Remove(entry.Key);
                }

                Directory.CreateDirectory(Path.GetDirectoryName(newFull));
                File.Move(oldFull, newFull);
                if (File.Exists(oldMarks)) File.Move(oldMarks, newMarks);
                MoveIdentity(oldFull, newFull);

                string oldRel = Convert.ToString(plan["relativePath"]).Replace('\\', '/');
                string newRel = Convert.ToString(plan["newRelativePath"]).Replace('\\', '/');
                if (starredPaths.Remove(oldRel)) {
                    starredPaths.Add(newRel);
                    SaveVaultState();
                }
                return new { path = newFull, relativePath = newRel };
            }
        }

        public object ApplyFolderMovePlan(Dictionary<string, object> plan) {
            lock (registryLock) {
                EnsureRegistry();
                string sourceFolder = Convert.ToString(plan["sourceFolder"]).Replace('\\', '/').Trim('/');
                string newFolderPath = Convert.ToString(plan["newFolderPath"]).Replace('\\', '/').Trim('/');
                string oldDirFull = SafeDirectoryPath(sourceFolder, false);
                string newDirFull = SafeDirectoryPath(newFolderPath, false);
                if (String.Equals(oldDirFull, newDirFull, StringComparison.OrdinalIgnoreCase)) throw new IOException("目标目录与原目录相同，无需移动。");
                if (newDirFull.StartsWith(oldDirFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("不能将目录移动到其自身或子目录中。");
                if (File.Exists(newDirFull)) throw new IOException("目标路径存在同名文件，无法移动目录。");

                var originals = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                var outputs = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                object updatesObj;
                if (plan.TryGetValue("updates", out updatesObj) && updatesObj is IEnumerable) {
                    foreach (Dictionary<string, object> update in ((IEnumerable)updatesObj).Cast<Dictionary<string, object>>()) {
                        string rawPath = Convert.ToString(update.ContainsKey("path") && update["path"] != null && !Convert.ToString(update["path"]).StartsWith("vault://", StringComparison.OrdinalIgnoreCase) ? update["path"] : update["relativePath"]);
                        string file = SafeNotePath(rawPath);
                        if (originals.ContainsKey(file)) continue;
                        string expected = Convert.ToString(update["expectedSource"]);
                        byte[] original = ReadVerifiedSource(file, expected);
                        originals.Add(file, original);
                        outputs.Add(file, EncodeLike(original, Convert.ToString(update["source"])));
                    }
                }

                var movePairs = new List<Tuple<string, string, string, string>>();
                object movedObj;
                if (plan.TryGetValue("movedNotes", out movedObj) && movedObj is IEnumerable) {
                    foreach (Dictionary<string, object> item in ((IEnumerable)movedObj).Cast<Dictionary<string, object>>()) {
                        string oldRel = Convert.ToString(item["oldRelativePath"]).Replace('\\', '/');
                        string newRel = Convert.ToString(item["newRelativePath"]).Replace('\\', '/');
                        string oldFull = SafeNotePath(oldRel);
                        string newFull = SafeNotePath(newRel);
                        if (File.Exists(newFull) || Directory.Exists(newFull)) throw new IOException("目标目录已存在同名笔记：" + newRel);
                        movePairs.Add(Tuple.Create(oldFull, newFull, oldRel, newRel));
                    }
                }

                foreach (var entry in originals) {
                    if (!File.ReadAllBytes(entry.Key).SequenceEqual(entry.Value)) throw new IOException("目录移动提交前检测到磁盘变化，操作已取消。");
                }
                foreach (var entry in outputs) {
                    if (entry.Value.SequenceEqual(originals[entry.Key])) continue;
                    FileStore.AtomicWrite(entry.Key, entry.Value, true);
                    cachedNotes.Remove(entry.Key);
                }

                Directory.CreateDirectory(newDirFull);
                object movedFoldersObj;
                if (plan.TryGetValue("movedFolders", out movedFoldersObj) && movedFoldersObj is IEnumerable) {
                    foreach (Dictionary<string, object> fItem in ((IEnumerable)movedFoldersObj).Cast<Dictionary<string, object>>()) {
                        string subNew = Convert.ToString(fItem["newFolder"]);
                        if (!String.IsNullOrWhiteSpace(subNew)) {
                            Directory.CreateDirectory(SafeDirectoryPath(subNew, false));
                        }
                    }
                }

                foreach (var pair in movePairs) {
                    string oldFull = pair.Item1;
                    string newFull = pair.Item2;
                    string oldRel = pair.Item3;
                    string newRel = pair.Item4;
                    Directory.CreateDirectory(Path.GetDirectoryName(newFull));
                    File.Move(oldFull, newFull);
                    string oldMarks = oldFull + ".inklet.json";
                    string newMarks = newFull + ".inklet.json";
                    if (File.Exists(oldMarks) && !File.Exists(newMarks)) File.Move(oldMarks, newMarks);
                    cachedNotes.Remove(oldFull);
                    MoveIdentity(oldFull, newFull);
                    if (starredPaths.Remove(oldRel)) starredPaths.Add(newRel);
                }

                if (Directory.Exists(oldDirFull)) {
                    DeleteEmptyDirectoriesRecursive(oldDirFull);
                }
                SaveRegistry();
                SaveVaultState();
                return new {
                    oldFolder = sourceFolder,
                    newFolder = newFolderPath,
                    movedCount = movePairs.Count
                };
            }
        }

        public object ApplyDeletePlan(Dictionary<string, object> plan) {
            lock (registryLock) {
                EnsureRegistry();
                var originals = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                var outputs = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                object updatesObj;
                if (plan.TryGetValue("updates", out updatesObj) && updatesObj is IEnumerable) {
                    foreach (Dictionary<string, object> update in ((IEnumerable)updatesObj).Cast<Dictionary<string, object>>()) {
                        string file = SafeNotePath(Convert.ToString(update.ContainsKey("path") && update["path"] != null ? update["path"] : update["relativePath"]));
                        if (originals.ContainsKey(file)) continue;
                        string expected = Convert.ToString(update["expectedSource"]);
                        byte[] original = ReadVerifiedSource(file, expected);
                        originals.Add(file, original);
                        outputs.Add(file, EncodeLike(original, Convert.ToString(update["source"])));
                    }
                }

                var targetsToDelete = new List<string>();
                object deletedObj;
                if (plan.TryGetValue("deletedNotes", out deletedObj) && deletedObj is IEnumerable) {
                    foreach (Dictionary<string, object> del in ((IEnumerable)deletedObj).Cast<Dictionary<string, object>>()) {
                        string rawTarget = Convert.ToString(del.ContainsKey("path") && del["path"] != null && !Convert.ToString(del["path"]).StartsWith("vault://", StringComparison.OrdinalIgnoreCase) ? del["path"] : del["relativePath"]);
                        string full = SafeNotePath(rawTarget);
                        if (File.Exists(full) && !targetsToDelete.Contains(full, StringComparer.OrdinalIgnoreCase)) {
                            targetsToDelete.Add(full);
                        }
                    }
                }

                foreach (var entry in originals) {
                    if (!File.ReadAllBytes(entry.Key).SequenceEqual(entry.Value)) throw new IOException("删除提交前检测到引用文件已变化，操作已取消。");
                }
                foreach (var entry in outputs) {
                    if (entry.Value.SequenceEqual(originals[entry.Key])) continue;
                    FileStore.AtomicWrite(entry.Key, entry.Value, true);
                    cachedNotes.Remove(entry.Key);
                }

                string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                foreach (string full in targetsToDelete) {
                    string rel = full.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                    if (File.Exists(full)) File.Delete(full);
                    string marks = full + ".inklet.json";
                    if (File.Exists(marks)) File.Delete(marks);
                    cachedNotes.Remove(full);
                    starredPaths.Remove(rel);
                    foreach (var rec in registry.Notes.Where(n => String.Equals(n.RelativePath, rel, StringComparison.OrdinalIgnoreCase))) {
                        rec.Deleted = true;
                    }
                }

                string mode = plan.ContainsKey("mode") ? Convert.ToString(plan["mode"]) : "note";
                string folderPath = plan.ContainsKey("folderPath") ? Convert.ToString(plan["folderPath"]) : "";
                if (mode == "folder" && !String.IsNullOrWhiteSpace(folderPath)) {
                    string dirFull = SafeDirectoryPath(folderPath, false);
                    if (Directory.Exists(dirFull)) {
                        DeleteEmptyDirectoriesRecursive(dirFull);
                    }
                }

                SaveRegistry();
                SaveVaultState();
                return new {
                    deletedCount = targetsToDelete.Count,
                    affectedFileCount = outputs.Count
                };
            }
        }

        private static void DeleteEmptyDirectoriesRecursive(string dir) {
            if (!Directory.Exists(dir)) return;
            foreach (string sub in Directory.GetDirectories(dir)) {
                DeleteEmptyDirectoriesRecursive(sub);
            }
            if (Directory.GetFiles(dir).Length == 0 && Directory.GetDirectories(dir).Length == 0) {
                try { Directory.Delete(dir, false); } catch { }
            }
        }

        private static readonly HashSet<string> SupportedRawExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".pdf", ".epub", ".docx", ".pptx", ".xlsx", ".csv", ".tsv", ".txt", ".html", ".htm", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".webp", ".svg"
        };
        private static readonly HashSet<string> BinaryRawExts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".pdf", ".epub", ".docx", ".pptx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"
        };

        private IEnumerable<string> EnumerateRawFiles() {
            string rawDir = SafeDirectoryPath("raw", false);
            if (!Directory.Exists(rawDir)) yield break;
            var pending = new Stack<string>(); pending.Push(rawDir);
            while (pending.Count > 0) {
                string directory = pending.Pop();
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
                foreach (string child in Directory.GetDirectories(directory).OrderByDescending(value => value, StringComparer.OrdinalIgnoreCase)) {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0 && !Path.GetFileName(child).StartsWith(".", StringComparison.Ordinal)) pending.Push(child);
                }
                foreach (string file in Directory.GetFiles(directory).OrderBy(value => value, StringComparer.OrdinalIgnoreCase)) {
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0 && SupportedRawExts.Contains(Path.GetExtension(file))) yield return file;
                }
            }
        }

        public object[] ListReadingDocuments() {
            lock (registryLock) {
                string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                return EnumerateRawFiles().Where(file => String.Equals(Path.GetExtension(file), ".pdf", StringComparison.OrdinalIgnoreCase) || String.Equals(Path.GetExtension(file), ".epub", StringComparison.OrdinalIgnoreCase)).Select(file => (object)new {
                    name = Path.GetFileName(file),
                    relativePath = file.Substring(root.Length + 1).Replace('\\', '/'),
                    sizeBytes = new FileInfo(file).Length
                }).ToArray();
            }
        }

        public object ReadRawFile(string relativePath) {
            lock (registryLock) {
                if (String.IsNullOrEmpty(relativePath) || !relativePath.StartsWith("raw/", StringComparison.Ordinal) || relativePath.Contains("\\") || !SupportedRawExts.Contains(Path.GetExtension(relativePath))) throw new IOException("原件路径必须位于 raw 目录。");
                string file = SafeDirectoryPath(relativePath, false);
                byte[] bytes;
                using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                    if (stream.Length == 0 || stream.Length > 16 * 1024 * 1024) throw new IOException("原件为空或超过 16 MB 读取上限。");
                    bytes = new byte[(int)stream.Length];
                    int offset = 0;
                    while (offset < bytes.Length) {
                        int count = stream.Read(bytes, offset, bytes.Length - offset);
                        if (count == 0) throw new IOException("原件读取不完整。");
                        offset += count;
                    }
                }
                bool binary = BinaryRawExts.Contains(Path.GetExtension(file));
                return new { name = Path.GetFileName(file), relativePath = relativePath, sizeBytes = bytes.Length, sha256 = BytesHash(bytes), source = binary ? "" : DecodeSource(bytes), base64Data = binary ? Convert.ToBase64String(bytes) : "" };
            }
        }

        public object[] ScanRawFiles() {
            lock (registryLock) {
                string root = Path.GetFullPath(CurrentVaultPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var list = new List<object>();
                foreach (string file in EnumerateRawFiles()) {
                    string ext = Path.GetExtension(file);
                    if (!SupportedRawExts.Contains(ext)) continue;
                    var info = new FileInfo(file);
                    if (info.Length > 16 * 1024 * 1024) continue;
                    byte[] bytes = File.ReadAllBytes(file);
                    string rel = file.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                    string sha = BytesHash(bytes);
                    bool isBin = BinaryRawExts.Contains(ext);
                    list.Add(new {
                        id = "raw:" + rel,
                        name = Path.GetFileName(file),
                        relativePath = rel,
                        path = file,
                        sizeBytes = bytes.Length,
                        sha256 = sha,
                        source = isBin ? "" : DecodeSource(bytes),
                        base64Data = isBin ? Convert.ToBase64String(bytes) : ""
                    });
                }
                return list.ToArray();
            }
        }

        public object ImportRawFile(string fileName, string base64Data, string textSource) {
            lock (registryLock) {
                string cleanName = Path.GetFileName((fileName ?? "").Trim());
                foreach (char c in Path.GetInvalidFileNameChars()) cleanName = cleanName.Replace(c, '-');
                if (String.IsNullOrWhiteSpace(cleanName)) throw new IOException("导入文件名不能为空。");
                string ext = Path.GetExtension(cleanName);
                if (!SupportedRawExts.Contains(ext)) throw new IOException("不支持的原始资料格式：" + ext);
                string rawDir = SafeDirectoryPath("raw", false);
                Directory.CreateDirectory(rawDir);
                string target = Path.GetFullPath(Path.Combine(rawDir, cleanName));
                if (!target.StartsWith(rawDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("目标路径越界。");
                byte[] bytes = !String.IsNullOrEmpty(base64Data)
                    ? Convert.FromBase64String(base64Data)
                    : Utf8.GetBytes(textSource ?? "");
                if (bytes.Length > 16 * 1024 * 1024) throw new IOException("单个原始资料不能超过 16 MB。");
                SafeDirectoryPath("raw/" + cleanName, false);
                if (File.Exists(target) && !File.ReadAllBytes(target).SequenceEqual(bytes)) throw new IOException("同名原件已存在，请更改文件名后导入；不会覆盖已有原件。");
                FileStore.AtomicWrite(target, bytes, true);
                if (String.Equals(ext, ".md", StringComparison.OrdinalIgnoreCase) || String.Equals(ext, ".markdown", StringComparison.OrdinalIgnoreCase)) {
                    cachedNotes.Remove(target);
                }
                return new {
                    importedPath = "raw/" + cleanName,
                    rawFiles = ScanRawFiles(),
                    vault = DescribeVault(true)
                };
            }
        }
    }
}
