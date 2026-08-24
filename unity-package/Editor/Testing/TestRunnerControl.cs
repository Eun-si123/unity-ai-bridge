using System;
using System.Collections.Generic;
using System.Linq;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityAiBridge.Editor.Testing
{
    [Serializable]
    internal sealed class TestRunIssuePayload
    {
        public string fullName;
        public string resultState;
        public double durationSeconds;
        public string message;
        public string stackTrace;
        public string output;
    }

    [Serializable]
    internal sealed class TestRunPayload
    {
        public string mutationId;
        public bool replayed;
        public string runGuid;
        public string status;
        public string testMode;
        public string assemblyName;
        public string[] testNames;
        public long requestedUnixMs;
        public long startedUnixMs;
        public long finishedUnixMs;
        public int selectedTestCaseCount;
        public string resultState;
        public double durationSeconds;
        public int passCount;
        public int failCount;
        public int skipCount;
        public int inconclusiveCount;
        public int assertCount;
        public TestRunIssuePayload[] issues;
        public bool issuesTruncated;
        public string errorMessage;
    }

    [Serializable]
    internal sealed class TestRunJournal
    {
        public string mutationId;
        public string intentFingerprint;
        public string runGuid;
        public string status;
        public string testMode;
        public string assemblyName;
        public string[] testNames;
        public long requestedUnixMs;
        public long startedUnixMs;
        public long finishedUnixMs;
        public int selectedTestCaseCount;
        public string resultState;
        public double durationSeconds;
        public int passCount;
        public int failCount;
        public int skipCount;
        public int inconclusiveCount;
        public int assertCount;
        public TestRunIssuePayload[] issues;
        public bool issuesTruncated;
        public string errorMessage;
    }

    internal sealed class TestRunCompilingException : InvalidOperationException
    {
        public TestRunCompilingException(string message) : base(message) { }
    }

    internal sealed class TestRunPlayModeException : InvalidOperationException
    {
        public TestRunPlayModeException(string message) : base(message) { }
    }

    internal sealed class TestRunInProgressException : InvalidOperationException
    {
        public TestRunInProgressException(string message) : base(message) { }
    }

    internal sealed class TestRunMutationConflictException : InvalidOperationException
    {
        public TestRunMutationConflictException(string message) : base(message) { }
    }

    internal sealed class TestRunUnavailableException : InvalidOperationException
    {
        public TestRunUnavailableException(string message) : base(message) { }
    }

    [InitializeOnLoad]
    internal static class TestRunnerControl
    {
        public const int MaximumMutationIdLength = 128;
        public const int MaximumAssemblyNameLength = 256;
        public const int MaximumTestNameLength = 512;
        public const int MaximumTestNames = 64;
        public const int MaximumIssueDetails = 100;
        public const int MaximumDetailTextLength = 8_000;

        private const string ScheduledStatus = "scheduled";
        private const string RunningStatus = "running";
        private const string CompletedStatus = "completed";
        private const string ErrorStatus = "error";
        private const string TestModeEdit = "edit";
        private const string JournalPrefix = "UnityAiBridge.TestRun.v1.";
        private const string ActiveMutationKey = "UnityAiBridge.TestRun.Active.v1";

        private static readonly CallbackListener Listener = new CallbackListener();

        static TestRunnerControl()
        {
            // Test Framework callbacks are not preserved by domain reload. Register once for
            // every loaded script domain and keep durable run state in SessionState instead.
            TestRunnerApi.RegisterTestCallback(Listener, 100);
        }

        public static TestRunPayload StartEditMode(
            string assemblyName,
            string[] testNames,
            string mutationId)
        {
            var normalizedNames = NormalizeAndValidate(assemblyName, testNames, mutationId);
            var fingerprint = BuildIntentFingerprint(assemblyName, normalizedNames);
            var existing = ReadJournal(mutationId);
            if (existing != null)
            {
                if (!string.Equals(existing.intentFingerprint, fingerprint, StringComparison.Ordinal))
                {
                    throw new TestRunMutationConflictException(
                        "mutationId was already used for a different EditMode test-run intent.");
                }

                return ToPayload(existing, true);
            }

            if (EditorApplication.isCompiling)
            {
                throw new TestRunCompilingException(
                    "Unity is compiling; a new EditMode test run was not started.");
            }

            var playMode = PlayModeCommand.CaptureSnapshot();
            if (!string.Equals(playMode.mode, "edit", StringComparison.Ordinal))
            {
                throw new TestRunPlayModeException(
                    $"EditMode tests require stable Edit Mode. Current Play Mode lifecycle state is '{playMode.mode}'.");
            }

            var activeMutationId = SessionState.GetString(ActiveMutationKey, string.Empty);
            if (!string.IsNullOrEmpty(activeMutationId))
            {
                var active = ReadJournal(activeMutationId);
                if (active != null && !IsTerminal(active.status))
                {
                    throw new TestRunInProgressException(
                        $"Unity AI Bridge already owns an unfinished test run. mutationId={activeMutationId}, status={active.status}, runGuid={active.runGuid}");
                }
                SessionState.EraseString(ActiveMutationKey);
            }

            var journal = new TestRunJournal
            {
                mutationId = mutationId,
                intentFingerprint = fingerprint,
                runGuid = string.Empty,
                status = ScheduledStatus,
                testMode = TestModeEdit,
                assemblyName = assemblyName,
                testNames = normalizedNames,
                requestedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                startedUnixMs = 0,
                finishedUnixMs = 0,
                selectedTestCaseCount = 0,
                resultState = string.Empty,
                durationSeconds = 0,
                passCount = 0,
                failCount = 0,
                skipCount = 0,
                inconclusiveCount = 0,
                assertCount = 0,
                issues = Array.Empty<TestRunIssuePayload>(),
                issuesTruncated = false,
                errorMessage = string.Empty,
            };

            WriteJournal(journal);
            SessionState.SetString(ActiveMutationKey, mutationId);

            try
            {
                var filter = new Filter
                {
                    testMode = TestMode.EditMode,
                    assemblyNames = new[] { assemblyName },
                    testNames = normalizedNames.Length > 0 ? normalizedNames : null,
                };
                var settings = new ExecutionSettings(filter)
                {
                    runSynchronously = false,
                };

                var api = ScriptableObject.CreateInstance<TestRunnerApi>();
                try
                {
                    journal.runGuid = api.Execute(settings) ?? string.Empty;
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(api);
                }

                if (string.IsNullOrWhiteSpace(journal.runGuid))
                {
                    throw new InvalidOperationException(
                        "Unity Test Framework did not return a run GUID for the scheduled EditMode test run.");
                }

                WriteJournal(journal);
                return ToPayload(journal, false);
            }
            catch (Exception exception)
            {
                journal.status = ErrorStatus;
                journal.finishedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                journal.errorMessage = Truncate(exception.Message, MaximumDetailTextLength);
                WriteJournal(journal);
                ClearActiveIfOwned(journal.mutationId);
                throw;
            }
        }

        public static TestRunPayload Get(string mutationId)
        {
            ValidateMutationId(mutationId);
            var journal = ReadJournal(mutationId);
            if (journal == null)
            {
                throw new TestRunUnavailableException(
                    $"No Unity AI Bridge test-run journal exists for mutationId={mutationId} in this Editor session.");
            }
            return ToPayload(journal, false);
        }

        internal static string BuildIntentFingerprintForVerification(
            string assemblyName,
            string[] testNames)
        {
            var names = NormalizeAndValidate(
                assemblyName,
                testNames,
                "test-run-verification-fingerprint");
            return BuildIntentFingerprint(assemblyName, names);
        }

        internal static int CountCompletedTestCasesForVerification(
            int passCount,
            int failCount,
            int skipCount,
            int inconclusiveCount)
        {
            return CountCompletedTestCases(passCount, failCount, skipCount, inconclusiveCount);
        }

        internal static void ClearForVerification(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                return;
            }
            SessionState.EraseString(JournalPrefix + mutationId);
            if (string.Equals(
                SessionState.GetString(ActiveMutationKey, string.Empty),
                mutationId,
                StringComparison.Ordinal))
            {
                SessionState.EraseString(ActiveMutationKey);
            }
        }

        private static string[] NormalizeAndValidate(
            string assemblyName,
            string[] testNames,
            string mutationId)
        {
            ValidateAssemblyName(assemblyName);
            ValidateMutationId(mutationId);

            if (testNames == null || testNames.Length == 0)
            {
                return Array.Empty<string>();
            }
            if (testNames.Length > MaximumTestNames)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(testNames),
                    $"At most {MaximumTestNames} exact test names may be selected in one run.");
            }

            var normalized = new SortedSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < testNames.Length; i++)
            {
                var value = testNames[i];
                if (string.IsNullOrWhiteSpace(value))
                {
                    throw new ArgumentException("testNames may not contain empty values.", nameof(testNames));
                }
                if (value.Length > MaximumTestNameLength)
                {
                    throw new ArgumentOutOfRangeException(
                        nameof(testNames),
                        $"Each test name must be at most {MaximumTestNameLength} characters.");
                }
                normalized.Add(value);
            }

            return normalized.ToArray();
        }

        private static void ValidateAssemblyName(string assemblyName)
        {
            if (string.IsNullOrWhiteSpace(assemblyName))
            {
                throw new ArgumentException("assemblyName is required.", nameof(assemblyName));
            }
            if (assemblyName.Length > MaximumAssemblyNameLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(assemblyName),
                    $"assemblyName must be at most {MaximumAssemblyNameLength} characters.");
            }
            if (assemblyName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    "assemblyName must be the Unity test assembly name without the .dll extension.",
                    nameof(assemblyName));
            }
        }

        private static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required.", nameof(mutationId));
            }
            if (mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(mutationId),
                    $"mutationId must be at most {MaximumMutationIdLength} characters.");
            }
            for (var i = 0; i < mutationId.Length; i++)
            {
                var c = mutationId[i];
                if (!(char.IsLetterOrDigit(c) || c == '-' || c == '_' || c == '.' || c == ':'))
                {
                    throw new ArgumentException(
                        "mutationId may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(mutationId));
                }
            }
        }

        private static string BuildIntentFingerprint(string assemblyName, string[] normalizedTestNames)
        {
            return TestModeEdit + "\n" + assemblyName + "\n" + string.Join("\n", normalizedTestNames);
        }

        private static void OnRunStarted(ITestAdaptor testsToRun)
        {
            var journal = ReadActiveJournal();
            if (journal == null || IsTerminal(journal.status) || !MatchesIntent(testsToRun, journal))
            {
                return;
            }

            journal.status = RunningStatus;
            if (journal.startedUnixMs <= 0)
            {
                journal.startedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            }

            // ICallbacks.RunStarted receives the full loaded test tree, not the filtered
            // selection. Do not report testsToRun.TestCaseCount as selectedTestCaseCount.
            // The actual completed selection count is derived from terminal result totals.
            journal.selectedTestCaseCount = 0;
            WriteJournal(journal);
        }

        private static void OnRunFinished(ITestResultAdaptor result)
        {
            var journal = ReadActiveJournal();
            if (journal == null || IsTerminal(journal.status) || !MatchesIntent(result.Test, journal))
            {
                return;
            }

            var issues = new List<TestRunIssuePayload>();
            var totalIssues = 0;
            CollectIssues(result, issues, ref totalIssues);

            journal.status = CompletedStatus;
            if (journal.startedUnixMs <= 0)
            {
                journal.startedUnixMs = journal.requestedUnixMs;
            }
            journal.finishedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            journal.passCount = Math.Max(0, result.PassCount);
            journal.failCount = Math.Max(0, result.FailCount);
            journal.skipCount = Math.Max(0, result.SkipCount);
            journal.inconclusiveCount = Math.Max(0, result.InconclusiveCount);
            journal.selectedTestCaseCount = CountCompletedTestCases(
                journal.passCount,
                journal.failCount,
                journal.skipCount,
                journal.inconclusiveCount);
            journal.resultState = result.ResultState ?? string.Empty;
            journal.durationSeconds = Math.Max(0, result.Duration);
            journal.assertCount = Math.Max(0, result.AssertCount);
            journal.issues = issues.ToArray();
            journal.issuesTruncated = totalIssues > issues.Count;
            journal.errorMessage = string.Empty;
            WriteJournal(journal);
            ClearActiveIfOwned(journal.mutationId);
        }

        private static int CountCompletedTestCases(
            int passCount,
            int failCount,
            int skipCount,
            int inconclusiveCount)
        {
            var total = (long)Math.Max(0, passCount) +
                        Math.Max(0, failCount) +
                        Math.Max(0, skipCount) +
                        Math.Max(0, inconclusiveCount);
            return total > int.MaxValue ? int.MaxValue : (int)total;
        }

        private static void OnRunError(string message)
        {
            var journal = ReadActiveJournal();
            if (journal == null || IsTerminal(journal.status))
            {
                return;
            }

            journal.status = ErrorStatus;
            journal.finishedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            journal.errorMessage = Truncate(message, MaximumDetailTextLength);
            WriteJournal(journal);
            ClearActiveIfOwned(journal.mutationId);
        }

        private static void CollectIssues(
            ITestResultAdaptor result,
            List<TestRunIssuePayload> issues,
            ref int totalIssues)
        {
            if (result == null)
            {
                return;
            }

            if (!result.HasChildren)
            {
                if (!string.Equals(result.ResultState, "Passed", StringComparison.Ordinal))
                {
                    totalIssues++;
                    if (issues.Count < MaximumIssueDetails)
                    {
                        issues.Add(new TestRunIssuePayload
                        {
                            fullName = result.FullName ?? result.Name ?? string.Empty,
                            resultState = result.ResultState ?? string.Empty,
                            durationSeconds = Math.Max(0, result.Duration),
                            message = Truncate(result.Message, MaximumDetailTextLength),
                            stackTrace = Truncate(result.StackTrace, MaximumDetailTextLength),
                            output = Truncate(result.Output, MaximumDetailTextLength),
                        });
                    }
                }
                return;
            }

            foreach (var child in result.Children)
            {
                CollectIssues(child, issues, ref totalIssues);
            }
        }

        private static bool MatchesIntent(ITestAdaptor root, TestRunJournal journal)
        {
            if (root == null)
            {
                return false;
            }

            var assemblies = new HashSet<string>(StringComparer.Ordinal);
            var leafNames = new HashSet<string>(StringComparer.Ordinal);
            CollectTreeIdentity(root, assemblies, leafNames);
            if (!assemblies.Contains(journal.assemblyName))
            {
                return false;
            }

            if (journal.testNames == null || journal.testNames.Length == 0)
            {
                return true;
            }

            for (var i = 0; i < journal.testNames.Length; i++)
            {
                if (!leafNames.Contains(journal.testNames[i]))
                {
                    return false;
                }
            }
            return true;
        }

        private static void CollectTreeIdentity(
            ITestAdaptor test,
            HashSet<string> assemblies,
            HashSet<string> leafNames)
        {
            if (test.IsTestAssembly)
            {
                assemblies.Add(NormalizeAssemblyNodeName(test.Name));
                assemblies.Add(NormalizeAssemblyNodeName(test.FullName));
            }

            if (!test.HasChildren)
            {
                if (!string.IsNullOrEmpty(test.FullName))
                {
                    leafNames.Add(test.FullName);
                }
                return;
            }

            foreach (var child in test.Children)
            {
                CollectTreeIdentity(child, assemblies, leafNames);
            }
        }

        private static string NormalizeAssemblyNodeName(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }
            return value.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                ? value.Substring(0, value.Length - 4)
                : value;
        }

        private static bool IsTerminal(string status)
        {
            return string.Equals(status, CompletedStatus, StringComparison.Ordinal) ||
                   string.Equals(status, ErrorStatus, StringComparison.Ordinal);
        }

        private static TestRunJournal ReadActiveJournal()
        {
            var mutationId = SessionState.GetString(ActiveMutationKey, string.Empty);
            return string.IsNullOrEmpty(mutationId) ? null : ReadJournal(mutationId);
        }

        private static TestRunJournal ReadJournal(string mutationId)
        {
            var json = SessionState.GetString(JournalPrefix + mutationId, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            try
            {
                return JsonUtility.FromJson<TestRunJournal>(json);
            }
            catch (Exception exception)
            {
                throw new TestRunUnavailableException(
                    $"Could not read the existing test-run journal: {exception.Message}");
            }
        }

        private static void WriteJournal(TestRunJournal journal)
        {
            SessionState.SetString(JournalPrefix + journal.mutationId, JsonUtility.ToJson(journal));
        }

        private static void ClearActiveIfOwned(string mutationId)
        {
            if (string.Equals(
                SessionState.GetString(ActiveMutationKey, string.Empty),
                mutationId,
                StringComparison.Ordinal))
            {
                SessionState.EraseString(ActiveMutationKey);
            }
        }

        private static TestRunPayload ToPayload(TestRunJournal journal, bool replayed)
        {
            return new TestRunPayload
            {
                mutationId = journal.mutationId,
                replayed = replayed,
                runGuid = journal.runGuid ?? string.Empty,
                status = journal.status ?? string.Empty,
                testMode = journal.testMode ?? TestModeEdit,
                assemblyName = journal.assemblyName ?? string.Empty,
                testNames = journal.testNames ?? Array.Empty<string>(),
                requestedUnixMs = journal.requestedUnixMs,
                startedUnixMs = journal.startedUnixMs,
                finishedUnixMs = journal.finishedUnixMs,
                selectedTestCaseCount = journal.selectedTestCaseCount,
                resultState = journal.resultState ?? string.Empty,
                durationSeconds = journal.durationSeconds,
                passCount = journal.passCount,
                failCount = journal.failCount,
                skipCount = journal.skipCount,
                inconclusiveCount = journal.inconclusiveCount,
                assertCount = journal.assertCount,
                issues = journal.issues ?? Array.Empty<TestRunIssuePayload>(),
                issuesTruncated = journal.issuesTruncated,
                errorMessage = journal.errorMessage ?? string.Empty,
            };
        }

        private static string Truncate(string value, int maximumLength)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }
            return value.Length <= maximumLength ? value : value.Substring(0, maximumLength);
        }

        private sealed class CallbackListener : IErrorCallbacks
        {
            public void RunStarted(ITestAdaptor testsToRun)
            {
                OnRunStarted(testsToRun);
            }

            public void RunFinished(ITestResultAdaptor result)
            {
                OnRunFinished(result);
            }

            public void TestStarted(ITestAdaptor test)
            {
            }

            public void TestFinished(ITestResultAdaptor result)
            {
            }

            public void OnError(string message)
            {
                OnRunError(message);
            }
        }
    }
}
