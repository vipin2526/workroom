// Cross-platform OS sleep blocker for 24/7 agents running long tasks on laptops/workstations.
// On Windows: invokes kernel32 SetThreadExecutionState
// On macOS: invokes caffeinate -d -i
// On Linux: invokes systemd-inhibit or keeps wake lock

import { spawn } from 'node:child_process';
import os from 'node:os';

let blockerProcess = null;

export function enableSleepBlocker(reason = 'RoomForge Agent active task') {
  const platform = os.platform();

  if (platform === 'darwin') {
    if (!blockerProcess) {
      blockerProcess = spawn('caffeinate', ['-d', '-i', '-s'], { stdio: 'ignore' });
      blockerProcess.unref();
      console.log(`[SleepBlocker] macOS caffeinate active: ${reason}`);
    }
  } else if (platform === 'win32') {
    // Windows PowerShell call to SetThreadExecutionState (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED = 0x80000001)
    if (!blockerProcess) {
      const psCommand = `
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class WinPower {
            [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
            public static extern uint SetThreadExecutionState(uint esFlags);
        }
"@
        [WinPower]::SetThreadExecutionState(0x80000001);
        Start-Sleep -Seconds 86400;
      `;
      blockerProcess = spawn('powershell', ['-NoProfile', '-Command', psCommand], { stdio: 'ignore' });
      blockerProcess.unref();
      console.log(`[SleepBlocker] Windows execution state locked: ${reason}`);
    }
  } else if (platform === 'linux') {
    if (!blockerProcess) {
      blockerProcess = spawn('systemd-inhibit', ['--what=sleep:idle', `--why=${reason}`, 'sleep', '86400'], { stdio: 'ignore' });
      blockerProcess.unref();
      console.log(`[SleepBlocker] Linux systemd-inhibit active: ${reason}`);
    }
  }
}

export function disableSleepBlocker() {
  if (blockerProcess) {
    try {
      blockerProcess.kill();
    } catch {}
    blockerProcess = null;
    console.log('[SleepBlocker] Sleep lock released.');
  }
}
