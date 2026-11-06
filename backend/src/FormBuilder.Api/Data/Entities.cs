namespace FormBuilder.Api.Data;

public sealed class User
{
    public Guid Id { get; set; }

    /// <summary>Normalised: trimmed + lower-invariant. Unique.</summary>
    public required string Email { get; set; }

    public required string PasswordHash { get; set; }

    public DateTime CreatedAt { get; set; }
}

public static class FormStatus
{
    public const string Draft = "draft";
    public const string Published = "published";
    public const string Closed = "closed";

    public static readonly string[] All = [Draft, Published, Closed];
}

public sealed class Form
{
    public Guid Id { get; set; }

    public Guid OwnerId { get; set; }

    public User? Owner { get; set; }

    /// <summary>22-char base64url id used by the public link; assigned on first publish, never changes.</summary>
    public string? PublicId { get; set; }

    public string Status { get; set; } = FormStatus.Draft;

    /// <summary>Denormalised draft title (search / listing).</summary>
    public string Title { get; set; } = "";

    /// <summary>Canonical JSON (<see cref="Forms.Schema.FormSchema.ToJson"/>) of the editable draft.</summary>
    public required string DraftSchema { get; set; }

    /// <summary>Number of the latest published version (null until first publish).</summary>
    public int? LiveVersion { get; set; }

    /// <summary>Next response number to hand out; incremented atomically on submission.</summary>
    public int NextResponseNumber { get; set; } = 1;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public List<FormVersion> Versions { get; set; } = [];

    public List<FormResponse> Responses { get; set; } = [];
}

/// <summary>Immutable snapshot of a published schema (a DB trigger rejects UPDATEs).</summary>
public sealed class FormVersion
{
    public Guid Id { get; set; }

    public Guid FormId { get; set; }

    public int Number { get; set; }

    /// <summary>Canonical schema JSON at publish time.</summary>
    public required string Schema { get; set; }

    public DateTime PublishedAt { get; set; }

    public List<FormResponse> Responses { get; set; } = [];
}

public sealed class FormResponse
{
    public Guid Id { get; set; }

    public Guid FormId { get; set; }

    public Guid VersionId { get; set; }

    public FormVersion? Version { get; set; }

    public int Number { get; set; }

    public DateTime SubmittedAt { get; set; }

    /// <summary>jsonb object: block id → string | string[] (normalised answers).</summary>
    public required string Answers { get; set; }
}
