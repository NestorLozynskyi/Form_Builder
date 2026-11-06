using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace FormBuilder.Api.Data;

/// <summary>Used by `dotnet ef` tooling. Reads the connection string from ConnectionStrings__Default.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        // Fallback for `dotnet ef` on a local development database only (see compose.db-port.yaml).
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
                 ?? "Host=localhost;Port=5442;Database=formbuilder;Username=formbuilder;Password=formbuilder";
        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).Options;
        return new AppDbContext(options);
    }
}
