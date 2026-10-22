' Windowless launcher. Task Scheduler owns this process, independently of editors.
Option Explicit
Dim shell, files, folder, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -ExecutionPolicy Bypass -File """ & folder & "\Run-BackgroundTracker.ps1"""
Do
  result = shell.Run(command, 0, True)
  WScript.Sleep 5000
Loop
