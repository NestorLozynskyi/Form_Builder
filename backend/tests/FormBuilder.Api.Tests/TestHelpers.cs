using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FormBuilder.Api.Forms.Schema;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FormBuilder.Api.Tests;

/// <summary>
/// Behaves like a browser + Angular's HttpClient: keeps cookies and echoes the XSRF-TOKEN cookie in X-XSRF-TOKEN on
/// mutating requests (unless <see cref="SendXsrf"/> is false).
/// </summary>
public sealed class BrowserHandler : DelegatingHandler
{
    public CookieContainer Cookies { get; } = new();
    public bool SendXsrf { get; set; } = true;
    public string? XsrfOverride { get; set; }
    public string? ForwardedFor { get; set; }

    public string? Cookie(string name) =>
        Cookies.GetCookies(new Uri("http://localhost/")).FirstOrDefault(c => c.Name == name)?.Value;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var uri = request.RequestUri!;
        var header = Cookies.GetCookieHeader(uri);
        if (header.Length > 0) request.Headers.Add("Cookie", header);
        if (ForwardedFor is not null) request.Headers.Add("X-Forwarded-For", ForwardedFor);
        if (request.Method != HttpMethod.Get && SendXsrf && (XsrfOverride ?? Cookie("XSRF-TOKEN")) is { } token)
        {
            request.Headers.Add("X-XSRF-TOKEN", token);
        }

        var response = await base.SendAsync(request, ct);
        if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
        {
            foreach (var c in setCookies) Cookies.SetCookies(uri, c);
        }

        return response;
    }
}

/// <summary>One "browser" talking to the API.</summary>
public sealed class Session : IDisposable
{
    public static int Counter;

    public HttpClient Client { get; }
    public BrowserHandler Handler { get; } = new();
    public string? Email { get; private set; }

    public static CancellationToken Ct => TestContext.Current.CancellationToken;

    public Session(WebApplicationFactory<Program> factory)
    {
        Client = factory.CreateDefaultClient(Handler);
    }

    public static string UniqueEmail(string prefix = "user") =>
        $"{prefix}-{Interlocked.Increment(ref Counter)}-{Guid.NewGuid():N}@example.com";

    /// <summary>Loads the session (gets an anonymous XSRF token) and signs up a fresh account.</summary>
    public static async Task<Session> SignedUpAsync(WebApplicationFactory<Program> factory)
    {
        var s = new Session(factory);
        await s.InitAsync();
        var email = UniqueEmail();
        var r = await s.Client.PostAsJsonAsync("/api/auth/sign-up", new { email, password = "correct horse" }, Ct);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        s.Email = email;
        return s;
    }

    public async Task InitAsync()
    {
        var r = await Client.GetAsync("/api/auth/session", Ct);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    public async Task<JsonElement> CreateFormAsync()
    {
        var r = await Client.PostAsync("/api/forms", null, Ct);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    public Task<HttpResponseMessage> SaveDraftAsync(string formId, FormSchema schema) =>
        Client.PutAsJsonAsync($"/api/forms/{formId}/draft", schema, FormSchema.Json, Ct);

    public Task<HttpResponseMessage> PublishAsync(string formId) => Client.PostAsync($"/api/forms/{formId}/publish", null, Ct);

    /// <summary>Creates a form with <paramref name="schema"/>, publishes it and returns (id, publicId).</summary>
    public async Task<(string Id, string PublicId)> CreatePublishedAsync(FormSchema schema)
    {
        var id = (await CreateFormAsync()).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await SaveDraftAsync(id, schema)).StatusCode);
        var published = await PublishAsync(id);
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        var body = await published.Content.ReadFromJsonAsync<JsonElement>(Ct);
        return (id, body.GetProperty("publicId").GetString()!);
    }

    public async Task<JsonElement> GetJsonAsync(string url)
    {
        var r = await Client.GetAsync(url, Ct);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    public Task<HttpResponseMessage> SubmitAsync(string publicId, int version, object answers, string website = "") =>
        Client.PostAsJsonAsync($"/api/public/forms/{publicId}/responses", new { version, answers, website }, Ct);

    public void Dispose() => Client.Dispose();
}

public static class Schemas
{
    public static Block Short(string id, string label, bool required = false, string? pattern = null) =>
        new() { Id = id, Type = BlockTypes.Short, Label = label, Required = required, Pattern = pattern };

    public static Block Email(string id, string label, bool required = false) =>
        new() { Id = id, Type = BlockTypes.Email, Label = label, Required = required };

    public static Block Checkbox(string id, string label, params string[] options) =>
        new() { Id = id, Type = BlockTypes.Checkbox, Label = label, Options = [.. options] };

    public static Block Heading(string id, string text) => new() { Id = id, Type = BlockTypes.Heading, Text = text };

    public static FormSchema Form(string title, params Block[] blocks) => new() { Title = title, Blocks = [.. blocks] };

    public static FormSchema Contact(string title = "Contact") =>
        Form(title, Heading("h1", "Hello"), Short("name", "Your name", required: true), Email("mail", "Email"));
}

public static class ProblemAssert
{
    public static async Task<JsonElement> IsAsync(HttpResponseMessage response, HttpStatusCode status, string? title = null)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Session.Ct);
        Assert.Equal((int)status, problem.GetProperty("status").GetInt32());
        Assert.True(problem.TryGetProperty("traceId", out _));
        if (title is not null) Assert.Equal(title, problem.GetProperty("title").GetString());
        return problem;
    }

    public static async Task<JsonElement> ValidationAsync(HttpResponseMessage response, string key, string message)
    {
        var problem = await IsAsync(response, HttpStatusCode.BadRequest);
        Assert.Equal([message], problem.GetProperty("errors").GetProperty(key).EnumerateArray().Select(e => e.GetString()));
        return problem;
    }
}
