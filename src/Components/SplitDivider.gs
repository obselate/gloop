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
                HandleSize: if enabled {
                    1
                } else {
                    0
                },
                Disabled: !enabled,
                AccessibilityName: name,
                OnChange: change,
                CreateRoot: (_, root) -> {
                    root.FlexGrow = 1
                    root.FlexBasis = 0
                    return root
                },
                CreateHandle: (_, divider) -> {
                    divider.ZIndex = 2
                    divider.BackgroundColor = Color.Transparent
                    divider.BorderWidth = if !enabled {
                        Edges{}
                    } else if orientation == SplitOrientation.Horizontal {
                        Edges{Left: 1}
                    } else {
                        Edges{Top: 1}
                    }
                    divider.BorderColor = line ? palette.Border: Color.Transparent
                    divider.Hover = Style{BorderColor: palette.Accent}
                    divider.Focus = palette.FocusBorder()
                    if enabled {
                        divider.Children.Add(
                            Container{
                                Position: PositionType.Absolute,
                                Left: if orientation == SplitOrientation.Horizontal {
                                    -3
                                } else {
                                    0
                                },
                                Right: if orientation == SplitOrientation.Horizontal {
                                    -3
                                } else {
                                    0
                                },
                                Top: if orientation == SplitOrientation.Horizontal {
                                    0
                                } else {
                                    -3
                                },
                                Bottom: if orientation == SplitOrientation.Horizontal {
                                    0
                                } else {
                                    -3
                                },
                                HitTestSelf: true,
                                Cursor: if orientation == SplitOrientation.Horizontal {
                                    Cursor.ResizeHorizontal
                                } else {
                                    Cursor.ResizeVertical
                                },
                            }
                        )
                    }
                    return divider
                },
            }
        )
    }
}
