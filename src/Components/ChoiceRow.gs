package gloop

import Goo
import Goo.Widgets
import System

class ChoiceRow {
    shared {
        internal func Build(
            name string,
            label Blob,
            leading Blob,
            trailing Blob,
            selected bool,
            choose Action,
            handle ElementHandle,
            p Palette,
            height float64,
            gap float64
        ) Blob {
            let button = Button{
                Handle: handle,
                Height: height,
                FlexShrink: 0,
                MinWidth: 0,
                Padding: Edges{Left: 10, Right: 10},
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: gap,
                BorderWidth: 1,
                BorderRadius: 4,
                BorderColor: selected ? p.Accent: p.Border,
                BackgroundColor: p.Background,
                Hover: Style{BorderColor: p.Accent},
                Focus: p.Ring(),
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: name, Selected: selected},
                OnClick: choose,
                OnFocus: (_) -> handle.ScrollIntoView(),
                leading,
                Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, label},
                trailing,
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }
    }
}
