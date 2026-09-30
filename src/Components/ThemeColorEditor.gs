package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Colors
import System

internal data struct ThemeColorEditorInput {
    var Role string
    var Value int32
    var WheelSize float64
    var Gap float64
    var FocusColor Color
    var Change Action[int32]
}

open class ThemeColorEditor : Cell[ThemeColorEditorInput] {
    private let wheelHandle ElementHandle = ElementHandle()
    private let sliderHandle ElementHandle = ElementHandle()

    protected override func Build(value ThemeColorEditorInput) Blob -> Cell.Mount[ColorPickerInput, ColorPicker](
        "picker",
        ColorPickerInput{
            Value: value.Value,
            Mode: ColorMode.Oklch,
            Compact: true,
            WheelSize: value.WheelSize,
            Gap: value.Gap,
            AccessibilityName: value.Role,
            ShowFocusHighlight: true,
            FocusOutlineColor: value.FocusColor,
            OnValueChanged: value.Change,
            CreateRoot: (input, wheel, slider) -> Container{
                Width: input.WheelSize,
                Gap: input.Gap ?? 12,
                AlignItems: AlignItems.Stretch,
                Container{Handle: wheelHandle, OnFocus: (_) -> wheelHandle.ScrollIntoView(), wheel,},
                Container{Handle: sliderHandle, OnFocus: (_) -> sliderHandle.ScrollIntoView(), slider,},
            },
        }
    )

    shared {
        internal func Build(
            role string,
            color int32,
            wheelSize float64,
            gap float64,
            focusColor Color,
            change Action[int32]
        ) Blob ->
        Cell.Mount[ThemeColorEditorInput, ThemeColorEditor](
            nil,
            ThemeColorEditorInput{
                Role: role,
                Value: color,
                WheelSize: wheelSize,
                Gap: gap,
                FocusColor: focusColor,
                Change: change,
            }
        )
    }
}
