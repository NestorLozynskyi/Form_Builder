using System.Net;
using System.Text;
using FormBuilder.Api.Forms.Schema;
using FormBuilder.Api.Responses;
using static FormBuilder.Api.Tests.Schemas;

namespace FormBuilder.Api.Tests;

public sealed class CsvExportTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    private static async Task<(HttpResponseMessage Response, byte[] Bytes, List<List<string>> Rows)> ExportAsync(Session s, string id)
    {
        var r = await s.Client.GetAsync($"/api/forms/{id}/responses/export.csv", Ct);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var bytes = await r.Content.ReadAsByteArrayAsync(Ct);
        return (r, bytes, Parse(Encoding.UTF8.GetString(bytes.AsSpan(3))));
    }

    /// <summary>Minimal RFC 4180 parser (CRLF rows) for assertions.</summary>
    private static List<List<string>> Parse(string csv)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < csv.Length && csv[i + 1] == '"') { cell.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else cell.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == ',') { row.Add(cell.ToString()); cell.Clear(); }
            else if (c == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') { row.Add(cell.ToString()); cell.Clear(); rows.Add(row); row = []; i++; }
            else cell.Append(c);
        }

        Assert.Empty(row);
        Assert.Equal(0, cell.Length);
        return rows;
    }

    [Fact]
    public async Task Export_has_bom_headers_quoting_and_neutralised_formulas()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var schema = Form("Café Feedback: 2026!", Short("a", "=SUM(A1)"), Short("t", "\tTabbed"), new Block { Id = "b", Type = BlockTypes.Long, Label = "Comment, \"quoted\"" },
            Checkbox("c", "Tags", "x", "y", "z"));
        var (id, publicId) = await owner.CreatePublishedAsync(schema);
        using var anon = new Session(factory);
        await anon.SubmitAsync(publicId, 1, new { a = "=1+1", b = "line1\nline2, \"q\"", c = new[] { "z", "x" } });
        await anon.SubmitAsync(publicId, 1, new { a = "+cmd", b = "-5" });
        await anon.SubmitAsync(publicId, 1, new { a = "@SUM(1)", b = "=HYPERLINK(\"http://x\")" });

        var (response, bytes, rows) = await ExportAsync(owner, id);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("utf-8", response.Content.Headers.ContentType?.CharSet);
        Assert.Equal("attachment; filename=\"cafe-feedback-2026-responses.csv\"", response.Content.Headers.ContentDisposition?.ToString());
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]);

        var text = Encoding.UTF8.GetString(bytes.AsSpan(3));
        Assert.Contains("\"line1\nline2, \"\"q\"\"\"", text);
        Assert.EndsWith("\r\n", text);

        Assert.Equal(["Response", "Submitted (UTC)", "Version", "'=SUM(A1)", "'\tTabbed", "Comment, \"quoted\"", "Tags"], rows[0]);
        Assert.Equal(4, rows.Count);
        Assert.Equal("1", rows[1][0]);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", rows[1][1]);
        Assert.Equal("1", rows[1][2]);
        Assert.Equal(["'=1+1", "", "line1\nline2, \"q\"", "x; z"], rows[1][3..]);
        Assert.Equal(["'+cmd", "", "'-5", ""], rows[2][3..]);
        Assert.Equal(["'@SUM(1)", "", "'=HYPERLINK(\"http://x\")", ""], rows[3][3..]);
    }

    [Fact]
    public async Task Columns_span_versions_with_removed_fields_and_latest_labels()
    {
        using var owner = await Session.SignedUpAsync(factory);
        // v1: name, age, city ; v2: name (renamed), city, email (age removed) ; v3: email, name (city removed)
        var v1 = Form("Columns", Short("name", "Name"), Short("age", "Age"), Short("city", "City"));
        var (id, publicId) = await owner.CreatePublishedAsync(v1);
        using var anon = new Session(factory);
        await anon.SubmitAsync(publicId, 1, new { name = "Ann", age = "30", city = "Oslo" });

        await owner.SaveDraftAsync(id, Form("Columns", Short("name", "Full name"), Short("city", "Town"), Email("mail", "Email")));
        await owner.PublishAsync(id);
        await anon.SubmitAsync(publicId, 2, new { name = "Bob", city = "Rome", mail = "bob@example.com" });

        await owner.SaveDraftAsync(id, Form("Columns", Email("mail", "E-mail"), Short("name", "Your name")));
        await owner.PublishAsync(id);
        await anon.SubmitAsync(publicId, 3, new { name = "Cy", mail = "cy@example.com" });

        var (_, _, rows) = await ExportAsync(owner, id);
        Assert.Equal(["Response", "Submitted (UTC)", "Version", "E-mail", "Your name", "Town", "Age"], rows[0]);
        Assert.Equal(["1", "1", "", "Ann", "Oslo", "30"], [rows[1][0], .. rows[1][2..]]);
        Assert.Equal(["2", "2", "bob@example.com", "Bob", "Rome", ""], [rows[2][0], .. rows[2][2..]]);
        Assert.Equal(["3", "3", "cy@example.com", "Cy", "", ""], [rows[3][0], .. rows[3][2..]]);
    }

    [Fact]
    public async Task Export_of_form_without_versions_has_only_fixed_headers()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var id = (await owner.CreateFormAsync()).GetProperty("id").GetString()!;
        var (response, _, rows) = await ExportAsync(owner, id);
        Assert.Equal("attachment; filename=\"untitled-form-responses.csv\"", response.Content.Headers.ContentDisposition?.ToString());
        Assert.Equal([["Response", "Submitted (UTC)", "Version"]], rows);
    }

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("-1", "'-1")]
    [InlineData("\rx", "\"'\rx\"")]
    [InlineData("\tx", "'\tx")]
    [InlineData("+1", "'+1")]
    [InlineData("@a", "'@a")]
    [InlineData("a\nb", "\"a\nb\"")]
    [InlineData("", "")]
    public void Cell_rules(string value, string expected) => Assert.Equal(expected, CsvExport.Cell(value));
}
