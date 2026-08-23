using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ConsoleCountsPayload
    {
        public int errors;
        public int warnings;
        public int logs;
    }

    [Serializable]
    internal sealed class ConsoleDiagnosticPayload
    {
        public long timestampUnixMs;
        public string severity;
        public string message;
        public string stackTrace;
    }

    [Serializable]
    internal sealed class CompilerDiagnosticPayload
    {
        public string severity;
        public string message;
        public string file;
        public int line;
        public int column;
        public string assemblyPath;
    }

    [Serializable]
    internal sealed class CompilationSnapshotPayload
    {
        public long sequence;
        public long completedUnixMs;
        public bool truncated;
        public CompilerDiagnosticPayload[] messages;
    }

    [Serializable]
    internal sealed class DiagnosticsPayload
    {
        public ConsoleCountsPayload consoleCounts;
        public bool isCompiling;
        public long captureStartedUnixMs;
        public string minimumSeverity;
        public int maxEntries;
        public string consoleEntryCoverage;
        public string compilerCoverage;
        public bool consoleEntriesTruncated;
        public bool compilerMessagesTruncated;
        public ConsoleDiagnosticPayload[] recentConsoleEntries;
        public CompilationSnapshotPayload latestCompilation;
    }

    [InitializeOnLoad]
    internal static class DiagnosticsCommand
    {
        public const int DefaultMaxEntries = 100;
        public const int MaximumMaxEntries = 200;
        public const string DefaultMinimumSeverity = "warning";

        private const int ConsoleRingCapacity = 200;
        private const int CompilerMessageCapacity = 500;
        private const int MaximumMessageCharacters = 4096;
        private const int MaximumStackCharacters = 8192;
        private const string CompilationSessionKey = "UnityAiBridge.Diagnostics.LatestCompilation.v1";

        private static readonly object Gate = new object();
        private static readonly List<ConsoleDiagnosticPayload> ConsoleEntries = new List<ConsoleDiagnosticPayload>();
        private static readonly List<CompilerDiagnosticPayload> CurrentCompilerMessages = new List<CompilerDiagnosticPayload>();
        private static readonly long CaptureStartedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        private static CompilationSnapshotPayload latestCompilation;
        private static long currentCompilationSequence;
        private static bool currentCompilerMessagesTruncated;

        static DiagnosticsCommand()
        {
            latestCompilation = LoadLatestCompilation();
            currentCompilationSequence = latestCompilation != null ? latestCompilation.sequence : 0;

            Application.logMessageReceivedThreaded += OnLogMessage;
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload += Shutdown;
        }

        public static DiagnosticsPayload Execute(int maxEntries, string minimumSeverity)
        {
            ValidateArguments(maxEntries, minimumSeverity);

            ConsoleWindowUtility.GetConsoleLogCounts(out var errorCount, out var warningCount, out var logCount);

            ConsoleDiagnosticPayload[] consoleEntries;
            CompilationSnapshotPayload compilation;
            bool consoleTruncated;

            lock (Gate)
            {
                consoleEntries = FilterRecentConsoleEntries(maxEntries, minimumSeverity, out consoleTruncated);
                compilation = CloneCompilationSnapshot(latestCompilation, maxEntries, minimumSeverity);
            }

            return new DiagnosticsPayload
            {
                consoleCounts = new ConsoleCountsPayload
                {
                    errors = errorCount,
                    warnings = warningCount,
                    logs = logCount,
                },
                isCompiling = EditorApplication.isCompiling,
                captureStartedUnixMs = CaptureStartedUnixMs,
                minimumSeverity = minimumSeverity,
                maxEntries = maxEntries,
                consoleEntryCoverage = "captured_since_current_domain_load",
                compilerCoverage = "latest_compilation_observed_by_compilation_pipeline",
                consoleEntriesTruncated = consoleTruncated,
                compilerMessagesTruncated = compilation != null && compilation.truncated,
                recentConsoleEntries = consoleEntries,
                latestCompilation = compilation ?? new CompilationSnapshotPayload
                {
                    sequence = 0,
                    completedUnixMs = 0,
                    truncated = false,
                    messages = Array.Empty<CompilerDiagnosticPayload>(),
                },
            };
        }

        public static void ValidateArguments(int maxEntries, string minimumSeverity)
        {
            if (maxEntries < 1 || maxEntries > MaximumMaxEntries)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxEntries),
                    $"maxEntries must be between 1 and {MaximumMaxEntries}.");
            }

            if (!IsValidSeverity(minimumSeverity))
            {
                throw new ArgumentException(
                    "minimumSeverity must be one of 'error', 'warning', or 'log'.",
                    nameof(minimumSeverity));
            }
        }

        private static void OnLogMessage(string message, string stackTrace, LogType type)
        {
            var entry = new ConsoleDiagnosticPayload
            {
                timestampUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                severity = ToSeverity(type),
                message = BoundText(message, MaximumMessageCharacters),
                stackTrace = BoundText(stackTrace, MaximumStackCharacters),
            };

            lock (Gate)
            {
                if (ConsoleEntries.Count >= ConsoleRingCapacity)
                {
                    ConsoleEntries.RemoveAt(0);
                }
                ConsoleEntries.Add(entry);
            }
        }

        private static void OnCompilationStarted(object context)
        {
            lock (Gate)
            {
                currentCompilationSequence = Math.Max(
                    currentCompilationSequence + 1,
                    latestCompilation != null ? latestCompilation.sequence + 1 : 1);
                CurrentCompilerMessages.Clear();
                currentCompilerMessagesTruncated = false;
            }
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] messages)
        {
            if (messages == null || messages.Length == 0)
            {
                return;
            }

            lock (Gate)
            {
                foreach (var message in messages)
                {
                    if (CurrentCompilerMessages.Count >= CompilerMessageCapacity)
                    {
                        currentCompilerMessagesTruncated = true;
                        break;
                    }

                    CurrentCompilerMessages.Add(new CompilerDiagnosticPayload
                    {
                        severity = message.type == CompilerMessageType.Error ? "error" : "warning",
                        message = BoundText(message.message, MaximumMessageCharacters),
                        file = message.file ?? string.Empty,
                        line = Math.Max(message.line, 0),
                        column = Math.Max(message.column, 0),
                        assemblyPath = assemblyPath ?? string.Empty,
                    });
                }
            }
        }

        private static void OnCompilationFinished(object context)
        {
            lock (Gate)
            {
                latestCompilation = new CompilationSnapshotPayload
                {
                    sequence = currentCompilationSequence,
                    completedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    truncated = currentCompilerMessagesTruncated,
                    messages = CurrentCompilerMessages.ToArray(),
                };

                SessionState.SetString(CompilationSessionKey, JsonUtility.ToJson(latestCompilation));
            }
        }

        private static CompilationSnapshotPayload LoadLatestCompilation()
        {
            var json = SessionState.GetString(CompilationSessionKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return new CompilationSnapshotPayload
                {
                    sequence = 0,
                    completedUnixMs = 0,
                    truncated = false,
                    messages = Array.Empty<CompilerDiagnosticPayload>(),
                };
            }

            try
            {
                var snapshot = JsonUtility.FromJson<CompilationSnapshotPayload>(json);
                if (snapshot == null)
                {
                    throw new InvalidOperationException("Compilation snapshot deserialized to null.");
                }
                snapshot.messages = snapshot.messages ?? Array.Empty<CompilerDiagnosticPayload>();
                return snapshot;
            }
            catch
            {
                return new CompilationSnapshotPayload
                {
                    sequence = 0,
                    completedUnixMs = 0,
                    truncated = false,
                    messages = Array.Empty<CompilerDiagnosticPayload>(),
                };
            }
        }

        private static ConsoleDiagnosticPayload[] FilterRecentConsoleEntries(
            int maxEntries,
            string minimumSeverity,
            out bool truncated)
        {
            var filtered = new List<ConsoleDiagnosticPayload>();
            for (var index = ConsoleEntries.Count - 1; index >= 0; index--)
            {
                var entry = ConsoleEntries[index];
                if (!MeetsMinimumSeverity(entry.severity, minimumSeverity))
                {
                    continue;
                }

                filtered.Add(entry);
                if (filtered.Count >= maxEntries)
                {
                    break;
                }
            }

            filtered.Reverse();

            var matchingCount = 0;
            foreach (var entry in ConsoleEntries)
            {
                if (MeetsMinimumSeverity(entry.severity, minimumSeverity))
                {
                    matchingCount++;
                }
            }
            truncated = matchingCount > filtered.Count;
            return filtered.ToArray();
        }

        private static CompilationSnapshotPayload CloneCompilationSnapshot(
            CompilationSnapshotPayload snapshot,
            int maxEntries,
            string minimumSeverity)
        {
            if (snapshot == null)
            {
                return null;
            }

            var filtered = new List<CompilerDiagnosticPayload>();
            var messages = snapshot.messages ?? Array.Empty<CompilerDiagnosticPayload>();
            foreach (var message in messages)
            {
                if (!MeetsMinimumSeverity(message.severity, minimumSeverity))
                {
                    continue;
                }

                if (filtered.Count >= maxEntries)
                {
                    break;
                }
                filtered.Add(message);
            }

            var matchingCount = 0;
            foreach (var message in messages)
            {
                if (MeetsMinimumSeverity(message.severity, minimumSeverity))
                {
                    matchingCount++;
                }
            }

            return new CompilationSnapshotPayload
            {
                sequence = snapshot.sequence,
                completedUnixMs = snapshot.completedUnixMs,
                truncated = snapshot.truncated || matchingCount > filtered.Count,
                messages = filtered.ToArray(),
            };
        }

        private static bool IsValidSeverity(string severity)
        {
            return string.Equals(severity, "error", StringComparison.Ordinal) ||
                   string.Equals(severity, "warning", StringComparison.Ordinal) ||
                   string.Equals(severity, "log", StringComparison.Ordinal);
        }

        private static bool MeetsMinimumSeverity(string severity, string minimumSeverity)
        {
            return SeverityRank(severity) >= SeverityRank(minimumSeverity);
        }

        private static int SeverityRank(string severity)
        {
            if (string.Equals(severity, "error", StringComparison.Ordinal))
            {
                return 3;
            }
            if (string.Equals(severity, "warning", StringComparison.Ordinal))
            {
                return 2;
            }
            return 1;
        }

        private static string ToSeverity(LogType type)
        {
            switch (type)
            {
                case LogType.Error:
                case LogType.Assert:
                case LogType.Exception:
                    return "error";
                case LogType.Warning:
                    return "warning";
                default:
                    return "log";
            }
        }

        private static string BoundText(string value, int maximumCharacters)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }
            return value.Length <= maximumCharacters
                ? value
                : value.Substring(0, maximumCharacters);
        }

        private static void Shutdown()
        {
            Application.logMessageReceivedThreaded -= OnLogMessage;
            CompilationPipeline.compilationStarted -= OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished -= OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished -= OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload -= Shutdown;
        }
    }
}
