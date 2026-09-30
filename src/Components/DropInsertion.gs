package gloop

import Goo

class DropInsertion {
    shared {
        internal func Build(target DropTarget, active bool, name string, p Palette) Blob -> Container{
            Height: 8,
            FlexShrink: 0,
            JustifyContent: JustifyContent.Center,
            Padding: Edges{Left: 10, Right: 8},
            DropTarget: target,
            Accessibility: Accessibility{Name: name},
            Container{Height: 1, BackgroundColor: active ? p.Accent: Color.Transparent},
        }
    }
}
