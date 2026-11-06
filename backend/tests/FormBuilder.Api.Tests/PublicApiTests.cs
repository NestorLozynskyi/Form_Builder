using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FormBuilder.Api.Forms.Schema;
using Microsoft.EntityFrameworkCore;
using static FormBuilder.Api.Tests.Schemas;

namespace FormBuilder.Api.Tests;

public sealed class PublicApiTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    [Fact]
    public async Task Open_form_returns_live_schema_without_auth()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (_, publicId) = await owner.CreatePublishedAsync(Contact("Public"));
        using var anon = new Session(factory);
        var body = await anon.GetJsonAsync($"/api/public/forms/{publicId}");
        Assert.Equal(publicId, body.GetProperty("publicId").GetString());
        Assert.Equal("open", body.GetProperty("status").GetString());
        Assert.Equal(1, body.GetProperty("version").GetInt32());
        Assert.Equal("Public", body.GetProperty("schema").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Unknown_malformed_and_never_published_forms_are_not_available()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var draft = (await owner.CreateFormAsync()).GetProperty("id").GetString()!;
        using var anon = new Session(factory);
        foreach (var publicId in new[] { "AAAAAAAAAAAAAAAAAAAAAA", "not valid!", "short", draft })
        {
            await ProblemAssert.IsAsync(await anon.Client.GetAsync($"/api/public/forms/{Uri.EscapeDataString(publicId)}", Ct),
                HttpStatusCode.NotFound, "Form not available");
            await ProblemAssert.IsAsync(await anon.SubmitAsync(Uri.EscapeDataString(publicId), 1, new { }),
                HttpStatusCode.NotFound, "Form not available");
        }
    }

    [Fact]
    public async Task Submission_is_stored_with_sequential_numbers_and_normalised_answers()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var schema = Form("Order", Short("name", "Name", required: true), Checkbox("extras", "Extras", "Milk", "Sugar", "Lemon"));
        var (id, publicId) = await owner.CreatePublishedAsync(schema);
        using var anon = new Session(factory);

        var r1 = await anon.SubmitAsync(publicId, 1, new { name = "  Ann  ", extras = new[] { "Lemon", "Milk" }, unknown = "x" });
        Assert.Equal(HttpStatusCode.Created, r1.StatusCode);
        Assert.Equal(1, (await r1.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("number").GetInt32());
        var r2 = await anon.SubmitAsync(publicId, 1, new { name = "Bob" });
        Assert.Equal(2, (await r2.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("number").GetInt32());

        var page = await owner.GetJsonAsync($"/api/forms/{id}/responses");
        Assert.Equal(2, page.GetProperty("total").GetInt32());
        var items = page.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal([2, 1], items.Select(i => i.GetProperty("number").GetInt32()));
        var first = items[1];
        Assert.Equal(1, first.GetProperty("version").GetInt32());
        Assert.Equal("Ann", first.GetProperty("answers").GetProperty("name").GetString());
        Assert.Equal(["Milk", "Lemon"], first.GetProperty("answers").GetProperty("extras").EnumerateArray().Select(e => e.GetString()));
        Assert.False(first.GetProperty("answers").TryGetProperty("unknown", out _));
    }

    [Fact]
    public async Task Validation_errors_are_keyed_by_block_id()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var schema = Form("V", Short("name", "Name", required: true), Email("mail", "Email"), Short("zip", "Zip", pattern: "^[0-9]{5}$"));
        var (id, publicId) = await owner.CreatePublishedAsync(schema);
        using var anon = new Session(factory);

        var r = await anon.SubmitAsync(publicId, 1, new { name = "   ", mail = "nope", zip = "12" });
        var problem = await ProblemAssert.IsAsync(r, HttpStatusCode.BadRequest);
        var errors = problem.GetProperty("errors");
        Assert.Equal("Enter an answer.", errors.GetProperty("name")[0].GetString());
        Assert.Equal("Enter an email address like name@example.com.", errors.GetProperty("mail")[0].GetString());
        Assert.Equal("Enter an answer in the expected format.", errors.GetProperty("zip")[0].GetString());
        Assert.Equal(0, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Stale_tab_submission_is_validated_against_the_version_it_saw()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var v1 = Form("Stale", Short("name", "Name", required: true), Short("city", "City"));
        var (id, publicId) = await owner.CreatePublishedAsync(v1);

        // v2 drops "city" and adds a new required field.
        var v2 = Form("Stale", Short("name", "Name", required: true), Email("mail", "Email", required: true));
        await owner.SaveDraftAsync(id, v2);
        Assert.Equal(HttpStatusCode.OK, (await owner.PublishAsync(id)).StatusCode);

        using var anon = new Session(factory);
        var stale = await anon.SubmitAsync(publicId, 1, new { name = "Ann", city = "Oslo" });
        Assert.Equal(HttpStatusCode.Created, stale.StatusCode);

        var invalidV1 = await anon.SubmitAsync(publicId, 1, new { city = "Oslo" });
        var problem = await ProblemAssert.IsAsync(invalidV1, HttpStatusCode.BadRequest);
        Assert.False(problem.GetProperty("errors").TryGetProperty("mail", out _));

        var v2Missing = await anon.SubmitAsync(publicId, 2, new { name = "Bob" });
        await ProblemAssert.ValidationAsync(v2Missing, "mail", "Enter an email address.");

        var page = await owner.GetJsonAsync($"/api/forms/{id}/responses");
        var item = Assert.Single(page.GetProperty("items").EnumerateArray());
        Assert.Equal(1, item.GetProperty("version").GetInt32());
        Assert.Equal("Oslo", item.GetProperty("answers").GetProperty("city").GetString());
    }

    [Fact]
    public async Task Unknown_version_is_409_and_closed_is_409()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(factory);

        var unknown = await ProblemAssert.IsAsync(await anon.SubmitAsync(publicId, 7, new { name = "Ann" }), HttpStatusCode.Conflict, "Form version not available");
        Assert.Equal("This form was updated. Reload the page to see the latest version.", unknown.GetProperty("detail").GetString());
        var noVersion = await anon.Client.PostAsJsonAsync($"/api/public/forms/{publicId}/responses", new { answers = new { name = "A" } }, Ct);
        await ProblemAssert.IsAsync(noVersion, HttpStatusCode.Conflict, "Form version not available");

        await owner.Client.PostAsync($"/api/forms/{id}/close", null, Ct);
        await ProblemAssert.IsAsync(await anon.SubmitAsync(publicId, 1, new { name = "Ann" }), HttpStatusCode.Conflict, "Form closed");
        var closedView = await anon.GetJsonAsync($"/api/public/forms/{publicId}");
        Assert.Equal("closed", closedView.GetProperty("status").GetString());
        Assert.Equal("Contact", closedView.GetProperty("title").GetString());
        Assert.Equal("cobalt", closedView.GetProperty("accent").GetString());
        Assert.False(closedView.TryGetProperty("schema", out _));
        Assert.Equal(0, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Honeypot_submission_pretends_success_but_stores_nothing()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(factory);
        var r = await anon.SubmitAsync(publicId, 1, new { name = "Bot" }, website: "http://spam.example");
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        Assert.Equal(0, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Concurrent_submissions_get_distinct_numbers()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(factory);
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(i => anon.SubmitAsync(publicId, 1, new { name = "P" + i })));
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        var numbers = new List<int>();
        foreach (var r in results) numbers.Add((await r.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("number").GetInt32());
        Assert.Equal(Enumerable.Range(1, 20), numbers.Order());
        Assert.Equal(20, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Response_keeps_its_version_schema_after_field_removed()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var v1 = Form("Bound", Short("name", "Name"), Short("pet", "Pet name"));
        var (id, publicId) = await owner.CreatePublishedAsync(v1);
        using var anon = new Session(factory);
        await anon.SubmitAsync(publicId, 1, new { name = "Ann", pet = "Rex" });

        await owner.SaveDraftAsync(id, Form("Bound", Short("name", "Full name")));
        await owner.PublishAsync(id);
        await anon.SubmitAsync(publicId, 2, new { name = "Bob" });

        var page = await owner.GetJsonAsync($"/api/forms/{id}/responses");
        var oldId = page.GetProperty("items")[1].GetProperty("id").GetString();
        var old = await owner.GetJsonAsync($"/api/forms/{id}/responses/{oldId}");
        Assert.Equal(1, old.GetProperty("version").GetInt32());
        Assert.Equal(["name", "pet"], old.GetProperty("schema").GetProperty("blocks").EnumerateArray().Select(b => b.GetProperty("id").GetString()));
        Assert.Equal("Pet name", old.GetProperty("schema").GetProperty("blocks")[1].GetProperty("label").GetString());
        Assert.Equal("Rex", old.GetProperty("answers").GetProperty("pet").GetString());
        Assert.Equal(2, old.GetProperty("index").GetInt32());
        Assert.Equal(2, old.GetProperty("total").GetInt32());
        Assert.Equal(page.GetProperty("items")[0].GetProperty("id").GetString(), old.GetProperty("prevId").GetString());
        Assert.Equal(JsonValueKind.Null, old.GetProperty("nextId").ValueKind);

        Assert.Equal(2, old.GetProperty("removedIn").GetProperty("pet").GetInt32());
        Assert.False(old.GetProperty("removedIn").TryGetProperty("name", out _));
        var current = await owner.GetJsonAsync($"/api/forms/{id}/responses/{page.GetProperty("items")[0].GetProperty("id").GetString()}");
        Assert.Empty(current.GetProperty("removedIn").EnumerateObject());
        Assert.False(old.GetProperty("schema").TryGetProperty("inputBlocks", out _));

        var detail = await owner.GetJsonAsync($"/api/forms/{id}");
        Assert.Equal([1, 1], detail.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("responseCount").GetInt32()));
        Assert.Equal(2, detail.GetProperty("responseCount").GetInt32());
    }

    [Fact]
    public async Task Responses_paging_and_delete()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(factory);
        for (var i = 1; i <= 5; i++) await anon.SubmitAsync(publicId, 1, new { name = "P" + i });

        var page2 = await owner.GetJsonAsync($"/api/forms/{id}/responses?page=2&pageSize=2");
        Assert.Equal(5, page2.GetProperty("total").GetInt32());
        Assert.Equal(2, page2.GetProperty("page").GetInt32());
        Assert.Equal([3, 2], page2.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("number").GetInt32()));
        await ProblemAssert.IsAsync(await owner.Client.GetAsync($"/api/forms/{id}/responses?pageSize=101", Ct), HttpStatusCode.BadRequest);
        await ProblemAssert.IsAsync(await owner.Client.GetAsync($"/api/forms/{id}/responses?page=0", Ct), HttpStatusCode.BadRequest);

        var rid = page2.GetProperty("items")[0].GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/forms/{id}/responses/{rid}", Ct)).StatusCode);
        await ProblemAssert.IsAsync(await owner.Client.GetAsync($"/api/forms/{id}/responses/{rid}", Ct), HttpStatusCode.NotFound);
        await ProblemAssert.IsAsync(await owner.Client.DeleteAsync($"/api/forms/{id}/responses/{rid}", Ct), HttpStatusCode.NotFound);
        Assert.Equal(4, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());

        // Numbers are never reused.
        var next = await anon.SubmitAsync(publicId, 1, new { name = "P6" });
        Assert.Equal(6, (await next.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("number").GetInt32());
    }

    [Fact]
    public async Task Catastrophic_patterns_are_rejected_and_allowed_patterns_run_fast()
    {
        Assert.Equal(SafePattern.ErrNested, SafePattern.Check("(a+)+$"));
        Assert.NotNull(SafePattern.Check("(a|aa)*b\\1"));

        using var owner = await Session.SignedUpAsync(factory);
        var (_, publicId) = await owner.CreatePublishedAsync(Form("Fast", Short("code", "Code", pattern: "^(a|aa)*b$")));
        using var anon = new Session(factory);
        var adversarial = new string('a', 999) + "!";

        var sw = Stopwatch.StartNew();
        var r = await anon.SubmitAsync(publicId, 1, new { code = adversarial });
        sw.Stop();
        await ProblemAssert.ValidationAsync(r, "code", "Enter an answer in the expected format.");
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(2), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task Unsafe_pattern_saved_in_draft_is_never_executed()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var id = (await owner.CreateFormAsync()).GetProperty("id").GetString()!;
        // Saving and reading back a draft with a catastrophic pattern must not evaluate it.
        var sw = Stopwatch.StartNew();
        Assert.Equal(HttpStatusCode.OK, (await owner.SaveDraftAsync(id, Form("Evil", Short("x", "X", pattern: "^(a+)+$")))).StatusCode);
        var detail = await owner.GetJsonAsync($"/api/forms/{id}");
        sw.Stop();
        Assert.Equal("Fix 1 issue to publish.", detail.GetProperty("publishBlocker").GetString());
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(2));

        // Even if such a pattern ended up in a version, answer validation skips it instead of running it.
        var block = Short("x", "X", pattern: "^(a+)+$");
        var (error, _) = FormRules.ValidateAnswer(block, JsonSerializer.SerializeToElement(new string('a', 900) + "!"), "2026-01-01");
        Assert.Null(error);
    }

    [Fact]
    public async Task Nul_characters_in_answers_do_not_break_storage()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(factory);
        Assert.Equal(HttpStatusCode.Created, (await anon.SubmitAsync(publicId, 1, new { name = "A\0nn" })).StatusCode);
        var stored = await factory.WithDbAsync(db => db.Responses.Where(r => r.FormId == Guid.Parse(id)).Select(r => r.Answers).SingleAsync(Ct));
        Assert.Contains("Ann", stored);
    }
}
