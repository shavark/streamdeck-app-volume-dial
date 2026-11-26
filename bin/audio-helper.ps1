<#
  audio-helper.ps1 - long-lived helper for the App Volume Dial plugin.

  Reads one command per line on stdin, writes one JSON line per reply on stdout.
    list                 -> every live audio app on the default output device
    set <pid> <0..1>     -> set that app's volume
    toggle <pid>         -> toggle that app's mute
  The plugin keeps this process alive so turning the dial never pays
  process-startup cost.
#>

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AV {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class DE { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDEnum {
    int EnumAudioEndpoints(int f, int m, out IntPtr c);
    int GetDefaultAudioEndpoint(int flow, int role, out IDev d);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDev d);
    int R(IntPtr a);
    int U(IntPtr a);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDev {
    int Activate(ref Guid i, int c, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int a, out IntPtr s);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int s);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IASM2 {
    int GetAudioSessionControl(IntPtr g, int f, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v);
    int GetSessionEnumerator(out IASE e);
    int RegSN(IntPtr n);
    int UnregSN(IntPtr n);
    int RegDN(string s, IntPtr n);
    int UnregDN(IntPtr n);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IASE {
    int GetCount(out int n);
    int GetSession(int i, out IASC2 s);
  }

  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IASC2 {
    int GetState(out int st);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr g);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string p, IntPtr g);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, IntPtr c);
    int RegANS(IntPtr n);
    int UnregANS(IntPtr n);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out int pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool b);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISAV {
    int SetMasterVolume(float v, ref Guid g);
    int GetMasterVolume(out float v);
    int SetMute(bool m, ref Guid g);
    int GetMute(out bool m);
  }

  public class Row {
    public int Pid;
    public int State;
    public float Vol;
    public bool Mute;
  }

  public static class Core {
    static Guid IID = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    static IASE Sessions() {
      var en = (IDEnum)(new DE());
      IDev d;
      if (en.GetDefaultAudioEndpoint(0, 0, out d) != 0) return null;
      object o;
      Guid iid = IID;
      if (d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
      IASE se;
      if (((IASM2)o).GetSessionEnumerator(out se) != 0) return null;
      return se;
    }

    public static Row[] List() {
      var se = Sessions();
      if (se == null) return new Row[0];
      int n;
      se.GetCount(out n);
      var rows = new System.Collections.Generic.List<Row>();
      for (int i = 0; i < n; i++) {
        IASC2 sc;
        if (se.GetSession(i, out sc) != 0) continue;
        // The Windows system-sounds session reports pid 0, so the pid check
        // below excludes it. Do not call IsSystemSoundsSession here: its
        // HRESULT marshals unreliably through this interop and swallowed
        // every session when it was used.
        int pid;
        if (sc.GetProcessId(out pid) != 0 || pid == 0) continue;
        int st;
        sc.GetState(out st);
        if (st == 2) continue;                            // expired
        var sav = (ISAV)sc;
        float v;
        sav.GetMasterVolume(out v);
        bool m;
        sav.GetMute(out m);
        rows.Add(new Row { Pid = pid, State = st, Vol = v, Mute = m });
      }
      return rows.ToArray();
    }

    static ISAV Find(int pid) {
      var se = Sessions();
      if (se == null) return null;
      int n;
      se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IASC2 sc;
        if (se.GetSession(i, out sc) != 0) continue;
        int p;
        if (sc.GetProcessId(out p) != 0) continue;
        if (p == pid) return (ISAV)sc;
      }
      return null;
    }

    public static float Set(int pid, float vol) {
      var s = Find(pid);
      if (s == null) return -1f;
      if (vol < 0f) vol = 0f;
      if (vol > 1f) vol = 1f;
      Guid g = Guid.Empty;
      s.SetMasterVolume(vol, ref g);
      float v;
      s.GetMasterVolume(out v);
      return v;
    }

    public static int Toggle(int pid) {
      var s = Find(pid);
      if (s == null) return -1;
      bool m;
      s.GetMute(out m);
      Guid g = Guid.Empty;
      s.SetMute(!m, ref g);
      s.GetMute(out m);
      return m ? 1 : 0;
    }
  }
}
'@

Add-Type -AssemblyName System.Drawing

# Icons are keyed by exe path, so every Chrome/Discord child process shares one
# extraction and we only pay for it once per application.
$iconCache = @{}

function Get-AppIconBase64([int]$procId) {
  $exe = $null
  try { $exe = (Get-Process -Id $procId -ErrorAction Stop).Path } catch { $exe = $null }
  if (-not $exe) { return $null }
  if ($iconCache.ContainsKey($exe)) { return $iconCache[$exe] }

  $b64 = $null
  try {
    $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
    if ($ico) {
      $src = $ico.ToBitmap()
      $size = 72
      $bmp = New-Object System.Drawing.Bitmap $size, $size
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($src, 0, 0, $size, $size)
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      $ms.Dispose(); $bmp.Dispose(); $src.Dispose(); $ico.Dispose()
    }
  } catch {
    $b64 = $null
  }

  $iconCache[$exe] = $b64
  return $b64
}

$nameCache = @{}
function Get-ProcName([int]$procId) {
  if ($nameCache.ContainsKey($procId)) { return $nameCache[$procId] }
  $n = $null
  try { $n = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $n = $null }
  if (-not $n) { $n = "pid$procId" }
  $nameCache[$procId] = $n
  return $n
}

function Send-Reply($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

Send-Reply @{ ok = $true; ready = $true }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  $parts = $line -split '\s+'
  $cmd = $parts[0].ToLower()
  try {
    if ($cmd -eq 'list') {
      $rows = [AV.Core]::List()
      $list = @()
      foreach ($r in $rows) {
        $list += [pscustomobject]@{
          pid    = $r.Pid
          name   = (Get-ProcName $r.Pid)
          vol    = [math]::Round($r.Vol, 4)
          mute   = [bool]$r.Mute
          active = ($r.State -eq 1)
        }
      }
      # currently-playing first, then alphabetical, so cycling order is predictable
      $sorted = @($list | Sort-Object @{ Expression = { if ($_.active) { 0 } else { 1 } } }, @{ Expression = { $_.name } })
      Send-Reply @{ ok = $true; sessions = $sorted }
    }
    elseif ($cmd -eq 'set') {
      $v = [AV.Core]::Set([int]$parts[1], [float]$parts[2])
      if ($v -lt 0) { Send-Reply @{ ok = $false; err = 'gone' } }
      else { Send-Reply @{ ok = $true; vol = [math]::Round($v, 4) } }
    }
    elseif ($cmd -eq 'icon') {
      $b64 = Get-AppIconBase64 ([int]$parts[1])
      if ($b64) { Send-Reply @{ ok = $true; png = $b64 } }
      else { Send-Reply @{ ok = $false; err = 'no icon' } }
    }
    elseif ($cmd -eq 'toggle') {
      $m = [AV.Core]::Toggle([int]$parts[1])
      if ($m -lt 0) { Send-Reply @{ ok = $false; err = 'gone' } }
      else { Send-Reply @{ ok = $true; mute = ($m -eq 1) } }
    }
    else {
      Send-Reply @{ ok = $false; err = "unknown command: $cmd" }
    }
  }
  catch {
    Send-Reply @{ ok = $false; err = $_.Exception.Message }
  }
}
