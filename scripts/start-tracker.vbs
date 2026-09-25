' Silent launcher for track-activity.mjs on Windows (native Node, no WSL).
'
' Install: Task Scheduler -> Create Task -> Action: wscript.exe with this file as the
' argument. Or drop a shortcut into shell:startup for the simpler, no-restart version.
'
' Two rules this file exists to honour:
'
'   1. Never MsgBox. Under Task Scheduler a dialog renders on an invisible desktop and
'      blocks wscript forever -- the task reports "running" while doing nothing at all.
'      Every failure goes to launcher.log instead.
'
'   2. Never rely on PATH to find Node. A scheduled task does not inherit the same
'      environment as an interactive console, so "node" alone can fail to resolve.
'
' The project directory is derived from this script's own location, so there is nothing
' to edit regardless of where the repo is cloned or under which username.

Option Explicit

Dim fso, shell, scriptsDir, projectDir, tracker, nodeExe, logFile

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptsDir)
tracker    = fso.BuildPath(scriptsDir, "track-activity.mjs")
logFile    = fso.BuildPath(projectDir, "launcher.log")

Sub LogLine(msg)
    On Error Resume Next
    Dim f
    Set f = fso.OpenTextFile(logFile, 8, True)   ' 8 = append, True = create if absent
    f.WriteLine Now & "  " & msg
    f.Close
End Sub

' Checks the usual install locations before falling back to PATH resolution.
Function FindNode()
    Dim candidates, i, p
    candidates = Array( _
        shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
        shell.ExpandEnvironmentStrings("%ProgramW6432%\nodejs\node.exe"), _
        shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
        shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe"), _
        shell.ExpandEnvironmentStrings("%APPDATA%\nvm\node.exe") _
    )

    For i = 0 To UBound(candidates)
        p = candidates(i)
        If fso.FileExists(p) Then
            FindNode = p
            Exit Function
        End If
    Next

    FindNode = ""
End Function

If Not fso.FileExists(tracker) Then
    LogLine "ERROR  tracker script not found: " & tracker
    WScript.Quit 1
End If

If Not fso.FolderExists(fso.BuildPath(projectDir, "node_modules")) Then
    LogLine "ERROR  node_modules missing -- run 'npm install' in " & projectDir
    WScript.Quit 1
End If

nodeExe = FindNode()
If nodeExe = "" Then
    LogLine "ERROR  node.exe not found in any known location. Install Node, or add its path to FindNode()."
    WScript.Quit 1
End If

' Run from the project root so .env.local and node_modules resolve.
' 0 = hidden window, False = do not wait for it to exit.
On Error Resume Next
shell.CurrentDirectory = projectDir
shell.Run """" & nodeExe & """ """ & tracker & """", 0, False

If Err.Number <> 0 Then
    LogLine "ERROR  could not launch node (" & Err.Number & "): " & Err.Description
    WScript.Quit 1
End If

LogLine "started  " & nodeExe
