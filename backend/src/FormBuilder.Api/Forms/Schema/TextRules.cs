using System.Globalization;
using System.Text;

namespace FormBuilder.Api.Forms.Schema;

/// <summary>
/// Text helpers whose behaviour is defined to match JavaScript exactly (see frontend core/validation/text.ts).
/// .NET's Trim()/char.IsWhiteSpace and JS String.prototype.trim()/\s differ (e.g. U+FEFF, U+180E), so the
/// whitespace set is spelled out once and used by both implementations.
/// </summary>
public static class TextRules
{
    /// <summary>Exactly the characters matched by JavaScript's \s and removed by String.prototype.trim().</summary>
    public static readonly (char Lo, char Hi)[] WhitespaceRanges =
    [
        ('\t', '\r'), // \t \n \v \f \r
        (' ', ' '),
        ('\u00A0', '\u00A0'),
        ('\u1680', '\u1680'),
        ('\u2000', '\u200A'),
        ('\u2028', '\u2029'),
        ('\u202F', '\u202F'),
        ('\u205F', '\u205F'),
        ('\u3000', '\u3000'),
        ('\uFEFF', '\uFEFF'),
    ];

    public static bool IsWhitespace(char c)
    {
        foreach (var (lo, hi) in WhitespaceRanges)
        {
            if (c >= lo && c <= hi) return true;
        }

        return false;
    }

    public static string Trim(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        int start = 0, end = s.Length - 1;
        while (start <= end && IsWhitespace(s[start])) start++;
        while (end >= start && IsWhitespace(s[end])) end--;
        return s.Substring(start, end - start + 1);
    }

    /// <summary>Integer with en-US thousands separators, e.g. 1,000 (same as JS toLocaleString('en-US')).</summary>
    public static string Count(long n)
    {
        var digits = Math.Abs(n).ToString(CultureInfo.InvariantCulture);
        var sb = new StringBuilder();
        for (var i = 0; i < digits.Length; i++)
        {
            if (i > 0 && (digits.Length - i) % 3 == 0) sb.Append(',');
            sb.Append(digits[i]);
        }

        return (n < 0 ? "-" : "") + sb;
    }

    /// <summary>Shortest round-trip number text; equals JS String(n) for |n| &lt; 1e15.</summary>
    public static string Number(double n) => n.ToString("R", CultureInfo.InvariantCulture);

    private static readonly string[] Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /// <summary>"2024-01-05" → "Jan 5, 2024".</summary>
    public static string ShortDate(string iso)
    {
        var p = iso.Split('-');
        return p.Length == 3 ? $"{Months[int.Parse(p[1], CultureInfo.InvariantCulture) - 1]} {int.Parse(p[2], CultureInfo.InvariantCulture)}, {p[0]}" : iso;
    }

    /// <summary>Strict calendar date check for "YYYY-MM-DD" (years 1000–9999).</summary>
    public static bool IsIsoDate(string? s)
    {
        if (s is null || s.Length != 10 || s[4] != '-' || s[7] != '-') return false;
        for (var i = 0; i < 10; i++)
        {
            if (i is 4 or 7) continue;
            if (s[i] < '0' || s[i] > '9') return false;
        }

        var y = int.Parse(s.AsSpan(0, 4), CultureInfo.InvariantCulture);
        var m = int.Parse(s.AsSpan(5, 2), CultureInfo.InvariantCulture);
        var d = int.Parse(s.AsSpan(8, 2), CultureInfo.InvariantCulture);
        if (y < 1000 || m < 1 || m > 12 || d < 1) return false;
        return d <= DateTime.DaysInMonth(y, m);
    }

    /// <summary>
    /// Email format used by the mockups: something@something.tld (tld ≥ 2 chars), no whitespace, one "@".
    /// Same as /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ with the JS whitespace set.
    /// </summary>
    public static bool IsEmail(string v)
    {
        var at = v.IndexOf('@');
        if (at <= 0 || at != v.LastIndexOf('@')) return false;
        foreach (var c in v)
        {
            if (IsWhitespace(c)) return false;
        }

        var domain = v[(at + 1)..];
        // [^\s@]+\.[^\s@]{2,} — greedy: the last dot that leaves ≥2 chars after it and ≥1 before it.
        for (var i = domain.Length - 3; i >= 1; i--)
        {
            if (domain[i] == '.') return true;
        }

        return false;
    }

    /// <summary>Accepts "12", "-3", "4.5", "-0.25" (what a number input yields); rejects exponents, "+", spaces.</summary>
    public static bool TryParseNumber(string v, out double result)
    {
        result = 0;
        var i = 0;
        if (v.Length == 0) return false;
        if (v[0] == '-') i = 1;
        var digitsBefore = 0;
        while (i < v.Length && v[i] >= '0' && v[i] <= '9') { i++; digitsBefore++; }
        if (digitsBefore == 0) return false;
        if (i < v.Length)
        {
            if (v[i] != '.') return false;
            i++;
            var digitsAfter = 0;
            while (i < v.Length && v[i] >= '0' && v[i] <= '9') { i++; digitsAfter++; }
            if (digitsAfter == 0 || i != v.Length) return false;
        }

        result = double.Parse(v, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        return true;
    }
}
