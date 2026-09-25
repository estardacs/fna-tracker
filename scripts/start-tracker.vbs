' Silent autostart for track-activity.mjs on Windows (native Node, no WSL).
'
' Install: press Win+R, run  shell:startup  , and drop a shortcut to this file there.
' It launches Node with no console window and does not wait for it to finish.
'
' Adjust TRACKER_DIR to wherever the project lives on this machine.

Const TRACKER_DIR = "C:\Users\estarducs\fna-tracker"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

script = fso.BuildPath(TRACKER_DIR, "scripts\track-activity.mjs")

If Not fso.FileExists(script) Then
    MsgBox "Tracker not found at:" & vbCrLf & script & vbCrLf & vbCrLf & _
           "Edit TRACKER_DIR in start-tracker.vbs.", vbExclamation, "fna-tracker"
    WScript.Quit 1
End If

' 0 = hidden window, False = don't wait. Quotes guard paths containing spaces.
shell.CurrentDirectory = TRACKER_DIR
shell.Run "node """ & script & """", 0, False
