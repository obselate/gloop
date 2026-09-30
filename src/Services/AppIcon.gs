package gloop

import System
import System.IO

internal class AppIcon {
    shared {
        internal func Bytes()[]uint8 {
            using let stream = typeof(AppIcon).Assembly.GetManifestResourceStream("gloop.Icon.png")
            ?? throw InvalidOperationException("Embedded Gloop icon is missing")
            using let output = MemoryStream()
            stream.CopyTo(output)
            return output.ToArray()
        }
    }
}
