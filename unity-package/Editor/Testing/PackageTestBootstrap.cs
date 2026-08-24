using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;

namespace UnityAiBridge.Editor.Testing
{
    [InitializeOnLoad]
    internal static class PackageTestBootstrap
    {
        internal const string PackageName = "com.eunsung.unity-ai-bridge";
        internal const string TestAssemblyName = "EunSung.UnityAiBridge.Editor.Tests";

        private const string MenuPath = "Tools/Unity AI Bridge/Enable Package Tests";
        private const string ReimportSessionKey = "UnityAiBridge.PackageTests.ReimportAttempted";
        private const int StartupRetryBudget = 8;

        private static int _remainingStartupRetries = StartupRetryBudget;
        private static bool _attemptScheduled;

        static PackageTestBootstrap()
        {
            Events.registeredPackages -= OnRegisteredPackages;
            Events.registeredPackages += OnRegisteredPackages;
            ScheduleAttempt();
        }

        [MenuItem(MenuPath)]
        private static void EnablePackageTestsFromMenu()
        {
            try
            {
                var packageInfo = UnityEditor.PackageManager.PackageInfo.FindForPackageName(PackageName);
                if (packageInfo == null)
                {
                    throw new InvalidOperationException("Unity Package Manager could not resolve the Unity AI Bridge package.");
                }

                EnsurePackageTestsEnabled(packageInfo.assetPath, logSuccess: true);
            }
            catch (Exception exception)
            {
                Debug.LogError(
                    "[Unity AI Bridge] Could not enable package tests. Add '" + PackageName +
                    "' to Packages/manifest.json -> testables manually, then Reimport the package. " + exception);
            }
        }

        private static void OnRegisteredPackages(PackageRegistrationEventArgs args)
        {
            if (!ContainsPackage(args.added) && !ContainsPackage(args.changedTo))
            {
                return;
            }

            _remainingStartupRetries = StartupRetryBudget;
            ScheduleAttempt();
        }

        private static bool ContainsPackage(IEnumerable<UnityEditor.PackageManager.PackageInfo> packages)
        {
            if (packages == null)
            {
                return false;
            }

            foreach (var package in packages)
            {
                if (package != null && string.Equals(package.name, PackageName, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static void ScheduleAttempt()
        {
            if (_attemptScheduled)
            {
                return;
            }

            _attemptScheduled = true;
            EditorApplication.delayCall += RunScheduledAttempt;
        }

        private static void RunScheduledAttempt()
        {
            _attemptScheduled = false;

            try
            {
                var packageInfo = UnityEditor.PackageManager.PackageInfo.FindForPackageName(PackageName);
                if (packageInfo == null)
                {
                    if (_remainingStartupRetries-- > 0)
                    {
                        ScheduleAttempt();
                    }
                    return;
                }

                if (packageInfo.source == PackageSource.Embedded)
                {
                    return;
                }

                if (!ShouldAutoEnable(packageInfo.source))
                {
                    return;
                }

                EnsurePackageTestsEnabled(packageInfo.assetPath, logSuccess: true);
            }
            catch (Exception exception)
            {
                Debug.LogWarning(
                    "[Unity AI Bridge] Could not automatically enable package tests. " +
                    "Use Tools > Unity AI Bridge > Enable Package Tests or add '" + PackageName +
                    "' to Packages/manifest.json -> testables manually, then Reimport the package. " + exception.Message);
            }
        }

        internal static bool ShouldAutoEnable(PackageSource source)
        {
            return source == PackageSource.Local ||
                   source == PackageSource.LocalTarball ||
                   source == PackageSource.Git;
        }

        private static void EnsurePackageTestsEnabled(string packageAssetPath, bool logSuccess)
        {
            var projectRoot = Directory.GetParent(Application.dataPath);
            if (projectRoot == null)
            {
                throw new InvalidOperationException("Could not resolve the Unity project root.");
            }

            var manifestPath = Path.Combine(projectRoot.FullName, "Packages", "manifest.json");
            if (!File.Exists(manifestPath))
            {
                throw new FileNotFoundException("Project package manifest was not found.", manifestPath);
            }

            var original = File.ReadAllText(manifestPath);
            var updated = ProjectManifestTestables.EnsurePackageTestable(
                original,
                PackageName,
                out var changed);

            if (changed)
            {
                var tempPath = manifestPath + ".unity-ai-bridge.tmp";
                try
                {
                    File.WriteAllText(tempPath, updated, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                    File.Copy(tempPath, manifestPath, overwrite: true);
                }
                finally
                {
                    if (File.Exists(tempPath))
                    {
                        File.Delete(tempPath);
                    }
                }

                if (logSuccess)
                {
                    Debug.Log("[Unity AI Bridge] Added the package to Packages/manifest.json -> testables.");
                }
            }
            else if (logSuccess && IsTestAssemblyLoaded())
            {
                Debug.Log("[Unity AI Bridge] Package tests are already enabled and the EditMode test assembly is loaded.");
            }

            EnsureTestAssemblyDiscovery(packageAssetPath, logSuccess);
        }

        private static void EnsureTestAssemblyDiscovery(string packageAssetPath, bool logSuccess)
        {
            if (IsTestAssemblyLoaded())
            {
                return;
            }

            if (SessionState.GetBool(ReimportSessionKey, false))
            {
                if (logSuccess)
                {
                    Debug.LogWarning(
                        "[Unity AI Bridge] Package tests are enabled but the test assembly is still not loaded after a reimport attempt. " +
                        "If Test Runner is still empty, right-click Unity AI Bridge under Project > Packages and choose Reimport, or restart the Editor.");
                }
                return;
            }

            if (string.IsNullOrWhiteSpace(packageAssetPath) || !AssetDatabase.IsValidFolder(packageAssetPath))
            {
                throw new InvalidOperationException(
                    "Could not resolve the package AssetDatabase path required for Test Runner reimport: '" +
                    packageAssetPath + "'.");
            }

            SessionState.SetBool(ReimportSessionKey, true);

            if (logSuccess)
            {
                Debug.Log(
                    "[Unity AI Bridge] Package tests are enabled but the test assembly is not loaded yet. " +
                    "Reimporting the package once so Unity Test Framework can discover it.");
            }

            AssetDatabase.ImportAsset(
                packageAssetPath,
                ImportAssetOptions.ForceUpdate | ImportAssetOptions.ImportRecursive);
        }

        private static bool IsTestAssemblyLoaded()
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (string.Equals(
                        assembly.GetName().Name,
                        TestAssemblyName,
                        StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
