using Microsoft.AspNetCore.Http.HttpResults;

namespace FormBuilder.Api.Infrastructure;

/// <summary>Problem Details helpers used by endpoints and by middleware that short-circuits the pipeline.</summary>
public static class Problems
{
    public static ProblemHttpResult Result(int status, string title, string? detail = null) =>
        TypedResults.Problem(statusCode: status, title: title, detail: detail);

    public static ProblemHttpResult Conflict(string title, string? detail = null) =>
        Result(StatusCodes.Status409Conflict, title, detail);

    public static ValidationProblem Validation(string key, string message) =>
        ErrorHandling.Validation(new Dictionary<string, string[]> { [key] = [message] });

    /// <summary>Writes a problem response directly (for middleware / authentication events).</summary>
    public static async Task WriteAsync(HttpContext context, int status, string title, string? detail = null)
    {
        context.Response.StatusCode = status;
        var service = context.RequestServices.GetRequiredService<IProblemDetailsService>();
        await service.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Status = status, Title = title, Detail = detail },
        });
    }
}
