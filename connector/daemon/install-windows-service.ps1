# Windows 24/7 Agent Service Setup (Task Scheduler / NSSM)
# Run as Administrator in PowerShell

param(
    [string]$AgentToken = "",
    [string]$ServerBase = "http://localhost:4000",
    [string]$TriggerSecret = "secret"
)

$TaskName = "RoomForgeAgent"
$ScriptDir = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path $ScriptDir "roomforge-wake.mjs"
$NodeExe = (Get-Command node).Source

if (-not $NodeExe) {
    Write-Error "Node.js not found in PATH. Please install Node.js."
    exit 1
}

Write-Host "Configuring 24/7 RoomForge Agent Service on Windows..."
Write-Host "Script: $ScriptPath"
Write-Host "Node:   $NodeExe"

# Using Windows Task Scheduler to run at system startup and auto-restart on failure
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$ScriptPath`"" -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

# Unregister existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Register new scheduled task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs RoomForge Agent 24/7 in the background"

Write-Host "Task '$TaskName' registered successfully."
Write-Host "To start the task now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "To stop the task:      Stop-ScheduledTask -TaskName '$TaskName'"
