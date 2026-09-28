param([string]$FixtureDirectory=$PSScriptRoot)
New-Item -ItemType Directory -Path $FixtureDirectory -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FixtureDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command); }'
[void][FixtureDpi]::SetProcessDPIAware()
$root=Split-Path -Parent $PSScriptRoot
$form=New-Object Windows.Forms.Form
$form.Text='GPT-MCP Acceptance Window'
$form.StartPosition='Manual'
$workArea=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location=New-Object Drawing.Point(($workArea.Left+150),($workArea.Top+150))
$form.Size=New-Object Drawing.Size(650,280)
$form.TopMost=$true
$box=New-Object Windows.Forms.TextBox
$box.Location=New-Object Drawing.Point(30,60)
$box.Size=New-Object Drawing.Size(570,35)
$box.Font=New-Object Drawing.Font('Consolas',16)
$box.AccessibleName='GPT-MCP test input'
$box.Add_TextChanged({[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'desktop-input.txt'),$box.Text)})
$form.Controls.Add($box)
$button=New-Object Windows.Forms.Button
$button.Text='Test mouse click'
$button.Location=New-Object Drawing.Point(30,125)
$button.Size=New-Object Drawing.Size(220,45)
$button.Add_Click({[IO.File]::WriteAllText((Join-Path $FixtureDirectory 'desktop-click.txt'),'MCP_CLICK_OK')})
$form.Controls.Add($button)
$form.Add_Shown({
  [void][FixtureDpi]::ShowWindow($form.Handle,5)
  $form.Activate()
  $textPoint=$box.PointToScreen((New-Object Drawing.Point(50,15)))
  $clickPoint=$button.PointToScreen((New-Object Drawing.Point(100,20)))
  @{title=$form.Text;input=@($textPoint.X,$textPoint.Y);button=@($clickPoint.X,$clickPoint.Y)}|ConvertTo-Json|Set-Content (Join-Path $FixtureDirectory 'desktop-window-points.json') -Encoding UTF8
})
$timer=New-Object Windows.Forms.Timer
$timer.Interval=1000
$timer.Add_Tick({if(Test-Path (Join-Path $FixtureDirectory 'desktop-window-stop')){$form.Close()}})
$timer.Start()
[void]$form.ShowDialog()
