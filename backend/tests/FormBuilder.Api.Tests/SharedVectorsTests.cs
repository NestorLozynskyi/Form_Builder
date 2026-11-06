using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using FormBuilder.Api.Forms.Schema;

namespace FormBuilder.Api.Tests;

/// <summary>
/// Runs shared/validation-vectors.json — the same file is executed by the Angular client
/// (frontend/src/app/core/validation/shared-vectors.spec.ts), so client and server must agree on every vector.
/// </summary>
public sealed class SharedVectorsTests
{
    private static readonly JsonObject Data = Load();

    private static JsonObject Load()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "shared", "validation-vectors.json"))) dir = dir.Parent;
        if (dir is null) throw new FileNotFoundException("shared/validation-vectors.json not found above " + AppContext.BaseDirectory);
        return JsonNode.Parse(File.ReadAllText(Path.Combine(dir.FullName, "shared", "validation-vectors.json")))!.AsObject();
    }

    private static Block ToBlock(JsonNode? n) => n.Deserialize<Block>(FormSchema.Json)!;

    public static TheoryData<string> AnswerNames() => new(Data["answers"]!.AsArray().Select(v => v!["name"]!.GetValue<string>()));
    public static TheoryData<string> ConfigNames() => new(Data["config"]!.AsArray().Select(v => v!["name"]!.GetValue<string>()));
    public static TheoryData<int> PatternIndexes() => new(Enumerable.Range(0, Data["patterns"]!.AsArray().Count));

    [Fact]
    public void Vector_file_is_not_trivial()
    {
        Assert.True(Data["answers"]!.AsArray().Count >= 50);
        Assert.True(Data["config"]!.AsArray().Count >= 10);
        Assert.True(Data["patterns"]!.AsArray().Count >= 30);
    }

    [Theory]
    [MemberData(nameof(AnswerNames))]
    public void Answer(string name)
    {
        var v = Data["answers"]!.AsArray().Single(x => x!["name"]!.GetValue<string>() == name)!;
        var value = v["value"] is null ? (JsonElement?)null : JsonSerializer.SerializeToElement(v["value"]);
        var (error, normalized) = FormRules.ValidateAnswer(ToBlock(v["block"]), value, v["today"]!.GetValue<string>());

        Assert.Equal(v["error"]?.GetValue<string>(), error);
        var expected = v["normalized"]?.ToJsonString() ?? "null";
        Assert.Equal(expected, JsonSerializer.Serialize(normalized));
    }

    [Theory]
    [MemberData(nameof(ConfigNames))]
    public void Config(string name)
    {
        var v = Data["config"]!.AsArray().Single(x => x!["name"]!.GetValue<string>() == name)!;
        var actual = FormRules.BlockIssues(ToBlock(v["block"])).Select(i => $"{i.Key}: {i.Message}").ToArray();
        var expected = v["expected"]!.AsArray().Select(e => $"{e!["key"]!.GetValue<string>()}: {e["message"]!.GetValue<string>()}").ToArray();
        Assert.Equal(expected, actual);
    }

    [Theory]
    [MemberData(nameof(PatternIndexes))]
    public void Pattern(int index)
    {
        var v = Data["patterns"]![index]!;
        var pattern = v["pattern"]!.GetValue<string>();
        Assert.Equal(v["error"]?.GetValue<string>(), SafePattern.Check(pattern));
        foreach (var m in v["matches"]!.AsArray())
        {
            var value = m![0]!.GetValue<string>();
            var sw = Stopwatch.StartNew();
            Assert.Equal(m[1]!.GetValue<bool>(), SafePattern.IsMatch(pattern, value));
            Assert.True(sw.ElapsedMilliseconds < 250, $"'{pattern}' took {sw.ElapsedMilliseconds} ms");
        }
    }
}
