param(
  [Parameter(Mandatory)][int]$AppProcess,
  [Parameter(Mandatory)][ValidateSet('folder', 'resize', 'close')][string]$Action,
  [string]$Folder
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
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, string value, uint flags, uint timeout, out UIntPtr result);
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
  public static bool SetFolderName(IntPtr dialog, string folder) {
    IntPtr edit = IntPtr.Zero;
    EnumChildWindows(dialog, delegate(IntPtr window, IntPtr unused) {
      if (IsWindowVisible(window) && Class(window) == "Edit" && GetDlgCtrlID(window) == 1001) {
        edit = window;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    UIntPtr result;
    return edit != IntPtr.Zero && SendMessageTimeout(edit, 0x000C, IntPtr.Zero, folder, 2, 2000, out result) != IntPtr.Zero;
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
  $fileName = [System.Windows.Automation.PropertyCondition]::new($property::AutomationIdProperty, '1148')
  $editType = [System.Windows.Automation.PropertyCondition]::new($property::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $entry = $dialog.FindFirst($scope::Descendants, $fileName)
  if ($entry -and $entry.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) {
    $entry = $entry.FindFirst($scope::Descendants, $editType)
  }
  if (!$entry) {
    $id = [System.Windows.Automation.PropertyCondition]::new($property::AutomationIdProperty, '1001')
    $query = [System.Windows.Automation.AndCondition]::new($id, $editType)
    $entry = $dialog.FindFirst($scope::Descendants, $query)
  }
  if ($entry) {
    $entry.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Folder)
  } elseif (![Native]::SetFolderName($handle, $Folder)) {
    throw 'Native folder picker file-name field was not available'
  }
  # IDOK goes through the common item dialog's selection and validation path.
  if (![Native]::PostMessage($handle, 0x0111, [IntPtr]1, [IntPtr]::Zero)) {
    throw 'Could not confirm the native folder picker'
  }
  Start-Sleep -Milliseconds 450
  if ([Native]::IsWindow($handle)) {
    [void][Native]::PostMessage($handle, 0x0111, [IntPtr]1, [IntPtr]::Zero)
  }
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
