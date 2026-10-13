package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class ThemePalette {
    internal var Background string
    internal var Surface string
    internal var Text string
    internal var MutedText string
    internal var Accent string
    internal var Border string
    internal var Selection string

    internal init() {
        Background = "#090B10"
        Surface = "#161A22"
        Text = "#ECEDED"
        MutedText = "#B8BFC9"
        Accent = "#478AD1"
        Border = "#2A303B"
        Selection = "#17273A"
    }

    internal func Clone() ThemePalette {
        let copy = ThemePalette()
        copy.ApplyFrom(this)
        return copy
    }

    internal func ApplyFrom(source ThemePalette) {
        Background = source.Background
        Surface = source.Surface
        Text = source.Text
        MutedText = source.MutedText
        Accent = source.Accent
        Border = source.Border
        Selection = source.Selection
    }

    internal func ColorFor(role string) string -> switch role {
        case "Background": Background
        case "Surface": Surface
        case "Text": Text
        case "Muted text": MutedText
        case "Accent": Accent
        case "Border": Border
        case "Selection": Selection
        default: ""
    }

    internal func SetColor(role string, color string) {
        if role == "Background" {
            Background = color
        } else if role == "Surface" {
            Surface = color
        } else if role == "Text" {
            Text = color
        } else if role == "Muted text" {
            MutedText = color
        } else if role == "Accent" {
            Accent = color
        } else if role == "Border" {
            Border = color
        } else if role == "Selection" {
            Selection = color
        }
    }
}
