package gloop

import Goo
import System.Collections.Generic

class QuestionPrompt {
    shared {
        internal func Build(question string, detail string, progress string, error string, busy bool, p Palette) Blob {
            let children = List[Blob]()
            children.Add(Text{Content: progress, Color: p.Muted, FontSize: 11})
            children.Add(Text{Content: question, Color: p.Text, FontSize: 17, FontWeight: 600, TextWrap: TextWrap.Wrap})
            children.Add(Text{Content: detail, Color: p.Muted, FontSize: 13, TextWrap: TextWrap.Wrap})
            if error != "" {
                children.Add(
                    Container{
                        MaxHeight: 100,
                        MinHeight: 0,
                        OverflowY: Overflow.Scroll,
                        ScrollbarY: Ui.ScrollbarStyle(p),
                        Text{Content: error, Color: p.Error, FontSize: 12, TextWrap: TextWrap.Wrap},
                    }
                )
            }
            if busy {
                children.Add(Text{Content: "Applying your choice…", Color: p.Muted, FontSize: 12})
            }
            return Container{MinHeight: 0, Gap: 8, Children: children.ToArray()}
        }
    }
}
