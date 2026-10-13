package gloop

import System
import System.Collections.Generic

class MimeDatabase {
    private const GlobWeightScale int32 = 4096
    private const AncestorLimit int32 = 16

    private let globs List[MimeGlob] = List[MimeGlob]()
    private let canonical Dictionary[string, string] = Dictionary[string, string]()
    private let synonyms Dictionary[string, List[string]] = Dictionary[string, List[string]]()
    private let parents Dictionary[string, List[string]] = Dictionary[string, List[string]]()

    internal init(files List[MimeDataFile]) {
        let cleared = HashSet[string]()

        for file in files {
            let own = HashSet[string]()

            for line in file.Globs {
                let fields = line.Split(':')

                if fields.Length >= 3 && !line.StartsWith('#') && Int32.TryParse(fields[0], out var weight) {
                    let sensitive = fields.Length > 3 && fields[3].Contains("cs")

                    if fields[2] == "__NOGLOBS__" {
                        own.Add(fields[1])
                    } else if !cleared.Contains(fields[1]) {
                        globs.Add(
                            MimeGlob{
                                Pattern: fields[2],
                                Folded: sensitive ? "": fields[2].ToLowerInvariant(),
                                Type: fields[1],
                                Weight: weight,
                            }
                        )
                    }
                }
            }

            cleared.UnionWith(own)

            for line in file.Aliases {
                let fields = line.Split(' ')

                if fields.Length == 2 && !line.StartsWith('#') {
                    canonical.TryAdd(fields[0], fields[1])
                    link(synonyms, fields[1], fields[0])
                }
            }

            for line in file.Subclasses {
                let fields = line.Split(' ')

                if fields.Length == 2 && !line.StartsWith('#') {
                    link(parents, fields[0], fields[1])
                }
            }
        }
    }

    /// Returns the type matching a file name or an empty string. The highest weight wins, then the longest pattern,
    /// then a case-sensitive match over a case-insensitive one, then the earlier directory.
    internal func Lookup(fileName string) string {
        let lower = fileName.ToLowerInvariant()
        var found = ""
        var best = -1

        for glob in globs {
            let sensitive = glob.Folded == ""
            let score = (glob.Weight * GlobWeightScale + glob.Pattern.Length) * 2 + (sensitive ? 1: 0)

            if score > best && matches(sensitive ? glob.Pattern: glob.Folded, sensitive ? fileName: lower) {
                found = glob.Type
                best = score
            }
        }

        return found
    }

    /// Returns the canonical type followed by its aliases.
    internal func Names(name string) List[string] {
        let root = canonicalName(name)
        let names = List[string]{root}

        if synonyms.TryGetValue(root, out var aliases) {
            names.AddRange(aliases)
        }

        return names
    }

    /// Returns the parent types, nearest first. A text type without a parent descends from text/plain.
    internal func Ancestors(name string) List[string] {
        let found = List[string]{canonicalName(name)}
        var index = 0

        while index < found.Count && found.Count < AncestorLimit {
            let current = found[index]
            index++

            if parents.TryGetValue(current, out var direct) {
                for parent in direct {
                    if !found.Contains(parent) {
                        found.Add(parent)
                    }
                }
            } else if current.StartsWith("text/") && !found.Contains("text/plain") {
                found.Add("text/plain")
            }
        }

        found.RemoveAt(0)

        return found
    }

    private func canonicalName(name string) string -> canonical.TryGetValue(name, out var root) ? root: name

    private func link(table Dictionary[string, List[string]], key string, value string) {
        if !table.TryGetValue(key, out var values) {
            values = List[string]()
            table[key] = values
        }

        values.Add(value)
    }

    private func matches(pattern string, text string) bool {
        var p = 0
        var t = 0
        var star = -1
        var mark = 0

        while t < text.Length {
            if p < pattern.Length && pattern[p] == '*' {
                star = p
                p++
                mark = t
                continue
            }

            let next = p < pattern.Length ? step(pattern, p, text[t]): -1

            if next >= 0 {
                p = next
                t++
            } else if star >= 0 {
                p = star + 1
                mark++
                t = mark
            } else {
                return false
            }
        }

        while p < pattern.Length && pattern[p] == '*' {
            p++
        }

        return p == pattern.Length
    }

    private func step(pattern string, p int32, c char) int32 {
        let head = pattern[p]
        let close = head == '[' ? pattern.IndexOf(']', Math.Min(p + 2, pattern.Length)): -1

        if close < 0 {
            return head == '?' || head == c ? p + 1: -1
        }

        let negated = pattern[p + 1] == '!' || pattern[p + 1] == '^'
        var found = false
        var index = negated ? p + 2: p + 1

        while index < close {
            if index + 2 < close && pattern[index + 1] == '-' {
                found = found || (c >= pattern[index] && c <= pattern[index + 2])
                index += 3
            } else {
                found = found || c == pattern[index]
                index++
            }
        }

        return found != negated ? close + 1: -1
    }
}
