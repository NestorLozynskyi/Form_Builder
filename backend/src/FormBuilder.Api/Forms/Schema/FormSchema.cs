using System.Text.Json;
using System.Text.Json.Serialization;

namespace FormBuilder.Api.Forms.Schema;

/// <summary>
/// Declarative form structure shared by the draft and every published version. The same JSON shape is used by
/// the Angular client (frontend/src/app/core/schema) and validated by the same rules on both sides.
/// </summary>
public sealed class FormSchema
{
    public string Title { get; set; } = "Untitled form";
    public string Description { get; set; } = "";
    public string SuccessMessage { get; set; } = "Thanks! Your response has been recorded.";

    /// <summary>Preset key (cobalt, teal, …) or custom hex "#RRGGBB".</summary>
    public string Accent { get; set; } = "cobalt";

    public List<Block> Blocks { get; set; } = [];

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static FormSchema NewDraft() => new();

    public string ToJson() => JsonSerializer.Serialize(this, Json);

    public static FormSchema FromJson(string json) =>
        JsonSerializer.Deserialize<FormSchema>(json, Json) ?? throw new InvalidOperationException("Empty schema.");

    [JsonIgnore]
    public IEnumerable<Block> InputBlocks => Blocks.Where(b => BlockTypes.IsInput(b.Type));
}

/// <summary>
/// One block on the form. A flat shape keeps (de)serialisation identical in C# and TypeScript; properties that do
/// not apply to a type are null/empty. <see cref="Id"/> is stable across versions (field identity).
/// </summary>
public sealed class Block
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";

    // input fields
    public string? Label { get; set; }
    public string? Help { get; set; }
    public bool Required { get; set; }

    // short / long
    public int? MinLength { get; set; }
    public int? MaxLength { get; set; }
    public string? Pattern { get; set; }
    public string? PatternMessage { get; set; }

    // number (min/max) and scale (max)
    public double? Min { get; set; }
    public double? Max { get; set; }
    public bool Integer { get; set; }

    // date
    public string? Earliest { get; set; }
    public string? LatestMode { get; set; }
    public string? Latest { get; set; }

    // radio / checkbox / dropdown
    public List<string>? Options { get; set; }
    public int? MinSelected { get; set; }
    public int? MaxSelected { get; set; }

    // scale
    public string? LeftLabel { get; set; }
    public string? RightLabel { get; set; }

    // heading / description
    public string? Text { get; set; }
}

public static class BlockTypes
{
    public const string Short = "short";
    public const string Long = "long";
    public const string Email = "email";
    public const string Number = "number";
    public const string Date = "date";
    public const string Radio = "radio";
    public const string Checkbox = "checkbox";
    public const string Dropdown = "dropdown";
    public const string Scale = "scale";
    public const string Heading = "heading";
    public const string Description = "description";

    public static readonly string[] Inputs = [Short, Long, Email, Number, Date, Radio, Checkbox, Dropdown, Scale];
    public static readonly string[] All = [.. Inputs, Heading, Description];

    public static bool IsInput(string type) => Inputs.Contains(type);
    public static bool IsKnown(string type) => All.Contains(type);
    public static bool HasOptions(string type) => type is Radio or Checkbox or Dropdown;
    public static bool IsText(string type) => type is Short or Long;
}

/// <summary>System limits (also enforced by the client; see README "Limits").</summary>
public static class Limits
{
    public const int MaxBlocks = 100;
    public const int MaxOptions = 50;
    public const int OptionMaxLength = 200;
    public const int TitleMaxLength = 200;
    public const int FormDescriptionMaxLength = 2000;
    public const int SuccessMessageMaxLength = 1000;
    public const int LabelMaxLength = 500;
    public const int HelpMaxLength = 1000;
    public const int HeadingMaxLength = 200;
    public const int DescriptionMaxLength = 2000;
    public const int PatternMaxLength = 200;
    public const int PatternMessageMaxLength = 200;
    public const int ScaleLabelMaxLength = 60;
    public const int BlockIdMaxLength = 40;
    public const int ShortTextMaxValue = 1000;
    public const int LongTextMaxValue = 10000;
    public const int EmailMaxValue = 254;
    public const int NumberMaxValueLength = 40;
    public const int ScaleMinTo = 2;
    public const int ScaleMaxTo = 10;
    public const double NumberBoundAbsMax = 1e15;

    public static int TextHardMax(string type) => type == BlockTypes.Long ? LongTextMaxValue : ShortTextMaxValue;
}
