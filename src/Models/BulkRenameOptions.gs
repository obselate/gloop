package gloop

import System
import System.Collections.Generic
import System.Globalization
import System.IO
import System.Text.RegularExpressions

class BulkRenameOptions {
    internal var Find string = ""
    internal var Replace string = ""
    internal var UseRegex bool
    internal var Pattern string = ""
    internal var Start string = "1"
    internal var Padding string = "1"
    internal var Case string = "Keep case"

    internal func Names(sources List[string]) List[string] {
        var start int64
        var padding int32

        if Pattern != "" &&
            (!Int64.TryParse(Start, out start) || start < 0 || start > Int64.MaxValue - int64(sources.Count)) {
            throw ArgumentException("Numbering start must be a non-negative whole number")
        }
        if Pattern != "" && (!Int32.TryParse(Padding, out padding) || padding < 1 || padding > 20) {
            throw ArgumentException("Number padding must be between 1 and 20")
        }

        let regex Regex? = if UseRegex && Find != "" {
            Regex(Find, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50))
        } else {
            nil
        }
        let names = List[string](sources.Count)

        for index in 0 ... sources.Count {
            var name = Path.GetFileName(sources[index])

            if Pattern != "" {
                name = Pattern.Replace(
                    "{n}",
                    (start + int64(index)).ToString(CultureInfo.InvariantCulture).PadLeft(padding, '0')
                )
            }
            if Find != "" {
                name = regex?.Replace(name, Replace) ?? name.Replace(Find, Replace, StringComparison.Ordinal)
            }

            names.Add(
                switch Case {
                    case "lowercase": name.ToLowerInvariant()
                    case "UPPERCASE": name.ToUpperInvariant()
                    default: name
                }
            )
        }

        return names
    }
}
