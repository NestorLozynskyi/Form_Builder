using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace FormBuilder.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IDataProtectionKeyContext
{
    public const int EmailMaxLength = 254;
    public const string EmailUniqueIndexName = "ux_users_email";

    public DbSet<User> Users => Set<User>();
    public DbSet<Form> Forms => Set<Form>();
    public DbSet<FormVersion> FormVersions => Set<FormVersion>();
    public DbSet<FormResponse> Responses => Set<FormResponse>();

    /// <summary>ASP.NET Core Data Protection key ring (auth + antiforgery cookies survive restarts / replicas).</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(EmailMaxLength).IsRequired();
            e.Property(x => x.PasswordHash).HasColumnName("password_hash").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => x.Email).IsUnique().HasDatabaseName(EmailUniqueIndexName);
        });

        modelBuilder.Entity<Form>(e =>
        {
            e.ToTable("forms", t => t.HasCheckConstraint("ck_forms_status", "status IN ('draft', 'published', 'closed')"));
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OwnerId).HasColumnName("owner_id");
            e.Property(x => x.PublicId).HasColumnName("public_id").HasMaxLength(22);
            e.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
            e.Property(x => x.Title).HasColumnName("title").IsRequired();
            e.Property(x => x.DraftSchema).HasColumnName("draft_schema").HasColumnType("text").IsRequired();
            e.Property(x => x.LiveVersion).HasColumnName("live_version");
            e.Property(x => x.NextResponseNumber).HasColumnName("next_response_number");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.OwnerId, x.UpdatedAt }).HasDatabaseName("ix_forms_owner_updated").IsDescending(false, true);
            e.HasIndex(x => x.PublicId).IsUnique().HasDatabaseName("ux_forms_public_id");
        });

        modelBuilder.Entity<FormVersion>(e =>
        {
            e.ToTable("form_versions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.FormId).HasColumnName("form_id");
            e.Property(x => x.Number).HasColumnName("number");
            e.Property(x => x.Schema).HasColumnName("schema").HasColumnType("text").IsRequired();
            e.Property(x => x.PublishedAt).HasColumnName("published_at");
            e.HasOne<Form>().WithMany(f => f.Versions).HasForeignKey(x => x.FormId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.FormId, x.Number }).IsUnique().HasDatabaseName("ux_form_versions_form_number");
        });

        modelBuilder.Entity<FormResponse>(e =>
        {
            e.ToTable("responses");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.FormId).HasColumnName("form_id");
            e.Property(x => x.VersionId).HasColumnName("version_id");
            e.Property(x => x.Number).HasColumnName("number");
            e.Property(x => x.SubmittedAt).HasColumnName("submitted_at");
            e.Property(x => x.Answers).HasColumnName("answers").HasColumnType("jsonb").IsRequired();
            e.HasOne<Form>().WithMany(f => f.Responses).HasForeignKey(x => x.FormId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Version).WithMany(v => v.Responses).HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Cascade);
            // Serves paging (newest first via backward scan) and guarantees unique numbers per form.
            e.HasIndex(x => new { x.FormId, x.Number }).IsUnique().HasDatabaseName("ux_responses_form_number");
            e.HasIndex(x => x.VersionId).HasDatabaseName("ix_responses_version");
        });

        modelBuilder.Entity<DataProtectionKey>(e =>
        {
            e.ToTable("data_protection_keys");
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.FriendlyName).HasColumnName("friendly_name");
            e.Property(x => x.Xml).HasColumnName("xml");
        });
    }
}
