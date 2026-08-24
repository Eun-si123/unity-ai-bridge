using System;
using System.Collections.Generic;
using System.Text;

namespace UnityAiBridge.Editor.Testing
{
    internal static class ProjectManifestTestables
    {
        internal static string EnsurePackageTestable(
            string manifestJson,
            string packageName,
            out bool changed)
        {
            if (manifestJson == null)
            {
                throw new ArgumentNullException(nameof(manifestJson));
            }
            if (string.IsNullOrWhiteSpace(packageName))
            {
                throw new ArgumentException("Package name is required.", nameof(packageName));
            }

            ValidateRootObject(manifestJson, out var rootCloseIndex);

            if (TryFindTopLevelProperty(
                    manifestJson,
                    "testables",
                    out var valueStart,
                    out var valueEnd,
                    out var propertyIndent))
            {
                var testables = ParseStringArray(manifestJson, valueStart, valueEnd);
                if (testables.Contains(packageName))
                {
                    changed = false;
                    return manifestJson;
                }

                testables.Add(packageName);
                var replacement = FormatStringArray(testables, propertyIndent);
                changed = true;
                return manifestJson.Substring(0, valueStart) +
                       replacement +
                       manifestJson.Substring(valueEnd);
            }

            var prefix = manifestJson.Substring(0, rootCloseIndex).TrimEnd();
            var suffix = manifestJson.Substring(rootCloseIndex);
            var hasProperties = HasRootProperties(prefix);
            var separator = hasProperties ? "," : string.Empty;

            changed = true;
            return prefix + separator +
                   "\n  \"testables\": [\n" +
                   "    \"" + EscapeJsonString(packageName) + "\"\n" +
                   "  ]\n" +
                   suffix;
        }

        private static bool HasRootProperties(string prefix)
        {
            var openIndex = prefix.IndexOf('{');
            if (openIndex < 0)
            {
                return false;
            }

            return prefix.Substring(openIndex + 1).Trim().Length > 0;
        }

        private static void ValidateRootObject(string json, out int rootCloseIndex)
        {
            var index = 0;
            SkipWhitespace(json, ref index);
            if (index >= json.Length || json[index] != '{')
            {
                throw new FormatException("Packages/manifest.json must contain a top-level JSON object.");
            }

            var end = FindMatching(json, index, '{', '}');
            var trailing = end + 1;
            SkipWhitespace(json, ref trailing);
            if (trailing != json.Length)
            {
                throw new FormatException("Packages/manifest.json contains unexpected trailing content.");
            }

            rootCloseIndex = end;
        }

        private static bool TryFindTopLevelProperty(
            string json,
            string propertyName,
            out int valueStart,
            out int valueEnd,
            out string propertyIndent)
        {
            valueStart = 0;
            valueEnd = 0;
            propertyIndent = "  ";

            var index = 0;
            SkipWhitespace(json, ref index);
            if (index >= json.Length || json[index] != '{')
            {
                return false;
            }
            index++;

            while (true)
            {
                SkipWhitespace(json, ref index);
                if (index >= json.Length)
                {
                    throw new FormatException("Unexpected end of project manifest.");
                }
                if (json[index] == '}')
                {
                    return false;
                }

                var propertyLineIndent = ReadLineIndent(json, index);
                var key = ReadJsonString(json, ref index);
                SkipWhitespace(json, ref index);
                if (index >= json.Length || json[index] != ':')
                {
                    throw new FormatException("Expected ':' after a project-manifest property name.");
                }
                index++;
                SkipWhitespace(json, ref index);

                var currentValueStart = index;
                var currentValueEnd = SkipJsonValue(json, index);
                if (string.Equals(key, propertyName, StringComparison.Ordinal))
                {
                    valueStart = currentValueStart;
                    valueEnd = currentValueEnd;
                    propertyIndent = propertyLineIndent;
                    return true;
                }

                index = currentValueEnd;
                SkipWhitespace(json, ref index);
                if (index < json.Length && json[index] == ',')
                {
                    index++;
                    continue;
                }
                if (index < json.Length && json[index] == '}')
                {
                    return false;
                }

                throw new FormatException("Expected ',' or '}' in the project manifest.");
            }
        }

        private static List<string> ParseStringArray(string json, int start, int end)
        {
            var index = start;
            SkipWhitespace(json, ref index);
            if (index >= end || json[index] != '[')
            {
                throw new FormatException("Project-manifest 'testables' must be a JSON string array.");
            }
            index++;

            var values = new List<string>();
            while (true)
            {
                SkipWhitespace(json, ref index);
                if (index >= end)
                {
                    throw new FormatException("Unterminated project-manifest 'testables' array.");
                }
                if (json[index] == ']')
                {
                    index++;
                    break;
                }

                values.Add(ReadJsonString(json, ref index));
                SkipWhitespace(json, ref index);
                if (index < end && json[index] == ',')
                {
                    index++;
                    continue;
                }
                if (index < end && json[index] == ']')
                {
                    index++;
                    break;
                }

                throw new FormatException("Project-manifest 'testables' must contain only strings.");
            }

            SkipWhitespace(json, ref index);
            if (index != end)
            {
                throw new FormatException("Unexpected content after project-manifest 'testables'.");
            }

            return values;
        }

        private static string FormatStringArray(IReadOnlyList<string> values, string propertyIndent)
        {
            var itemIndent = propertyIndent + "  ";
            var builder = new StringBuilder();
            builder.Append("[\n");
            for (var i = 0; i < values.Count; i++)
            {
                builder.Append(itemIndent)
                    .Append('"')
                    .Append(EscapeJsonString(values[i]))
                    .Append('"');
                if (i + 1 < values.Count)
                {
                    builder.Append(',');
                }
                builder.Append('\n');
            }
            builder.Append(propertyIndent).Append(']');
            return builder.ToString();
        }

        private static int SkipJsonValue(string json, int start)
        {
            if (start >= json.Length)
            {
                throw new FormatException("Missing project-manifest value.");
            }

            var c = json[start];
            if (c == '"')
            {
                var index = start;
                ReadJsonString(json, ref index);
                return index;
            }
            if (c == '{')
            {
                return FindMatching(json, start, '{', '}') + 1;
            }
            if (c == '[')
            {
                return FindMatching(json, start, '[', ']') + 1;
            }

            var cursor = start;
            while (cursor < json.Length &&
                   json[cursor] != ',' &&
                   json[cursor] != '}' &&
                   json[cursor] != ']')
            {
                cursor++;
            }
            if (cursor == start)
            {
                throw new FormatException("Invalid project-manifest value.");
            }
            return cursor;
        }

        private static int FindMatching(string json, int start, char open, char close)
        {
            var depth = 0;
            var inString = false;
            var escaped = false;

            for (var i = start; i < json.Length; i++)
            {
                var c = json[i];
                if (inString)
                {
                    if (escaped)
                    {
                        escaped = false;
                    }
                    else if (c == '\\')
                    {
                        escaped = true;
                    }
                    else if (c == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (c == '"')
                {
                    inString = true;
                    continue;
                }
                if (c == open)
                {
                    depth++;
                    continue;
                }
                if (c == close)
                {
                    depth--;
                    if (depth == 0)
                    {
                        return i;
                    }
                }
            }

            throw new FormatException("Unterminated JSON container in project manifest.");
        }

        private static string ReadJsonString(string json, ref int index)
        {
            if (index >= json.Length || json[index] != '"')
            {
                throw new FormatException("Expected a JSON string in the project manifest.");
            }
            index++;

            var builder = new StringBuilder();
            while (index < json.Length)
            {
                var c = json[index++];
                if (c == '"')
                {
                    return builder.ToString();
                }
                if (c != '\\')
                {
                    builder.Append(c);
                    continue;
                }

                if (index >= json.Length)
                {
                    throw new FormatException("Invalid JSON escape in project manifest.");
                }

                var escaped = json[index++];
                switch (escaped)
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (index + 4 > json.Length)
                        {
                            throw new FormatException("Invalid Unicode escape in project manifest.");
                        }
                        var hex = json.Substring(index, 4);
                        builder.Append((char)Convert.ToInt32(hex, 16));
                        index += 4;
                        break;
                    default:
                        throw new FormatException("Unsupported JSON escape in project manifest.");
                }
            }

            throw new FormatException("Unterminated JSON string in project manifest.");
        }

        private static string EscapeJsonString(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"");
        }

        private static string ReadLineIndent(string json, int index)
        {
            var lineStart = index;
            while (lineStart > 0 && json[lineStart - 1] != '\n' && json[lineStart - 1] != '\r')
            {
                lineStart--;
            }

            var cursor = lineStart;
            while (cursor < index && (json[cursor] == ' ' || json[cursor] == '\t'))
            {
                cursor++;
            }

            return json.Substring(lineStart, cursor - lineStart);
        }

        private static void SkipWhitespace(string json, ref int index)
        {
            while (index < json.Length && char.IsWhiteSpace(json[index]))
            {
                index++;
            }
        }
    }
}
