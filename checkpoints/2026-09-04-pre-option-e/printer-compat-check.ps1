# Balaji FeeHub  -  Option E printer compatibility check
# Run in an ELEVATED PowerShell window (right-click PowerShell -> "Run as administrator").
#
# Usage:
#   .\printer-compat-check.ps1 -PrinterName "HP LaserJet Pro 4004dn"
#
# Tests, in order, exactly per the Option E verification plan:
#   A. Get-Printer (name/status/port as Windows actually sees it)
#   B. .NET PrinterSettings.PaperSizes (driver's own baseline list)
#   C. OpenPrinter (valid handle on this exact device)
#   D. AddForm for exactly 210.00mm x 142.80mm (FORM_PRINTER)
#   E. Re-check PaperSizes after AddForm to see if the driver surfaces it
#
# Never hides or reinterprets a failure  -  reports the exact Win32 error code
# and its authoritative system message (via Win32Exception), same as the
# HP LaserJet P1007 test that first surfaced ERROR_INVALID_FORM_SIZE this way.

param(
    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    [double]$WidthMm = 210.0,
    [double]$HeightMm = 142.8
)

function Section($title) {
    Write-Output ""
    Write-Output "=== $title ==="
}

Section "A. Get-Printer"
$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if (-not $printer) {
    Write-Output "FAIL: No printer named '$PrinterName' found on this PC. Check Devices and Printers for the exact name."
    exit 1
}
$printer | Format-List Name, PrinterStatus, DriverName, PortName

if ($printer.PrinterStatus -ne 'Normal') {
    Write-Output "WARNING: printer status is '$($printer.PrinterStatus)', not Normal. Fix this before continuing  -  a non-Normal printer will fail printing regardless of paper-size support."
}

Section "B. .NET PrinterSettings.PaperSizes (driver's own baseline list)"
Add-Type -AssemblyName System.Drawing
$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = $PrinterName
if (-not $ps.IsValid) {
    Write-Output "FAIL: .NET does not consider '$PrinterName' a valid/usable printer."
    exit 1
}
$ps.PaperSizes | Sort-Object Width, Height | ForEach-Object {
    $wMm = [math]::Round($_.Width / 100 * 25.4, 1)
    $hMm = [math]::Round($_.Height / 100 * 25.4, 1)
    Write-Output "$($_.PaperName) | ${wMm}mm x ${hMm}mm"
}
$targetWmm100 = [math]::Round($WidthMm / 25.4 * 100)
$targetHmm100 = [math]::Round($HeightMm / 25.4 * 100)
$nativeMatch = $ps.PaperSizes | Where-Object {
    [math]::Abs($_.Width - $targetWmm100) -le 2 -and [math]::Abs($_.Height - $targetHmm100) -le 2
}
if ($nativeMatch) {
    Write-Output "NOTE: driver already lists a size matching ${WidthMm}mm x ${HeightMm}mm natively: $($nativeMatch.PaperName)"
}

Section "C. OpenPrinter"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SpoolerTest {
    [StructLayout(LayoutKind.Sequential)] public struct SIZEL { public int cx; public int cy; }
    [StructLayout(LayoutKind.Sequential)] public struct RECTL { public int left; public int top; public int right; public int bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct FORM_INFO_1 { public int Flags; [MarshalAs(UnmanagedType.LPWStr)] public string pName; public SIZEL Size; public RECTL ImageableArea; }
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool AddForm(IntPtr hPrinter, int Level, ref FORM_INFO_1 pForm);
}
"@

$hPrinter = [IntPtr]::Zero
$openOk = [SpoolerTest]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)
$openErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
Write-Output "OpenPrinter('$PrinterName') = $openOk (error $openErr)"
if (-not $openOk) {
    Write-Output "FAIL: could not open a handle to this printer. Stopping  -  AddForm needs a valid handle."
    exit 1
}

# Everything from here on MUST close the handle exactly once, even on an
# unexpected exception  -  a leaked printer handle can block later spooler
# operations (including this same script's next run) until the process exits.
$added = $false
$addErr = 0
try {
    Section "D. AddForm ($WidthMm mm x $HeightMm mm, FORM_PRINTER)"
    $formName = "FeeHub Receipt $WidthMm x $HeightMm mm"
    $form = New-Object SpoolerTest+FORM_INFO_1
    $form.Flags = 2  # FORM_PRINTER  -  scoped to this printer only, never touches other printers' forms
    $form.pName = $formName
    $form.Size = New-Object SpoolerTest+SIZEL -Property @{ cx = [int]($WidthMm * 1000); cy = [int]($HeightMm * 1000) }
    $form.ImageableArea = New-Object SpoolerTest+RECTL -Property @{ left = 0; top = 0; right = [int]($WidthMm * 1000); bottom = [int]($HeightMm * 1000) }

    $added = [SpoolerTest]::AddForm($hPrinter, 1, [ref]$form)
    $addErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
} finally {
    [SpoolerTest]::ClosePrinter($hPrinter) | Out-Null
}

Write-Output "AddForm = $added (error $addErr)"

# ERROR_ALREADY_EXISTS (183) means a form with this exact name already exists
# on this printer  -  almost certainly from a prior run of this same script.
# That is not a failure, but it is also not automatically a pass: confirm the
# EXISTING form's actual size matches what we asked for before trusting it,
# in case a stale/different-sized form from an earlier, different test is
# what's actually sitting there.
if (-not $added -and $addErr -eq 183) {
    Write-Output "Form '$formName' already exists on this printer (ERROR_ALREADY_EXISTS)  -  checking its recorded size matches..."
    $ps0 = New-Object System.Drawing.Printing.PrinterSettings
    $ps0.PrinterName = $PrinterName
    $existing = $ps0.PaperSizes | Where-Object { $_.PaperName -eq $formName }
    if ($existing -and [math]::Abs($existing.Width - $targetWmm100) -le 2 -and [math]::Abs($existing.Height - $targetHmm100) -le 2) {
        Write-Output "ALREADY EXISTS / VERIFIED  -  existing form matches the requested ${WidthMm}mm x ${HeightMm}mm size."
        $added = $true  # treat as success for the rest of this script
    } else {
        Write-Output "FAIL  -  a form named '$formName' exists but its recorded size does NOT match ${WidthMm}mm x ${HeightMm}mm. Not overwriting it automatically; investigate manually."
        exit 1
    }
} elseif (-not $added) {
    $msg = try { ([System.ComponentModel.Win32Exception]::new($addErr)).Message } catch { "(no system message available)" }
    Write-Output "Windows error $addErr : $msg"
    Write-Output ""
    Write-Output "RESULT: FAIL  -  Windows/driver rejected the exact ${WidthMm}mm x ${HeightMm}mm form for '$PrinterName'."
    exit 1
}

Section "E. Re-check PaperSizes after AddForm"
$ps2 = New-Object System.Drawing.Printing.PrinterSettings
$ps2.PrinterName = $PrinterName
$match = $ps2.PaperSizes | Where-Object { $_.PaperName -eq $formName -or ([math]::Abs($_.Width - $targetWmm100) -le 2 -and [math]::Abs($_.Height - $targetHmm100) -le 2) }
if ($match) {
    Write-Output "Driver now exposes: $($match.PaperName) | Width=$($match.Width) Height=$($match.Height) (1/100 inch)"
    Write-Output ""
    Write-Output "RESULT: PASS  -  Windows accepts the exact ${WidthMm}mm x ${HeightMm}mm form for '$PrinterName', and the driver surfaces it."
} else {
    Write-Output "Form was added at the Windows spooler level, but the driver's own PaperSizes list still does not show it."
    Write-Output ""
    Write-Output "RESULT: PARTIAL  -  Windows accepted AddForm, but the driver itself may not honor it at print time. Proceed to the Electron print test (Phase 3) before trusting this printer, and watch closely for A4/A5 substitution on the physical output."
}
