using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using static FormBuilder.Api.Tests.Schemas;

namespace FormBuilder.Api.Tests;

/// <summary>
/// Runs against a second in-process host (same database) with low limits. The test server has no client IP, so a
/// startup filter makes every request come from a private-network "proxy" (like Caddy); X-Forwarded-For then decides
/// the client IP, which also verifies the ForwardedHeaders trust configuration.
/// </summary>
public sealed class RateLimitTests(ApiFactory factory) : IDisposable
{
    private const int Limit = 3;
    private static CancellationToken Ct => Session.Ct;

    private readonly WebApplicationFactory<Program> _limited = factory.WithWebHostBuilder(b =>
    {
        b.UseSetting("RateLimits:AuthPermitLimit", Limit.ToString(System.Globalization.CultureInfo.InvariantCulture));
        b.UseSetting("RateLimits:SubmitPermitLimit", Limit.ToString(System.Globalization.CultureInfo.InvariantCulture));
        b.UseSetting("RateLimits:WindowSeconds", "60");
        b.ConfigureServices(s => s.AddSingleton<IStartupFilter, ProxyIpStartupFilter>());
    });

    public void Dispose() => _limited.Dispose();

    private static string RandomIp() => $"203.0.113.{Random.Shared.Next(1, 255)}";

    private sealed class ProxyIpStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((ctx, nxt) =>
            {
                ctx.Connection.RemoteIpAddress = IPAddress.Parse("172.18.0.5");
                return nxt();
            });
            next(app);
        };
    }

    [Fact]
    public async Task Auth_endpoints_are_limited_per_client_ip_with_retry_after()
    {
        using var s = new Session(_limited);
        s.Handler.ForwardedFor = $"198.51.100.{Random.Shared.Next(1, 255)}";
        await s.InitAsync();
        for (var i = 0; i < Limit; i++)
        {
            var r = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = "nobody@example.com", password = "wrong-pass" }, Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        }

        var limited = await s.Client.PostAsJsonAsync("/api/auth/sign-up", new { email = Session.UniqueEmail(), password = "password123" }, Ct);
        await ProblemAssert.IsAsync(limited, HttpStatusCode.TooManyRequests, "Too many requests");
        var retryAfter = int.Parse(limited.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(retryAfter, 1, 60);

        // Another client behind the same proxy has its own budget.
        s.Handler.ForwardedFor = "198.51.100.254, " + RandomIp().Replace("203.0.113", "192.0.2", StringComparison.Ordinal);
        var other = await s.Client.PostAsJsonAsync("/api/auth/sign-in", new { email = "nobody@example.com", password = "wrong-pass" }, Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, other.StatusCode);
    }

    [Fact]
    public async Task Public_submissions_are_limited_with_retry_after()
    {
        using var owner = await Session.SignedUpAsync(factory);
        var (_, publicId) = await owner.CreatePublishedAsync(Contact());
        using var anon = new Session(_limited);
        anon.Handler.ForwardedFor = RandomIp();
        for (var i = 0; i < Limit; i++)
        {
            Assert.Equal(HttpStatusCode.Created, (await anon.SubmitAsync(publicId, 1, new { name = "P" + i })).StatusCode);
        }

        var limited = await anon.SubmitAsync(publicId, 1, new { name = "Too many" });
        await ProblemAssert.IsAsync(limited, HttpStatusCode.TooManyRequests, "Too many requests");
        Assert.True(limited.Headers.Contains("Retry-After"));

        // Another form has its own budget (partition = IP + publicId).
        var (_, otherPublicId) = await owner.CreatePublishedAsync(Contact());
        Assert.Equal(HttpStatusCode.Created, (await anon.SubmitAsync(otherPublicId, 1, new { name = "Ok" })).StatusCode);
    }
}
