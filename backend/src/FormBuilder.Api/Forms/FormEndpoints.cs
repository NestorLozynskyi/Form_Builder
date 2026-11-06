using System.Security.Cryptography;
using FormBuilder.Api.Data;
using FormBuilder.Api.Forms.Schema;
using FormBuilder.Api.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace FormBuilder.Api.Forms;

public sealed record FormSummaryDto(
    Guid Id, string Title, string Status, int? LiveVersion, bool HasUnpublishedChanges, int ResponseCount,
    DateTime UpdatedAt, string? PublicId);

public sealed record VersionInfoDto(int Number, DateTime PublishedAt, int ResponseCount);

public sealed record FormDetailDto(
    Guid Id, string Title, string Status, int? LiveVersion, bool HasUnpublishedChanges, int ResponseCount,
    DateTime UpdatedAt, string? PublicId, FormSchema Draft, FormSchema? LiveSchema, string? PublishBlocker,
    VersionInfoDto[] Versions, DateTime CreatedAt);

public static class FormEndpoints
{
    public const int MaxFormsPerUser = 500;

    public static IEndpointRouteBuilder MapFormEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/forms").WithTags("Forms").RequireAuthorization();
        group.MapGet("/", ListAsync);
        group.MapPost("/", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPut("/{id}/draft", SaveDraftAsync);
        group.MapPost("/{id}/publish", PublishAsync);
        group.MapPost("/{id}/close", CloseAsync);
        group.MapPost("/{id}/reopen", ReopenAsync);
        group.MapDelete("/{id}", DeleteAsync);
        return app;
    }

    public static ProblemHttpResult FormNotFound() => ErrorHandling.NotFound("Form not found.");

    /// <summary>Parses an id from the route; malformed ids behave exactly like missing ones.</summary>
    public static bool TryId(string raw, out Guid id) => Guid.TryParseExact(raw, "D", out id);

    private static async Task<Results<Ok<List<FormSummaryDto>>, ValidationProblem>> ListAsync(
        string? q, string? status, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        var uid = ctx.User.UserId();
        var query = db.Forms.AsNoTracking().Where(f => f.OwnerId == uid);
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!FormStatus.All.Contains(status)) return Problems.Validation("status", "Use draft, published or closed.");
            query = query.Where(f => f.Status == status);
        }

        var term = TextRules.Trim(q).ToLowerInvariant();
        if (term.Length > 0) query = query.Where(f => f.Title.ToLower().Contains(term));

        var items = await query.OrderByDescending(f => f.UpdatedAt).ThenBy(f => f.Id)
            .Select(f => new FormSummaryDto(
                f.Id, f.Title, f.Status, f.LiveVersion,
                f.LiveVersion != null && f.DraftSchema != f.Versions.Where(v => v.Number == f.LiveVersion).Select(v => v.Schema).FirstOrDefault(),
                f.Responses.Count(), f.UpdatedAt, f.PublicId))
            .ToListAsync(ct);
        return TypedResults.Ok(items);
    }

    private static async Task<Results<Created<FormDetailDto>, ProblemHttpResult>> CreateAsync(
        HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        var uid = ctx.User.UserId();
        if (await db.Forms.CountAsync(f => f.OwnerId == uid, ct) >= MaxFormsPerUser)
        {
            return Problems.Conflict("Form limit reached", $"You can have up to {MaxFormsPerUser} forms. Delete a form to create a new one.");
        }

        var draft = FormSchema.NewDraft();
        var now = Clock.UtcNow();
        var form = new Form
        {
            Id = Guid.CreateVersion7(), OwnerId = uid, Status = FormStatus.Draft, Title = TitleOf(draft),
            DraftSchema = draft.ToJson(), CreatedAt = now, UpdatedAt = now,
        };
        db.Forms.Add(form);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/forms/{form.Id}", await DetailAsync(db, form, ct));
    }

    private static async Task<Results<Ok<FormDetailDto>, ProblemHttpResult>> GetAsync(
        string id, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        var form = TryId(id, out var fid) ? await OwnedForms(db, ctx).AsNoTracking().SingleOrDefaultAsync(f => f.Id == fid, ct) : null;
        return form is null ? FormNotFound() : TypedResults.Ok(await DetailAsync(db, form, ct));
    }

    private static async Task<Results<Ok<FormDetailDto>, ValidationProblem, ProblemHttpResult>> SaveDraftAsync(
        string id, FormSchema schema, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!TryId(id, out var fid)) return FormNotFound();
        var structural = FormRules.StructuralErrors(schema);
        // Ownership first: a foreign form must look missing even when the body is invalid.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var form = await LockOwnedAsync(db, fid, ctx.User.UserId(), ct);
        if (form is null) return FormNotFound();
        if (structural.Count > 0) return ErrorHandling.Validation(structural);

        form.DraftSchema = schema.ToJson();
        form.Title = TitleOf(schema);
        form.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(await DetailAsync(db, form, ct));
    }

    private static async Task<Results<Ok<FormDetailDto>, ValidationProblem, ProblemHttpResult>> PublishAsync(
        string id, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!TryId(id, out var fid)) return FormNotFound();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var form = await LockOwnedAsync(db, fid, ctx.User.UserId(), ct);
        if (form is null) return FormNotFound();

        if (form.LiveVersion is { } live)
        {
            var liveSchema = await db.FormVersions.Where(v => v.FormId == form.Id && v.Number == live)
                .Select(v => v.Schema).SingleAsync(ct);
            if (liveSchema == form.DraftSchema)
            {
                return Problems.Conflict("Nothing to publish", "The live version already matches the draft.");
            }
        }

        var draft = FormSchema.FromJson(form.DraftSchema);
        if (FormRules.PublishBlocker(draft) is { } blocker)
        {
            return Problems.Validation("publish", blocker);
        }

        var now = Clock.UtcNow();
        var number = (form.LiveVersion ?? 0) + 1;
        db.FormVersions.Add(new FormVersion
        {
            Id = Guid.CreateVersion7(), FormId = form.Id, Number = number, Schema = form.DraftSchema, PublishedAt = now,
        });
        form.LiveVersion = number;
        form.PublicId ??= NewPublicId();
        if (form.Status == FormStatus.Draft) form.Status = FormStatus.Published;
        form.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(await DetailAsync(db, form, ct));
    }

    private static Task<Results<Ok<FormDetailDto>, ProblemHttpResult>> CloseAsync(
        string id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        TransitionAsync(id, ctx, db, FormStatus.Published, FormStatus.Closed, ct);

    private static Task<Results<Ok<FormDetailDto>, ProblemHttpResult>> ReopenAsync(
        string id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        TransitionAsync(id, ctx, db, FormStatus.Closed, FormStatus.Published, ct);

    private static async Task<Results<Ok<FormDetailDto>, ProblemHttpResult>> TransitionAsync(
        string id, HttpContext ctx, AppDbContext db, string from, string to, CancellationToken ct)
    {
        if (!TryId(id, out var fid)) return FormNotFound();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var form = await LockOwnedAsync(db, fid, ctx.User.UserId(), ct);
        if (form is null) return FormNotFound();

        if (form.Status == FormStatus.Draft)
        {
            return Problems.Conflict("Form not published", "Publish the form first.");
        }

        if (form.Status == from)
        {
            form.Status = to;
            form.UpdatedAt = Clock.UtcNow();
            await db.SaveChangesAsync(ct);
        }

        // Already in the target state: idempotent.
        await tx.CommitAsync(ct);
        return TypedResults.Ok(await DetailAsync(db, form, ct));
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(
        string id, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!TryId(id, out var fid)) return FormNotFound();
        var uid = ctx.User.UserId();
        // versions + responses go with it (ON DELETE CASCADE).
        var deleted = await db.Forms.Where(f => f.Id == fid && f.OwnerId == uid).ExecuteDeleteAsync(ct);
        return deleted == 0 ? FormNotFound() : TypedResults.NoContent();
    }

    // ------------------------------------------------------------------ helpers

    public static IQueryable<Form> OwnedForms(AppDbContext db, HttpContext ctx)
    {
        var uid = ctx.User.UserId();
        return db.Forms.Where(f => f.OwnerId == uid);
    }

    /// <summary>Loads the caller's form with a row lock (serialises publish / draft save / state changes).</summary>
    private static async Task<Form?> LockOwnedAsync(AppDbContext db, Guid id, Guid uid, CancellationToken ct) =>
        (await db.Forms.FromSql($"SELECT * FROM forms WHERE id = {id} AND owner_id = {uid} FOR UPDATE").ToListAsync(ct))
        .SingleOrDefault();

    private static string TitleOf(FormSchema s) => (s.Title ?? "").Replace("\0", "", StringComparison.Ordinal);

    private static string NewPublicId() => Base64Url(RandomNumberGenerator.GetBytes(16));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static async Task<FormDetailDto> DetailAsync(AppDbContext db, Form form, CancellationToken ct)
    {
        var versions = await db.FormVersions.AsNoTracking().Where(v => v.FormId == form.Id).OrderBy(v => v.Number)
            .Select(v => new VersionInfoDto(v.Number, v.PublishedAt, v.Responses.Count()))
            .ToArrayAsync(ct);
        string? liveJson = null;
        if (form.LiveVersion is { } live)
        {
            liveJson = await db.FormVersions.AsNoTracking().Where(v => v.FormId == form.Id && v.Number == live)
                .Select(v => v.Schema).SingleAsync(ct);
        }

        var draft = FormSchema.FromJson(form.DraftSchema);
        return new FormDetailDto(
            form.Id, form.Title, form.Status, form.LiveVersion,
            liveJson is not null && liveJson != form.DraftSchema,
            versions.Sum(v => v.ResponseCount), form.UpdatedAt, form.PublicId,
            draft, liveJson is null ? null : FormSchema.FromJson(liveJson), FormRules.PublishBlocker(draft),
            versions, form.CreatedAt);
    }
}
