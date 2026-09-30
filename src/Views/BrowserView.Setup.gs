package gloop

import Goo
import Goo.Widgets
import System

partial class BrowserView {
    private var setupStep int32
    private var setupFirstStep int32
    private var setupBusy bool
    private var setupChooserChanged bool
    private var setupAccepted bool = true
    private var setupCompletion chan[bool]?
    private let setupChoiceHandle ElementHandle = ElementHandle()

    private func OpenSetup() {
        if chooser != nil || setupBusy {
            return
        }
        CloseDialog()
        setupStep = 0
        setupChooserChanged = false
        setupAccepted = true
        var error = ""
        try {
            if FirstRunSetup.IsSystemRegistered() {
                setupStep = 1
            }
        } catch (failure Exception) {
            error = failure.Message
        }
        setupFirstStep = setupStep
        OpenDialog("Desktop setup", "")
        dialogError = error
    }

    private func SetupDialog() Blob {
        let p = palette
        let question = switch setupStep {
            case 0: "Add Gloop to your app menu?"
            case 1: "Use Gloop to open folders by default?"
            case 2: "Use Gloop for open and save dialogs?"
            default: "All set"
        }
        let detail = switch setupStep {
            case 0: "Includes the launcher, app icon, and desktop app details. Needed to use Gloop as a desktop default."
            case 1: "Folders opened from other apps will open in Gloop."
            case 2: "Works with apps that use the system file picker. Apps with custom dialogs may keep their own picker."
            default: if setupChooserChanged {
                "Log out and back in, then restart apps to use Gloop for open and save dialogs."
            } else {
                "You can revisit Desktop setup in Preferences at any time."
            }
        }
        let progress = setupStep < 3 ? (setupStep - setupFirstStep + 1).ToString() +
            " of " +
            (3 - setupFirstStep).ToString(): "Setup complete"
        let actions = Container{FlexDirection: FlexDirection.Row, JustifyContent: JustifyContent.FlexEnd, Gap: 8}
        if setupStep < 3 {
            let no = Ui.ActionButton("No", () -> AnswerSetup(false), p, handle: setupChoiceHandle)
            no.Disabled = setupBusy
            let yes = Ui.ActionButton(
                dialogError == "" ? "Yes": "Try again",
                () -> AnswerSetup(dialogError == "" || setupAccepted),
                p,
                true
            )
            yes.Disabled = setupBusy
            actions.Children = []Blob{no, yes}
        } else {
            let done = Ui.ActionButton("Start browsing", () -> CloseDialog(), p, true, setupChoiceHandle)
            actions.Children = []Blob{done}
        }
        return DialogShell.Build(
            "Desktop setup",
            QuestionPrompt.Build(question, detail, progress, dialogError, setupBusy, p),
            actions,
            dialogHandle,
            () -> CloseDialog(),
            HandleKey,
            WidgetKeyBindings.Editing(window?.PlatformInput),
            Host,
            p,
            480,
            true,
            setupBusy
        )
    }

    private func AnswerSetup(accept bool) {
        if setupBusy || setupStep >= 3 {
            return
        }
        let next = setupStep == 0 && !accept ? 3: setupStep + 1
        setupAccepted = accept
        setupBusy = true
        dialogError = ""
        let done = chan[bool](1)
        setupCompletion = done
        go ApplySetupChoice(setupStep, accept, next, done)
        Rebuild()
    }

    private func ApplySetupChoice(step int32, accept bool, next int32, done chan[bool]) {
        var error = ""
        try {
            if accept {
                let action = switch step {
                    case 0: SetupAction.Launcher
                    case 1: SetupAction.Folders
                    default: SetupAction.Chooser
                }
                FirstRunSetup.Apply(action)
            }
            if next == 3 {
                FirstRunSetup.Complete()
            }
        } catch (failure Exception) {
            error = failure.Message
        }
        try {
            Host.Post(
                () -> {
                    setupBusy = false
                    dialogError = error
                    if error == "" {
                        setupStep = next
                        setupChooserChanged = setupChooserChanged || (step == 2 && accept)
                    }
                    Rebuild()
                    Host.Post(
                        () -> {
                            if dialog == "Desktop setup" && !setupBusy {
                                setupChoiceHandle.Focus()
                            }
                        }
                    )
                }
            )
        } finally {
            done.Close()
        }
    }
}
