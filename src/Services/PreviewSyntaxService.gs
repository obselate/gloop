package gloop

import System
import System.Collections.Generic

data struct PreviewHighlight {
    internal var Spans[]PreviewStyleSpan
    internal var Limited bool
}

class PreviewSyntaxService {
    shared {
        internal func LanguageFor(extension string) string -> switch extension {
            case ".gs": "gsharp"
            case ".cs": "csharp"
            case ".js": "javascript"
            case ".ts": "typescript"
            case ".json": "json"
            case ".py": "python"
            case ".sh": "shell"
            case ".rs": "rust"
            case ".go": "go"
            case ".yaml" or ".yml" or ".toml": "config"
            case ".xml" or ".html": "markup"
            case ".css": "css"
            default: "plain"
        }

        internal func Highlight(text string, language string, cancelled Func[bool]) PreviewHighlight {
            if language == "plain" || text.Length == 0 {
                return PreviewHighlight{Spans: []PreviewStyleSpan{}}
            }
            let keywords = HashSet[string](
                keywordText(language).Split(' ', StringSplitOptions.RemoveEmptyEntries),
                StringComparer.Ordinal
            )
            let styles = List[PreviewStyleSpan]()
            let hashComments = language == "python" || language == "shell" || language == "config"
            let slashComments = language == "gsharp" || language == "csharp" || language == "javascript"
            || language == "typescript" || language == "rust" || language == "go" || language == "css"
            let blockComments = slashComments
            var index = 0
            var lastCheck = 0
            var inMarkupTag = false
            while index < text.Length {
                if index - lastCheck >= 16384 {
                    if cancelled() {
                        throw OperationCanceledException()
                    }
                    lastCheck = index
                }
                if styles.Count >= 32768 {
                    return PreviewHighlight{Spans: styles.ToArray(), Limited: true}
                }
                let start = index
                let character = text[index]
                if language == "markup" && starts(text, index, "<!--") {
                    index = endOf(text, index + 4, "-->")
                    inMarkupTag = false
                    add(styles, start, index, "comment")
                } else if language == "markup" && !inMarkupTag && character != '<' {
                    index++
                } else if hashComments && character == '#' {
                    index = endOfLine(text, index)
                    add(styles, start, index, "comment")
                } else if slashComments && starts(text, index, "//") {
                    index = endOfLine(text, index)
                    add(styles, start, index, "comment")
                } else if blockComments && starts(text, index, "/*") {
                    index = endOf(text, index + 2, "*/")
                    add(styles, start, index, "comment")
                } else if (language != "markup" || inMarkupTag) &&
                    (
                    character == '"' ||
                        (character == '\'' && language != "json") ||
                        (character == '`' && (language == "javascript" || language == "typescript"))
                ) {
                    let triple = language == "python" || language == "config"
                    let multiline = language == "shell" || language == "markup" || character == '`'
                    index = endOfString(text, index, character, triple, multiline, language != "markup", cancelled)
                    add(styles, start, index, "string")
                } else if language == "markup" && character == '<' {
                    index++
                    inMarkupTag = true
                    if index < text.Length && text[index] == '/' {
                        index++
                    }
                    let name = index
                    while index < text.Length &&
                        (Char.IsLetterOrDigit(text[index]) || text[index] == '-' || text[index] == ':') {
                        index++
                    }
                    add(styles, name, index, "type")
                } else if language == "markup" && character == '>' {
                    inMarkupTag = false
                    index++
                } else if Char.IsDigit(character) {
                    index++
                    while index < text.Length &&
                        (Char.IsLetterOrDigit(text[index]) || text[index] == '.' || text[index] == '_') {
                        index++
                    }
                    add(styles, start, index, "number")
                } else if wordCharacter(character) {
                    index++
                    while index < text.Length && wordCharacter(text[index]) {
                        index++
                    }
                    let word = text.Substring(start, index - start)
                    if keywords.Contains(word) {
                        add(styles, start, index, "keyword")
                    } else if language != "json" && Char.IsUpper(character) {
                        add(styles, start, index, "type")
                    } else if language == "config" &&
                        index < text.Length &&
                        (text[index] == ':' || text[index] == '=') {
                        add(styles, start, index, "type")
                    }
                } else {
                    index++
                }
            }
            return PreviewHighlight{Spans: styles.ToArray()}
        }

        private func starts(text string, index int32, value string) bool ->
        index + value.Length <= text.Length && String.CompareOrdinal(text, index, value, 0, value.Length) == 0

        private func endOf(text string, start int32, suffix string) int32 {
            let end = text.IndexOf(suffix, start, StringComparison.Ordinal)
            return if end < 0 {
                text.Length
            } else {
                end + suffix.Length
            }
        }

        private func endOfLine(text string, start int32) int32 {
            let end = text.IndexOf('\n', start)
            return end < 0 ? text.Length: end
        }

        private func endOfString(
            text string,
            start int32,
            quote char,
            triple bool,
            multiline bool,
            escapes bool,
            cancelled Func[bool]
        ) int32 {
            let repeated = triple && start + 2 < text.Length && text[start + 1] == quote && text[start + 2] == quote
            var index = start + (repeated ? 3: 1)
            var lastCheck = index
            while index < text.Length {
                if index - lastCheck >= 16384 {
                    if cancelled() {
                        throw OperationCanceledException()
                    }
                    lastCheck = index
                }
                if text[index] == '\n' && !multiline && !repeated {
                    return index
                }
                if escapes &&
                    text[index] == '\\' &&
                    index +
                    1 < text.Length &&
                    text[index + 1] == '\n' &&
                    !multiline &&
                    !repeated {
                    return index
                }
                if escapes && text[index] == '\\' {
                    index += 2
                } else if text[index] == quote {
                    if !repeated {
                        return index + 1
                    }
                    if index + 2 < text.Length && text[index + 1] == quote && text[index + 2] == quote {
                        return index + 3
                    }
                    index++
                } else {
                    index++
                }
            }
            return text.Length
        }

        private func wordCharacter(value char) bool -> Char.IsLetterOrDigit(value) || value == '_' || value == '$'

        private func add(styles List[PreviewStyleSpan], start int32, end int32, kind string) {
            if end > start {
                styles.Add(PreviewStyleSpan{Start: start, Length: end - start, Kind: kind})
            }
        }

        private func keywordText(language string) string -> switch language {
            case "json": "true false null"
            case "python": "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield"
            case "shell": "case do done elif else esac fi for function if in local return select then until while"
            case "config": "true false null yes no on off"
            case "markup": ""
            case "css": "important inherit initial unset auto none block flex grid"
            default: "as async await bool break case catch chan class const continue default defer do else enum false finally float for func go if import in int interface internal is let lock namespace new nil null object package private protected public return select send shared static string struct switch this throw true try type uint using var void where while"
        }
    }
}
