using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FormBuilder.Api.Forms.Schema;
using static FormBuilder.Api.Tests.Schemas;

namespace FormBuilder.Api.Tests;

/// <summary>Account B must not see or touch anything of account A; every attempt looks like a missing resource.</summary>
public sealed class IsolationTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    [Fact]
    public async Task Other_account_gets_404_everywhere_and_nothing_changes()
    {
        using var owner = await Session.SignedUpAsync(factory);
        using var other = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Contact("Private"));
        Assert.Equal(HttpStatusCode.Created, (await owner.SubmitAsync(publicId, 1, new { name = "Ann" })).StatusCode);
        var responseId = (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("items")[0].GetProperty("id").GetString();
        await owner.SaveDraftAsync(id, Contact("Private v2"));

        var missing = await ProblemAssert.IsAsync(await other.Client.GetAsync($"/api/forms/{Guid.NewGuid()}", Ct), HttpStatusCode.NotFound);

        var attempts = new Func<Task<HttpResponseMessage>>[]
        {
            () => other.Client.GetAsync($"/api/forms/{id}", Ct),
            () => other.SaveDraftAsync(id, Form("Hacked", Short("x", "X"))),
            () => other.PublishAsync(id),
            () => other.Client.PostAsync($"/api/forms/{id}/close", null, Ct),
            () => other.Client.PostAsync($"/api/forms/{id}/reopen", null, Ct),
            () => other.Client.GetAsync($"/api/forms/{id}/responses", Ct),
            () => other.Client.GetAsync($"/api/forms/{id}/responses/{responseId}", Ct),
            () => other.Client.DeleteAsync($"/api/forms/{id}/responses/{responseId}", Ct),
            () => other.Client.GetAsync($"/api/forms/{id}/responses/export.csv", Ct),
            () => other.Client.DeleteAsync($"/api/forms/{id}", Ct),
        };
        foreach (var attempt in attempts)
        {
            var problem = await ProblemAssert.IsAsync(await attempt(), HttpStatusCode.NotFound);
            Assert.Equal(missing.GetProperty("title").GetString(), problem.GetProperty("title").GetString());
            Assert.Equal(missing.GetProperty("detail").GetString(), problem.GetProperty("detail").GetString());
        }

        // Invalid body against a foreign form is still a 404 (no information leak through validation).
        var invalid = Form("Bad", Short("a", "A"), Short("a", "B"));
        await ProblemAssert.IsAsync(await other.SaveDraftAsync(id, invalid), HttpStatusCode.NotFound);

        Assert.Empty((await other.GetJsonAsync("/api/forms")).EnumerateArray());

        var detail = await owner.GetJsonAsync($"/api/forms/{id}");
        Assert.Equal("Private v2", detail.GetProperty("draft").GetProperty("title").GetString());
        Assert.Equal("published", detail.GetProperty("status").GetString());
        Assert.Equal(1, detail.GetProperty("liveVersion").GetInt32());
        Assert.Equal(1, detail.GetProperty("responseCount").GetInt32());
        Assert.Single((await owner.GetJsonAsync("/api/forms")).EnumerateArray());
    }

    [Fact]
    public async Task Response_of_another_form_is_not_reachable_through_own_form()
    {
        using var a = await Session.SignedUpAsync(factory);
        using var b = await Session.SignedUpAsync(factory);
        var (aId, aPublic) = await a.CreatePublishedAsync(Contact());
        var (bId, _) = await b.CreatePublishedAsync(Contact());
        await a.SubmitAsync(aPublic, 1, new { name = "Ann" });
        var aResponse = (await a.GetJsonAsync($"/api/forms/{aId}/responses")).GetProperty("items")[0].GetProperty("id").GetString();

        await ProblemAssert.IsAsync(await b.Client.GetAsync($"/api/forms/{bId}/responses/{aResponse}", Ct), HttpStatusCode.NotFound);
        await ProblemAssert.IsAsync(await b.Client.DeleteAsync($"/api/forms/{bId}/responses/{aResponse}", Ct), HttpStatusCode.NotFound);
        var page = await a.GetJsonAsync($"/api/forms/{aId}/responses");
        Assert.Equal(1, page.GetProperty("total").GetInt32());
    }
}
