using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using FormBuilder.Api.Data;
using FormBuilder.Api.Forms.Schema;
using FormBuilder.Api.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace FormBuilder.Api.Public;

public sealed record PublicOpenFormDto(string PublicId, int Version, string Status, FormSchema Schema);

public sealed record PublicClosedFormDto(string PublicId, string Status, string Title, string Accent);

public sealed record SubmitRequest(int? Version, Dictionary<string, JsonElement>? Answers, string? Website);

public sealed record SubmitResultDto(int Number);

public static partial class PublicEndpoints
{
    public const string ErrNotAvailable = "Form not available";

    [GeneratedRegex("^[A-Za-z0-9_-]{22}$")]
    private static partial Regex PublicIdRegex();

    public static IEndpointRouteBuilder MapPublicEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/public/forms").WithTags("Public").AllowAnonymous();
        group.MapGet("/{publicId}", GetAsync);
        group.MapPost("/{publicId}/responses", SubmitAsync)
            .WithMetadata(SkipCsrfMetadata.Instance)
            .WithMetadata(new BodySizeLimitMetadata(Security.PublicSubmissionBodyBytes))
            .RequireRateLimiting(Security.SubmitPolicy);
        return app;
    }

    private static ProblemHttpResult NotAvailable() =>
        Problems.Result(StatusCodes.Status404NotFound, ErrNotAvailable, "This form doesn’t exist or isn’t published.");

    private static ProblemHttpResult Closed() =>
        Problems.Conflict("Form closed", "This form is no longer accepting responses.");

    /// <summary>"today" for date rules = the latest calendar date anywhere on Earth (UTC+14).</summary>
    public static string ServerToday() => DateTime.UtcNow.AddHours(14).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<Form?> FindLiveAsync(AppDbContext db, string publicId, CancellationToken ct)
    {
        if (!PublicIdRegex().IsMatch(publicId)) return null;
        return await db.Forms.AsNoTracking()
            .SingleOrDefaultAsync(f => f.PublicId == publicId && f.LiveVersion != null && f.Status != FormStatus.Draft, ct);
    }

    private static async Task<Results<Ok<PublicOpenFormDto>, Ok<PublicClosedFormDto>, ProblemHttpResult>> GetAsync(
        string publicId, AppDbContext db, CancellationToken ct)
    {
        var form = await FindLiveAsync(db, publicId, ct);
        if (form is null) return NotAvailable();

        var schema = FormSchema.FromJson(await db.FormVersions.AsNoTracking()
            .Where(v => v.FormId == form.Id && v.Number == form.LiveVersion).Select(v => v.Schema).SingleAsync(ct));
        if (form.Status == FormStatus.Closed)
        {
            return TypedResults.Ok(new PublicClosedFormDto(form.PublicId!, "closed", schema.Title ?? "", schema.Accent));
        }

        return TypedResults.Ok(new PublicOpenFormDto(form.PublicId!, form.LiveVersion!.Value, "open", schema));
    }

    private static async Task<Results<Created<SubmitResultDto>, ValidationProblem, ProblemHttpResult>> SubmitAsync(
        string publicId, SubmitRequest request, AppDbContext db, CancellationToken ct)
    {
        var form = await FindLiveAsync(db, publicId, ct);
        if (form is null) return NotAvailable();
        if (form.Status == FormStatus.Closed) return Closed();

        // Honeypot: pretend success, store nothing.
        if (!string.IsNullOrEmpty(request.Website))
        {
            return TypedResults.Created((string?)null, new SubmitResultDto(form.NextResponseNumber));
        }

        var version = request.Version is { } n
            ? await db.FormVersions.AsNoTracking().Where(v => v.FormId == form.Id && v.Number == n)
                .Select(v => new { v.Id, v.Schema }).SingleOrDefaultAsync(ct)
            : null;
        if (version is null)
        {
            return Problems.Conflict("Form version not available", "This form was updated. Reload the page to see the latest version.");
        }

        // PostgreSQL text/jsonb cannot store U+0000; strip it before validation so stored = validated.
        var answers = request.Answers?.ToDictionary(kv => kv.Key, kv => StripNul(kv.Value));
        var (errors, normalized) = FormRules.ValidateSubmission(FormSchema.FromJson(version.Schema), answers, ServerToday());
        if (errors.Count > 0)
        {
            return ErrorHandling.Validation(errors.ToDictionary(e => e.Key, e => new[] { e.Value }));
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Atomic per-form numbering; the row lock also serialises against close.
        var allocated = await db.Database
            .SqlQuery<int>($"UPDATE forms SET next_response_number = next_response_number + 1 WHERE id = {form.Id} AND status = 'published' RETURNING next_response_number - 1 AS \"Value\"")
            .ToListAsync(ct);
        if (allocated.Count == 0) return Closed();

        var number = allocated[0];
        db.Responses.Add(new FormResponse
        {
            Id = Guid.CreateVersion7(), FormId = form.Id, VersionId = version.Id, Number = number,
            SubmittedAt = Clock.UtcNow(), Answers = JsonSerializer.Serialize(normalized, FormSchema.Json),
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Created((string?)null, new SubmitResultDto(number));
    }

    private static JsonElement StripNul(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String when value.GetString()!.Contains('\0', StringComparison.Ordinal) =>
            JsonSerializer.SerializeToElement(value.GetString()!.Replace("\0", "", StringComparison.Ordinal)),
        JsonValueKind.Array when value.EnumerateArray().Any(e => e.ValueKind == JsonValueKind.String && e.GetString()!.Contains('\0', StringComparison.Ordinal)) =>
            JsonSerializer.SerializeToElement(value.EnumerateArray().Select(StripNul).ToArray()),
        _ => value,
    };
}
