param(
    [Parameter(Mandatory)][ValidateSet('0.6.7','0.6.8')][string]$SourceVersion,
    [Parameter(Mandatory)][string]$TargetVersion,
    [ValidateSet('published','legacy-delta','delta','fallback','full','recovery')][string]$Case = 'published',
    [string]$TargetDirectory,
    [string]$CandidateExecutable
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSNativeCommandUseErrorActionPreference = $true
$results = New-Item -ItemType Directory -Force "update-results/$Case"
$root = Join-Path $env:RUNNER_TEMP "navigator-update-$Case"
$install = Join-Path $root 'installed Navigator'
$data = Join-Path $env:LOCALAPPDATA 'Navigator Desktop'
$cache = Join-Path $data 'updates'
$ready = Join-Path $cache 'ready.json'
$failure = Join-Path $cache 'last-error.txt'
$executable = Join-Path $install 'navigator-desktop.exe'
$startup = Join-Path $data 'startup.jsonl'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$baselineNodeOptions = $env:NODE_OPTIONS
$baselineAboutMarker = $env:NAVIGATOR_UPDATE_ABOUT_MARKER
$aboutHook = (Join-Path $PSScriptRoot 'windows-update-open-about.cjs').Replace('\', '/')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$fixture = $Case -ne 'published'
$expectRecovery = $Case -eq 'recovery'
$expectedVersion = if ($expectRecovery) { $SourceVersion } else { $TargetVersion }
$app = $null
$relaunch = $null
$recording = $null
$aboutApp = $null

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

function Find-Control([Diagnostics.Process]$Process, [string]$Name) {
    $Process.Refresh()
    if (!$Process.MainWindowHandle) { return }
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $control = $element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($control -and $control.Current.IsEnabled) { return $control }
}
function Find-UpdateButton([Diagnostics.Process]$Process) {
    foreach ($name in 'Update ready. Restart to update.', 'Restart to update') {
        $button = Find-Control $Process $name
        if ($button) { return $button }
    }
}
function Invoke-Control($Control) {
    $Control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
    $digest = @{
        '0.6.7' = '7e6ce2d3cea576da6f8e4d6b917e7bf42936f01be7e5b916741997ea40589682'
        '0.6.8' = 'a0b55c014b35aba7e994895d02750e6c23f9dfa84170f751c083b0b78765782b'
    }[$SourceVersion]
    curl.exe --fail --silent --show-error --location --retry 3 --output $installer "https://github.com/AyaanZaveri/navigator/releases/download/release-v$SourceVersion/$file"
    if ((Get-FileHash $installer).Hash -ne $digest) { throw 'Released installer checksum mismatch.' }
    $setup = Start-Process -FilePath $installer -ArgumentList '/S', "/D=$install" -PassThru
    if (!$setup.WaitForExit(180000)) { throw 'Base installation timed out.' }
    if ($setup.ExitCode -ne 0) { throw "Base installation exited $($setup.ExitCode)." }
    if ((Get-Version) -notmatch "^$([regex]::Escape($SourceVersion))(\b|\.0$)") { throw "Unexpected base version: $(Get-Version)" }

    $marker = Join-Path $install 'resources\restart-test-marker.txt'
    Set-Content -LiteralPath $marker -Value 'Present only before the test update'
    $profileMarker = Join-Path $data 'update-profile-marker.txt'
    Set-Content -LiteralPath $profileMarker -Value 'Keep the existing profile'
    if ($fixture) {
        $env:NAVIGATOR_UPDATE_FIXTURE_VERSION = $TargetVersion
        $env:NAVIGATOR_UPDATE_FIXTURE_FULL = Join-Path $TargetDirectory "Navigator-$TargetVersion-windows-x64-setup.exe"
        if ($Case -ne 'full') {
            $env:NAVIGATOR_UPDATE_FIXTURE_DELTA = Join-Path $TargetDirectory "Navigator-$TargetVersion-windows-x64-from-$SourceVersion-delta.exe"
        }
        if ($Case -ne 'legacy-delta') {
            Copy-Item $CandidateExecutable $executable -Force
            Copy-Item (Join-Path $PSScriptRoot '../desktop/windows/background-update.cjs') (Join-Path $install 'resources\background-update.cjs') -Force
            # Make the installer use the app path, independent of its registry default.
            Set-ItemProperty -LiteralPath 'HKCU:\Software\Navigator Desktop' -Name InstallDir -Value (Join-Path $root 'wrong registry destination')
        }
        if ($Case -eq 'fallback') {
            # Same-length corruption in a reused file must reject the delta.
            $manifest = Join-Path $install 'release-manifest.json'
            $old = Get-Content -Raw $manifest
            Set-Content -NoNewline $manifest $old.Replace('"version":"0.6.8"', '"version":"0.6.0"')
            if ((Get-Content -Raw $manifest | ConvertFrom-Json).version -ne '0.6.0') { throw 'Fixture did not corrupt delta base metadata.' }
        }
        $helper = Join-Path $install 'resources\background-update.cjs'
        Copy-Item $helper (Join-Path $install 'resources\background-update-original.cjs')
        Copy-Item (Join-Path $PSScriptRoot 'windows-restart-update-feed.cjs') $helper -Force
    }

    # The Start menu shortcut launches from the installed directory.
    $app = Start-Process -FilePath $executable -WorkingDirectory $install -PassThru
    $oldPid = $app.Id
    Write-Output "Started installed Navigator $SourceVersion (PID $oldPid), case: $Case"
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
    $expectedSelection = if ($Case -eq 'full') { "-setup.exe" } else { "-from-$SourceVersion-delta.exe" }
    if (!$selection.EndsWith($expectedSelection)) { throw "Wrong staged payload: $selection" }
    Write-Output "Staged signed payload: $selection"
    # A current status after relaunch must come from the manual check.
    Set-Content (Join-Path $data 'update-checks.json') 'false'
    if ($expectRecovery) {
        New-Item -ItemType Directory "$install.update-stage" | Out-Null
        Set-Content "$install.update-stage/retained.txt" 'Preserve interrupted stage'
    }
    $recording = Start-ThreadJob -FilePath (Join-Path $PSScriptRoot 'record-windows-update.ps1') -ArgumentList $results.FullName
    [void](Wait-For { Test-Path (Join-Path $results 'record.ready') } 20 'the screen and console monitor')
    Start-Sleep -Milliseconds 400
    $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $invoke.Invoke()
    Write-Output 'Invoked Restart to update once.'
    [void](Wait-For { $app.HasExited } 45 'the original app process to exit')
    $shutdownMs = $timer.ElapsedMilliseconds
    Write-Output "Original process exited after ${shutdownMs}ms (exit $($app.ExitCode))"
    $relaunch = Wait-For {
        if ($expectRecovery) {
            if (!(Test-Path $failure) -or !(Test-Path $marker) -or !(Test-Path $ready)) { return }
        } else {
            if (Test-Path $failure) { throw "Updater reported failure: $(Get-Content -Raw $failure)" }
            if ((Test-Path $ready) -or (Test-Path $marker)) { return }
        }
        if ((Get-Version) -notmatch "^$([regex]::Escape($expectedVersion))(\.0)?$") { return }
        Get-Process -Name 'navigator-desktop' -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -ne $oldPid -and $_.Path -eq $executable } | Select-Object -First 1
    } 200 'Navigator to reopen after the installer exits'
    Write-Output "Relaunched Navigator $(Get-Version) PID $($relaunch.Id) in $($timer.ElapsedMilliseconds)ms"
    [void](Wait-For { Test-AppReady $relaunch.Id } 90 'the relaunched app to become ready')
    $appReadyMs = $timer.ElapsedMilliseconds
    if ((Get-Content -Raw $profileMarker).Trim() -ne 'Keep the existing profile') { throw 'Profile marker changed.' }
    if ($expectRecovery) {
        if ((Get-Content -Raw "$install.update-stage/retained.txt").Trim() -ne 'Preserve interrupted stage') {
            throw 'The installer changed the interrupted stage.'
        }
        if ((Get-Content -Raw $failure) -notmatch 'exited with status 4') {
            throw "Unexpected recovery error: $(Get-Content -Raw $failure)"
        }
    } elseif ((Test-Path "$install.update-backup") -or (Test-Path "$install.update-stage")) {
        throw 'Installer left an update backup or stage.'
    }
    if ($Case -notin 'published','legacy-delta') {
        $updateLog = Get-Content -Raw (Join-Path $cache 'update.log')
        if (($updateLog -match 'Full fallback exited with status 0') -ne ($Case -eq 'fallback')) {
            throw "Unexpected fallback outcome: $updateLog"
        }
    }
    $reference = if ($fixture) { Join-Path $TargetDirectory 'desktop-win32-x64/navigator-desktop.exe' }
    if (!$expectRecovery -and $reference -and (Test-Path $reference) -and (Get-FileHash $reference).Hash -ne (Get-FileHash $executable).Hash) {
        throw 'The installed executable differs from the candidate package.'
    }
    # Installer-launched processes deliberately do not inherit NODE_OPTIONS.
    # Verify the automatic relaunch first, then open the same installation
    # directly to test a later manual update check in About.
    $automaticallyRelaunchedPid = $relaunch.Id
    [void]$relaunch.CloseMainWindow()
    if (!$relaunch.WaitForExit(15000)) { throw 'Relaunched Navigator did not close normally.' }
    $env:NAVIGATOR_UPDATE_ABOUT_MARKER = Join-Path $root 'open-about'
    Set-Content $env:NAVIGATOR_UPDATE_ABOUT_MARKER 'open the public About route'
    $env:NODE_OPTIONS = "$baselineNodeOptions --require `"$aboutHook`"".Trim()
    $aboutApp = Start-Process -FilePath $executable -WorkingDirectory $install -PassThru
    [void](Wait-For { Find-Control $aboutApp "Navigator $expectedVersion" } 30 'the About version after relaunch')
    if ($expectRecovery) {
        [void](Wait-For { Find-Control $aboutApp "Couldn’t install the update. Try again from Settings." } 30 'the installation error in About')
    }
    $check = Wait-For { Find-Control $aboutApp 'Check for updates' } 30 'the manual check control'
    Invoke-Control $check
    if ($expectRecovery) {
        [void](Wait-For { Find-UpdateButton $aboutApp } 40 'a second successful check after the installation error')
    } else {
        [void](Wait-For { Find-Control $aboutApp "You’re up to date." } 40 'a successful update check after relaunch')
    }
    Start-Sleep -Milliseconds 500
    if ($fixture -and (Test-Path (Join-Path $results 'console-windows.txt'))) {
        throw "A console appeared during the update: $(Get-Content -Raw (Join-Path $results 'console-windows.txt'))"
    }
    $record = [ordered]@{
        mode = $Case; clicks = 1; sourceVersion = $SourceVersion; installedVersion = Get-Version
        payload = $selection; oldPid = $oldPid; newPid = $automaticallyRelaunchedPid
        shutdownMs = $shutdownMs; appReadyMs = $appReadyMs
    }
    $record | ConvertTo-Json | Tee-Object -FilePath (Join-Path $results 'result.json')
} finally {
    if ($recording) {
        Set-Content (Join-Path $results 'record.stop') 'stop'
        Wait-Job $recording -Timeout 10 | Out-Null
        Receive-Job $recording -ErrorAction Continue | Out-Null
        Remove-Job $recording -Force
        $firstFrame = Join-Path $results 'frame-0000.jpg'
        if ((Test-Path $firstFrame) -and (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
            ffmpeg -nostdin -y -loglevel error -framerate 4 -i (Join-Path $results 'frame-%04d.jpg') -c:v libx264 -pix_fmt yuv420p (Join-Path $results 'restart-to-update.mp4')
            Get-ChildItem $results -Filter 'frame-*.jpg' | Remove-Item
        }
    }
    Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -like "$root*" -or $_.ExecutablePath -like "$cache*" -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*navigator-desktop.exe*')
    } | Select-Object Name, ProcessId, ParentProcessId, CommandLine | ConvertTo-Json | Set-Content (Join-Path $results 'processes.json')
    foreach ($file in @((Join-Path $data 'startup.jsonl'), (Join-Path $data 'installation.jsonl'), (Join-Path $data 'installation.log'), (Join-Path $cache 'update.log'), $failure)) {
        if (Test-Path $file) { Copy-Item $file $results.FullName }
    }
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id -ErrorAction SilentlyContinue }
    foreach ($process in @($relaunch, $aboutApp)) {
        if ($process -and !$process.HasExited) {
            [void]$process.CloseMainWindow()
            if (!$process.WaitForExit(15000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
        }
    }
    $env:NODE_OPTIONS = $baselineNodeOptions
    $env:NAVIGATOR_UPDATE_ABOUT_MARKER = $baselineAboutMarker
    Stop-Transcript | Out-Null
}
