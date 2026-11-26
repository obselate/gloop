package gloop

import Goo
import System
import System.ComponentModel
import System.Diagnostics
import System.IO
import System.Runtime.InteropServices
import System.Text
import System.Threading

unsafe class MediaPreview {
    shared {
        private const MaximumEdge int32 = 2048
        private const MaximumOutputBytes int32 = 16777216
        private const MaximumErrorCharacters int32 = 4096
        private const TimeoutMilliseconds int32 = 15000
        private const MaximumMemoryBytes uint64 = 536870912

        internal func Supports(extension string) bool -> extension.ToLowerInvariant() is
        ".pdf" or ".mp4" or ".mkv" or ".webm" or ".wav" or ".flac" or ".mp3" or ".ogg" or ".bmp" or ".tif" or ".tiff"

        internal func Load(path string, width int32, height int32, token CancellationToken) ImageSource {
            token.ThrowIfCancellationRequested()
            let fullPath = Path.GetFullPath(path)
            let extension = Path.GetExtension(fullPath).ToLowerInvariant()

            if !Supports(extension) {
                throw NotSupportedException("This media format has no preview renderer.")
            }

            let targetWidth = Math.Clamp(width, 1, MaximumEdge)
            let targetHeight = Math.Clamp(height, 1, MaximumEdge)
            let pdf = extension == ".pdf"
            let tool = if pdf {
                "pdftoppm"
            } else {
                "ffmpeg"
            }
            let start = ProcessStartInfo(tool)
            start.UseShellExecute = false
            start.CreateNoWindow = true
            start.RedirectStandardInput = true
            start.RedirectStandardOutput = true
            start.RedirectStandardError = true

            if pdf {
                Add(
                    start,
                    []string{
                        "-f",
                        "1",
                        "-l",
                        "1",
                        "-singlefile",
                        "-png",
                        "-scale-to",
                        Math.Min(targetWidth, targetHeight).ToString(),
                        fullPath
                    }
                )
            } else {
                let format = switch extension {
                    case ".mp4": "mov"
                    case ".mkv" or ".webm": "matroska"
                    case ".wav": "wav"
                    case ".flac": "flac"
                    case ".mp3": "mp3"
                    case ".bmp": "bmp_pipe"
                    case ".tif" or ".tiff": "tiff_pipe"
                    default: "ogg"
                }
                let audio = extension is ".wav" or ".flac" or ".mp3" or ".ogg"
                Add(
                    start,
                    []string{
                        "-nostdin",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-nostats",
                        "-max_alloc",
                        "67108864",
                        "-cpucount",
                        "1",
                        "-threads",
                        "1",
                        "-filter_threads",
                        "1",
                        "-filter_complex_threads",
                        "1",
                        "-protocol_whitelist",
                        "file",
                        "-format_whitelist",
                        format,
                        "-probesize",
                        "1048576",
                        "-analyzeduration",
                        "1000000",
                        "-f",
                        format
                    }
                )

                if format == "mov" {
                    Add(start, []string{"-enable_drefs", "0", "-use_absolute_path", "0"})
                }

                if audio {
                    Add(start, []string{"-t", "30"})
                }

                Add(start, []string{"-i", "file:" + fullPath, "-threads", "1"})

                if audio {
                    Add(
                        start,
                        []string{
                            "-filter_complex",
                            "[0:a:0]aformat=channel_layouts=mono,aresample=8000,showwavespic=s=" +
                                targetWidth.ToString() + "x" + targetHeight.ToString() +
                                ":colors=0x9eb7d5:scale=sqrt[wave]",
                            "-map",
                            "[wave]"
                        }
                    )
                } else {
                    Add(
                        start,
                        []string{
                            "-map",
                            "0:v:0",
                            "-an",
                            "-sn",
                            "-dn",
                            "-vf",
                            "scale=" + targetWidth.ToString() + ":" + targetHeight.ToString() +
                                ":force_original_aspect_ratio=decrease"
                        }
                    )
                }

                Add(start, []string{"-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"})
            }

            using let process = Start(start, pdf)
            using let output = MemoryStream()
            let errors = StringBuilder()

            scope {
                go ReadOutput(process, output)
                go ReadErrors(process, errors)

                try {
                    LimitResources(process)
                    process.StandardInput.Close()
                    let timer = Stopwatch.StartNew()

                    while !process.WaitForExit(25) {
                        token.ThrowIfCancellationRequested()

                        if timer.ElapsedMilliseconds >= TimeoutMilliseconds {
                            throw IOException(tool + " preview timed out after 15 seconds.")
                        }

                        process.Refresh()

                        if uint64(process.WorkingSet64) > MaximumMemoryBytes {
                            throw IOException(tool + " preview exceeded the 512 MiB memory limit.")
                        }
                    }
                } finally {
                    Stop(process)
                }
            }

            token.ThrowIfCancellationRequested()

            if output.Length > MaximumOutputBytes {
                throw IOException(tool + " preview exceeded the 16 MiB output limit.")
            }

            if process.ExitCode != 0 || output.Length == 0 {
                throw IOException(tool + " could not render this file: " + errors.ToString().Trim())
            }

            output.Position = 0
            return ImageSource.Decode(
                output,
                ImageDecodeLimits{
                    MaxEncodedBytes: MaximumOutputBytes,
                    MaxPixelsPerSide: MaximumEdge,
                    MaxDecodedBytes: MaximumOutputBytes
                },
                token
            )
        }

        private func Add(start ProcessStartInfo, arguments[]string) {
            for argument in arguments {
                start.ArgumentList.Add(argument)
            }
        }

        private func Start(start ProcessStartInfo, pdf bool) Process {
            try {
                return Process.Start(start) ?? throw IOException("Could not start " + start.FileName + ".")
            } catch (failure Win32Exception) {
                throw IOException(
                    "Install " +
                        (
                        if pdf {
                            "Poppler (pdftoppm)"
                        } else {
                            "FFmpeg (ffmpeg)"
                        }
                    ) +
                        " and put it on PATH to preview this file. " +
                        failure.Message,
                    failure
                )
            }
        }

        private func LimitResources(process Process) {
            let limits *uint64 = stackalloc[2]uint64
            limits[0] = MaximumMemoryBytes
            limits[1] = MaximumMemoryBytes

            if setResourceLimit(process.Id, 2, IntPtr(limits), IntPtr.Zero) != 0 {
                let error = Marshal.GetLastWin32Error()

                if process.HasExited {
                    return
                }

                throw IOException("Could not limit preview helper memory.", Win32Exception(error))
            }

            limits[0] = 2147483648
            limits[1] = 2147483648

            if setResourceLimit(process.Id, 9, IntPtr(limits), IntPtr.Zero) != 0 {
                let error = Marshal.GetLastWin32Error()

                if !process.HasExited {
                    throw IOException("Could not limit preview helper address space.", Win32Exception(error))
                }
            }
        }

        private func Stop(process Process) {
            lock process {
                try {
                    if !process.HasExited {
                        process.Kill(true)
                    }
                } catch (failure Win32Exception) when failure.NativeErrorCode == 3 { } catch (
                    failure InvalidOperationException
                ) when process.HasExited { }

                process.WaitForExit()
            }
        }

        private func ReadOutput(process Process, output MemoryStream) {
            try {
                let buffer = [16384]uint8
                let input = process.StandardOutput.BaseStream
                var count = input.Read(buffer, 0, buffer.Length)

                while count > 0 {
                    output.Write(buffer, 0, Math.Min(count, MaximumOutputBytes + 1 - int32(output.Length)))

                    if output.Length > MaximumOutputBytes {
                        Stop(process)
                        return
                    }

                    count = input.Read(buffer, 0, buffer.Length)
                }
            } catch (failure Exception) {
                Stop(process)
                throw IOException("Could not read the media preview image.", failure)
            }
        }

        private func ReadErrors(process Process, errors StringBuilder) {
            try {
                let buffer = [1024]char
                let input = process.StandardError
                var count = input.Read(buffer, 0, buffer.Length)

                while count > 0 {
                    errors.Append(buffer, 0, Math.Min(count, MaximumErrorCharacters - errors.Length))
                    count = input.Read(buffer, 0, buffer.Length)
                }
            } catch (failure Exception) {
                Stop(process)
                throw IOException("Could not read the media preview diagnostic.", failure)
            }
        }

        @DllImport("libc", EntryPoint: "prlimit64", SetLastError: true)
        private func setResourceLimit(processId int32, resource int32, limits IntPtr, previous IntPtr) int32;
    }
}
