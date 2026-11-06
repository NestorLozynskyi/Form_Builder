using System.Text.Json.Serialization;
using FormBuilder.Api.Auth;
using FormBuilder.Api.Data;
using FormBuilder.Api.Forms;
using FormBuilder.Api.Infrastructure;
using FormBuilder.Api.Public;
using FormBuilder.Api.Responses;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Configuration comes from appsettings.json overridden by environment variables
// (e.g. ConnectionStrings__Default, Database__ApplyMigrationsOnStartup, RateLimits__AuthPermitLimit).
var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Connection string 'ConnectionStrings:Default' is not configured.");
}

builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));
builder.Services.AddUnifiedProblemDetails();
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never);
builder.AddAppSecurity();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    app.Logger.LogInformation("Applying EF Core migrations on startup");
    await db.Database.MigrateAsync();
}

app.UseRouting();
app.UseBodySizeLimits();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.UseCsrfProtection();

app.MapGet("/api/health", async (AppDbContext db, CancellationToken ct) =>
{
    bool dbUp;
    try
    {
        dbUp = await db.Database.CanConnectAsync(ct);
    }
    catch (Exception)
    {
        dbUp = false;
    }

    var body = new { status = dbUp ? "healthy" : "unhealthy", database = dbUp ? "up" : "down" };
    return dbUp ? Results.Ok(body) : Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable);
}).WithTags("Health");

app.MapAuthEndpoints();
app.MapFormEndpoints();
app.MapResponseEndpoints();
app.MapPublicEndpoints();

// Test-only endpoint demonstrating the 500 problem format: never mapped outside the Testing environment.
if (app.Environment.IsEnvironment("Testing") && app.Configuration.GetValue<bool>("Diagnostics:EnableErrorEndpoint"))
{
    app.MapGet("/api/diagnostics/error", IResult () =>
        throw new InvalidOperationException("Deliberate failure for diagnostics.")).WithTags("Diagnostics");
}

// Unknown /api routes -> 404 Problem Details.
app.Map("/api/{**rest}", () => Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not Found",
    detail: "The requested API endpoint does not exist."));

app.Run();

public partial class Program;
