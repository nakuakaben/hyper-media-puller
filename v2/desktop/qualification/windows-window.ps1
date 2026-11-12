param(
  [Parameter(Mandatory)][int]$AppProcess,
  [Parameter(Mandatory)][ValidateSet('folder', 'resize', 'close')][string]$Action
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public static class Native {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int w, int h, bool redraw);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder buffer, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder buffer, int max);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  static string Title(IntPtr window) { var b = new StringBuilder(512); GetWindowText(window, b, b.Capacity); return b.ToString(); }
  static string Class(IntPtr window) { var b = new StringBuilder(128); GetClassName(window, b, b.Capacity); return b.ToString(); }
  public static IntPtr Picker(uint process) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr window, IntPtr unused) {
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid == process && IsWindowVisible(window) && Title(window) == "Choisir une destination HMP V2") {
        found = window;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string Windows(uint process) {
    var found = new List<string>();
    EnumWindows(delegate(IntPtr window, IntPtr unused) {
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid == process && IsWindowVisible(window)) found.Add(Class(window) + " / " + Title(window));
      return true;
    }, IntPtr.Zero);
    return String.Join(" | ", found.ToArray());
  }
  public static IntPtr ConfirmButton(IntPtr dialog) {
    IntPtr button = IntPtr.Zero;
    EnumChildWindows(dialog, delegate(IntPtr window, IntPtr unused) {
      if (IsWindowVisible(window) && Class(window) == "Button" && GetDlgCtrlID(window) == 1) {
        button = window;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return button;
  }

}
'@
if ($Action -eq 'folder') {
  $scope = [System.Windows.Automation.TreeScope]
  $automation = [System.Windows.Automation.AutomationElement]
  $property = [System.Windows.Automation.AutomationElementIdentifiers]
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  do {
    $handle = [Native]::Picker($AppProcess)
    if ($handle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
  } until ($handle -ne [IntPtr]::Zero -or [DateTime]::UtcNow -ge $deadline)
  if ($handle -eq [IntPtr]::Zero) {
    throw ("Native folder picker not found. Visible app windows: " + [Native]::Windows($AppProcess))
  }
  $dialog = $automation::FromHandle($handle)
  $buttonType = [System.Windows.Automation.PropertyCondition]::new($property::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $confirmId = [System.Windows.Automation.PropertyCondition]::new($property::AutomationIdProperty, '1')
  $confirmName = [System.Windows.Automation.PropertyCondition]::new($property::NameProperty, 'Select Folder')
  $confirm = [System.Windows.Automation.OrCondition]::new($confirmId, $confirmName)
  $buttonQuery = [System.Windows.Automation.AndCondition]::new($confirm, $buttonType)
  $button = $dialog.FindFirst($scope::Descendants, $buttonQuery)
  if ($button) {
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  } else {
    $child = [Native]::ConfirmButton($handle)
    if ($child -ne [IntPtr]::Zero) {
      [void][Native]::PostMessage($child, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    } else {
      [void][Native]::PostMessage($handle, 0x0111, [IntPtr]1, [IntPtr]::Zero)
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  while ([Native]::IsWindow($handle) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 150 }
  if ([Native]::IsWindow($handle)) { throw 'The Windows folder picker did not confirm the current directory' }
  Write-Output 'Native Windows folder picker invoked'
  return
}
$window = (Get-Process -Id $AppProcess).MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'Main window handle was not available' }
if ($Action -eq 'resize') {
  if (![Native]::MoveWindow($window, 32, 32, 1152, 720, $true)) { throw 'Native resize failed' }
  Write-Output ("Native window resized; OS DPI = " + [Native]::GetDpiForWindow($window))
} else {
  if (![Native]::PostMessage($window, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Native WM_CLOSE failed' }
  Write-Output 'WM_CLOSE posted to HMP'
}
