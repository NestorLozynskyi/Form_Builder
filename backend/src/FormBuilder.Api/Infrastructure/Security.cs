using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using FormBuilder.Api.Data;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.RateLimiting;

namespace FormBuilder.Api.Infrastructure;

public sealed class RateLimitSettings
{
    public int AuthPermitLimit { get; set; } = 10;
    public int SubmitPermitLimit { get; set; } = 10;
    public int WindowSeconds { get; set; } = 60;
}

/// <summary>Marks an endpoint as exempt from the CSRF check (anonymous public submissions only).</summary>
public sealed class SkipCsrfMetadata
{
    public static readonly SkipCsrfMetadata Instance = new();
}

/// <summary>Request body limit for one endpoint (overrides the global 512 KB).</summary>
public sealed class BodySizeLimitMetadata(long bytes) : IRequestSizeLimitMetadata
{
    public long? MaxRequestBodySize { get; } = bytes;
}

public static class Security
{
    public const string AuthCookieName = "fb.auth";
    public const string AntiforgeryCookieName = "fb.antiforgery";
    public const string XsrfCookieName = "XSRF-TOKEN";
    public const string XsrfHeaderName = "X-XSRF-TOKEN";

    public const string AuthPolicy = "auth";
    public const string SubmitPolicy = "submit";

    public const long MaxRequestBodyBytes = 512 * 1024;
    public const long PublicSubmissionBodyBytes = 64 * 1024;

    public static WebApplicationBuilder AddAppSecurity(this WebApplicationBuilder builder)
    {
        var services = builder.Services;

        builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = MaxRequestBodyBytes);

        // Key ring in PostgreSQL so cookies stay valid across restarts / container re-creation.
        services.AddDataProtection().SetApplicationName("FormBuilder").PersistKeysToDbContext<AppDbContext>();

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
        {
            o.Cookie.Name = AuthCookieName;
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Lax;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            o.ExpireTimeSpan = TimeSpan.FromDays(14);
            o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = ctx =>
                Problems.WriteAsync(ctx.HttpContext, StatusCodes.Status401Unauthorized, "Unauthorized",
                    "Sign in to continue.");
            // A cookie whose account no longer exists (e.g. database reset) is rejected instead of failing later.
            o.Events.OnValidatePrincipal = async ctx =>
            {
                var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                if (!Guid.TryParse(id, out var uid) ||
                    !await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.AnyAsync(db.Users, u => u.Id == uid, ctx.HttpContext.RequestAborted))
                {
                    ctx.RejectPrincipal();
                    await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                }
            };
            o.Events.OnRedirectToAccessDenied = ctx =>
                Problems.WriteAsync(ctx.HttpContext, StatusCodes.Status403Forbidden, "Forbidden");
        });
        services.AddAuthorization();

        services.AddAntiforgery(o =>
        {
            o.HeaderName = XsrfHeaderName;
            o.Cookie.Name = AntiforgeryCookieName;
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        });

        // Caddy (or any reverse proxy) on loopback / private networks is trusted for X-Forwarded-For/Proto.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.KnownIPNetworks.Clear();
            o.KnownProxies.Clear();
            foreach (var cidr in new[]
                     {
                         "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7",
                         "::ffff:127.0.0.0/104", "::ffff:10.0.0.0/104", "::ffff:172.16.0.0/108", "::ffff:192.168.0.0/112",
                     })
            {
                o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(cidr));
            }
        });

        services.Configure<RateLimitSettings>(builder.Configuration.GetSection("RateLimits"));
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(AuthPolicy, ctx =>
            {
                var s = Settings(ctx);
                return RateLimitPartition.GetFixedWindowLimiter("auth|" + ClientIp(ctx), _ => Window(s.AuthPermitLimit, s));
            });
            o.AddPolicy(SubmitPolicy, ctx =>
            {
                var s = Settings(ctx);
                var publicId = ctx.Request.RouteValues["publicId"] as string ?? "";
                return RateLimitPartition.GetFixedWindowLimiter($"submit|{ClientIp(ctx)}|{publicId}",
                    _ => Window(s.SubmitPermitLimit, s));
            });
            o.OnRejected = async (ctx, _) =>
            {
                var seconds = ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry)
                    ? Math.Max(1, (int)Math.Ceiling(retry.TotalSeconds))
                    : Settings(ctx.HttpContext).WindowSeconds;
                ctx.HttpContext.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
                await Problems.WriteAsync(ctx.HttpContext, StatusCodes.Status429TooManyRequests, "Too many requests",
                    $"Too many requests. Try again in {seconds} seconds.");
            };
        });

        return builder;
    }

    private static RateLimitSettings Settings(HttpContext ctx) =>
        ctx.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptions<RateLimitSettings>>().Value;

    private static FixedWindowRateLimiterOptions Window(int permits, RateLimitSettings s) => new()
    {
        PermitLimit = Math.Max(1, permits),
        Window = TimeSpan.FromSeconds(Math.Max(1, s.WindowSeconds)),
        QueueLimit = 0,
        AutoReplenishment = true,
    };

    private static string ClientIp(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress;
        if (ip is null) return "unknown";
        return (ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip).ToString();
    }

    /// <summary>
    /// Rejects bodies over the endpoint limit with a 413 problem (Content-Length check) and lowers the server limit
    /// for streamed bodies.
    /// </summary>
    public static IApplicationBuilder UseBodySizeLimits(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var limit = ctx.GetEndpoint()?.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize
                    ?? MaxRequestBodyBytes;
        var feature = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
        {
            feature.MaxRequestBodySize = limit;
        }

        if (ctx.Request.ContentLength > limit)
        {
            await Problems.WriteAsync(ctx, StatusCodes.Status413PayloadTooLarge, "Request too large",
                $"The request body must be at most {limit / 1024} KB.");
            return;
        }

        await next();
    });

    /// <summary>
    /// Double-submit CSRF check for every mutating /api request (header X-XSRF-TOKEN vs antiforgery cookie, bound to
    /// the current user). Runs after authorization so unauthenticated calls get 401 first.
    /// </summary>
    public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var method = ctx.Request.Method;
        var mutating = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) ||
                         HttpMethods.IsTrace(method));
        if (mutating && ctx.Request.Path.StartsWithSegments("/api") &&
            ctx.GetEndpoint()?.Metadata.GetMetadata<SkipCsrfMetadata>() is null)
        {
            var antiforgery = ctx.RequestServices.GetRequiredService<IAntiforgery>();
            try
            {
                await antiforgery.ValidateRequestAsync(ctx);
            }
            catch (AntiforgeryValidationException)
            {
                await Problems.WriteAsync(ctx, StatusCodes.Status400BadRequest, "Invalid CSRF token",
                    "Reload the page and try again.");
                return;
            }
        }

        await next();
    });

    /// <summary>Issues a fresh antiforgery token pair for <paramref name="user"/> and exposes it in XSRF-TOKEN.</summary>
    public static void IssueXsrfToken(HttpContext ctx, ClaimsPrincipal? user = null)
    {
        if (user is not null)
        {
            // Tokens are bound to the identity: the new token must be generated for the new principal.
            ctx.User = user;
        }

        var tokens = ctx.RequestServices.GetRequiredService<IAntiforgery>().GetAndStoreTokens(ctx);
        ctx.Response.Cookies.Append(XsrfCookieName, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = ctx.Request.IsHttps,
            Path = "/",
        });
    }

    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("No user id."));
}
