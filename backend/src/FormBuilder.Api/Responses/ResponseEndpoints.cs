using System.Text;
using System.Text.Json;
using FormBuilder.Api.Data;
using FormBuilder.Api.Forms;
using FormBuilder.Api.Forms.Schema;
using FormBuilder.Api.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace FormBuilder.Api.Responses;

public sealed record ResponseItemDto(Guid Id, int Number, DateTime SubmittedAt, int Version, JsonElement Answers);

public sealed record ResponsePageDto(int Total, int Page, int PageSize, List<ResponseItemDto> Items);

public sealed record ResponseDetailDto(
    Guid Id, int Number, DateTime SubmittedAt, int Version, JsonElement Answers, FormSchema Schema, int Index, int Total,
    Guid? PrevId, Guid? NextId, Dictionary<string, int> RemovedIn);

public static class ResponseEndpoints
{
    public const int MaxPageSize = 100;

    public static IEndpointRouteBuilder MapResponseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/forms/{id}/responses").WithTags("Responses").RequireAuthorization();
        group.MapGet("/", ListAsync);
        group.MapGet("/export.csv", ExportAsync);
        group.MapGet("/{responseId}", GetAsync);
        group.MapDelete("/{responseId}", DeleteAsync);
        return app;
    }

    private static ProblemHttpResult ResponseNotFound() => ErrorHandling.NotFound("Response not found.");

    private static Task<bool> OwnsAsync(AppDbContext db, HttpContext ctx, Guid formId, CancellationToken ct) =>
        FormEndpoints.OwnedForms(db, ctx).AnyAsync(f => f.Id == formId, ct);

    private static JsonElement ParseAnswers(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static async Task<Results<Ok<ResponsePageDto>, ValidationProblem, ProblemHttpResult>> ListAsync(
        string id, int? page, int? pageSize, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!FormEndpoints.TryId(id, out var fid) || !await OwnsAsync(db, ctx, fid, ct)) return FormEndpoints.FormNotFound();

        var p = page ?? 1;
        var size = pageSize ?? 10;
        var errors = new Dictionary<string, string[]>();
        if (p < 1) errors["page"] = ["Page must be 1 or greater."];
        if (size is < 1 or > MaxPageSize) errors["pageSize"] = [$"Page size must be from 1 to {MaxPageSize}."];
        if (errors.Count > 0) return ErrorHandling.Validation(errors);

        var query = db.Responses.AsNoTracking().Where(r => r.FormId == fid);
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(r => r.Number)
            .Skip((int)Math.Min((long)(p - 1) * size, int.MaxValue)).Take(size)
            .Select(r => new { r.Id, r.Number, r.SubmittedAt, Version = r.Version!.Number, r.Answers })
            .ToListAsync(ct);
        var items = rows.Select(r => new ResponseItemDto(r.Id, r.Number, r.SubmittedAt, r.Version, ParseAnswers(r.Answers))).ToList();
        return TypedResults.Ok(new ResponsePageDto(total, p, size, items));
    }

    private static async Task<Results<Ok<ResponseDetailDto>, ProblemHttpResult>> GetAsync(
        string id, string responseId, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!FormEndpoints.TryId(id, out var fid) || !await OwnsAsync(db, ctx, fid, ct)) return FormEndpoints.FormNotFound();
        if (!FormEndpoints.TryId(responseId, out var rid)) return ResponseNotFound();

        var r = await db.Responses.AsNoTracking().Where(x => x.Id == rid && x.FormId == fid)
            .Select(x => new { x.Id, x.Number, x.SubmittedAt, Version = x.Version!.Number, Schema = x.Version.Schema, x.Answers })
            .SingleOrDefaultAsync(ct);
        if (r is null) return ResponseNotFound();

        var all = db.Responses.AsNoTracking().Where(x => x.FormId == fid);
        var total = await all.CountAsync(ct);
        var newer = await all.CountAsync(x => x.Number > r.Number, ct);
        var prevId = await all.Where(x => x.Number > r.Number).OrderBy(x => x.Number).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
        var nextId = await all.Where(x => x.Number < r.Number).OrderByDescending(x => x.Number).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);

        // For fields of the response's version that are gone from the live version: the first later version without them.
        var schema = FormSchema.FromJson(r.Schema);
        var later = (await db.FormVersions.AsNoTracking().Where(v => v.FormId == fid && v.Number > r.Version)
                .OrderBy(v => v.Number).Select(v => new { v.Number, v.Schema }).ToListAsync(ct))
            .Select(v => (v.Number, Ids: FormSchema.FromJson(v.Schema).Blocks.Select(b => b.Id).ToHashSet()))
            .ToList();
        var removedIn = new Dictionary<string, int>();
        if (later.Count > 0)
        {
            foreach (var b in schema.InputBlocks)
            {
                if (later[^1].Ids.Contains(b.Id)) continue;
                removedIn[b.Id] = later.First(v => !v.Ids.Contains(b.Id)).Number;
            }
        }

        return TypedResults.Ok(new ResponseDetailDto(r.Id, r.Number, r.SubmittedAt, r.Version, ParseAnswers(r.Answers),
            schema, newer + 1, total, prevId, nextId, removedIn));
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(
        string id, string responseId, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!FormEndpoints.TryId(id, out var fid) || !await OwnsAsync(db, ctx, fid, ct)) return FormEndpoints.FormNotFound();
        if (!FormEndpoints.TryId(responseId, out var rid)) return ResponseNotFound();
        var deleted = await db.Responses.Where(r => r.Id == rid && r.FormId == fid).ExecuteDeleteAsync(ct);
        return deleted == 0 ? ResponseNotFound() : TypedResults.NoContent();
    }

    private static async Task<IResult> ExportAsync(string id, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        if (!FormEndpoints.TryId(id, out var fid)) return FormEndpoints.FormNotFound();
        var form = await FormEndpoints.OwnedForms(db, ctx).AsNoTracking()
            .Where(f => f.Id == fid).Select(f => new { f.Title }).SingleOrDefaultAsync(ct);
        if (form is null) return FormEndpoints.FormNotFound();

        var versions = (await db.FormVersions.AsNoTracking().Where(v => v.FormId == fid)
                .Select(v => new { v.Id, v.Number, v.Schema }).ToListAsync(ct))
            .Select(v => new CsvExport.VersionSchema(v.Id, v.Number, FormSchema.FromJson(v.Schema)))
            .ToList();
        var columns = CsvExport.Columns(versions);
        var versionNumbers = versions.ToDictionary(v => v.Id, v => v.Number);

        ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{CsvExport.Slug(form.Title)}-responses.csv\"";
        return Results.Stream(async stream =>
        {
            await using var writer = new StreamWriter(stream, new UTF8Encoding(false), 16 * 1024);
            await writer.WriteAsync('﻿');
            await writer.WriteAsync(CsvExport.HeaderRow(columns));
            var rows = db.Responses.AsNoTracking().Where(r => r.FormId == fid).OrderBy(r => r.Number)
                .Select(r => new { r.Number, r.SubmittedAt, r.VersionId, r.Answers }).AsAsyncEnumerable();
            await foreach (var r in rows.WithCancellation(ct))
            {
                await writer.WriteAsync(CsvExport.DataRow(columns, r.Number, r.SubmittedAt, versionNumbers[r.VersionId], r.Answers));
            }
        }, "text/csv; charset=utf-8");
    }
}
