using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Inklet;
using Inkloom;

public static class VaultStoreTests {
    static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
    static void Reject(Action action) { try { action(); } catch (IOException) { return; } throw new Exception("Expected rejection"); }
    static void VerifyWorkspaceCapture(string root) {
        var store = new FileStore(Path.Combine(root, "capture-profile")); var vault = new VaultStore(store);
        string folder = Path.Combine(root, "capture-vault"); Directory.CreateDirectory(folder); vault.SetVaultDirectory(folder);
        Require(vault.ScanRawFiles().Length == 0 && vault.ListReadingDocuments().Length == 0, "Empty raw directory fabricated documents");
        Require(!Directory.Exists(Path.Combine(folder, "raw")), "Read-only scan created raw directory");
        byte[] rawBytes = Encoding.ASCII.GetBytes("%PDF-1.4\nreader storage fixture\n%%EOF");
        vault.ImportRawFile("Reader.pdf", Convert.ToBase64String(rawBytes), "");
        string rawPath = Path.Combine(folder, "raw", "Reader.pdf");
        var raw = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(vault.ReadRawFile("raw/Reader.pdf")));
        Require(Convert.FromBase64String((string)raw["base64Data"]).SequenceEqual(rawBytes) && ((string)raw["sha256"]).Length == 64, "Raw reader altered bytes or omitted byte hash");
        Require(vault.ListReadingDocuments().Length == 1 && !store.Json.Serialize(vault.ListReadingDocuments()).Contains("base64Data"), "Document listing loaded binary contents");
        Reject(() => vault.ReadRawFile("raw/../Reader.pdf"));
        Reject(() => vault.ReadRawFile("outside/Reader.pdf"));
        Reject(() => vault.ReadRawFile("raw/missing.pdf"));
        Reject(() => vault.ImportRawFile("Reader.pdf", Convert.ToBase64String(new byte[] { 1, 2, 3 }), ""));
        Require(File.ReadAllBytes(rawPath).SequenceEqual(rawBytes), "Raw reading or conflicting import changed the source");
        Console.WriteLine("INKLOOM_READER_PASS empty-scan, read-only-bytes, metadata-list, boundary, missing, import-conflict");
        string source = "---\ntitle: Capture\ncategory: task\n---\n\n- [ ] Capture @due(2026-10-23)\n";
        string target = vault.CreateNoteFile("Capture receipt", "tasks", source, true); byte[] before = File.ReadAllBytes(target); string identity = vault.NoteId(target);
        Require(vault.CreateNoteFile("Capture receipt", "tasks", source, true) == target, "Identical capture retry created another file");
        Reject(() => vault.CreateNoteFile("Capture receipt", "tasks", source + "EXTERNAL", true));
        Require(File.ReadAllBytes(target).SequenceEqual(before) && vault.NoteId(target) == identity, "Capture retry modified the original");
        string longTitle = new string('n', 245 - Path.Combine(folder, "tasks").Length - 4);
        string longFile = vault.CreateNoteFile(longTitle, "tasks", source, true); Require(longFile.Length == 245 && File.ReadAllText(longFile) == source, "Capture temporary filename exceeded a valid destination path budget");
        Directory.CreateDirectory(Path.Combine(folder, "projects", "empty")); var state = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(vault.DescribeVault(true));
        Require(state.Contains("projects/empty"), "Empty directory missing from native hierarchy");
        Require(Directory.GetFiles(folder, "*.tmp", SearchOption.AllDirectories).Length == 0, "Capture left temporary output");
        Console.WriteLine("INKLOOM_CAPTURE_PASS exclusive-create, idempotent-retry, conflict, long-path, empty-folders");
    }
    static void VerifyFailedRenameRollback(string root, string mode) {
        var store = new FileStore(Path.Combine(root, mode + "-profile"));
        var vault = new VaultStore(store);
        string notes = Path.Combine(root, mode + "-vault"); Directory.CreateDirectory(notes); vault.SetVaultDirectory(notes);
        string first = Path.Combine(notes, "First.md"); string referring = Path.Combine(notes, "Ref.md"); string target = Path.Combine(notes, "Next.md");
        File.WriteAllText(first, "# First\r\n", new UTF8Encoding(true)); File.WriteAllText(referring, "[[First]]\r\n", new UTF8Encoding(false));
        File.WriteAllText(first + ".inklet.json", "{\"marks\":[]}", new UTF8Encoding(false)); byte[] marksBefore = File.ReadAllBytes(first + ".inklet.json");
        byte[] firstBefore = File.ReadAllBytes(first); byte[] referringBefore = File.ReadAllBytes(referring); string identity = vault.NoteId(first);
        var plan = new Dictionary<string, object> {
            {"path", first}, {"relativePath", "First.md"}, {"newRelativePath", "Next.md"},
            {"updates", new object[] {
                new Dictionary<string, object> { {"path", first}, {"expectedSource", "# First\n"}, {"source", "# Next\n"} },
                new Dictionary<string, object> { {"path", referring}, {"expectedSource", "[[First]]\n"}, {"source", "[[Next]]\n"} }
            }}
        };
        FileStream occupied = null;
        try {
            if (mode == "reference-lock") occupied = new FileStream(referring, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (mode == "annotations-lock") occupied = new FileStream(first + ".inklet.json", FileMode.Open, FileAccess.Read, FileShare.Read);
            vault.RenameCheckpoint = stage => {
                if (stage == "identity-moved" && mode == "identity-failure") throw new IOException("Injected failure after identity migration");
                if (stage == "files-written" && (mode == "rollback-lock" || mode == "external-edit")) {
                    File.WriteAllText(referring, "EXTERNAL_VERSION\n", new UTF8Encoding(false));
                    if (mode == "rollback-lock") occupied = new FileStream(referring, FileMode.Open, FileAccess.Read, FileShare.None);
                    throw new IOException("Injected failure before rename");
                }
            };
            Reject(() => vault.ApplyRenamePlan(plan));
        } finally { if (occupied != null) occupied.Dispose(); }
        bool pending = mode == "rollback-lock" || mode == "external-edit";
        Require(firstBefore.SequenceEqual(File.ReadAllBytes(first)), "Rollback stopped before restoring an independent file");
        Require(pending ? File.ReadAllText(referring) == "EXTERNAL_VERSION\n" : referringBefore.SequenceEqual(File.ReadAllBytes(referring)), "Rollback replaced external content or lost the original reference");
        Require(!File.Exists(target) && vault.NoteId(first) == identity, "Failed rename changed file name or identity");
        Require(!File.Exists(target + ".inklet.json") && marksBefore.SequenceEqual(File.ReadAllBytes(first + ".inklet.json")), "Rollback lost annotations");
        Require(vault.PendingRecovery().Length == (pending ? 1 : 0), "Rollback terminal state is inaccurate");
        Require(new VaultStore(store).PendingRecovery().Length == (pending ? 1 : 0), "Rollback state changed after reopening the profile");
        string journal = Directory.GetDirectories(Path.Combine(store.DataDirectory, "rename-journals")).Single();
        Require(File.Exists(Path.Combine(journal, "ROLLED_BACK")) == !pending && !File.Exists(Path.Combine(journal, "COMMITTED")), "Rollback has an incorrect terminal journal marker");
        Require(Directory.GetFiles(journal, "*.bak").Length == 3, "Rollback discarded original backups");
        if (pending) Require(File.ReadAllText(Path.Combine(journal, "recovery.json")).Contains("\"state\":\"pending\""), "Incomplete rollback has no recovery report");
        Console.WriteLine("INKLOOM_ROLLBACK_PASS " + mode);
    }
    static void VerifySourceSnapshotProtection(string root, bool rename) {
        string mode = rename ? "rename-snapshot" : "update-snapshot";
        var store = new FileStore(Path.Combine(root, mode + "-profile")); var vault = new VaultStore(store);
        string notes = Path.Combine(root, mode + "-vault"); Directory.CreateDirectory(notes); vault.SetVaultDirectory(notes);
        string file = Path.Combine(notes, "First.md"); File.WriteAllText(file, "# First\n", new UTF8Encoding(true));
        vault.SourceVerifiedCheckpoint = path => File.WriteAllText(path, "EXTERNAL_AFTER_VERIFICATION\r\n", new UTF8Encoding(true));
        if (rename) {
            var plan = new Dictionary<string, object> { {"path", file}, {"relativePath", "First.md"}, {"newRelativePath", "Next.md"}, {"updates", new object[] {
                new Dictionary<string, object> { {"path", file}, {"expectedSource", "# First\n"}, {"source", "# Next\n"} }
            }} };
            Reject(() => vault.ApplyRenamePlan(plan));
        } else Reject(() => vault.UpdateFileSource(file, "# Replacement\n", "# First\n"));
        Require(File.ReadAllText(file) == "EXTERNAL_AFTER_VERIFICATION\r\n", "Write overwrote a change after source verification");
        Require(File.ReadAllBytes(file).Take(3).SequenceEqual(new byte[] {239,187,191}), "Rejected write changed the external BOM");
        Require(!File.Exists(Path.Combine(notes, "Next.md")), "Rejected snapshot check still renamed the note");
        Console.WriteLine("INKLOOM_SNAPSHOT_PASS " + mode);
    }
    static void VerifyFailedVaultSwitch(string root) {
        var store = new FileStore(Path.Combine(root, "switch-profile")); var vault = new VaultStore(store);
        string original = Path.Combine(root, "switch-original"); Directory.CreateDirectory(original);
        string note = Path.Combine(original, "Original.md"); File.WriteAllText(note, "# Original\n"); vault.SetVaultDirectory(original);
        string originalId = vault.VaultId; string noteId = vault.NoteId(note); vault.ToggleStarred(note);
        string broken = Path.Combine(root, "switch-broken"); Directory.CreateDirectory(broken);
        string registry = Path.Combine(store.DataDirectory, "vaults", VaultStore.StableNoteId(broken), "identity.json"); Directory.CreateDirectory(Path.GetDirectoryName(registry)); File.WriteAllText(registry, "{");
        Reject(() => vault.SetVaultDirectory(broken));
        Require(vault.CurrentVaultPath == original && vault.VaultId == originalId && vault.NoteId(note) == noteId, "Failed vault switch changed the active identity or directory");
        Require(store.Json.Serialize(vault.DescribeVault()).Contains("\"starred\":true"), "Failed vault switch lost starred state");
        string next = Path.Combine(root, "switch-next"); Directory.CreateDirectory(next);
        using (var occupied = new FileStream(Path.Combine(store.DataDirectory, "vault-state.json"), FileMode.Open, FileAccess.Read, FileShare.Read)) Reject(() => vault.SetVaultDirectory(next));
        Require(vault.CurrentVaultPath == original && new VaultStore(store).CurrentVaultPath == original, "Failed vault state persistence changed the current or reopened directory");
        Console.WriteLine("INKLOOM_VAULT_SWITCH_PASS registry-failure, state-write-failure");
    }
    static void VerifyRecoveryManager(string root) {
        var store = new FileStore(Path.Combine(root, "recovery-profile")); var vault = new VaultStore(store);
        string notes = Path.Combine(root, "recovery-vault"); Directory.CreateDirectory(notes); vault.SetVaultDirectory(notes);
        string first = Path.Combine(notes, "First.md"); string referring = Path.Combine(notes, "Ref.md"); string target = Path.Combine(notes, "Next.md");
        File.WriteAllText(first, "# First\r\n", new UTF8Encoding(true)); File.WriteAllText(referring, "[[First]]\r\n", new UTF8Encoding(false));
        File.WriteAllText(first + ".inklet.json", "{\"marks\":[]}", new UTF8Encoding(false));
        byte[] original = File.ReadAllBytes(first); byte[] reference = File.ReadAllBytes(referring); string identity = vault.NoteId(first);
        var plan = new Dictionary<string, object> { {"path", first}, {"relativePath", "First.md"}, {"newRelativePath", "Next.md"}, {"updates", new object[] {
            new Dictionary<string, object> { {"path", first}, {"expectedSource", "# First\n"}, {"source", "# Next\n"} },
            new Dictionary<string, object> { {"path", referring}, {"expectedSource", "[[First]]\n"}, {"source", "[[Next]]\n"} }
        }} };
        vault.ApplyRenamePlan(plan);
        string journal = Directory.GetDirectories(Path.Combine(store.DataDirectory, "rename-journals")).Single(); string id = Path.GetFileName(journal);
        File.Delete(Path.Combine(journal, "COMMITTED"));
        var preview = vault.PreviewRecovery(id); Require(preview.canRestore && preview.files.Count == 2, "Applied uncommitted transaction has no recovery preview");
        Require(!store.Json.Serialize(preview).Contains("\"original\"") && !store.Json.Serialize(preview).Contains("\"journal\""), "Recovery preview exposed internal backup payloads");
        byte[] updatedReference = File.ReadAllBytes(referring); File.WriteAllText(referring, "EXTERNAL\n");
        Reject(() => vault.RestoreRecovery(id, preview.token)); Require(File.Exists(target) && File.ReadAllText(referring) == "EXTERNAL\n", "Stale preview changed files");
        Require(!vault.PreviewRecovery(id).canRestore, "External changes did not block recovery"); File.WriteAllBytes(referring, updatedReference);
        string other = Path.Combine(root, "recovery-other"); Directory.CreateDirectory(other); vault.SetVaultDirectory(other);
        Require(!vault.PreviewRecovery(id).canRestore, "Recovery crossed the current vault boundary"); vault.SetVaultDirectory(notes);
        string manifestPath = Path.Combine(journal, "plan.json"); byte[] manifest = File.ReadAllBytes(manifestPath);
        var parsed = store.Json.Deserialize<VaultStore.RecoveryJournal>(File.ReadAllText(manifestPath));
        string backupPath = Path.Combine(journal, parsed.files[0].backup); byte[] backup = File.ReadAllBytes(backupPath); File.WriteAllText(backupPath, "damaged");
        Require(!vault.PreviewRecovery(id).canRestore, "Corrupt backup accepted"); File.WriteAllBytes(backupPath, backup);
        parsed.files[0].backup = "../outside.bak"; File.WriteAllText(manifestPath, store.Json.Serialize(parsed));
        Require(!vault.PreviewRecovery(id).canRestore, "Escaping backup path accepted"); File.WriteAllBytes(manifestPath, manifest);
        parsed = store.Json.Deserialize<VaultStore.RecoveryJournal>(File.ReadAllText(manifestPath)); parsed.format = 0; File.WriteAllText(manifestPath, store.Json.Serialize(parsed));
        Require(!vault.PreviewRecovery(id).canRestore, "Legacy recovery log was writable"); File.WriteAllBytes(manifestPath, manifest);
        preview = vault.PreviewRecovery(id);
        using (var occupied = new FileStream(referring, FileMode.Open, FileAccess.Read, FileShare.Read)) Reject(() => vault.RestoreRecovery(id, preview.token));
        Require(vault.PendingRecovery().Length == 1 && File.Exists(first), "Interrupted recovery lost its pending state");
        preview = vault.PreviewRecovery(id); Require(preview.canRestore, "Partially completed recovery cannot be retried safely"); vault.RestoreRecovery(id, preview.token);
        Require(original.SequenceEqual(File.ReadAllBytes(first)) && reference.SequenceEqual(File.ReadAllBytes(referring)) && !File.Exists(target), "Recovery did not restore original bytes and name");
        Require(File.Exists(first + ".inklet.json") && vault.NoteId(first) == identity && vault.PendingRecovery().Length == 0, "Recovery lost annotations, identity or terminal state");
        Reject(() => vault.RestoreRecovery(id, preview.token));
        Require(Directory.GetFiles(journal, "*.bak").Length == 3, "Recovery deleted backups");
        for (int index = 0; index < 27; index++) {
            string entry = Path.Combine(Path.GetDirectoryName(journal), Guid.NewGuid().ToString("N")); Directory.CreateDirectory(entry); File.WriteAllBytes(Path.Combine(entry, "plan.json"), manifest);
        }
        var firstPage = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(vault.ListRecovery(0, 25, "pending")));
        var secondPage = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(vault.ListRecovery(25, 25, "pending")));
        Require(Convert.ToInt32(firstPage["total"]) == 27 && ((System.Collections.IEnumerable)firstPage["items"]).Cast<object>().Count() == 25 && ((System.Collections.IEnumerable)secondPage["items"]).Cast<object>().Count() == 2, "Recovery pagination hid pending history");
        Console.WriteLine("INKLOOM_RECOVERY_PASS preview, stale-token, external-edit, cross-vault, corrupt-backup, boundary, legacy, interrupted-retry, identity, pagination");
    }
    static void VerifyStartupPreferences(string root) {
        var store = new FileStore(Path.Combine(root, "startup-profile")); var vault = new VaultStore(store);
        string notes = Path.Combine(root, "startup-vault"); Directory.CreateDirectory(notes);
        string first = Path.Combine(notes, "Alpha.md"); string second = Path.Combine(notes, "Beta.md");
        File.WriteAllText(first, "# Alpha\n"); File.WriteAllText(second, "# Beta\n"); vault.SetVaultDirectory(notes);
        string secondId = vault.NoteId(second); vault.RememberActiveNote(second); vault.SetStartupPreference("last", null);
        Require(new VaultStore(store).ResolveStartupNote() == second, "Last note was not restored after reopening");
        vault.SetStartupPreference("note", secondId); string moved = Path.Combine(notes, "Moved.md"); File.Move(second, moved); vault.DescribeVault(true);
        Require(new VaultStore(store).ResolveStartupNote() == moved, "Fixed startup note did not follow permanent identity after move");
        File.Delete(moved); Require(new VaultStore(store).ResolveStartupNote() == first, "Missing startup note did not fall back safely");
        vault.SetStartupPreference("blank", null); Require(new VaultStore(store).ResolveStartupNote() == null, "Blank startup mode opened a note");
        Reject(() => vault.SetStartupPreference("note", "foreign-note"));
        string registry = Path.Combine(store.DataDirectory, "vaults", VaultStore.StableNoteId(notes), "identity.json");
        using (var occupied = new FileStream(registry, FileMode.Open, FileAccess.Read, FileShare.Read)) Reject(() => vault.SetStartupPreference("first", null));
        Require(store.Json.Serialize(vault.WorkspacePreferences()).Contains("\"startupMode\":\"blank\""), "Failed preference save changed memory state");
        string other = Path.Combine(root, "startup-other"); Directory.CreateDirectory(other); vault.SetVaultDirectory(other);
        Require(store.Json.Serialize(vault.WorkspacePreferences()).Contains("\"startupMode\":\"first\""), "Startup mode leaked to another vault");
        vault.SetVaultDirectory(notes); Require(store.Json.Serialize(vault.WorkspacePreferences()).Contains("\"startupMode\":\"blank\""), "Returning to vault lost its preference");
        vault.ForgetRecentVault(other); Require(Directory.Exists(other) && !store.Json.Serialize(vault.WorkspacePreferences()).Contains(other.Replace("\\", "\\\\")), "Removing recent entry deleted files or kept the entry");
        for (int index = 0; index < 14; index++) { string recent = Path.Combine(root, "recent-" + index); Directory.CreateDirectory(recent); vault.SetVaultDirectory(recent); }
        vault.SetVaultDirectory(Path.Combine(root, "recent-13"));
        var preferences = store.Json.Deserialize<Dictionary<string, object>>(store.Json.Serialize(vault.WorkspacePreferences()));
        Require(((System.Collections.IEnumerable)preferences["recentVaults"]).Cast<object>().Count() == 12, "Recent vault limit or deduplication failed");
        Directory.Delete(Path.Combine(root, "recent-13")); var reopened = new VaultStore(store);
        Require(reopened.CurrentVaultPath != Path.Combine(root, "recent-13") && Directory.Exists(reopened.CurrentVaultPath), "Missing recent vault did not fall back to a usable directory");
        Require(store.Json.Serialize(reopened.WorkspacePreferences()).Contains("\"available\":false"), "Missing directory disappeared from recent history");
        Console.WriteLine("INKLOOM_STARTUP_PASS recent-vaults, last-note, fixed-note-id, blank, missing-fallback, per-vault, failed-save, bounded-history, missing-vault");
    }
    public static int Main(string[] arguments) {
        if (arguments.Length >= 3 && arguments[0] == "--crash-rename") return RunCrashRename(arguments[1], arguments[2]);
        string root = Path.Combine(Path.GetTempPath(), "InkloomNative-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            var store = new FileStore(Path.Combine(root, "profile"));
            var vault = new VaultStore(store);
            string notes = Path.Combine(root, "vault"); Directory.CreateDirectory(notes);
            vault.SetVaultDirectory(notes);
            string first = Path.Combine(notes, "First.md"); string referring = Path.Combine(notes, "Ref.md");
            File.WriteAllText(first, "# First\r\n", new UTF8Encoding(true));
            File.WriteAllText(referring, "[[First]]\r\n", new UTF8Encoding(false));
            byte[] before = File.ReadAllBytes(first);
            string permanentId = vault.NoteId(first);
            Require(permanentId == new VaultStore(store).NoteId(first), "Note identity changed across sessions");
            Reject(() => vault.UpdateFileSource(first, "lost", "stale"));
            Require(before.SequenceEqual(File.ReadAllBytes(first)), "Stale write modified file");
            Reject(() => vault.SafeNotePath(Path.Combine(root, "vault-other", "bad.md")));
            Reject(() => vault.SafeNotePath("../bad.md"));
            vault.UpdateFileSource(first, "# First\nBody\n", "# First\n");
            vault.Invalidate(first, true);
            Require(vault.NoteId(first) == permanentId, "Atomic replacement notification changed identity");
            using (var watcher = new FileSystemWatcher(notes)) {
                watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite;
                watcher.Deleted += (sender, change) => vault.Invalidate(change.FullPath, true);
                watcher.Created += (sender, change) => vault.Invalidate(change.FullPath);
                watcher.Renamed += (sender, change) => vault.Invalidate(null);
                watcher.EnableRaisingEvents = true;
                for (int attempt = 0; attempt < 5; attempt++) {
                    vault.UpdateFileSource(first, "# First\nBody\n", "# First\nBody\n");
                    vault.DescribeVault(); Require(vault.NoteId(first) == permanentId, "Real replacement events changed identity");
                }
            }
            byte[] updated = File.ReadAllBytes(first);
            Require(updated.Take(3).SequenceEqual(new byte[] {239,187,191}), "BOM lost");
            Require(File.ReadAllText(first).Contains("\r\n"), "CRLF lost");
            var updates = new object[] {
                new Dictionary<string, object> { {"path", first}, {"expectedSource", "# First\nBody\n"}, {"source", "# First\nBody\n"} },
                new Dictionary<string, object> { {"path", referring}, {"expectedSource", "[[First]]\n"}, {"source", "[[Next]]\n"} }
            };
            var plan = new Dictionary<string, object> { {"path", first}, {"relativePath", "First.md"}, {"newRelativePath", "Next.md"}, {"updates", updates} };
            File.WriteAllText(referring, "external\n");
            Reject(() => vault.ApplyRenamePlan(plan));
            Require(File.Exists(first) && !File.Exists(Path.Combine(notes, "Next.md")), "Conflict moved source");
            File.WriteAllText(referring, "[[First]]\r\n");
            File.WriteAllText(first + ".inklet.json", "{\"marks\":[]}");
            vault.ApplyRenamePlan(plan);
            Require(vault.NoteId(Path.Combine(notes, "Next.md")) == permanentId, "Rename changed permanent identity");
            Require(!File.Exists(first) && File.Exists(Path.Combine(notes, "Next.md")), "Rename missing");
            Require(File.ReadAllText(referring) == "[[Next]]\r\n", "Reference write or CRLF failed");
            Require(File.ReadAllText(Path.Combine(notes, "Next.md.inklet.json")) == "{\"marks\":[]}", "Annotations lost");
            Require(Directory.GetFiles(Path.Combine(store.DataDirectory, "rename-journals"), "COMMITTED", SearchOption.AllDirectories).Length == 1, "Journal not committed");
            string movedFolder = Path.Combine(notes, "moved"); Directory.CreateDirectory(movedFolder);
            string movedFile = Path.Combine(movedFolder, "Next.md"); File.Move(Path.Combine(notes, "Next.md"), movedFile);
            vault.DescribeVault(true);
            Require(vault.NoteId(movedFile) == permanentId, "External move changed permanent identity");
            string duplicate = Path.Combine(notes, "Next.md"); File.WriteAllText(duplicate, "different\n");
            Require(vault.NoteId(duplicate) != permanentId, "Same-name notes share identity");
            string deletedId = vault.NoteId(duplicate); File.Delete(duplicate); vault.DescribeVault(true);
            File.WriteAllText(duplicate, "recreated\n"); Require(vault.NoteId(duplicate) != deletedId, "Recreated file inherited deleted identity");
            vault.ToggleStarred(duplicate);
            string otherVault = Path.Combine(root, "other-vault"); Directory.CreateDirectory(otherVault); File.WriteAllText(Path.Combine(otherVault, "Next.md"), "other\n");
            vault.SetVaultDirectory(otherVault);
            Require(store.Json.Serialize(vault.DescribeVault()).Contains("\"starred\":false"), "Stars leaked across vaults");
            vault.SetVaultDirectory(notes);
            File.WriteAllBytes(Path.Combine(notes, "Bad.md"), new byte[] { 255, 254, 40, 0 });
            var scan = store.Json.Serialize(vault.DescribeVault(true));
            Require(scan.Contains("Bad.md") && scan.Contains("\"incomplete\":true"), "Invalid encoding was silently accepted");
            VerifyWorkspaceCapture(root);
            foreach (string mode in new[] { "reference-lock", "annotations-lock", "identity-failure", "rollback-lock", "external-edit" }) VerifyFailedRenameRollback(root, mode);
            VerifySourceSnapshotProtection(root, false); VerifySourceSnapshotProtection(root, true);
            VerifyFailedVaultSwitch(root);
            VerifyRecoveryManager(root);
            VerifyStartupPreferences(root);
            VerifyPortableIdentity(root);
            VerifyAclDenial(root);
            VerifyCrashRecovery(root);
            if (arguments.Length > 0) VerifyCrossVolumeIdentity(root, arguments[0]);
            VerifyWatcherOverflow(root);
            var integrityStore = new FileStore(Path.Combine(root, "scan-integrity-profile")); var integrityVault = new VaultStore(integrityStore);
            string integrityDirectory = Path.Combine(root, "scan-integrity"); Directory.CreateDirectory(integrityDirectory); integrityVault.SetVaultDirectory(integrityDirectory);
            string integrityNote = Path.Combine(integrityDirectory, "Probe.md"); File.WriteAllText(integrityNote, "# Before\n", new UTF8Encoding(false));
            integrityVault.DescribeVault(); DateTime stamp = File.GetLastWriteTimeUtc(integrityNote);
            File.WriteAllText(integrityNote, "# After!\n", new UTF8Encoding(false)); File.SetLastWriteTimeUtc(integrityNote, stamp);
            Require(integrityStore.Json.Serialize(integrityVault.DescribeVault()).Contains("After!"), "Same-size same-timestamp external edit was hidden by the scan cache");
            Console.WriteLine("INKLOOM_SCAN_PASS same-size-same-timestamp");
            Console.WriteLine("INKLOOM_NATIVE_STORAGE_PASS stale-write, boundary, BOM, CRLF, batch-conflict, rename, journal");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { try { Directory.Delete(root, true); } catch {} }
    }
    static void VerifyPortableIdentity(string root) {
        string source = Path.Combine(root, "portable-source"); string destination = Path.Combine(root, "portable-destination"); Directory.CreateDirectory(source); Directory.CreateDirectory(destination);
        string sourceNote = Path.Combine(source, "Note.md"); File.WriteAllText(sourceNote, "# Portable\r\n", new UTF8Encoding(true)); File.Copy(sourceNote, Path.Combine(destination, "Note.md"));
        var firstStore = new FileStore(Path.Combine(root, "portable-profile-a")); var first = new VaultStore(firstStore); first.SetVaultDirectory(source); string originalId = first.NoteId(sourceNote); first.ToggleStarred(sourceNote); first.SetStartupPreference("note", originalId);
        string json = firstStore.Json.Serialize(first.ExportIdentity());
        var secondStore = new FileStore(Path.Combine(root, "portable-profile-b")); var second = new VaultStore(secondStore); second.SetVaultDirectory(destination); string target = Path.Combine(destination, "Note.md"); byte[] before = File.ReadAllBytes(target);
        var preview = second.PreviewIdentity(json); Require(preview.canImport, "Matching copied vault did not validate for identity migration");
        File.WriteAllText(target, "changed"); Reject(() => second.ImportIdentity(json, preview.token)); File.WriteAllBytes(target, before);
        preview = second.PreviewIdentity(json); second.ImportIdentity(json, preview.token);
        Require(second.NoteId(target) == originalId && second.VaultId == first.VaultId && before.SequenceEqual(File.ReadAllBytes(target)), "Identity migration changed content or failed to preserve identities");
        Require(secondStore.Json.Serialize(second.DescribeVault()).Contains("\"starred\":true") && second.ResolveStartupNote() == target, "Identity migration lost stars or startup note");
        var malformed = first.ExportIdentity(); malformed.notes.Add(malformed.notes[0]); Require(!second.PreviewIdentity(firstStore.Json.Serialize(malformed)).canImport, "Duplicate portable identity was accepted");
        malformed = first.ExportIdentity(); malformed.notes[0].relativePath = "../outside.md"; Require(!second.PreviewIdentity(firstStore.Json.Serialize(malformed)).canImport, "Portable identity escaped vault boundary");
        Console.WriteLine("INKLOOM_MIGRATION_PASS copied-vault, cross-profile, hash-match, stale-preview, stable-id, stars, startup, duplicate, boundary");
    }

    static void VerifyAclDenial(string root) {
        var store = new FileStore(Path.Combine(root, "acl-profile")); var vault = new VaultStore(store);
        string directory = Path.Combine(root, "acl-vault"); Directory.CreateDirectory(directory); string note = Path.Combine(directory, "Protected.md"); File.WriteAllText(note, "# Protected\n"); vault.SetVaultDirectory(directory);
        var original = File.GetAccessControl(note); var changed = File.GetAccessControl(note);
        var directoryOriginal = Directory.GetAccessControl(directory); var directoryChanged = Directory.GetAccessControl(directory);
        var identity = System.Security.Principal.WindowsIdentity.GetCurrent().User;
        changed.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(identity, System.Security.AccessControl.FileSystemRights.WriteData | System.Security.AccessControl.FileSystemRights.AppendData | System.Security.AccessControl.FileSystemRights.Delete, System.Security.AccessControl.AccessControlType.Deny));
        directoryChanged.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(identity, System.Security.AccessControl.FileSystemRights.CreateFiles | System.Security.AccessControl.FileSystemRights.DeleteSubdirectoriesAndFiles, System.Security.AccessControl.AccessControlType.Deny));
        try {
            File.SetAccessControl(note, changed); Directory.SetAccessControl(directory, directoryChanged); bool rejected = false;
            try { vault.UpdateFileSource(note, "# Overwritten\n", "# Protected\n"); } catch (IOException) { rejected = true; } catch (UnauthorizedAccessException) { rejected = true; }
            Require(rejected && File.ReadAllText(note) == "# Protected\n", "ACL denied write modified content or was reported successful");
        } finally { Directory.SetAccessControl(directory, directoryOriginal); File.SetAccessControl(note, original); }
        Console.WriteLine("INKLOOM_ACL_PASS temporary-file-write-deny-restored");
    }

    static int RunCrashRename(string root, string stage) {
        var store = new FileStore(Path.Combine(root, "profile")); var vault = new VaultStore(store);
        string directory = Path.Combine(root, "vault"); Directory.CreateDirectory(directory); vault.SetVaultDirectory(directory);
        string first = Path.Combine(directory, "First.md"); string referring = Path.Combine(directory, "Ref.md");
        File.WriteAllText(first, "# First\r\n", new UTF8Encoding(true)); File.WriteAllText(referring, "[[First]]\r\n", new UTF8Encoding(false)); File.WriteAllText(first + ".inklet.json", "{\"marks\":[]}"); vault.NoteId(first);
        vault.RenameCheckpoint = checkpoint => { if (checkpoint == stage) System.Diagnostics.Process.GetCurrentProcess().Kill(); };
        var plan = new Dictionary<string, object> { {"path", first}, {"relativePath", "First.md"}, {"newRelativePath", "Next.md"}, {"updates", new object[] {
            new Dictionary<string, object> { {"path", first}, {"expectedSource", "# First\n"}, {"source", "# Next\n"} },
            new Dictionary<string, object> { {"path", referring}, {"expectedSource", "[[First]]\n"}, {"source", "[[Next]]\n"} }
        }} };
        vault.ApplyRenamePlan(plan); return 3;
    }

    static void VerifyCrashRecovery(string root) {
        foreach (string stage in new[] { "files-written", "identity-moved" }) {
            string fixture = Path.Combine(root, "crash-" + stage); Directory.CreateDirectory(fixture);
            var start = new System.Diagnostics.ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location, "--crash-rename \"" + fixture + "\" " + stage) { UseShellExecute = false, CreateNoWindow = true };
            using (var process = System.Diagnostics.Process.Start(start)) { if (!process.WaitForExit(20000)) { process.Kill(); throw new Exception("Crash fixture did not exit"); } Require(process.ExitCode != 3, "Crash checkpoint was not reached"); }
            var store = new FileStore(Path.Combine(fixture, "profile")); var vault = new VaultStore(store);
            string journal = vault.PendingRecovery().Single(); string id = Path.GetFileName(journal); var preview = vault.PreviewRecovery(id);
            Require(preview.canRestore, "Actual process termination left an unrecoverable transaction: " + preview.message); vault.RestoreRecovery(id, preview.token);
            string directory = Path.Combine(fixture, "vault"); Require(File.ReadAllText(Path.Combine(directory, "First.md")) == "# First\r\n" && File.ReadAllText(Path.Combine(directory, "Ref.md")) == "[[First]]\r\n", "Crash recovery lost original text");
            Require(!File.Exists(Path.Combine(directory, "Next.md")) && File.Exists(Path.Combine(directory, "First.md.inklet.json")), "Crash recovery lost names or annotations");
            Console.WriteLine("INKLOOM_CRASH_PASS " + stage);
        }
    }

    static void VerifyCrossVolumeIdentity(string root, string projectRoot) {
        if (String.Equals(Path.GetPathRoot(root), Path.GetPathRoot(projectRoot), StringComparison.OrdinalIgnoreCase)) { Console.WriteLine("INKLOOM_CROSS_VOLUME_SKIP no-second-volume"); return; }
        string source = Path.Combine(root, "cross-volume-source"); string destination = Path.Combine(projectRoot, "verification", "cross-volume-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(source); Directory.CreateDirectory(destination);
        try {
            string original = Path.Combine(source, "Note.md"); string copied = Path.Combine(destination, "Note.md"); File.WriteAllText(original, "# Cross volume\r\n", new UTF8Encoding(true)); File.Copy(original, copied);
            var sourceStore = new FileStore(Path.Combine(root, "cross-volume-profile-a")); var first = new VaultStore(sourceStore); first.SetVaultDirectory(source); string id = first.NoteId(original);
            string manifest = sourceStore.Json.Serialize(first.ExportIdentity()); var second = new VaultStore(new FileStore(Path.Combine(root, "cross-volume-profile-b"))); second.SetVaultDirectory(destination);
            Require(second.NoteId(copied) != id, "Cross-volume fixture unexpectedly reused identity before explicit import");
            var preview = second.PreviewIdentity(manifest); Require(preview.canImport, preview.message); second.ImportIdentity(manifest, preview.token);
            Require(second.NoteId(copied) == id && File.ReadAllBytes(original).SequenceEqual(File.ReadAllBytes(copied)), "Cross-volume identity import changed content or identity");
            Console.WriteLine("INKLOOM_CROSS_VOLUME_PASS " + Path.GetPathRoot(source) + " to " + Path.GetPathRoot(destination));
        } finally { Directory.Delete(destination, true); }
    }

    static void VerifyWatcherOverflow(string root) {
        string directory = Path.Combine(root, "watcher-overflow"); Directory.CreateDirectory(directory);
        var store = new FileStore(Path.Combine(root, "watcher-profile")); var vault = new VaultStore(store); vault.SetVaultDirectory(directory);
        string note = Path.Combine(directory, "Probe.md"); File.WriteAllText(note, "# Before\n"); vault.DescribeVault();
        using (var entered = new System.Threading.ManualResetEventSlim()) using (var release = new System.Threading.ManualResetEventSlim()) using (var overflow = new System.Threading.ManualResetEventSlim()) using (var watcher = new FileSystemWatcher(directory)) {
            int blocked = 0; watcher.InternalBufferSize = 4096; watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite;
            watcher.Created += (sender, change) => { if (System.Threading.Interlocked.Exchange(ref blocked, 1) == 0) { entered.Set(); release.Wait(20000); } };
            watcher.Error += (sender, error) => { vault.Invalidate(null); overflow.Set(); }; watcher.EnableRaisingEvents = true;
            try {
                File.WriteAllText(Path.Combine(directory, "start.tmp"), ""); Require(entered.Wait(5000), "Watcher did not receive initial notification");
                for (int index = 0; index < 3000; index++) File.WriteAllText(Path.Combine(directory, "burst-" + index + ".tmp"), "");
                File.WriteAllText(note, "# After!\n"); release.Set(); Require(overflow.Wait(10000), "Real watcher overflow did not occur");
                Require(store.Json.Serialize(vault.DescribeVault(true)).Contains("After!"), "Full rescan after overflow missed updated note");
            } finally { release.Set(); watcher.EnableRaisingEvents = false; }
        }
        Console.WriteLine("INKLOOM_WATCHER_PASS real-buffer-overflow-rescan");
    }
}