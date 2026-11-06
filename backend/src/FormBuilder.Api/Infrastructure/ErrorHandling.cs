using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.HttpResults;

namespace FormBuilder.Api.Infrastructure;

/// <summary>
/// Unified error format: RFC 9457 Problem Details (application/problem+json).
/// - validation: 400 with "errors": { field: [messages] } (ValidationProblemDetails)
/// - not found / other status codes: ProblemDetails with status + title
/// - unhandled exceptions: 500 ProblemDetails without internal details.
/// Every problem carries "traceId" for log correlation.
/// </summary>
public static class ErrorHandling
{
    public static IServiceCollection AddUnifiedProblemDetails(this IServiceCollection services)
    {
        services.AddProblemDetails(o =>
        {
            o.CustomizeProblemDetails = ctx =>
            {
                ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path;
                ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
                // Never leak exception details to clients.
                ctx.ProblemDetails.Extensions.Remove("exception");
            };
        });
        services.AddExceptionHandler<BadRequestExceptionHandler>();
        return services;
    }

    public static ProblemHttpResult NotFound(string detail) =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not Found", detail: detail);

    public static ValidationProblem Validation(IDictionary<string, string[]> errors) =>
        TypedResults.ValidationProblem(errors, title: "One or more validation errors occurred.");
}

/// <summary>Maps malformed request bodies (invalid JSON, wrong types) to 400 Problem Details.</summary>
internal sealed class BadRequestExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken ct)
    {
        if (exception is not BadHttpRequestException bad)
        {
            return false;
        }

        httpContext.Response.StatusCode = bad.StatusCode;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = bad.StatusCode,
                Title = bad.StatusCode == StatusCodes.Status413PayloadTooLarge ? "Request too large" : "Bad Request",
                Detail = bad.StatusCode == StatusCodes.Status413PayloadTooLarge
                    ? "The request body is too large."
                    : "The request body is malformed or has an invalid shape.",
            },
        });
    }
}
