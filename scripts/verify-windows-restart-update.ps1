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
$port = 19422
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
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

function Get-Targets {
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2 }
    catch { return }
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
    $target = Wait-For {
        if ($app.HasExited) { throw "Navigator exited before opening WebView2: $($app.ExitCode)" }
        Get-Targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://127.0.0.1:37371/*' } | Select-Object -First 1
    } 75 'the packaged WebView2 page'
    Write-Output "WebView2 connected: $($target.url)"
    agent-browser.cmd --cdp "$port" open 'http://127.0.0.1:37371/settings/about'
    agent-browser.cmd --cdp "$port" wait --fn 'Array.from(document.querySelectorAll("button")).some(b => /^(Check for updates|Download update|Restart to update)$/.test(b.textContent.trim()))'
    @'
(() => {
  const action = Array.from(document.querySelectorAll("button")).find(b => /^(Check for updates|Download update)$/.test(b.textContent.trim()));
  if (action) action.click();
})()
'@ | agent-browser.cmd --cdp "$port" eval --stdin
    agent-browser.cmd --cdp "$port" wait --fn 'Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "Restart to update" && !b.disabled)'
    if (!(Test-Path $ready)) { throw 'The UI reported ready without staging an update.' }
    $selection = (Get-Content -Raw $ready | ConvertFrom-Json).selected
    Write-Output "Staged signed payload: $selection"

    $timer = [Diagnostics.Stopwatch]::StartNew()
    @'
(() => {
  const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Restart to update" && !b.disabled);
  if (!button) throw new Error("Restart button disappeared");
  setTimeout(() => button.click(), 100);
  return "Scheduled one Restart to update click";
})()
'@ | agent-browser.cmd --cdp "$port" eval --stdin
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
    [void](Wait-For {
        Get-Targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://127.0.0.1:37371/*' } | Select-Object -First 1
    } 90 'the relaunched WebView2 page')
    $record = [ordered]@{
        mode = $mode; clicks = 1; sourceVersion = $SourceVersion; installedVersion = Get-Version
        payload = $selection; oldPid = $oldPid; newPid = $relaunch.Id
        shutdownMs = $shutdownMs; webviewPageMs = $timer.ElapsedMilliseconds
    }
    $record | ConvertTo-Json | Tee-Object -FilePath (Join-Path $results 'result.json')
} finally {
    foreach ($file in @((Join-Path $data 'startup.jsonl'), $failure)) {
        if (Test-Path $file) { Copy-Item $file $results.FullName }
    }
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id -ErrorAction SilentlyContinue }
    Stop-Transcript | Out-Null
}
