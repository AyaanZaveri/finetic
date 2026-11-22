param([Parameter(Mandatory)][ValidateSet('0.6.5','0.6.6')][string]$SourceVersion)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSNativeCommandUseErrorActionPreference = $true
$results = New-Item -ItemType Directory -Force 'update-results'
$root = Join-Path $env:RUNNER_TEMP 'navigator-restart-test'
$install = Join-Path $root 'installed'
$data = Join-Path $env:LOCALAPPDATA 'Navigator Desktop'
$cache = Join-Path $data 'updates'
$ready = Join-Path $cache 'ready.json'
$failure = Join-Path $cache 'last-error.txt'
$executable = Join-Path $install 'navigator-desktop.exe'
$startup = Join-Path $data 'startup.jsonl'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$fixture = $SourceVersion -eq '0.6.6'
$app = $null
$mode = if ($fixture) { 'released 0.6.6 with CI-signed reinstall fixture' } else { 'public 0.6.5 to 0.6.6' }

function Wait-For([scriptblock]$Condition, [int]$Seconds, [string]$Description) {
    $end = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $result = & $Condition
        if ($result) { return $result }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $end)
    throw "Timed out waiting for $Description"
}

function Test-AppReady([int]$ProcessId) {
    if (!(Test-Path $startup)) { return $false }
    foreach ($line in (Get-Content $startup -ErrorAction SilentlyContinue)) {
        try { $event = $line | ConvertFrom-Json } catch { continue }
        if ($event.pid -eq $ProcessId -and $event.stage -eq 'app-ready') { return $true }
    }
    return $false
}

function Find-UpdateButton([Diagnostics.Process]$Process) {
    $Process.Refresh()
    if (!$Process.MainWindowHandle) { return }
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
    foreach ($name in 'Update ready. Restart to update.', 'Restart to update') {
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::NameProperty, $name)
        $button = $element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($button -and $button.Current.IsEnabled) { return $button }
    }
}

function Get-Version {
    if (Test-Path $executable) { (Get-Item $executable).VersionInfo.ProductVersion }
}

Start-Transcript -Path (Join-Path $results 'restart-test.log') | Out-Null
try {
    if (Test-Path $data) { throw 'Run this check on a fresh Windows runner.' }
    New-Item -ItemType Directory -Force $root | Out-Null
    $file = "Navigator-$SourceVersion-windows-x64-setup.exe"
    $installer = Join-Path $root $file
    $digest = if ($fixture) { '14ebba555af3224a6d967e6c9bf938590315a99eb4f9e55238109aaafa220cfc' }
        else { 'a87acae479770f99851055edfde37182d256e635948a3ecc0b94308aa9466e9c' }
    curl.exe --fail --silent --show-error --location --retry 3 --output $installer "https://github.com/AyaanZaveri/navigator/releases/download/release-v$SourceVersion/$file"
    if ((Get-FileHash $installer).Hash -ne $digest) { throw 'Released installer checksum mismatch.' }
    $setup = Start-Process -FilePath $installer -ArgumentList '/S', "/D=$install" -PassThru
    if (!$setup.WaitForExit(180000)) { throw 'Base installation timed out.' }
    if ($setup.ExitCode -ne 0) { throw "Base installation exited $($setup.ExitCode)." }
    if ((Get-Version) -notmatch "^$([regex]::Escape($SourceVersion))(\b|\.0$)") { throw "Unexpected base version: $(Get-Version)" }

    $marker = Join-Path $install 'resources\restart-test-marker.txt'
    if ($fixture) {
        $env:NAVIGATOR_UPDATE_FIXTURE_INSTALLER = $installer
        $helper = Join-Path $install 'resources\background-update.cjs'
        Copy-Item $helper (Join-Path $install 'resources\background-update-original.cjs')
        Copy-Item (Join-Path $PSScriptRoot 'windows-restart-update-feed.cjs') $helper -Force
        Set-Content -LiteralPath $marker -Value 'Present only before the test update'
    }

    # The Start menu shortcut launches from the installed directory.
    $app = Start-Process -FilePath $executable -WorkingDirectory $install -PassThru
    $oldPid = $app.Id
    Write-Output "Started installed Navigator $SourceVersion (PID $oldPid), case: $mode"
    [void](Wait-For {
        if ($app.HasExited) { throw "Navigator exited before app-ready: $($app.ExitCode)" }
        Test-AppReady $oldPid
    } 75 'the installed app to become ready')
    $button = Wait-For {
        if ($app.HasExited) { throw 'Navigator exited while preparing the update.' }
        Find-UpdateButton $app
    } 90 'the Restart to update button'
    if (!(Test-Path $ready)) { throw 'The UI reported ready without staging an update.' }
    $selection = (Get-Content -Raw $ready | ConvertFrom-Json).selected
    Write-Output "Staged signed payload: $selection"
    $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $invoke.Invoke()
    Write-Output 'Invoked Restart to update once.'
    [void](Wait-For { $app.HasExited } 45 'the original app process to exit')
    $shutdownMs = $timer.ElapsedMilliseconds
    Write-Output "Original process exited after ${shutdownMs}ms (exit $($app.ExitCode))"
    $relaunch = Wait-For {
        if (Test-Path $failure) { throw "Updater reported failure: $(Get-Content -Raw $failure)" }
        if ((Test-Path $ready) -or (Test-Path $marker)) { return }
        if ((Get-Version) -notmatch '^0\.6\.6(\b|\.0$)') { return }
        Get-Process -Name 'navigator-desktop' -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -ne $oldPid -and $_.Path -eq $executable } | Select-Object -First 1
    } 200 'a successful install and new Navigator process'
    Write-Output "Replaced installation and relaunched PID $($relaunch.Id) in $($timer.ElapsedMilliseconds)ms"
    [void](Wait-For { Test-AppReady $relaunch.Id } 90 'the relaunched app to become ready')
    $record = [ordered]@{
        mode = $mode; clicks = 1; sourceVersion = $SourceVersion; installedVersion = Get-Version
        payload = $selection; oldPid = $oldPid; newPid = $relaunch.Id
        shutdownMs = $shutdownMs; appReadyMs = $timer.ElapsedMilliseconds
    }
    $record | ConvertTo-Json | Tee-Object -FilePath (Join-Path $results 'result.json')
} finally {
    foreach ($file in @((Join-Path $data 'startup.jsonl'), $failure)) {
        if (Test-Path $file) { Copy-Item $file $results.FullName }
    }
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id -ErrorAction SilentlyContinue }
    Stop-Transcript | Out-Null
}
