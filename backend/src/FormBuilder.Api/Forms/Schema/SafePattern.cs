using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FormBuilder.Api.Forms.Schema;

/// <summary>
/// Safe regular-expression subset for custom text patterns. The same parser exists in TypeScript
/// (frontend core/validation/safe-pattern.ts); both must return the same error for the same pattern
/// (checked by shared/validation-vectors.json).
///
/// Allowed: literal characters; escapes \d \w \s (and \D \W \S outside brackets), \t \n \r \f \v, \uXXXX, \xHH and
/// escaped punctuation; character classes [...] / [^...] with ranges; '.'; anchors ^ and $; groups (...) and (?:...);
/// alternation |; greedy quantifiers * + ? {n} {n,} {n,m} (n, m ≤ 100).
/// Rejected: nested quantifiers like (a+)+, back-references (\1, \k), lookaround ((?=, (?!, (?&lt;=, (?&lt;!), named
/// groups, lazy/possessive quantifiers, \b, Unicode properties, inline flags, bare { } ], patterns over 200 chars
/// and patterns whose expanded size exceeds 2,000 states.
///
/// Semantics are pinned so JavaScript and .NET agree: \d=[0-9], \w=[A-Za-z0-9_], \s = JS whitespace set,
/// '.' = any char except \n \r U+2028 U+2029, ^/$ = start/end of the whole value (search semantics, like RegExp.test).
/// On the server the translated pattern runs with RegexOptions.NonBacktracking and a timeout; the client runs the same
/// AST through a linear-time NFA simulation, so neither side can backtrack catastrophically.
/// </summary>
public static class SafePattern
{
    public const int MaxRepeat = 100;
    public const int MaxStates = 2000;

    public const string ErrSyntax = "Invalid pattern: check the syntax.";
    public const string ErrUnmatchedParen = "Invalid pattern: unmatched )";
    public const string ErrMissingParen = "Invalid pattern: missing closing )";
    public const string ErrMissingBracket = "Invalid pattern: missing closing ]";
    public const string ErrNothingToRepeat = "Invalid pattern: nothing to repeat.";
    public const string ErrNested = "This pattern could be very slow to check. Avoid nested repeats like (a+)+.";
    public const string ErrBackref = "Back-references like \\1 aren’t allowed.";
    public const string ErrLookaround = "Lookahead and lookbehind like (?=…) aren’t allowed.";
    public const string ErrUnsupported = "This pattern uses a feature that isn’t supported. Use letters, digits, [ ] classes, groups, | and repeats like * + ? {2,5}.";
    public const string ErrTooLong = "Use 200 characters or fewer for the pattern.";
    public const string ErrTooComplex = "This pattern is too complex to check quickly. Use smaller repeat counts.";

    public static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(250);

    /// <summary>Returns null when the pattern is allowed, otherwise the user-facing error message.</summary>
    public static string? Check(string pattern) => TryParse(pattern, out _, out var error) ? null : error;

    public static bool TryParse(string pattern, out Node? ast, out string? error)
    {
        ast = null;
        error = null;
        if (pattern.Length > Limits.PatternMaxLength)
        {
            error = ErrTooLong;
            return false;
        }

        try
        {
            var p = new Parser(pattern);
            var node = p.ParseAlternation();
            if (p.Pos < pattern.Length)
            {
                // only a stray ')' can stop the top-level alternation early
                throw new PatternException(ErrUnmatchedParen);
            }

            if (Size(node) > MaxStates) throw new PatternException(ErrTooComplex);
            ast = node;
            return true;
        }
        catch (PatternException ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Regex> Cache = new();

    /// <summary>Tests an already-validated pattern against a value (search semantics). Throws on timeout.</summary>
    public static bool IsMatch(string pattern, string value)
    {
        var regex = Cache.GetOrAdd(pattern, static p =>
        {
            if (!TryParse(p, out var ast, out var err)) throw new ArgumentException(err, nameof(pattern));
            return new Regex(ToDotNet(ast!), RegexOptions.NonBacktracking | RegexOptions.CultureInvariant, MatchTimeout);
        });
        if (Cache.Count > 5000) Cache.Clear();
        return regex.IsMatch(value);
    }

    // ------------------------------------------------------------------ AST

    public abstract record Node;
    public sealed record CharSet(bool Negated, IReadOnlyList<(char Lo, char Hi)> Ranges) : Node;
    public sealed record Start : Node;
    public sealed record End : Node;
    public sealed record Seq(IReadOnlyList<Node> Items) : Node;
    public sealed record Alt(IReadOnlyList<Node> Options) : Node;
    public sealed record Group(Node Inner) : Node;
    public sealed record Repeat(Node Inner, int Min, int? Max) : Node;

    private static readonly (char, char)[] Digit = [('0', '9')];
    private static readonly (char, char)[] Word = [('0', '9'), ('A', 'Z'), ('_', '_'), ('a', 'z')];
    private static readonly (char, char)[] Dot = [('\n', '\n'), ('\r', '\r'), ('\u2028', '\u2029')];

    public static int Size(Node n) => n switch
    {
        CharSet or Start or End => 1,
        Seq s => s.Items.Sum(Size),
        Alt a => a.Options.Sum(Size) + a.Options.Count,
        Group g => Size(g.Inner),
        Repeat r => Size(r.Inner) * (r.Max ?? Math.Max(r.Min, 1)) + 1,
        _ => 1,
    };

    private static bool ContainsRepeat(Node n) => n switch
    {
        Repeat => true,
        Seq s => s.Items.Any(ContainsRepeat),
        Alt a => a.Options.Any(ContainsRepeat),
        Group g => ContainsRepeat(g.Inner),
        _ => false,
    };

    private sealed class PatternException(string message) : Exception(message);

    private sealed class Parser(string p)
    {
        public int Pos;

        private bool AtEnd => Pos >= p.Length;
        private char Peek => p[Pos];

        public Node ParseAlternation()
        {
            var options = new List<Node> { ParseSequence() };
            while (!AtEnd && Peek == '|')
            {
                Pos++;
                options.Add(ParseSequence());
            }

            return options.Count == 1 ? options[0] : new Alt(options);
        }

        private Node ParseSequence()
        {
            var items = new List<Node>();
            while (!AtEnd && Peek != '|' && Peek != ')')
            {
                var atom = ParseAtom();
                var repeated = ParseQuantifier(atom);
                items.Add(repeated);
            }

            return new Seq(items);
        }

        private Node ParseAtom()
        {
            var c = Peek;
            switch (c)
            {
                case '(':
                    return ParseGroup();
                case '[':
                    return ParseClass();
                case '.':
                    Pos++;
                    return new CharSet(true, Dot);
                case '^':
                    Pos++;
                    return new Start();
                case '$':
                    Pos++;
                    return new End();
                case '\\':
                    return ParseEscape(inClass: false);
                case '*' or '+' or '?':
                    throw new PatternException(ErrNothingToRepeat);
                case '{' or '}' or ']':
                    throw new PatternException(ErrSyntax);
                default:
                    Pos++;
                    return Literal(c);
            }
        }

        private Node ParseGroup()
        {
            Pos++; // (
            if (!AtEnd && Peek == '?')
            {
                var next = Pos + 1 < p.Length ? p[Pos + 1] : '\0';
                if (next == ':')
                {
                    Pos += 2;
                }
                else if (next is '=' or '!')
                {
                    throw new PatternException(ErrLookaround);
                }
                else if (next == '<')
                {
                    var after = Pos + 2 < p.Length ? p[Pos + 2] : '\0';
                    throw new PatternException(after is '=' or '!' ? ErrLookaround : ErrUnsupported);
                }
                else
                {
                    throw new PatternException(ErrUnsupported);
                }
            }

            var inner = ParseAlternation();
            if (AtEnd || Peek != ')') throw new PatternException(ErrMissingParen);
            Pos++;
            return new Group(inner);
        }

        private Node ParseQuantifier(Node atom)
        {
            if (AtEnd) return atom;
            int min;
            int? max;
            switch (Peek)
            {
                case '*': min = 0; max = null; Pos++; break;
                case '+': min = 1; max = null; Pos++; break;
                case '?': min = 0; max = 1; Pos++; break;
                case '{':
                    (min, max) = ParseBraces();
                    break;
                default:
                    return atom;
            }

            if (atom is Start or End) throw new PatternException(ErrNothingToRepeat);
            if (!AtEnd && (Peek is '?' or '+')) throw new PatternException(ErrUnsupported); // lazy / possessive
            if (!AtEnd && (Peek is '*' or '{')) throw new PatternException(ErrNothingToRepeat);
            if (ContainsRepeat(atom)) throw new PatternException(ErrNested);
            return new Repeat(atom, min, max);
        }

        private (int, int?) ParseBraces()
        {
            Pos++; // {
            var n = ReadInt();
            if (n is null) throw new PatternException(ErrSyntax);
            int? m = n;
            if (!AtEnd && Peek == ',')
            {
                Pos++;
                m = AtEnd || Peek == '}' ? null : ReadInt() ?? throw new PatternException(ErrSyntax);
            }

            if (AtEnd || Peek != '}') throw new PatternException(ErrSyntax);
            Pos++;
            if (n > MaxRepeat || m > MaxRepeat) throw new PatternException(ErrTooComplex);
            if (m is not null && n > m) throw new PatternException(ErrSyntax);
            return (n.Value, m);
        }

        private int? ReadInt()
        {
            var s = Pos;
            while (!AtEnd && Peek >= '0' && Peek <= '9' && Pos - s < 4) Pos++;
            if (Pos == s) return null;
            if (!AtEnd && Peek >= '0' && Peek <= '9') throw new PatternException(ErrTooComplex);
            return int.Parse(p.AsSpan(s, Pos - s), CultureInfo.InvariantCulture);
        }

        private Node ParseClass()
        {
            Pos++; // [
            var negated = false;
            if (!AtEnd && Peek == '^')
            {
                negated = true;
                Pos++;
            }

            if (!AtEnd && Peek == ']') throw new PatternException(ErrSyntax); // empty class differs between engines
            var ranges = new List<(char, char)>();
            while (true)
            {
                if (AtEnd) throw new PatternException(ErrMissingBracket);
                var c = Peek;
                if (c == ']')
                {
                    Pos++;
                    break;
                }

                if (c == '[') throw new PatternException(ErrUnsupported); // .NET class subtraction / nesting

                char lo;
                if (c == '\\')
                {
                    var set = ParseEscape(inClass: true);
                    if (!IsSingle(set, out lo))
                    {
                        ranges.AddRange(((CharSet)set).Ranges);
                        continue;
                    }
                }
                else
                {
                    Pos++;
                    lo = c;
                }

                // range a-b (a '-' right before ']' is a literal)
                if (Pos + 1 < p.Length && Peek == '-' && p[Pos + 1] != ']')
                {
                    Pos++; // -
                    char hi;
                    if (Peek == '\\')
                    {
                        var hiSet = ParseEscape(inClass: true);
                        if (!IsSingle(hiSet, out hi)) throw new PatternException(ErrSyntax);
                    }
                    else if (Peek == '[')
                    {
                        throw new PatternException(ErrUnsupported);
                    }
                    else
                    {
                        hi = Peek;
                        Pos++;
                    }

                    if (lo > hi) throw new PatternException(ErrSyntax);
                    ranges.Add((lo, hi));
                }
                else
                {
                    ranges.Add((lo, lo));
                }
            }

            return new CharSet(negated, ranges);
        }

        private static bool IsSingle(Node n, out char c)
        {
            if (n is CharSet { Negated: false, Ranges.Count: 1 } s && s.Ranges[0].Lo == s.Ranges[0].Hi)
            {
                c = s.Ranges[0].Lo;
                return true;
            }

            c = '\0';
            return false;
        }

        private Node ParseEscape(bool inClass)
        {
            Pos++; // backslash
            if (AtEnd) throw new PatternException(ErrSyntax);
            var e = Peek;
            Pos++;
            switch (e)
            {
                case 'd': return new CharSet(false, Digit);
                case 'w': return new CharSet(false, Word);
                case 's': return new CharSet(false, TextRules.WhitespaceRanges);
                case 'D' or 'W' or 'S':
                    if (inClass) throw new PatternException(ErrUnsupported);
                    return new CharSet(true, e == 'D' ? Digit : e == 'W' ? Word : TextRules.WhitespaceRanges);
                case 't': return Literal('\t');
                case 'n': return Literal('\n');
                case 'r': return Literal('\r');
                case 'f': return Literal('\f');
                case 'v': return Literal('\v');
                case 'u': return Literal(ReadHex(4));
                case 'x': return Literal(ReadHex(2));
                case >= '1' and <= '9' or 'k':
                    throw new PatternException(ErrBackref);
                default:
                    if (e is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' || char.IsControl(e) || TextRules.IsWhitespace(e))
                    {
                        throw new PatternException(ErrUnsupported);
                    }

                    return Literal(e);
            }
        }

        private char ReadHex(int count)
        {
            if (Pos + count > p.Length) throw new PatternException(ErrSyntax);
            var span = p.AsSpan(Pos, count);
            foreach (var ch in span)
            {
                if (!Uri.IsHexDigit(ch)) throw new PatternException(ErrSyntax);
            }

            Pos += count;
            return (char)int.Parse(span, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        }

        private static CharSet Literal(char c) => new(false, [(c, c)]);
    }

    // ------------------------------------------------------------------ .NET translation

    public static string ToDotNet(Node n)
    {
        var sb = new StringBuilder();
        Emit(n, sb);
        return sb.ToString();
    }

    private static void Emit(Node n, StringBuilder sb)
    {
        switch (n)
        {
            case CharSet cs:
                sb.Append('[');
                if (cs.Negated) sb.Append('^');
                foreach (var (lo, hi) in cs.Ranges)
                {
                    sb.Append(CultureInfo.InvariantCulture, $"\\u{(int)lo:X4}");
                    if (hi != lo) sb.Append(CultureInfo.InvariantCulture, $"-\\u{(int)hi:X4}");
                }

                sb.Append(']');
                break;
            case Start:
                sb.Append("\\A");
                break;
            case End:
                sb.Append("\\z");
                break;
            case Seq s:
                foreach (var item in s.Items) Emit(item, sb);
                break;
            case Alt a:
                sb.Append("(?:");
                for (var i = 0; i < a.Options.Count; i++)
                {
                    if (i > 0) sb.Append('|');
                    Emit(a.Options[i], sb);
                }

                sb.Append(')');
                break;
            case Group g:
                sb.Append("(?:");
                Emit(g.Inner, sb);
                sb.Append(')');
                break;
            case Repeat r:
                sb.Append("(?:");
                Emit(r.Inner, sb);
                sb.Append(')');
                sb.Append(r.Max is null
                    ? r.Min switch { 0 => "*", 1 => "+", _ => $"{{{r.Min},}}" }
                    : $"{{{r.Min},{r.Max}}}");
                break;
        }
    }
}
