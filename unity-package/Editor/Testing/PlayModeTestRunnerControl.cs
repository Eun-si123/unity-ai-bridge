using System;
using System.Collections.Generic;
using System.Linq;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityAiBridge.Editor.Testing
{
    internal static class PlayModeTestRunnerControl
    {
        private const string TestModePlay = "play";
        private const string ScheduledStatus = "scheduled";
        private const string ErrorStatus = "error";
        private const string JournalPrefix = "UnityAiBridge.TestRun.v1.";
        private const string ActiveMutationKey = "UnityAiBridge.TestRun.Active.v1";

        public static TestRunPayload StartPlayMode(
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
                        "mutationId was already used for a different PlayMode test-run intent.");
                }

                return ToPayload(existing, true);
            }

            if (EditorApplication.isCompiling)
            {
                throw new TestRunCompilingException(
                    "Unity is compiling; a new PlayMode test run was not started.");
            }

            var playMode = PlayModeCommand.CaptureSnapshot();
            if (!string.Equals(playMode.mode, "edit", StringComparison.Ordinal))
            {
                throw new TestRunPlayModeException(
                    $"PlayMode tests must be scheduled from stable Edit Mode so Unity Test Framework owns the lifecycle transition. Current Play Mode lifecycle state is '{playMode.mode}'.");
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
                testMode = TestModePlay,
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
                    testMode = TestMode.PlayMode,
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
                        "Unity Test Framework did not return a run GUID for the scheduled PlayMode test run.");
                }

                WriteJournal(journal);
                return ToPayload(journal, false);
            }
            catch (Exception exception)
            {
                journal.status = ErrorStatus;
                journal.finishedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                journal.errorMessage = Truncate(exception.Message, TestRunnerControl.MaximumDetailTextLength);
                WriteJournal(journal);
                ClearActiveIfOwned(journal.mutationId);
                throw;
            }
        }

        internal static string BuildIntentFingerprintForVerification(
            string assemblyName,
            string[] testNames)
        {
            var names = NormalizeAndValidate(
                assemblyName,
                testNames,
                "playmode-test-run-verification-fingerprint");
            return BuildIntentFingerprint(assemblyName, names);
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
            if (testNames.Length > TestRunnerControl.MaximumTestNames)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(testNames),
                    $"At most {TestRunnerControl.MaximumTestNames} exact test names may be selected in one run.");
            }

            var normalized = new SortedSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < testNames.Length; i++)
            {
                var value = testNames[i];
                if (string.IsNullOrWhiteSpace(value))
                {
                    throw new ArgumentException("testNames may not contain empty values.", nameof(testNames));
                }
                if (value.Length > TestRunnerControl.MaximumTestNameLength)
                {
                    throw new ArgumentOutOfRangeException(
                        nameof(testNames),
                        $"Each test name must be at most {TestRunnerControl.MaximumTestNameLength} characters.");
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
            if (assemblyName.Length > TestRunnerControl.MaximumAssemblyNameLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(assemblyName),
                    $"assemblyName must be at most {TestRunnerControl.MaximumAssemblyNameLength} characters.");
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
            if (mutationId.Length > TestRunnerControl.MaximumMutationIdLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(mutationId),
                    $"mutationId must be at most {TestRunnerControl.MaximumMutationIdLength} characters.");
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
            return TestModePlay + "\n" + assemblyName + "\n" + string.Join("\n", normalizedTestNames);
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

        private static bool IsTerminal(string status)
        {
            return string.Equals(status, "completed", StringComparison.Ordinal) ||
                   string.Equals(status, ErrorStatus, StringComparison.Ordinal);
        }

        private static TestRunPayload ToPayload(TestRunJournal journal, bool replayed)
        {
            return new TestRunPayload
            {
                mutationId = journal.mutationId,
                replayed = replayed,
                runGuid = journal.runGuid ?? string.Empty,
                status = journal.status ?? string.Empty,
                testMode = journal.testMode ?? TestModePlay,
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
    }
}
