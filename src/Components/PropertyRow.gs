package gloop

import Goo
import System

class PropertyRow {
    shared {
        internal func Build(
            label string,
            value string,
            p Palette,
            labelWidth float64 = 62,
            size float64 = 11,
            wrap bool = false
        ) Blob {
            let text Blob = wrap ?
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Text{Content: value, Color: p.Text, FontSize: size, TextWrap: TextWrap.Wrap},
            }: Ui.Label(value, p.Text, size)
            return Container{
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                Gap: 8,
                Container{Width: labelWidth, FlexShrink: 0, Ui.Label(label, p.Muted, size)},
                text,
            }
        }
    }
}
