using System.Text.Json;
using System.Text.RegularExpressions;

namespace FormBuilder.Api.Forms.Schema;

public sealed record ConfigIssue(string BlockId, string Key, string Message);

/// <summary>
/// Rules for the form definition and for answers. Mirrors frontend core/validation/rules.ts message-for-message;
/// shared/validation-vectors.json is executed against both implementations.
/// </summary>
public static partial class FormRules
{
    public const string ErrNoInputs = "Add at least one input field to publish.";

    [GeneratedRegex("^[A-Za-z0-9_-]{1,40}$")]
    private static partial Regex BlockIdRegex();

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexRegex();

    public static readonly string[] AccentPresets = ["cobalt", "teal", "green", "amber", "red", "magenta", "slate", "indigo"];

    // ------------------------------------------------------------------ structure (hard limits, checked on every save)

    /// <summary>Returns problems that make a draft unacceptable to store at all (malformed or over system limits).</summary>
    public static Dictionary<string, string[]> StructuralErrors(FormSchema s)
    {
        var e = new Dictionary<string, string[]>();
        void Add(string key, string msg) => e[key] = [msg];

        if ((s.Title ?? "").Length > Limits.TitleMaxLength) Add("title", $"Use {Limits.TitleMaxLength} characters or fewer.");
        if ((s.Description ?? "").Length > Limits.FormDescriptionMaxLength) Add("description", $"Use {TextRules.Count(Limits.FormDescriptionMaxLength)} characters or fewer.");
        if ((s.SuccessMessage ?? "").Length > Limits.SuccessMessageMaxLength) Add("successMessage", $"Use {TextRules.Count(Limits.SuccessMessageMaxLength)} characters or fewer.");
        if (s.Accent is null || !(AccentPresets.Contains(s.Accent) || HexRegex().IsMatch(s.Accent))) Add("accent", "Use a preset or a hex color like #0F766E.");
        if (s.Blocks is null) { Add("blocks", "Blocks are required."); return e; }
        if (s.Blocks.Count > Limits.MaxBlocks) Add("blocks", $"A form can have up to {Limits.MaxBlocks} blocks.");

        var ids = new HashSet<string>();
        for (var i = 0; i < s.Blocks.Count; i++)
        {
            var b = s.Blocks[i];
            var k = $"blocks[{i}]";
            if (b is null) { Add(k, "Block is missing."); continue; }
            if (b.Id is null || !BlockIdRegex().IsMatch(b.Id) || !ids.Add(b.Id)) Add(k + ".id", "Block id must be unique (letters, digits, - and _).");
            if (b.Type is null || !BlockTypes.IsKnown(b.Type)) { Add(k + ".type", "Unknown block type."); continue; }
            if ((b.Label ?? "").Length > Limits.LabelMaxLength) Add(k + ".label", "Label is too long.");
            if ((b.Help ?? "").Length > Limits.HelpMaxLength) Add(k + ".help", "Help text is too long.");
            if ((b.Pattern ?? "").Length > Limits.PatternMaxLength * 2) Add(k + ".pattern", "Pattern is too long.");
            if ((b.PatternMessage ?? "").Length > Limits.PatternMessageMaxLength) Add(k + ".patternMessage", "Error message is too long.");
            if ((b.LeftLabel ?? "").Length > Limits.ScaleLabelMaxLength || (b.RightLabel ?? "").Length > Limits.ScaleLabelMaxLength) Add(k + ".scale", "Scale label is too long.");
            var textMax = b.Type == BlockTypes.Heading ? Limits.HeadingMaxLength : Limits.DescriptionMaxLength;
            if ((b.Text ?? "").Length > textMax) Add(k + ".text", "Text is too long.");
            if (b.Options is { } o)
            {
                if (o.Count > Limits.MaxOptions) Add(k + ".options", $"Use up to {Limits.MaxOptions} options.");
                if (o.Any(x => x is null || x.Length > Limits.OptionMaxLength)) Add(k + ".options", "Option text is too long.");
            }

            if (BlockTypes.HasOptions(b.Type) && b.Options is null) Add(k + ".options", "Options are required.");
            if (b.Type == BlockTypes.Scale && (b.Max is not { } mx || mx != Math.Floor(mx) || mx < Limits.ScaleMinTo || mx > Limits.ScaleMaxTo))
                Add(k + ".max", "Scale must go to a value from 2 to 10.");
            if (b.Min is { } mn && (double.IsNaN(mn) || Math.Abs(mn) > Limits.NumberBoundAbsMax)) Add(k + ".min", "Value is out of range.");
            if (b.Max is { } mx2 && (double.IsNaN(mx2) || Math.Abs(mx2) > Limits.NumberBoundAbsMax)) Add(k + ".max", "Value is out of range.");
            if (b.LatestMode is not (null or "none" or "today" or "date")) Add(k + ".latestMode", "Unknown latest date mode.");
            foreach (var v in new[] { b.MinLength, b.MaxLength, b.MinSelected, b.MaxSelected })
            {
                if (v is < -1_000_000 or > 1_000_000) Add(k + ".limits", "Value is out of range.");
            }
        }

        return e;
    }

    // ------------------------------------------------------------------ configuration issues (block publishing)

    public static List<ConfigIssue> BlockIssues(Block b)
    {
        var e = new List<ConfigIssue>();
        void Add(string key, string msg) => e.Add(new ConfigIssue(b.Id, key, msg));
        var t = b.Type;
        if (!BlockTypes.IsInput(t)) return e;

        if (TextRules.Trim(b.Label).Length == 0) Add("label", "Add a label for this question.");

        if (BlockTypes.IsText(t))
        {
            var hard = Limits.TextHardMax(t);
            if (b.MinLength < 0 || b.MaxLength < 0) Add("len", "Lengths can’t be negative.");
            else if (b.MinLength is { } mn && b.MaxLength is { } mx && mn > mx) Add("len", "Minimum length can’t be greater than maximum length.");
            else if (b.MaxLength > hard || b.MinLength > hard) Add("len", $"Lengths can’t be more than {TextRules.Count(hard)} characters.");
            if (!string.IsNullOrEmpty(b.Pattern) && SafePattern.Check(b.Pattern) is { } pe) Add("pattern", pe);
        }
        else if (t == BlockTypes.Number)
        {
            if (b.Min is { } mn && b.Max is { } mx && mn > mx) Add("range", "Minimum value can’t be greater than maximum value.");
        }
        else if (t == BlockTypes.Date)
        {
            var earliestOk = string.IsNullOrEmpty(b.Earliest) || TextRules.IsIsoDate(b.Earliest);
            var latestOk = b.LatestMode != "date" || TextRules.IsIsoDate(b.Latest);
            if (!earliestOk) Add("dates", "Enter the earliest date as a complete date.");
            else if (!latestOk) Add("dates", "Choose the latest date, or set Latest date to No limit.");
            else if (!string.IsNullOrEmpty(b.Earliest) && b.LatestMode == "date" && string.CompareOrdinal(b.Earliest, b.Latest) > 0)
                Add("dates", "Earliest date can’t be after latest date.");
        }

        if (BlockTypes.HasOptions(t))
        {
            var opts = b.Options ?? [];
            for (var i = 0; i < opts.Count; i++)
            {
                var text = TextRules.Trim(opts[i]);
                if (text.Length == 0)
                {
                    Add("opt" + i, $"Option {i + 1} is empty. Enter text or remove it.");
                    continue;
                }

                for (var j = 0; j < i; j++)
                {
                    if (TextRules.Trim(opts[j]) == text)
                    {
                        Add("opt" + i, $"Option {i + 1} is the same as option {j + 1}. Use different text.");
                        break;
                    }
                }
            }

            if (opts.Count < 2) Add("opts", "Add at least 2 options.");
        }

        if (t == BlockTypes.Checkbox)
        {
            var count = (b.Options ?? []).Count;
            if (b.MinSelected < 0 || b.MaxSelected < 0) Add("sel", "Selection limits can’t be negative.");
            else if (b.MinSelected is { } mn && b.MaxSelected is { } mx && mn > mx) Add("sel", "Minimum selected can’t be greater than maximum selected.");
            else if (b.MaxSelected > count || b.MinSelected > count) Add("sel", "Selection limits can’t be more than the number of options.");
        }

        return e;
    }

    public static List<ConfigIssue> Issues(FormSchema s) => s.Blocks.SelectMany(BlockIssues).ToList();

    /// <summary>Null when the schema can be published, otherwise the reason (same text as the editor tooltip).</summary>
    public static string? PublishBlocker(FormSchema s)
    {
        if (!s.Blocks.Any(b => BlockTypes.IsInput(b.Type))) return ErrNoInputs;
        var n = Issues(s).Count;
        return n == 0 ? null : $"Fix {n} {(n == 1 ? "issue" : "issues")} to publish.";
    }

    // ------------------------------------------------------------------ answers

    /// <summary>Validates one answer. Returns (error, normalized). normalized is null for "no answer".</summary>
    public static (string? Error, object? Normalized) ValidateAnswer(Block b, JsonElement? value, string today)
    {
        var t = b.Type;
        var isNull = value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

        if (t == BlockTypes.Checkbox)
        {
            var options = b.Options ?? [];
            var selected = new List<string>();
            if (!isNull)
            {
                if (value!.Value.ValueKind != JsonValueKind.Array) return ("Choose from the listed options.", null);
                foreach (var el in value.Value.EnumerateArray())
                {
                    if (el.ValueKind != JsonValueKind.String) return ("Choose from the listed options.", null);
                    var s = el.GetString()!;
                    if (!options.Contains(s) || selected.Contains(s)) return ("Choose from the listed options.", null);
                    selected.Add(s);
                }
            }

            var n = selected.Count;
            if (n == 0)
            {
                if (!b.Required) return (null, null);
                var need = Math.Max(1, b.MinSelected ?? 0);
                return ($"Choose at least {need} {Plural(need, "option")}.", null);
            }

            if (b.MinSelected is { } min && n < min) return ($"Choose at least {min} {Plural(min, "option")}.", null);
            if (b.MaxSelected is { } max && n > max) return ($"Choose no more than {max} {Plural(max, "option")}.", null);
            return (null, options.Where(selected.Contains).ToArray());
        }

        string raw;
        if (isNull) raw = "";
        else if (value!.Value.ValueKind == JsonValueKind.String) raw = value.Value.GetString()!;
        else return (WrongType(b), null);

        var v = TextRules.Trim(raw);
        if (v.Length == 0) return b.Required ? (RequiredMessage(b), null) : (null, null);

        switch (t)
        {
            case BlockTypes.Short or BlockTypes.Long:
            {
                var n = v.Length;
                var hard = Limits.TextHardMax(t);
                if (n > hard) return (TooLong(hard, n), null);
                if (b.MinLength is { } min && min > 0 && n < min) return ($"Use at least {TextRules.Count(min)} {Plural(min, "character")} — you’re at {TextRules.Count(n)}.", null);
                if (b.MaxLength is { } max && max >= 0 && n > max) return (TooLong(max, n), null);
                if (!string.IsNullOrEmpty(b.Pattern) && SafePattern.Check(b.Pattern) is null && !SafePattern.IsMatch(b.Pattern, v))
                {
                    var msg = TextRules.Trim(b.PatternMessage);
                    return (msg.Length > 0 ? msg : "Enter an answer in the expected format.", null);
                }

                return (null, v);
            }
            case BlockTypes.Email:
                if (v.Length > Limits.EmailMaxValue || !TextRules.IsEmail(v)) return ("Enter an email address like name@example.com.", null);
                return (null, v);
            case BlockTypes.Number:
            {
                if (v.Length > Limits.NumberMaxValueLength || !TextRules.TryParseNumber(v, out var num)) return ("Enter a number using digits only, like 25.", null);
                if (b.Integer && num != Math.Floor(num)) return ("Enter a whole number, without decimals.", null);
                var lo = b.Min;
                var hi = b.Max;
                if ((lo is { } l && num < l) || (hi is { } h && num > h))
                {
                    if (lo is not null && hi is not null) return ($"Enter a number from {TextRules.Number(lo.Value)} to {TextRules.Number(hi.Value)}.", null);
                    if (lo is not null) return ($"Enter a number of at least {TextRules.Number(lo.Value)}.", null);
                    return ($"Enter a number of at most {TextRules.Number(hi!.Value)}.", null);
                }

                return (null, v);
            }
            case BlockTypes.Date:
            {
                if (!TextRules.IsIsoDate(v)) return (b.Required ? "Enter a complete date." : "Enter a complete date, or clear the field.", null);
                var lo = TextRules.IsIsoDate(b.Earliest) ? b.Earliest : null;
                string? hi = b.LatestMode switch
                {
                    "today" => today,
                    "date" when TextRules.IsIsoDate(b.Latest) => b.Latest,
                    _ => null,
                };
                var hiText = b.LatestMode == "today" ? "today" : hi is null ? "" : TextRules.ShortDate(hi);
                var tooEarly = lo is not null && string.CompareOrdinal(v, lo) < 0;
                var tooLate = hi is not null && string.CompareOrdinal(v, hi) > 0;
                if (tooEarly || tooLate)
                {
                    if (lo is not null && hi is not null) return ($"Choose a date between {TextRules.ShortDate(lo)} and {hiText}.", null);
                    if (lo is not null) return ($"Choose a date on or after {TextRules.ShortDate(lo)}.", null);
                    return ($"Choose a date on or before {hiText}.", null);
                }

                return (null, v);
            }
            case BlockTypes.Radio or BlockTypes.Dropdown:
                return (b.Options ?? []).Contains(raw) ? (null, raw) : ("Choose one of the listed options.", null);
            case BlockTypes.Scale:
            {
                var max = (int)(b.Max ?? 5);
                return int.TryParse(v, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var r)
                       && r >= 1 && r <= max && v == r.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    ? (null, v)
                    : ($"Choose a rating from 1 to {max}.", null);
            }
            default:
                return (null, null);
        }
    }

    public static string RequiredMessage(Block b) => b.Type switch
    {
        BlockTypes.Short or BlockTypes.Long => "Enter an answer.",
        BlockTypes.Email => "Enter an email address.",
        BlockTypes.Number => "Enter a number.",
        BlockTypes.Date => "Enter a date.",
        BlockTypes.Radio or BlockTypes.Dropdown => "Choose an option.",
        BlockTypes.Scale => ScaleRequired(b),
        _ => "Enter an answer.",
    };

    private static string ScaleRequired(Block b)
    {
        var max = (int)(b.Max ?? 5);
        var l = TextRules.Trim(b.LeftLabel);
        var r = TextRules.Trim(b.RightLabel);
        return l.Length > 0 && r.Length > 0
            ? $"Choose a rating from 1 ({l}) to {max} ({r})."
            : $"Choose a rating from 1 to {max}.";
    }

    private static string WrongType(Block b) => b.Type switch
    {
        BlockTypes.Number => "Enter a number using digits only, like 25.",
        BlockTypes.Email => "Enter an email address like name@example.com.",
        BlockTypes.Date => "Enter a complete date.",
        BlockTypes.Radio or BlockTypes.Dropdown => "Choose one of the listed options.",
        BlockTypes.Scale => $"Choose a rating from 1 to {(int)(b.Max ?? 5)}.",
        _ => "Enter an answer.",
    };

    private static string TooLong(int max, int n) => $"Use {TextRules.Count(max)} {Plural(max, "character")} or fewer — you’re at {TextRules.Count(n)}.";

    private static string Plural(long n, string word) => n == 1 ? word : word + "s";

    /// <summary>Validates a full submission against a version schema.</summary>
    public static (Dictionary<string, string> Errors, Dictionary<string, object> Answers) ValidateSubmission(
        FormSchema schema, IReadOnlyDictionary<string, JsonElement>? answers, string today)
    {
        var errors = new Dictionary<string, string>();
        var normalized = new Dictionary<string, object>();
        foreach (var b in schema.InputBlocks)
        {
            JsonElement? v = answers is not null && answers.TryGetValue(b.Id, out var el) ? el : null;
            var (error, value) = ValidateAnswer(b, v, today);
            if (error is not null) errors[b.Id] = error;
            else if (value is not null) normalized[b.Id] = value;
        }

        return (errors, normalized);
    }
}
