' Silent autostart for track-activity.mjs on Windows (native Node, no WSL).
'
' Install: press Win+R, run  shell:startup  , and drop a SHORTCUT to this file there.
'
' The project directory is resolved from this script's own location, so there is
' nothing to edit — it works from wherever the repo is cloned, under any username.

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptsDir)
tracker = fso.BuildPath(scriptsDir, "track-activity.mjs")

If Not fso.FileExists(tracker) Then
    MsgBox "Tracker not found at:" & vbCrLf & tracker, vbExclamation, "fna-tracker"
    WScript.Quit 1
End If

If Not fso.FolderExists(fso.BuildPath(projectDir, "node_modules")) Then
    MsgBox "Dependencies are missing. Run this first:" & vbCrLf & vbCrLf & _
           "cd """ & projectDir & """" & vbCrLf & "npm install", _
           vbExclamation, "fna-tracker"
    WScript.Quit 1
End If

' Run from the project root so .env.local and node_modules resolve.
' 0 = hidden window, False = don't wait for it to exit.
shell.CurrentDirectory = projectDir
shell.Run "node """ & tracker & """", 0, False
