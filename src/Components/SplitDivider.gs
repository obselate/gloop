package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

class SplitDivider {
    shared {
        internal func Build(
            key string,
            first Blob?,
            second Blob?,
            value float64,
            change Action[float64],
            unit SplitUnit,
            orientation SplitOrientation,
            minimumFirst float64,
            minimumSecond float64,
            name string,
            enabled bool,
            palette Palette,
            line bool = true
        ) Blob -> Cell
            .Mount[SplitPaneInput, SplitPane](
            key,
            SplitPaneInput{
                First: first,
                Second: second,
                Value: value,
                Unit: unit,
                Orientation: orientation,
                MinimumFirst: if enabled {
                    minimumFirst
                } else {
                    0
                },
                MinimumSecond: if enabled {
                    minimumSecond
                } else {
                    0
                },
                HandleSize: enabled ? 8: 0,
                HandleColor: enabled && line ? palette.Border: Color.Transparent,
                Disabled: !enabled,
                AccessibilityName: name,
                OnChange: change,
                ConfigureRoot: (_, root) -> {
                    root.FlexGrow = 1
                    root.FlexBasis = 0
                },
            }
        )
    }
}
