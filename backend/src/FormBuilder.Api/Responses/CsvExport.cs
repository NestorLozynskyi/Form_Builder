using System.Globalization;
using System.Text;
using System.Text.Json;
using FormBuilder.Api.Forms.Schema;

namespace FormBuilder.Api.Responses;

/// <summary>CSV export rules (RFC 4180 + spreadsheet formula-injection neutralisation).</summary>
public static class CsvExport
{
    public sealed record VersionSchema(Guid Id, int Number, FormSchema Schema);

    public sealed record Column(string BlockId, string Header);

    /// <summary>
    /// Fields of the latest version in its order, then fields removed later, ordered by the latest version they existed
    /// in (descending), then by their order there. Header = label in the latest version containing the field.
    /// </summary>
    public static List<Column> Columns(IEnumerable<VersionSchema> versions)
    {
        var columns = new List<Column>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in versions.OrderByDescending(v => v.Number))
        {
            foreach (var b in v.Schema.InputBlocks)
            {
                if (seen.Add(b.Id)) columns.Add(new Column(b.Id, b.Label ?? ""));
            }
        }

        return columns;
    }

    public static string HeaderRow(IReadOnlyList<Column> columns) =>
        Row(["Response", "Submitted (UTC)", "Version", .. columns.Select(c => c.Header)]);

    public static string DataRow(IReadOnlyList<Column> columns, int number, DateTime submittedAt, int version, string answersJson)
    {
        using var doc = JsonDocument.Parse(answersJson);
        var answers = doc.RootElement;
        var cells = new List<string>(columns.Count + 3)
        {
            number.ToString(CultureInfo.InvariantCulture),
            submittedAt.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            version.ToString(CultureInfo.InvariantCulture),
        };
        foreach (var c in columns)
        {
            cells.Add(answers.ValueKind == JsonValueKind.Object && answers.TryGetProperty(c.BlockId, out var v) ? Text(v) : "");
        }

        return Row(cells);
    }

    private static string Text(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString()!,
        JsonValueKind.Array => string.Join("; ", v.EnumerateArray().Select(Text)),
        JsonValueKind.Null or JsonValueKind.Undefined => "",
        _ => v.GetRawText(),
    };

    public static string Row(IEnumerable<string> cells) => string.Join(",", cells.Select(Cell)) + "\r\n";

    /// <summary>Neutralises spreadsheet formulas (leading = + - @ TAB CR get a '), then applies RFC 4180 quoting.</summary>
    public static string Cell(string value)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
        return value.AsSpan().IndexOfAny("\",\r\n") >= 0 ? "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : value;
    }

    /// <summary>ASCII file-name slug of the form title ("form" when nothing is left).</summary>
    public static string Slug(string title)
    {
        var sb = new StringBuilder();
        foreach (var ch in title.Normalize(NormalizationForm.FormD).ToLowerInvariant())
        {
            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(ch);
            else if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
            if (sb.Length >= 60) break;
        }

        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "form" : slug;
    }
}
