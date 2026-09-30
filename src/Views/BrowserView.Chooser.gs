package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private var chooser FileChooserService?
    private var chooserName string = ""
    private var chooserFilterIndex int32
    private var chooserError string = ""
    private var chooserDirectory string = ""
    private let chooserNameHandle ElementHandle = ElementHandle()
    private let chooserChoices Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
    private var chooserResult PortalChooserResult = PortalChooserResult()

    internal prop ChooserResult PortalChooserResult {
        get -> chooserResult
    }

    private func AttachChooser(request PortalChooserRequest) FileChooserService {
        let picker = FileChooserService(request)
        chooser = picker
        Model.SelectFirstEntry = !request.Directory && !picker.SavingMany
        chooserName = picker.InitialName
        if let current = request.CurrentFilter {
            if request.Filters.Count == 0 {
                request.Filters.Add(current)
            }
        }
        for index in 0 ... request.Filters.Count {
            if SameChooserFilter(request.Filters[index], request.CurrentFilter) {
                chooserFilterIndex = index
                break
            }
        }
        for choice in request.Choices {
            chooserChoices[choice.Id] = choice.Selected != "" ? choice.Selected: choice
                .Options
                .Count > 0 ? choice
                .Options[0]
                .Id: "false"
        }
        Model.SetEntryFilter(picker.CreateEntryFilter(ChooserFilter()))
        return picker
    }

    private func SameChooserFilter(first PortalFilter, second PortalFilter?) bool {
        guard let other = second else {
            return false
        }
        if first.Name != other.Name || first.Patterns.Count != other.Patterns.Count {
            return false
        }
        for index in 0 ... first.Patterns.Count {
            if first
                .Patterns[index]
                .Type != other
                .Patterns[index]
                .Type ||
                first
                .Patterns[index]
                .Value != other
                .Patterns[index]
                .Value {
                return false
            }
        }
        return true
    }

    private func ChooserFilter() PortalFilter? {
        guard let picker = chooser else {
            return nil
        }
        let filters = picker.Request.Filters
        return chooserFilterIndex >= 0 && chooserFilterIndex < filters.Count ? filters[chooserFilterIndex]: nil
    }

    private func ChooserBar() Blob {
        guard let picker = chooser else {
            return Container{}
        }
        return Cell.Mount[FileChooserBarInput, FileChooserBar](
            "chooser-bar",
            FileChooserBarInput{
                Request: picker.Request,
                Name: chooserName,
                NameHandle: chooserNameHandle,
                OnNameChange: value -> {
                    chooserName = value
                    chooserError = ""
                    Rebuild()
                },
                FilterIndex: chooserFilterIndex,
                OnFilterChange: index -> {
                    chooserFilterIndex = index
                    chooserError = ""
                    Model.SetEntryFilter(picker.CreateEntryFilter(ChooserFilter()))
                },
                Choices: chooserChoices,
                OnChoiceChange: (id, value) -> {
                    chooserChoices[id] = value
                    Rebuild()
                },
                Summary: if picker.SavingMany {
                    picker.Request.Files.Count.ToString() + " files in " + FolderName(ChooserDestination())
                } else if picker.Request.Directory && Model.SelectedCount() == 0 {
                    "Current folder"
                } else if Model.SelectedCount() > 1 {
                    Model.SelectedCount().ToString() + " selected"
                } else {
                    Model.SelectionSummary()
                },
                Error: chooserError,
                OnAccept: () -> AcceptChooser(),
                OnCancel: CancelChooser,
                OverlayHost: rootHandle,
                Host: Host,
                Palette: palette,
            }
        )
    }

    private func ChooserDestination() string {
        if let entry = Model.SingleSelectedEntry() {
            if entry.IsDirectory {
                return entry.FullPath
            }
        }
        return Model.ActivePane().DirectoryPath
    }

    private func ChooserSelectionChanged() {
        guard let picker = chooser else {
            return
        }
        chooserError = ""
        if picker.Saving {
            if let entry = Model.SingleSelectedEntry() {
                if !entry.IsDirectory {
                    chooserName = entry.Name
                }
            }
        }
    }

    private func OpenBrowserSelection(doubleClick bool = false) {
        guard let picker = chooser else {
            Model.OpenSelected()
            return
        }
        if let entry = Model.SelectedEntry() {
            if entry.IsDirectory && (doubleClick || !picker.Request.Directory || picker.SavingMany) {
                Model.Navigate(entry.FullPath)
                return
            }
            if picker.Saving && !entry.IsDirectory {
                chooserName = entry.Name
            }
            if picker.Request.Method == "OpenFile" && !picker.Request.Directory
            && !entry.IsDirectory && Model.SelectedCount() == 0 {
                Model.Select(Model.ActivePane().Selected)
            }
        }
        AcceptChooser()
    }

    private func AcceptChooser(replace bool = false) {
        guard let picker = chooser else {
            return
        }
        let pane = Model.ActivePane()
        if pane.Loading || pane.Error != "" {
            chooserError = pane.Loading ? "Wait for the folder to finish loading.": pane.Error
            Rebuild()
            return
        }
        if picker.Request.Method == "OpenFile" && !picker.Request.Directory && Model.SelectedCount() == 1 {
            if let entry = Model.SingleSelectedEntry() {
                if entry.IsDirectory {
                    Model.Navigate(entry.FullPath)
                    return
                }
            }
        }
        let validation = picker.Validate(pane, chooserName, ChooserFilter(), chooserChoices, replace)
        if validation.Error != "" {
            chooserError = validation.Error
            Rebuild()
            return
        }
        if validation.ReplacePaths.Count > 0 {
            OpenDialog("Replace file", String.Join("\n", validation.ReplacePaths))
            return
        }
        if let result = validation.Result {
            chooserResult = result
            Host.RequestClose()
        }
    }

    private func CancelChooser() {
        chooserResult = PortalChooserResult()
        Host.RequestClose()
    }

    private func ChooserActionAllowed(action string) bool -> action != "Cut" && action != "Copy"
    && action != "Paste" && action != "Trash" && action != "Rename" && action != "ToggleSplit"
    && action != "NextPane" && action != "OpenTerminal" && action != "ToggleBookmark" && action != "OpenSettings"

    private func ChooserAllowsMultiple() bool -> chooser == nil ||
        (chooser?.Request.Method == "OpenFile" && (chooser?.Request.Multiple ?? false))

    private func ChooserTitle() string {
        guard let request = launch.ChooserRequest else {
            return Model.ActivePane().DirectoryPath
        }
        return request.Title != "" ? request.Title: request.Method != "OpenFile" ? "Save files": request.Directory ? "Select folder": "Open files"
    }
}
