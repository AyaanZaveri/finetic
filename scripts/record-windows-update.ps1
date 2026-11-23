# Runs in a thread job on the interactive Actions desktop.
param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class UpdateWindows {
    private delegate bool Callback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
    public static string[] Consoles() {
        var windows = new List<string>();
        EnumWindows((window, _) => {
            if (!IsWindowVisible(window)) return true;
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() == "ConsoleWindowClass" || name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS") {
                var title = new StringBuilder(512);
                GetWindowText(window, title, title.Capacity);
                windows.Add(window.ToString() + " " + name + " " + title);
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$seen = [Collections.Generic.HashSet[string]]::new()
$baseline = @([UpdateWindows]::Consoles() | ForEach-Object { ($_ -split ' ', 2)[0] })
try {
    for ($frame = 0; $frame -lt 360 -and !(Test-Path "$Output/record.stop"); $frame++) {
        foreach ($window in [UpdateWindows]::Consoles()) {
            if ((($window -split ' ', 2)[0] -notin $baseline) -and $seen.Add($window)) {
                Add-Content "$Output/console-windows.txt" $window
            }
        }
        try {
            $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
            $bitmap.Save(("$Output/frame-{0:D4}.jpg" -f $frame), [Drawing.Imaging.ImageFormat]::Jpeg)
        } catch {
            Set-Content "$Output/capture-error.txt" $_.Exception.Message
        }
        if ($frame -eq 0) { Set-Content "$Output/record.ready" 'ready' }
        Start-Sleep -Milliseconds 200
    }
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
