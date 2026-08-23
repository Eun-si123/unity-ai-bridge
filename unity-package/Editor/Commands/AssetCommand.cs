using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class AssetSummaryPayload
    {
        public string guid;
        public string path;
        public string name;
        public string extension;
        public string mainTypeName;
        public bool isFolder;
    }

    [Serializable]
    internal sealed class AssetSearchPayload
    {
        public string filter;
        public string[] searchInFolders;
        public int maxResults;
        public int totalMatches;
        public int returnedCount;
        public bool truncated;
        public AssetSummaryPayload[] assets;
    }

    [Serializable]
    internal sealed class AssetDependencyPayload
    {
        public string guid;
        public string path;
        public string mainTypeName;
    }

    [Serializable]
    internal sealed class AssetInspectPayload
    {
        public string guid;
        public string path;
        public string name;
        public string extension;
        public string mainTypeName;
        public int mainAssetInstanceId;
        public string mainAssetName;
        public string importerTypeName;
        public string dependencyHash;
        public string[] labels;
        public int directDependencyCount;
        public int returnedDependencyCount;
        public bool dependenciesTruncated;
        public AssetDependencyPayload[] directDependencies;
    }

    internal sealed class AssetUnavailableException : InvalidOperationException
    {
        public AssetUnavailableException(string message) : base(message) { }
    }

    internal static class AssetSearchCommand
    {
        public const int DefaultMaxResults = 50;
        public const int MaximumMaxResults = 200;
        public const int MaximumFilterLength = 256;
        public const int MaximumFolderCount = 16;
        public const int MaximumAssetPathLength = 512;

        public static void ValidateArguments(
            string filter,
            string[] searchInFolders,
            int maxResults)
        {
            if (filter == null)
            {
                throw new ArgumentNullException(nameof(filter));
            }
            if (filter.Length > MaximumFilterLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(filter),
                    $"filter must be at most {MaximumFilterLength} characters.");
            }
            if (searchInFolders == null || searchInFolders.Length == 0)
            {
                throw new ArgumentException(
                    "searchInFolders must contain at least one Unity project folder.",
                    nameof(searchInFolders));
            }
            if (searchInFolders.Length > MaximumFolderCount)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(searchInFolders),
                    $"searchInFolders may contain at most {MaximumFolderCount} folders.");
            }
            if (maxResults < 1 || maxResults > MaximumMaxResults)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxResults),
                    $"maxResults must be between 1 and {MaximumMaxResults}.");
            }

            for (var index = 0; index < searchInFolders.Length; index++)
            {
                ValidateProjectPath(searchInFolders[index], $"searchInFolders[{index}]");
                if (!AssetDatabase.IsValidFolder(searchInFolders[index]))
                {
                    throw new ArgumentException(
                        $"searchInFolders[{index}] is not a valid Unity AssetDatabase folder: '{searchInFolders[index]}'.",
                        nameof(searchInFolders));
                }
            }
        }

        public static AssetSearchPayload Execute(
            string filter,
            string[] searchInFolders,
            int maxResults)
        {
            ValidateArguments(filter, searchInFolders, maxResults);

            var guids = AssetDatabase.FindAssets(filter, searchInFolders);
            var summaries = new List<AssetSummaryPayload>(guids.Length);
            for (var index = 0; index < guids.Length; index++)
            {
                var path = AssetDatabase.GUIDToAssetPath(guids[index]);
                if (string.IsNullOrEmpty(path))
                {
                    continue;
                }
                summaries.Add(CaptureSummary(guids[index], path));
            }

            summaries.Sort((left, right) =>
                string.Compare(left.path, right.path, StringComparison.Ordinal));

            var returnedCount = Math.Min(maxResults, summaries.Count);
            var returned = new AssetSummaryPayload[returnedCount];
            for (var index = 0; index < returnedCount; index++)
            {
                returned[index] = summaries[index];
            }

            return new AssetSearchPayload
            {
                filter = filter,
                searchInFolders = (string[])searchInFolders.Clone(),
                maxResults = maxResults,
                totalMatches = summaries.Count,
                returnedCount = returnedCount,
                truncated = summaries.Count > returnedCount,
                assets = returned,
            };
        }

        internal static AssetSummaryPayload CaptureSummary(string guid, string path)
        {
            var type = AssetDatabase.GetMainAssetTypeAtPath(path);
            return new AssetSummaryPayload
            {
                guid = guid ?? string.Empty,
                path = path ?? string.Empty,
                name = Path.GetFileNameWithoutExtension(path) ?? string.Empty,
                extension = Path.GetExtension(path) ?? string.Empty,
                mainTypeName = type != null ? type.FullName ?? type.Name : string.Empty,
                isFolder = AssetDatabase.IsValidFolder(path),
            };
        }

        internal static void ValidateProjectPath(string path, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Unity asset path is required.", parameterName);
            }
            if (path.Length > MaximumAssetPathLength)
            {
                throw new ArgumentOutOfRangeException(
                    parameterName,
                    $"Unity asset path must be at most {MaximumAssetPathLength} characters.");
            }
            if (path.IndexOf('\\') >= 0)
            {
                throw new ArgumentException(
                    "Unity asset paths must use forward slashes.",
                    parameterName);
            }
            if (Path.IsPathRooted(path) || path.Contains("../") || path.EndsWith("/..", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Unity asset paths must be project-relative and may not contain parent traversal.",
                    parameterName);
            }
            if (!string.Equals(path, "Assets", StringComparison.Ordinal) &&
                !path.StartsWith("Assets/", StringComparison.Ordinal) &&
                !string.Equals(path, "Packages", StringComparison.Ordinal) &&
                !path.StartsWith("Packages/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Unity asset paths must be under Assets or Packages.",
                    parameterName);
            }
        }
    }

    internal static class AssetInspectCommand
    {
        public const int DefaultMaxDependencies = 64;
        public const int MaximumMaxDependencies = 256;

        public static void ValidateArguments(string path, int maxDependencies)
        {
            AssetSearchCommand.ValidateProjectPath(path, nameof(path));
            if (maxDependencies < 0 || maxDependencies > MaximumMaxDependencies)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxDependencies),
                    $"maxDependencies must be between 0 and {MaximumMaxDependencies}.");
            }
        }

        public static AssetInspectPayload Execute(string path, int maxDependencies)
        {
            ValidateArguments(path, maxDependencies);

            if (AssetDatabase.IsValidFolder(path))
            {
                throw new AssetUnavailableException(
                    "asset.inspect requires an asset file path, not a folder path.");
            }

            var guid = AssetDatabase.AssetPathToGUID(path);
            var mainAsset = AssetDatabase.LoadMainAssetAtPath(path);
            if (string.IsNullOrEmpty(guid) || mainAsset == null)
            {
                throw new AssetUnavailableException(
                    $"No Unity main asset is available at '{path}'.");
            }

            var mainType = AssetDatabase.GetMainAssetTypeAtPath(path);
            var importer = AssetImporter.GetAtPath(path);
            var labels = AssetDatabase.GetLabels(mainAsset) ?? Array.Empty<string>();
            Array.Sort(labels, StringComparer.Ordinal);

            var dependencyPaths = AssetDatabase.GetDependencies(path, false) ?? Array.Empty<string>();
            Array.Sort(dependencyPaths, StringComparer.Ordinal);
            var returnedDependencyCount = Math.Min(maxDependencies, dependencyPaths.Length);
            var dependencies = new AssetDependencyPayload[returnedDependencyCount];
            for (var index = 0; index < returnedDependencyCount; index++)
            {
                var dependencyPath = dependencyPaths[index];
                var dependencyType = AssetDatabase.GetMainAssetTypeAtPath(dependencyPath);
                dependencies[index] = new AssetDependencyPayload
                {
                    guid = AssetDatabase.AssetPathToGUID(dependencyPath) ?? string.Empty,
                    path = dependencyPath ?? string.Empty,
                    mainTypeName = dependencyType != null
                        ? dependencyType.FullName ?? dependencyType.Name
                        : string.Empty,
                };
            }

            return new AssetInspectPayload
            {
                guid = guid,
                path = path,
                name = Path.GetFileNameWithoutExtension(path) ?? string.Empty,
                extension = Path.GetExtension(path) ?? string.Empty,
                mainTypeName = mainType != null ? mainType.FullName ?? mainType.Name : string.Empty,
                mainAssetInstanceId = mainAsset.GetInstanceID(),
                mainAssetName = mainAsset.name ?? string.Empty,
                importerTypeName = importer != null
                    ? importer.GetType().FullName ?? importer.GetType().Name
                    : string.Empty,
                dependencyHash = AssetDatabase.GetAssetDependencyHash(path).ToString(),
                labels = labels,
                directDependencyCount = dependencyPaths.Length,
                returnedDependencyCount = returnedDependencyCount,
                dependenciesTruncated = dependencyPaths.Length > returnedDependencyCount,
                directDependencies = dependencies,
            };
        }
    }
}
