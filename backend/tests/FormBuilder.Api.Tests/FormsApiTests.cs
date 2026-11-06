using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FormBuilder.Api.Forms.Schema;
using Microsoft.EntityFrameworkCore;
using static FormBuilder.Api.Tests.Schemas;

namespace FormBuilder.Api.Tests;

public sealed class FormsApiTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    [Fact]
    public async Task Create_returns_new_draft_detail()
    {
        using var s = await Session.SignedUpAsync(factory);
        var form = await s.CreateFormAsync();
        Assert.Equal("draft", form.GetProperty("status").GetString());
        Assert.Equal("Untitled form", form.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, form.GetProperty("liveVersion").ValueKind);
        Assert.Equal(JsonValueKind.Null, form.GetProperty("publicId").ValueKind);
        Assert.Equal(JsonValueKind.Null, form.GetProperty("liveSchema").ValueKind);
        Assert.False(form.GetProperty("hasUnpublishedChanges").GetBoolean());
        Assert.Equal(0, form.GetProperty("responseCount").GetInt32());
        Assert.Equal(FormRules.ErrNoInputs, form.GetProperty("publishBlocker").GetString());
        Assert.Equal(0, form.GetProperty("versions").GetArrayLength());
        Assert.Equal("Untitled form", form.GetProperty("draft").GetProperty("title").GetString());
        Assert.EndsWith("Z", form.GetProperty("updatedAt").GetString());
    }

    [Fact]
    public async Task List_filters_by_title_and_status_sorted_by_updated_desc()
    {
        using var s = await Session.SignedUpAsync(factory);
        var a = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        var b = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        await s.SaveDraftAsync(a, Contact("Customer Feedback"));
        await s.SaveDraftAsync(b, Contact("Event signup"));
        await s.PublishAsync(b);

        var all = await s.GetJsonAsync("/api/forms");
        Assert.Equal([b, a], all.EnumerateArray().Select(f => f.GetProperty("id").GetString()));

        var byTitle = await s.GetJsonAsync("/api/forms?q=FEEDBACK");
        Assert.Equal([a], byTitle.EnumerateArray().Select(f => f.GetProperty("id").GetString()));

        var published = await s.GetJsonAsync("/api/forms?status=published");
        var item = Assert.Single(published.EnumerateArray());
        Assert.Equal(b, item.GetProperty("id").GetString());
        Assert.Equal(1, item.GetProperty("liveVersion").GetInt32());
        Assert.False(item.GetProperty("hasUnpublishedChanges").GetBoolean());
        Assert.Equal(22, item.GetProperty("publicId").GetString()!.Length);

        Assert.Empty((await s.GetJsonAsync("/api/forms?q=50%25_off")).EnumerateArray());
        var bad = await s.Client.GetAsync("/api/forms?status=archived", Ct);
        await ProblemAssert.IsAsync(bad, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Draft_save_rejects_structural_errors_only()
    {
        using var s = await Session.SignedUpAsync(factory);
        var id = (await s.CreateFormAsync()).GetProperty("id").GetString()!;

        var dup = Form("Dup", Short("a", "One"), Short("a", "Two"));
        await ProblemAssert.ValidationAsync(await s.SaveDraftAsync(id, dup), "blocks[1].id", "Block id must be unique (letters, digits, - and _).");

        var tooMany = Form("Many", [.. Enumerable.Range(0, 101).Select(i => Short("b" + i, "Q"))]);
        await ProblemAssert.ValidationAsync(await s.SaveDraftAsync(id, tooMany), "blocks", "A form can have up to 100 blocks.");

        // Configuration issues (empty label) are saved and reported via publishBlocker.
        var r = await s.SaveDraftAsync(id, Form("Issues", Short("q1", "")));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var detail = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("Fix 1 issue to publish.", detail.GetProperty("publishBlocker").GetString());
        Assert.Equal("Issues", detail.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Malformed_draft_body_is_400_problem()
    {
        using var s = await Session.SignedUpAsync(factory);
        var id = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        using var content = new StringContent("{ \"blocks\": 5 }", System.Text.Encoding.UTF8, "application/json");
        var r = await s.Client.PutAsync($"/api/forms/{id}/draft", content, Ct);
        await ProblemAssert.IsAsync(r, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Unsafe_regex_in_draft_is_saved_reported_and_blocks_publish()
    {
        using var s = await Session.SignedUpAsync(factory);
        var id = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        var r = await s.SaveDraftAsync(id, Form("Regex", Short("code", "Code", pattern: "(a+)+$")));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var detail = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("(a+)+$", detail.GetProperty("draft").GetProperty("blocks")[0].GetProperty("pattern").GetString());
        Assert.Equal("Fix 1 issue to publish.", detail.GetProperty("publishBlocker").GetString());

        await ProblemAssert.ValidationAsync(await s.PublishAsync(id), "publish", "Fix 1 issue to publish.");
    }

    [Fact]
    public async Task Publish_is_blocked_without_inputs_or_with_issues()
    {
        using var s = await Session.SignedUpAsync(factory);
        var id = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        await ProblemAssert.ValidationAsync(await s.PublishAsync(id), "publish", "Add at least one input field to publish.");

        await s.SaveDraftAsync(id, Form("Headings only", Heading("h", "Title")));
        await ProblemAssert.ValidationAsync(await s.PublishAsync(id), "publish", "Add at least one input field to publish.");

        var radio = new Block { Id = "r", Type = BlockTypes.Radio, Label = "Pick", Options = ["Same", "Same"] };
        await s.SaveDraftAsync(id, Form("Issues", radio, Short("x", "")));
        await ProblemAssert.ValidationAsync(await s.PublishAsync(id), "publish", "Fix 2 issues to publish.");

        var detail = await s.GetJsonAsync($"/api/forms/{id}");
        Assert.Equal("draft", detail.GetProperty("status").GetString());
        Assert.Equal(0, detail.GetProperty("versions").GetArrayLength());
    }

    [Fact]
    public async Task Publish_creates_versions_and_nothing_to_publish_is_409()
    {
        using var s = await Session.SignedUpAsync(factory);
        var (id, publicId) = await s.CreatePublishedAsync(Contact("Survey"));

        await ProblemAssert.IsAsync(await s.PublishAsync(id), HttpStatusCode.Conflict, "Nothing to publish");

        var v2 = Contact("Survey v2");
        Assert.Equal(HttpStatusCode.OK, (await s.SaveDraftAsync(id, v2)).StatusCode);
        var detail = await s.GetJsonAsync($"/api/forms/{id}");
        Assert.True(detail.GetProperty("hasUnpublishedChanges").GetBoolean());

        var r = await s.PublishAsync(id);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var after = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(2, after.GetProperty("liveVersion").GetInt32());
        Assert.Equal(publicId, after.GetProperty("publicId").GetString());
        Assert.False(after.GetProperty("hasUnpublishedChanges").GetBoolean());
        Assert.Equal([1, 2], after.GetProperty("versions").EnumerateArray().Select(v => v.GetProperty("number").GetInt32()));
    }

    [Fact]
    public async Task Published_version_is_immutable_when_draft_changes()
    {
        using var s = await Session.SignedUpAsync(factory);
        var (id, publicId) = await s.CreatePublishedAsync(Contact("Original"));

        var edited = Form("Edited", Short("other", "Completely different"));
        Assert.Equal(HttpStatusCode.OK, (await s.SaveDraftAsync(id, edited)).StatusCode);

        var detail = await s.GetJsonAsync($"/api/forms/{id}");
        Assert.Equal("Edited", detail.GetProperty("draft").GetProperty("title").GetString());
        Assert.Equal("Original", detail.GetProperty("liveSchema").GetProperty("title").GetString());
        Assert.Equal(1, detail.GetProperty("liveVersion").GetInt32());
        Assert.True(detail.GetProperty("hasUnpublishedChanges").GetBoolean());

        var pub = await s.GetJsonAsync($"/api/public/forms/{publicId}");
        Assert.Equal("Original", pub.GetProperty("schema").GetProperty("title").GetString());
        Assert.Equal(1, pub.GetProperty("version").GetInt32());
        Assert.Equal("name", pub.GetProperty("schema").GetProperty("blocks")[1].GetProperty("id").GetString());

        // Even a direct UPDATE is refused by the database.
        var ex = await Assert.ThrowsAnyAsync<Exception>(() => factory.WithDbAsync(db =>
            db.Database.ExecuteSqlRawAsync("UPDATE form_versions SET schema = 'x' WHERE form_id = {0}", [Guid.Parse(id)], Ct)));
        Assert.Contains("immutable", ex.Message);
    }

    [Fact]
    public async Task Close_reopen_and_publish_while_closed_keeps_closed()
    {
        using var s = await Session.SignedUpAsync(factory);
        var draftId = (await s.CreateFormAsync()).GetProperty("id").GetString()!;
        await ProblemAssert.IsAsync(await s.Client.PostAsync($"/api/forms/{draftId}/close", null, Ct), HttpStatusCode.Conflict);
        await ProblemAssert.IsAsync(await s.Client.PostAsync($"/api/forms/{draftId}/reopen", null, Ct), HttpStatusCode.Conflict);

        var (id, publicId) = await s.CreatePublishedAsync(Contact("Closable"));
        var closed = await s.Client.PostAsync($"/api/forms/{id}/close", null, Ct);
        Assert.Equal(HttpStatusCode.OK, closed.StatusCode);
        Assert.Equal("closed", (await closed.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("status").GetString());

        await s.SaveDraftAsync(id, Contact("Closable v2"));
        var published = await s.PublishAsync(id);
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        var body = await published.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal("closed", body.GetProperty("status").GetString());
        Assert.Equal(2, body.GetProperty("liveVersion").GetInt32());

        var pub = await s.GetJsonAsync($"/api/public/forms/{publicId}");
        Assert.Equal("closed", pub.GetProperty("status").GetString());
        Assert.Equal("Closable v2", pub.GetProperty("title").GetString());
        Assert.False(pub.TryGetProperty("schema", out _));

        var reopened = await s.Client.PostAsync($"/api/forms/{id}/reopen", null, Ct);
        Assert.Equal("published", (await reopened.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("status").GetString());
        var open = await s.GetJsonAsync($"/api/public/forms/{publicId}");
        Assert.Equal("open", open.GetProperty("status").GetString());
        Assert.Equal(2, open.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Updated_at_changes_on_save_publish_close_reopen()
    {
        using var s = await Session.SignedUpAsync(factory);
        var created = await s.CreateFormAsync();
        var id = created.GetProperty("id").GetString()!;
        var stamps = new List<DateTime> { created.GetProperty("updatedAt").GetDateTime() };
        async Task Step(HttpResponseMessage r)
        {
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            stamps.Add((await r.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("updatedAt").GetDateTime());
        }

        await Step(await s.SaveDraftAsync(id, Contact()));
        await Step(await s.PublishAsync(id));
        await Step(await s.Client.PostAsync($"/api/forms/{id}/close", null, Ct));
        await Step(await s.Client.PostAsync($"/api/forms/{id}/reopen", null, Ct));
        for (var i = 1; i < stamps.Count; i++) Assert.True(stamps[i] > stamps[i - 1]);
    }

    [Fact]
    public async Task Delete_cascades_versions_and_responses()
    {
        using var s = await Session.SignedUpAsync(factory);
        var (id, publicId) = await s.CreatePublishedAsync(Contact());
        Assert.Equal(HttpStatusCode.Created, (await s.SubmitAsync(publicId, 1, new { name = "Ann" })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.DeleteAsync($"/api/forms/{id}", Ct)).StatusCode);
        await ProblemAssert.IsAsync(await s.Client.GetAsync($"/api/forms/{id}", Ct), HttpStatusCode.NotFound);
        await ProblemAssert.IsAsync(await s.Client.GetAsync($"/api/public/forms/{publicId}", Ct), HttpStatusCode.NotFound, "Form not available");

        var fid = Guid.Parse(id);
        var left = await factory.WithDbAsync(async db =>
            await db.FormVersions.CountAsync(v => v.FormId == fid, Ct) + await db.Responses.CountAsync(r => r.FormId == fid, Ct));
        Assert.Equal(0, left);
    }

    [Fact]
    public async Task Malformed_and_missing_ids_return_the_same_404()
    {
        using var s = await Session.SignedUpAsync(factory);
        var missing = await ProblemAssert.IsAsync(await s.Client.GetAsync($"/api/forms/{Guid.NewGuid()}", Ct), HttpStatusCode.NotFound);
        var malformed = await ProblemAssert.IsAsync(await s.Client.GetAsync("/api/forms/not-a-guid", Ct), HttpStatusCode.NotFound);
        Assert.Equal(missing.GetProperty("title").GetString(), malformed.GetProperty("title").GetString());
        Assert.Equal(missing.GetProperty("detail").GetString(), malformed.GetProperty("detail").GetString());
    }
}
