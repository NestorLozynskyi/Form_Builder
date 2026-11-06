using FormBuilder.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

[assembly: AssemblyFixture(typeof(FormBuilder.Api.Tests.ApiFactory))]

namespace FormBuilder.Api.Tests;

/// <summary>
/// Starts a real PostgreSQL in Docker (Testcontainers) once per test run and hosts the API in-process
/// against it, applying the EF Core migrations through the same startup path as production.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine")
        .WithDatabase("formbuilder_tests")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();
        // Force host start so migrations run before the first test.
        _ = Server;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", _postgres.GetConnectionString());
        builder.UseSetting("Database:ApplyMigrationsOnStartup", "true");
        builder.UseSetting("Diagnostics:EnableErrorEndpoint", "true");
        // Every in-process request shares one client IP, so the default limits are lifted here;
        // RateLimitTests uses a derived host with low limits.
        builder.UseSetting("RateLimits:AuthPermitLimit", "100000");
        builder.UseSetting("RateLimits:SubmitPermitLimit", "100000");
    }

    public string ConnectionString => _postgres.GetConnectionString();

    /// <summary>Runs <paramref name="work"/> with a fresh DbContext (for assertions on stored rows).</summary>
    public async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> work)
    {
        await using var scope = Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}
