namespace FormBuilder.Api.Infrastructure;

public static class Clock
{
    /// <summary>UTC now truncated to PostgreSQL timestamp precision (microseconds) so API values round-trip exactly.</summary>
    public static DateTime UtcNow()
    {
        var now = DateTime.UtcNow;
        return new DateTime(now.Ticks - now.Ticks % 10, DateTimeKind.Utc);
    }
}
