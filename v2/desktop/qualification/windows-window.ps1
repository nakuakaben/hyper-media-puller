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
public static class Native {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int w, int h, bool redraw);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
}
'@
if ($Action -eq 'folder') {
  $scope = [System.Windows.Automation.TreeScope]
  $automation = [System.Windows.Automation.AutomationElement]
  $property = [System.Windows.Automation.AutomationElementIdentifiers]
  $processCondition = [System.Windows.Automation.PropertyCondition]::new($property::ProcessIdProperty, $AppProcess)
  $dialogCondition = [System.Windows.Automation.PropertyCondition]::new($property::ClassNameProperty, '#32770')
  $dialogQuery = [System.Windows.Automation.AndCondition]::new($processCondition, $dialogCondition)
  $deadline = [DateTime]::UtcNow.AddSeconds(18)
  do {
    $dialog = $automation::RootElement.FindFirst($scope::Children, $dialogQuery)
    if (!$dialog) { Start-Sleep -Milliseconds 200 }
  } until ($dialog -or [DateTime]::UtcNow -ge $deadline)
  if (!$dialog) { throw 'Native folder picker did not appear in the runner desktop' }
  $fileName = [System.Windows.Automation.PropertyCondition]::new($property::AutomationIdProperty, '1148')
  $editType = [System.Windows.Automation.PropertyCondition]::new($property::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $entry = $dialog.FindFirst($scope::Descendants, $fileName)
  if ($entry -and $entry.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) {
    $entry = $entry.FindFirst($scope::Descendants, $editType)
  }
  if (!$entry) { throw 'Native folder picker file-name field was not available' }
  $entry.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Folder)
  $confirm = [System.Windows.Automation.PropertyCondition]::new($property::AutomationIdProperty, '1')
  $buttonType = [System.Windows.Automation.PropertyCondition]::new($property::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttonQuery = [System.Windows.Automation.AndCondition]::new($confirm, $buttonType)
  $button = $dialog.FindFirst($scope::Descendants, $buttonQuery)
  if (!$button) { throw 'Native folder picker confirmation button was not available' }
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
