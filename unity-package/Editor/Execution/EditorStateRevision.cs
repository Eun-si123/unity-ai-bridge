using System;
using UnityEditor;

namespace UnityAiBridge.Editor.Execution
{
    [Serializable]
    internal sealed class EditorStateRevisionSnapshot
    {
        public string epoch;
        public long revision;
    }

    internal sealed class EditorStateStaleException : InvalidOperationException
    {
        public EditorStateStaleException(
            string message,
            EditorStateRevisionSnapshot current)
            : base(message)
        {
            Current = current;
        }

        public EditorStateRevisionSnapshot Current { get; }
    }

    [InitializeOnLoad]
    internal static class EditorStateRevision
    {
        private const string EpochKey = "UnityAiBridge.State.Epoch.v1";
        private const string RevisionKey = "UnityAiBridge.State.Revision.v1";

        private static string epoch;
        private static long revision;

        static EditorStateRevision()
        {
            epoch = SessionState.GetString(EpochKey, string.Empty);
            if (string.IsNullOrEmpty(epoch))
            {
                epoch = Guid.NewGuid().ToString("N");
                SessionState.SetString(EpochKey, epoch);
            }

            var revisionText = SessionState.GetString(RevisionKey, string.Empty);
            if (!long.TryParse(revisionText, out revision) || revision < 1)
            {
                revision = 1;
                PersistRevision();
            }

            EditorApplication.hierarchyChanged += OnHierarchyChanged;
            Undo.undoRedoPerformed += OnUndoRedoPerformed;
            Undo.postprocessModifications += OnPostprocessModifications;
        }

        public static EditorStateRevisionSnapshot Capture()
        {
            return new EditorStateRevisionSnapshot
            {
                epoch = epoch,
                revision = revision,
            };
        }

        public static void ValidateExpectation(string expectedEpoch, long expectedRevision)
        {
            var hasEpoch = !string.IsNullOrWhiteSpace(expectedEpoch);
            var hasRevision = expectedRevision > 0;
            if (hasEpoch != hasRevision)
            {
                throw new ArgumentException(
                    "expectedStateEpoch and expectedStateRevision must be supplied together.");
            }

            if (!hasEpoch)
            {
                return;
            }

            if (expectedEpoch.Length > 128)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(expectedEpoch),
                    "expectedStateEpoch must be at most 128 characters.");
            }
        }

        public static void RequireCurrent(string expectedEpoch, long expectedRevision)
        {
            ValidateExpectation(expectedEpoch, expectedRevision);
            if (string.IsNullOrEmpty(expectedEpoch))
            {
                return;
            }

            var current = Capture();
            if (!string.Equals(expectedEpoch, current.epoch, StringComparison.Ordinal))
            {
                throw new EditorStateStaleException(
                    $"State epoch mismatch. expected={expectedEpoch}, current={current.epoch}. Refresh Unity state before retrying the mutation.",
                    current);
            }

            if (expectedRevision != current.revision)
            {
                throw new EditorStateStaleException(
                    $"State revision mismatch. expected={expectedRevision}, current={current.revision}. Refresh Unity state before retrying the mutation.",
                    current);
            }
        }

        public static EditorStateRevisionSnapshot Advance()
        {
            if (revision == long.MaxValue)
            {
                epoch = Guid.NewGuid().ToString("N");
                SessionState.SetString(EpochKey, epoch);
                revision = 1;
            }
            else
            {
                revision += 1;
            }

            PersistRevision();
            return Capture();
        }

        private static void OnHierarchyChanged()
        {
            Advance();
        }

        private static void OnUndoRedoPerformed()
        {
            Advance();
        }

        private static UndoPropertyModification[] OnPostprocessModifications(
            UndoPropertyModification[] modifications)
        {
            if (modifications != null && modifications.Length > 0)
            {
                Advance();
            }

            return modifications;
        }

        private static void PersistRevision()
        {
            SessionState.SetString(RevisionKey, revision.ToString());
        }
    }
}
