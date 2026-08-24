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
        private const string MenuPath = "Tools/Unity AI Bridge/Enable Package Tests";
        private const int StartupRetryBudget = 8;

        private static int _remainingStartupRetries = StartupRetryBudget;
        private static bool _attemptScheduled;

        static PackageTestBootstrap()
        {
            // Unity raises this after package registration has been applied and after the
            // package-triggered compile/domain reload. Register from InitializeOnLoad so
            // first-install registration cannot race a one-shot delayCall.
            Events.registeredPackages -= OnRegisteredPackages;
            Events.registeredPackages += OnRegisteredPackages;

            // Also cover an already-installed Local/Git package after a git pull or Editor restart.
            ScheduleAttempt();
        }

        [MenuItem(MenuPath)]
        private static void EnablePackageTestsFromMenu()
        {
            try
            {
                EnsurePackageTestsEnabled(logSuccess: true);
            }
            catch (Exception exception)
            {
                Debug.LogError(
                    "[Unity AI Bridge] Could not enable package tests. Add '" + PackageName +
                    "' to Packages/manifest.json -> testables manually. " + exception);
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

        private static bool ContainsPackage(IEnumerable<PackageInfo> packages)
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
                var packageInfo = PackageInfo.FindForPackageName(PackageName);
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
                    // Unity treats embedded packages as development packages and exposes
                    // their tests without a project-manifest testables entry.
                    return;
                }

                if (!ShouldAutoEnable(packageInfo.source))
                {
                    return;
                }

                EnsurePackageTestsEnabled(logSuccess: true);
            }
            catch (Exception exception)
            {
                Debug.LogWarning(
                    "[Unity AI Bridge] Could not automatically enable package tests. " +
                    "Use Tools > Unity AI Bridge > Enable Package Tests or add '" + PackageName +
                    "' to Packages/manifest.json -> testables manually. " + exception.Message);
            }
        }

        internal static bool ShouldAutoEnable(PackageSource source)
        {
            return source == PackageSource.Local ||
                   source == PackageSource.LocalTarball ||
                   source == PackageSource.Git;
        }

        private static void EnsurePackageTestsEnabled(bool logSuccess)
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

            if (!changed)
            {
                if (logSuccess)
                {
                    Debug.Log("[Unity AI Bridge] Package tests are already enabled for this project.");
                }
                return;
            }

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

            // Do not call Client.Resolve() here. This code often runs immediately after a package
            // registration operation, and starting another Package Manager client operation can race
            // the operation that just installed/updated the package. Unity observes project-manifest
            // changes and runs its normal package registration/refresh cycle.
            if (logSuccess)
            {
                Debug.Log(
                    "[Unity AI Bridge] Added the package to Packages/manifest.json -> testables. " +
                    "Let Unity finish the package refresh/recompile; EditMode tests should then appear in Test Runner.");
            }
        }
    }
}
