using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace FormBuilder.Api.Tests;

public sealed class AuthTests(ApiFactory factory)
{
    private static CancellationToken Ct => Session.Ct;

    [Fact]
    public async Task Anonymous_session_returns_null_user_and_readable_xsrf_cookie()
    {
        using var s = new Session(factory);
        var r = await s.Client.GetAsync("/api/auth/session", Ct);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("user").ValueKind);

        var setCookies = r.Headers.GetValues("Set-Cookie").ToList();
        var xsrf = Assert.Single(setCookies, c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
        Assert.DoesNotContain("httponly", xsrf, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(setCookies, c => c.StartsWith("fb.antiforgery=", StringComparison.Ordinal) &&
                                         c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Sign_up_signs_in_with_normalised_email_and_httponly_auth_cookie()
    {
        using var s = new Session(factory);
        await s.InitAsync();
        var email = Session.UniqueEmail("Mixed");
        var r = await s.Client.PostAsJsonAsync("/api/auth/sign-up", new { email = "  " + email.ToUpperInvariant() + " ", password = "password123" }, Ct);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(email.ToLowerInvariant(), body.GetProperty("user").GetProperty("email").GetString());
        var auth = Assert.Single(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith("fb.auth=", StringComparison.Ordinal));
        Assert.Contains("httponly", auth, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", auth, StringComparison.OrdinalIgnoreCase);

        var session = await s.GetJsonAsync("/api/auth/session");
        Assert.Equal(email.ToLowerInvariant(), session.GetProperty("user").GetProperty("email").GetString());
    }

    [Theory]
    [InlineData("", "password123", "email", "Enter your email address.")]
    [InlineData("   ", "password123", "email", "Enter your email address.")]
    [InlineData("name@", "password123", "email", "This email address is incomplete. Use the format name@example.com.")]
    [InlineData("name.example.com", "password123", "email", "This email address is incomplete. Use the format name@example.com.")]
    [InlineData("ok@example.com", "", "password", "Create a password with at least 8 characters.")]
    [InlineData("ok@example.com", "abcde", "password", "Password is too short (5 of 8 characters). Add 3 more characters.")]
    [InlineData("ok@example.com", "abcdefg", "password", "Password is too short (7 of 8 characters). Add 1 more character.")]
    public async Task Sign_up_validation_messages(string email, string password, string key, string message)
    {
        using var s = new Session(factory);
        await s.InitAsync();
        var r = await s.Client.PostAsJsonAsync("/api/auth/sign-up", new { email, password }, Ct);
        await ProblemAssert.ValidationAsync(r, key, message);
    }

    [Fact]
    public async Task Sign_up_rejects_too_long_email_and_password()
    {
        using var s = new Session(factory);
        await s.InitAsync();
        var r = await s.Client.PostAsJsonAsync("/api/auth/sign-up",
            new { email = new string('a', 250) + "@example.com", password = new string('p', 129) }, Ct);
        var problem = await ProblemAssert.ValidationAsync(r, "password", "Use 128 characters or fewer.");
        Assert.Equal("This email address is incomplete. Use the format name@example.com.",
            problem.GetProperty("errors").GetProperty("email")[0].GetString());
    }

    [Fact]
    public async Task Sign_up_with_existing_email_is_rejected_case_insensitively()
    {
        using var first = await Session.SignedUpAsync(factory);
        using var s = new Session(factory);
        await s.InitAsync();
        var r = await s.Client.PostAsJsonAsync("/api/auth/sign-up", new { email = first.Email!.ToUpperInvariant(), password = "password123" }, Ct);
        await ProblemAssert.ValidationAsync(r, "email", "An account with this email already exists.");
    }

    [Fact]
    public async Task Sign_in_with_wrong_password_or_unknown_email_is_401()
    {
        using var account = await Session.SignedUpAsync(factory);
        using var s = new Session(factory);
        await s.InitAsync();

        var wrong = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = account.Email, password = "not the password" }, Ct);
        await ProblemAssert.IsAsync(wrong, HttpStatusCode.Unauthorized, "Email or password is incorrect.");
        var unknown = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = Session.UniqueEmail(), password = "whatever1" }, Ct);
        await ProblemAssert.IsAsync(unknown, HttpStatusCode.Unauthorized, "Email or password is incorrect.");

        var ok = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = account.Email, password = "correct horse" }, Ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(account.Email, (await ok.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("user").GetProperty("email").GetString());
        // The token issued with the sign-in response works for the new identity.
        Assert.Equal(HttpStatusCode.Created, (await s.Client.PostAsync("/api/forms", null, Ct)).StatusCode);
    }

    [Fact]
    public async Task Sign_out_ends_the_session_and_issues_anonymous_token()
    {
        using var s = await Session.SignedUpAsync(factory);
        var r = await s.Client.PostAsync("/api/auth/sign-out", null, Ct);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Contains(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));

        await ProblemAssert.IsAsync(await s.Client.GetAsync("/api/forms", Ct), HttpStatusCode.Unauthorized);
        var session = await s.GetJsonAsync("/api/auth/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);

        // The fresh anonymous token is valid for signing in again.
        var signIn = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = s.Email, password = "correct horse" }, Ct);
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/forms")]
    [InlineData("GET", "/api/forms/00000000-0000-0000-0000-000000000001")]
    [InlineData("GET", "/api/forms/00000000-0000-0000-0000-000000000001/responses")]
    [InlineData("GET", "/api/forms/00000000-0000-0000-0000-000000000001/responses/export.csv")]
    [InlineData("POST", "/api/forms")]
    [InlineData("POST", "/api/forms/00000000-0000-0000-0000-000000000001/publish")]
    [InlineData("DELETE", "/api/forms/00000000-0000-0000-0000-000000000001")]
    public async Task Unauthenticated_calls_get_401_problem_not_redirect(string method, string url)
    {
        using var s = new Session(factory);
        await s.InitAsync();
        var r = await s.Client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url), Ct);
        await ProblemAssert.IsAsync(r, HttpStatusCode.Unauthorized);
        Assert.Null(r.Headers.Location);
    }

    [Fact]
    public async Task Mutating_request_without_csrf_token_is_rejected()
    {
        using var s = await Session.SignedUpAsync(factory);
        s.Handler.SendXsrf = false;
        await ProblemAssert.IsAsync(await s.Client.PostAsync("/api/forms", null, Ct), HttpStatusCode.BadRequest, "Invalid CSRF token");

        s.Handler.SendXsrf = true;
        s.Handler.XsrfOverride = "bogus";
        await ProblemAssert.IsAsync(await s.Client.PostAsync("/api/forms", null, Ct), HttpStatusCode.BadRequest, "Invalid CSRF token");

        // Sign-in / sign-up are protected as well.
        using var anon = new Session(factory);
        await anon.InitAsync();
        anon.Handler.SendXsrf = false;
        var signUp = await anon.Client.PostAsJsonAsync("/api/auth/sign-up", new { email = Session.UniqueEmail(), password = "password123" }, Ct);
        await ProblemAssert.IsAsync(signUp, HttpStatusCode.BadRequest, "Invalid CSRF token");
    }

    [Fact]
    public async Task Token_issued_for_anonymous_user_is_not_valid_after_sign_in()
    {
        using var account = await Session.SignedUpAsync(factory);
        using var s = new Session(factory);
        await s.InitAsync();
        var anonymousToken = s.Handler.Cookie("XSRF-TOKEN");
        var signIn = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = account.Email, password = "correct horse" }, Ct);
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        Assert.NotEqual(anonymousToken, s.Handler.Cookie("XSRF-TOKEN"));

        s.Handler.XsrfOverride = anonymousToken;
        await ProblemAssert.IsAsync(await s.Client.PostAsync("/api/forms", null, Ct), HttpStatusCode.BadRequest, "Invalid CSRF token");
    }

    [Fact]
    public async Task Cookie_of_a_deleted_account_is_rejected_instead_of_failing()
    {
        using var s = await Session.SignedUpAsync(factory);
        await factory.WithDbAsync(db => db.Users.Where(u => u.Email == s.Email!.ToLowerInvariant()).ExecuteDeleteAsync(Session.Ct));
        var me = await s.GetJsonAsync("/api/auth/session");
        Assert.Equal(System.Text.Json.JsonValueKind.Null, me.GetProperty("user").ValueKind);
        await ProblemAssert.IsAsync(await s.Client.PostAsync("/api/forms", null, Session.Ct), HttpStatusCode.Unauthorized);
    }
}
