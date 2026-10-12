package gloop

import System
import System.Diagnostics

partial class BrowserView {
    private var typedPrefix string = ""
    private var typedAt int64

    private func TypeSelect(text string) bool {
        if Model.IsDisposed || text == "" || text.Length > 256 {
            return false
        }
        for letter in text {
            if Char.IsControl(letter) {
                return false
            }
        }
        let pane = Model.ActivePane()
        if pane.Loading || pane.VisibleEntries.Count == 0 {
            ResetTypeSelect()
            return false
        }
        let now = Stopwatch.GetTimestamp()
        let fresh = typedPrefix == "" || Stopwatch.GetElapsedTime(typedAt, now).TotalMilliseconds > 1000
        var repeated = !fresh && text.Length == 1
        if repeated {
            for letter in typedPrefix {
                if Char.ToUpperInvariant(letter) != Char.ToUpperInvariant(text[0]) {
                    repeated = false
                    break
                }
            }
        }
        var prefix = if fresh || repeated {
            text
        } else {
            typedPrefix + text
        }
        var start = if fresh || repeated {
            pane.Selected + 1
        } else {
            pane.Selected
        }
        if prefix.Length > 256 {
            prefix = text
            start = pane.Selected + 1
        }
        var index = Model.FindPrefix(pane, prefix, start)
        if index < 0 && !fresh && !repeated {
            prefix = text
            index = Model.FindPrefix(pane, prefix, pane.Selected + 1)
        }
        typedAt = now
        typedPrefix = if index >= 0 {
            prefix
        } else {
            ""
        }
        if index < 0 {
            return false
        }
        Model.SelectPrefix(index)
        return true
    }

    private func ResetTypeSelect() {
        typedPrefix = ""
        typedAt = 0
    }
}
