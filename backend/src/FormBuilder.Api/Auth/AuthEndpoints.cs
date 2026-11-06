using System.Security.Claims;
using FormBuilder.Api.Data;
using FormBuilder.Api.Forms.Schema;
using FormBuilder.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace FormBuilder.Api.Auth;

public sealed record UserDto(string Email);

public sealed record SessionDto(UserDto? User);

public sealed record CredentialsRequest(string? Email, string? Password);

public static class AuthEndpoints
{
    public const int PasswordMinLength = 8;
    public const int PasswordMaxLength = 128;

    public const string ErrEmailEmpty = "Enter your email address.";
    public const string ErrEmailFormat = "This email address is incomplete. Use the format name@example.com.";
    public const string ErrEmailTaken = "An account with this email already exists.";
    public const string ErrPasswordEmpty = "Create a password with at least 8 characters.";
    public const string ErrPasswordLong = "Use 128 characters or fewer.";
    public const string ErrSignIn = "Email or password is incorrect.";

    private static readonly PasswordHasher<User> Hasher = new();

    // Used to equalise timing when the email is unknown.
    private static readonly string DummyHash = Hasher.HashPassword(new User { Email = "", PasswordHash = "" }, "dummy-password");

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");
        group.MapGet("/session", Session);
        group.MapPost("/sign-up", SignUpAsync).RequireRateLimiting(Security.AuthPolicy);
        group.MapPost("/sign-in", SignInAsync).RequireRateLimiting(Security.AuthPolicy);
        group.MapPost("/sign-out", SignOutAsync);
        return app;
    }

    public static string NormalizeEmail(string? email) => TextRules.Trim(email).ToLowerInvariant();

    public static string PasswordTooShort(int n)
    {
        var missing = PasswordMinLength - n;
        return $"Password is too short ({n} of {PasswordMinLength} characters). Add {missing} more {(missing == 1 ? "character" : "characters")}.";
    }

    private static Ok<SessionDto> Session(HttpContext ctx)
    {
        Security.IssueXsrfToken(ctx);
        var email = ctx.User.Identity?.IsAuthenticated == true ? ctx.User.FindFirstValue(ClaimTypes.Email) : null;
        return TypedResults.Ok(new SessionDto(email is null ? null : new UserDto(email)));
    }

    private static async Task<Results<Created<SessionDto>, ValidationProblem>> SignUpAsync(
        CredentialsRequest request, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        var password = request.Password ?? "";
        var errors = new Dictionary<string, string[]>();

        if (email.Length == 0) errors["email"] = [ErrEmailEmpty];
        else if (email.Length > AppDbContext.EmailMaxLength || !TextRules.IsEmail(email)) errors["email"] = [ErrEmailFormat];

        if (password.Length == 0) errors["password"] = [ErrPasswordEmpty];
        else if (password.Length < PasswordMinLength) errors["password"] = [PasswordTooShort(password.Length)];
        else if (password.Length > PasswordMaxLength) errors["password"] = [ErrPasswordLong];

        if (errors.Count == 0 && await db.Users.AnyAsync(u => u.Email == email, ct)) errors["email"] = [ErrEmailTaken];
        if (errors.Count > 0) return ErrorHandling.Validation(errors);

        var user = new User { Id = Guid.CreateVersion7(), Email = email, PasswordHash = "", CreatedAt = Clock.UtcNow() };
        user.PasswordHash = Hasher.HashPassword(user, password);
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException
                                           {
                                               SqlState: PostgresErrorCodes.UniqueViolation,
                                               ConstraintName: AppDbContext.EmailUniqueIndexName,
                                           })
        {
            return Problems.Validation("email", ErrEmailTaken);
        }

        await SignInUserAsync(ctx, user);
        return TypedResults.Created("/api/auth/session", new SessionDto(new UserDto(user.Email)));
    }

    private static async Task<Results<Ok<SessionDto>, ProblemHttpResult>> SignInAsync(
        CredentialsRequest request, HttpContext ctx, AppDbContext db, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        var password = request.Password ?? "";
        var user = email.Length == 0 ? null : await db.Users.SingleOrDefaultAsync(u => u.Email == email, ct);

        if (user is null || password.Length == 0 || password.Length > PasswordMaxLength)
        {
            Hasher.VerifyHashedPassword(new User { Email = "", PasswordHash = "" }, DummyHash, password.Length > 0 ? password : "x");
            return Problems.Result(StatusCodes.Status401Unauthorized, ErrSignIn);
        }

        var result = Hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed)
        {
            return Problems.Result(StatusCodes.Status401Unauthorized, ErrSignIn);
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = Hasher.HashPassword(user, password);
            await db.SaveChangesAsync(ct);
        }

        await SignInUserAsync(ctx, user);
        return TypedResults.Ok(new SessionDto(new UserDto(user.Email)));
    }

    private static async Task<NoContent> SignOutAsync(HttpContext ctx, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        Security.IssueXsrfToken(ctx, new ClaimsPrincipal(new ClaimsIdentity()));
        return TypedResults.NoContent();
    }

    private static async Task SignInUserAsync(HttpContext ctx, User user)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Email, user.Email)],
            CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal,
            new AuthenticationProperties { IsPersistent = true });
        Security.IssueXsrfToken(ctx, principal);
    }
}
