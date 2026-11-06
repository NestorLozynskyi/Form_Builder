using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;

namespace FormBuilder.Api.Tests;

public sealed class InfrastructureTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    [Fact]
    public async Task Health_reports_database_up()
    {
        using var s = new Session(factory);
        var body = await s.GetJsonAsync("/api/health");
        Assert.Equal("healthy", body.GetProperty("status").GetString());
        Assert.Equal("up", body.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Unknown_api_route_is_404_problem()
    {
        using var s = new Session(factory);
        await ProblemAssert.IsAsync(await s.Client.GetAsync("/api/does-not-exist", Ct), HttpStatusCode.NotFound, "Not Found");
    }

    [Fact]
    public async Task Unhandled_exception_returns_500_problem_without_details()
    {
        // The diagnostics endpoint only exists in the Testing environment with Diagnostics:EnableErrorEndpoint=true.
        using var s = new Session(factory);
        var response = await s.Client.GetAsync("/api/diagnostics/error", Ct);
        var raw = await response.Content.ReadAsStringAsync(Ct);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.DoesNotContain("Deliberate failure", raw);
        Assert.True(JsonDocument.Parse(raw).RootElement.TryGetProperty("traceId", out _));
    }

    [Fact]
    public async Task Malformed_json_is_400_problem()
    {
        using var s = await Session.SignedUpAsync(factory);
        var id = (await s.CreateFormAsync()).GetProperty("id").GetString();
        using var content = new StringContent("{ not json", Encoding.UTF8, "application/json");
        await ProblemAssert.IsAsync(await s.Client.PutAsync($"/api/forms/{id}/draft", content, Ct), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Oversized_bodies_are_rejected_with_413()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (id, publicId) = await owner.CreatePublishedAsync(Schemas.Contact());

        using var bigBody = new StringContent("{\"version\":1,\"answers\":{\"name\":\"" + new string('x', 70 * 1024) + "\"}}", Encoding.UTF8, "application/json");
        var big = await owner.Client.PostAsync($"/api/public/forms/{publicId}/responses", bigBody, Ct);
        await ProblemAssert.IsAsync(big, HttpStatusCode.RequestEntityTooLarge);

        using var huge = new StringContent("{\"title\":\"" + new string('x', 600 * 1024) + "\"}", Encoding.UTF8, "application/json");
        await ProblemAssert.IsAsync(await owner.Client.PutAsync($"/api/forms/{id}/draft", huge, Ct), HttpStatusCode.RequestEntityTooLarge);

        Assert.Equal(0, (await owner.GetJsonAsync($"/api/forms/{id}/responses")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Diagnostics_endpoint_is_not_mapped_outside_testing()
    {
        using var prod = factory.WithWebHostBuilder(b => b.UseEnvironment("Production"));
        using var client = prod.CreateClient();
        var r = await client.GetAsync("/api/diagnostics/error", Ct);
        await ProblemAssert.IsAsync(r, HttpStatusCode.NotFound);
    }
}
