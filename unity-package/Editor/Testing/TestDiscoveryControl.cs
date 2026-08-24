using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityAiBridge.Editor.Testing
{
    [Serializable]
    internal sealed class TestAssemblyDiscoveryPayload
    {
        public string name;
        public int testCaseCount;
        public string assemblyType;
    }

    [Serializable]
    internal sealed class TestCaseDiscoveryPayload
    {
        public string name;
        public string fullName;
        public string uniqueName;
        public string parentFullName;
        public string runState;
        public string requiresPlayMode;
        public string[] categories;
    }

    [Serializable]
    internal sealed class TestDiscoveryPayload
    {
        public string testMode;
        public string scope;
        public string assemblyName;
        public string nameContains;
        public int totalMatches;
        public int offset;
        public int maxResults;
        public int returnedCount;
        public int nextOffset;
        public bool truncated;
        public TestAssemblyDiscoveryPayload[] assemblies;
        public TestCaseDiscoveryPayload[] tests;
    }

    internal sealed class TestDiscoveryCompilingException : InvalidOperationException
    {
        public TestDiscoveryCompilingException(string message) : base(message) { }
    }

    internal sealed class TestDiscoveryPlayModeException : InvalidOperationException
    {
        public TestDiscoveryPlayModeException(string message) : base(message) { }
    }

    internal sealed class TestDiscoveryAssemblyUnavailableException : InvalidOperationException
    {
        public TestDiscoveryAssemblyUnavailableException(string message) : base(message) { }
    }

    internal static class TestDiscoveryControl
    {
        public const int MaximumAssemblyNameLength = 256;
        public const int MaximumNameContainsLength = 256;
        public const int MaximumResults = 200;

        public static Task<TestDiscoveryPayload> RetrieveAsync(
            string testMode,
            string assemblyName,
            string nameContains,
            long offset,
            long maxResults,
            long deadlineUnixMs)
        {
            var mode = ParseMode(testMode);
            var normalizedAssembly = NormalizeOptional(assemblyName, MaximumAssemblyNameLength, nameof(assemblyName));
            var normalizedContains = NormalizeOptional(nameContains, MaximumNameContainsLength, nameof(nameContains));
            var pageOffset = ValidateOffset(offset);
            var pageSize = ValidateMaxResults(maxResults);

            if (EditorApplication.isCompiling)
            {
                throw new TestDiscoveryCompilingException(
                    "Unity is compiling; Test Framework discovery was not started.");
            }

            var playMode = PlayModeCommand.CaptureSnapshot();
            if (!string.Equals(playMode.mode, "edit", StringComparison.Ordinal))
            {
                throw new TestDiscoveryPlayModeException(
                    $"Test discovery requires stable Edit Mode. Current Play Mode lifecycle state is '{playMode.mode}'.");
            }

            var completion = new TaskCompletionSource<TestDiscoveryPayload>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            var finished = false;

            try
            {
                api.RetrieveTestList(mode, root =>
                {
                    if (finished)
                    {
                        return;
                    }
                    finished = true;

                    try
                    {
                        if (deadlineUnixMs > 0 &&
                            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > deadlineUnixMs)
                        {
                            throw new TimeoutException(
                                $"Test discovery completed after its command deadline. deadlineUnixMs={deadlineUnixMs}");
                        }

                        completion.TrySetResult(BuildPayload(
                            root,
                            testMode,
                            normalizedAssembly,
                            normalizedContains,
                            pageOffset,
                            pageSize));
                    }
                    catch (Exception exception)
                    {
                        completion.TrySetException(exception);
                    }
                    finally
                    {
                        UnityEngine.Object.DestroyImmediate(api);
                    }
                });
            }
            catch (Exception exception)
            {
                finished = true;
                UnityEngine.Object.DestroyImmediate(api);
                completion.TrySetException(exception);
            }

            return completion.Task;
        }

        internal static TestDiscoveryPayload BuildPayloadForVerification(
            ITestAdaptor root,
            string testMode,
            string assemblyName,
            string nameContains,
            int offset,
            int maxResults)
        {
            return BuildPayload(root, testMode, assemblyName, nameContains, offset, maxResults);
        }

        internal static int ValidateOffsetForVerification(long value)
        {
            return ValidateOffset(value);
        }

        internal static int ValidateMaxResultsForVerification(long value)
        {
            return ValidateMaxResults(value);
        }

        private static TestDiscoveryPayload BuildPayload(
            ITestAdaptor root,
            string testMode,
            string assemblyName,
            string nameContains,
            int offset,
            int maxResults)
        {
            if (root == null)
            {
                throw new InvalidOperationException("Unity Test Framework returned a null test tree.");
            }

            var assemblyNodes = new List<ITestAdaptor>();
            CollectAssemblyNodes(root, assemblyNodes);
            var normalizedAssemblies = assemblyNodes
                .Select(node => new { Node = node, Name = NormalizeAssemblyNodeName(node.Name) })
                .Where(item => !string.IsNullOrEmpty(item.Name))
                .GroupBy(item => item.Name, StringComparer.Ordinal)
                .Select(group => group.First())
                .OrderBy(item => item.Name, StringComparer.Ordinal)
                .ToArray();

            if (string.IsNullOrEmpty(assemblyName))
            {
                var matches = normalizedAssemblies
                    .Where(item => MatchesContains(item.Name, nameContains))
                    .Select(item => new TestAssemblyDiscoveryPayload
                    {
                        name = item.Name,
                        testCaseCount = Math.Max(0, item.Node.TestCaseCount),
                        assemblyType = item.Node.AssemblyType.ToString(),
                    })
                    .ToArray();

                var page = Page(matches, offset, maxResults);
                return new TestDiscoveryPayload
                {
                    testMode = testMode,
                    scope = "assemblies",
                    assemblyName = string.Empty,
                    nameContains = nameContains ?? string.Empty,
                    totalMatches = matches.Length,
                    offset = offset,
                    maxResults = maxResults,
                    returnedCount = page.Length,
                    nextOffset = Math.Min(matches.Length, offset + page.Length),
                    truncated = offset + page.Length < matches.Length,
                    assemblies = page,
                    tests = Array.Empty<TestCaseDiscoveryPayload>(),
                };
            }

            var targetAssembly = normalizedAssemblies
                .FirstOrDefault(item => string.Equals(item.Name, assemblyName, StringComparison.Ordinal));
            if (targetAssembly == null)
            {
                throw new TestDiscoveryAssemblyUnavailableException(
                    $"Unity Test Framework did not discover assembly '{assemblyName}' in {testMode} mode.");
            }

            var leaves = new List<ITestAdaptor>();
            CollectLeafTests(targetAssembly.Node, leaves);
            var testMatches = leaves
                .Where(test => !string.IsNullOrEmpty(test.FullName))
                .Where(test => MatchesContains(test.FullName, nameContains))
                .OrderBy(test => test.FullName, StringComparer.Ordinal)
                .Select(test => new TestCaseDiscoveryPayload
                {
                    name = test.Name ?? string.Empty,
                    fullName = test.FullName ?? string.Empty,
                    uniqueName = test.UniqueName ?? string.Empty,
                    parentFullName = test.ParentFullName ?? string.Empty,
                    runState = test.RunState.ToString(),
                    requiresPlayMode = FormatRequiresPlayMode(test.RequiresPlayMode),
                    categories = (test.Categories ?? Array.Empty<string>())
                        .Where(value => !string.IsNullOrEmpty(value))
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                })
                .ToArray();

            var testPage = Page(testMatches, offset, maxResults);
            return new TestDiscoveryPayload
            {
                testMode = testMode,
                scope = "tests",
                assemblyName = assemblyName,
                nameContains = nameContains ?? string.Empty,
                totalMatches = testMatches.Length,
                offset = offset,
                maxResults = maxResults,
                returnedCount = testPage.Length,
                nextOffset = Math.Min(testMatches.Length, offset + testPage.Length),
                truncated = offset + testPage.Length < testMatches.Length,
                assemblies = Array.Empty<TestAssemblyDiscoveryPayload>(),
                tests = testPage,
            };
        }

        private static void CollectAssemblyNodes(ITestAdaptor node, List<ITestAdaptor> output)
        {
            if (node == null)
            {
                return;
            }
            if (node.IsTestAssembly)
            {
                output.Add(node);
            }
            if (!node.HasChildren)
            {
                return;
            }
            foreach (var child in node.Children)
            {
                CollectAssemblyNodes(child, output);
            }
        }

        private static void CollectLeafTests(ITestAdaptor node, List<ITestAdaptor> output)
        {
            if (node == null)
            {
                return;
            }
            if (!node.HasChildren)
            {
                if (!node.IsSuite)
                {
                    output.Add(node);
                }
                return;
            }
            foreach (var child in node.Children)
            {
                CollectLeafTests(child, output);
            }
        }

        private static T[] Page<T>(T[] values, int offset, int maxResults)
        {
            if (offset >= values.Length)
            {
                return Array.Empty<T>();
            }
            return values.Skip(offset).Take(maxResults).ToArray();
        }

        private static bool MatchesContains(string value, string contains)
        {
            return string.IsNullOrEmpty(contains) ||
                   value.IndexOf(contains, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static TestMode ParseMode(string value)
        {
            if (string.Equals(value, "edit", StringComparison.Ordinal))
            {
                return TestMode.EditMode;
            }
            if (string.Equals(value, "play", StringComparison.Ordinal))
            {
                return TestMode.PlayMode;
            }
            throw new ArgumentException("testMode must be exactly 'edit' or 'play'.", nameof(value));
        }

        private static string NormalizeOptional(string value, int maximumLength, string name)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }
            if (value.Length > maximumLength)
            {
                throw new ArgumentOutOfRangeException(
                    name,
                    $"{name} must be at most {maximumLength} characters.");
            }
            if (string.Equals(name, nameof(value), StringComparison.Ordinal))
            {
                return value;
            }
            if (string.Equals(name, "assemblyName", StringComparison.Ordinal) &&
                value.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("assemblyName must not include the .dll extension.", name);
            }
            return value;
        }

        private static int ValidateOffset(long value)
        {
            if (value < 0 || value > int.MaxValue)
            {
                throw new ArgumentOutOfRangeException(nameof(value), "offset must be between 0 and 2147483647.");
            }
            return (int)value;
        }

        private static int ValidateMaxResults(long value)
        {
            if (value < 1 || value > MaximumResults)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    $"maxResults must be between 1 and {MaximumResults}.");
            }
            return (int)value;
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

        private static string FormatRequiresPlayMode(bool? value)
        {
            if (!value.HasValue)
            {
                return "unspecified";
            }
            return value.Value ? "required" : "not_required";
        }
    }
}
