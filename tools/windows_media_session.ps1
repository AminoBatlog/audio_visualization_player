param(
    [string]$PlayerFilter = 'qqmusic'
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CodexWin32WindowApi {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

function Get-AsTaskMethod {
    return [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.IsGenericMethodDefinition -and
            $_.GetGenericArguments().Count -eq 1 -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1
}

function Await-WinRtOperation {
    param(
        [Parameter(Mandatory = $true)]
        $Operation,
        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    $method = $script:AsTaskMethod.MakeGenericMethod($ResultType)
    $task = $method.Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function Normalize-Text {
    param([object]$Value)

    if ($null -eq $Value) {
        return ''
    }
    return [string]$Value
}

function Test-PlayerMatch {
    param(
        [string]$SourceAppId,
        [string]$Filter
    )

    if ([string]::IsNullOrWhiteSpace($Filter)) {
        return $true
    }

    $candidate = (Normalize-Text $SourceAppId).ToLowerInvariant()
    $normalizedFilter = (Normalize-Text $Filter).ToLowerInvariant()
    switch ($normalizedFilter) {
        'qqmusic' {
            return $candidate.Contains('qqmusic') -or
                $candidate.Contains('qq music') -or
                $candidate.Contains('tencent')
        }
        'netease' {
            return $candidate.Contains('cloudmusic') -or
                $candidate.Contains('netease')
        }
        default {
            return $candidate.Contains($normalizedFilter)
        }
    }
}

function Get-AccentHue {
    param(
        [byte[]]$Bytes,
        [int]$FallbackHue = 191
    )

    if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
        return $FallbackHue
    }

    $memory = New-Object System.IO.MemoryStream
    try {
        $memory.Write($Bytes, 0, $Bytes.Length)
        $memory.Position = 0
        $image = [System.Drawing.Image]::FromStream($memory, $true, $false)
        try {
            $bitmap = New-Object System.Drawing.Bitmap($image, 36, 36)
            try {
                $sumX = 0.0
                $sumY = 0.0
                $weightTotal = 0.0
                for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
                    for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
                        $pixel = $bitmap.GetPixel($x, $y)
                        if ($pixel.A -lt 64) {
                            continue
                        }

                        $brightness = $pixel.GetBrightness()
                        $saturation = $pixel.GetSaturation()
                        if ($brightness -lt 0.08 -or $brightness -gt 0.95 -or $saturation -lt 0.18) {
                            continue
                        }

                        $hueRadians = ($pixel.GetHue() * [Math]::PI) / 180.0
                        $weight = [Math]::Max(0.05, $saturation * (0.35 + $brightness))
                        $sumX += [Math]::Cos($hueRadians) * $weight
                        $sumY += [Math]::Sin($hueRadians) * $weight
                        $weightTotal += $weight
                    }
                }

                if ($weightTotal -le 0.0) {
                    return $FallbackHue
                }

                $degrees = ([Math]::Atan2($sumY, $sumX) * 180.0 / [Math]::PI)
                if ($degrees -lt 0) {
                    $degrees += 360.0
                }
                return [int][Math]::Round($degrees)
            } finally {
                $bitmap.Dispose()
            }
        } finally {
            $image.Dispose()
        }
    } catch {
        return $FallbackHue
    } finally {
        $memory.Dispose()
    }
}

function New-ArtPayload {
    param(
        [byte[]]$Bytes,
        [string]$ArtSource = ''
    )

    if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
        return $null
    }

    $mimeType = 'image/jpeg'
    $signature = [System.BitConverter]::ToString($Bytes, 0, [Math]::Min(8, $Bytes.Length))
    if ($signature.StartsWith('89-50-4E-47')) {
        $mimeType = 'image/png'
    } elseif ($signature.StartsWith('52-49-46-46')) {
        $mimeType = 'image/webp'
    }

    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        return [ordered]@{
            art_data_url = 'data:{0};base64,{1}' -f $mimeType, [Convert]::ToBase64String($Bytes)
            art_mime_type = $mimeType
            art_hash = [System.BitConverter]::ToString($sha1.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
            accent_hue = Get-AccentHue -Bytes $Bytes
            art_source = $ArtSource
        }
    } finally {
        $sha1.Dispose()
    }
}

function Get-ThumbnailBytes {
    param($ThumbnailReference)

    if ($null -eq $ThumbnailReference) {
        return $null
    }

    $stream = Await-WinRtOperation $ThumbnailReference.OpenReadAsync() ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $stream) {
        return $null
    }

    $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($stream)
    $memory = New-Object System.IO.MemoryStream
    try {
        $netStream.CopyTo($memory)
        return $memory.ToArray()
    } finally {
        $memory.Dispose()
        $netStream.Dispose()
        $stream.Dispose()
    }
}

function Get-WindowTrackInfo {
    param([string]$WindowTitle)

    $title = Normalize-Text $WindowTitle
    $songTitle = $title
    $artist = ''
    if ($title -match '^(?<song>.+?)\s+-\s+(?<artist>.+)$') {
        $songTitle = $Matches.song.Trim()
        $artist = $Matches.artist.Trim()
    }

    return [ordered]@{
        title = $songTitle
        artist = $artist
    }
}

function Get-TrackKey {
    param(
        [string]$Title,
        [string]$Artist
    )

    $normalizedTitle = (Normalize-Text $Title).Trim().ToLowerInvariant()
    $normalizedArtist = (Normalize-Text $Artist).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($normalizedTitle) -and [string]::IsNullOrWhiteSpace($normalizedArtist)) {
        return ''
    }
    return ($normalizedTitle + '|' + $normalizedArtist).Trim('|')
}


function Get-WindowTitleScore {
    param(
        [string]$WindowTitle,
        [string]$Player = ''
    )

    $title = (Normalize-Text $WindowTitle).Trim()
    if ([string]::IsNullOrWhiteSpace($title)) {
        return -1000
    }

    $normalizedTitle = $title.ToLowerInvariant()
    $score = 0

    switch ((Normalize-Text $Player).ToLowerInvariant()) {
        'qqmusic' {
            if ($normalizedTitle -in @('桌面歌词', 'qq音乐', 'qqmusic')) {
                return -500
            }
            if ($normalizedTitle.Contains('桌面歌词')) {
                $score -= 300
            }
        }
        'netease' {
            if ($normalizedTitle -in @('网易云音乐', 'cloudmusic')) {
                return -500
            }
        }
    }

    if ($title -match '^.+?\s+-\s+.+$') {
        $score += 300
    }
    if ($title.Length -ge 6) {
        $score += [Math]::Min(60, $title.Length)
    }
    if ($normalizedTitle.Contains('歌词')) {
        $score -= 80
    }
    if ($normalizedTitle.Contains('播放') -or $normalizedTitle.Contains('推荐')) {
        $score -= 30
    }
    return $score
}

function Get-ProcessWindowTitles {
    param([int]$ProcessId)

    $titles = New-Object System.Collections.Generic.List[object]
    $callback = [CodexWin32WindowApi+EnumWindowsProc]{
        param($hWnd, $lParam)

        $windowProcessId = 0
        [void][CodexWin32WindowApi]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId)
        if ($windowProcessId -ne $ProcessId) {
            return $true
        }

        $length = [CodexWin32WindowApi]::GetWindowTextLength($hWnd)
        $buffer = New-Object System.Text.StringBuilder ($length + 1)
        [void][CodexWin32WindowApi]::GetWindowText($hWnd, $buffer, $buffer.Capacity)
        $titles.Add([pscustomobject]@{
            Title = $buffer.ToString()
            Visible = [CodexWin32WindowApi]::IsWindowVisible($hWnd)
        }) | Out-Null
        return $true
    }

    [CodexWin32WindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $titles
}

function Get-BestWindowTitleForProcessName {
    param(
        [string]$ProcessName,
        [string]$Player = ''
    )

    $candidates = @()
    foreach ($process in (Get-Process $ProcessName -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending)) {
        foreach ($window in (Get-ProcessWindowTitles -ProcessId $process.Id)) {
            $title = (Normalize-Text $window.Title).Trim()
            if ([string]::IsNullOrWhiteSpace($title)) {
                continue
            }
            $candidates += [pscustomobject]@{
                Title = $title
                Visible = [bool]$window.Visible
                Score = Get-WindowTitleScore -WindowTitle $title -Player $Player
                StartedAt = $process.StartTime
            }
        }
    }

    $best = $candidates |
        Sort-Object             @{ Expression = { if ($_.Visible) { 1 } else { 0 } }; Descending = $true },             @{ Expression = { $_.Score }; Descending = $true },             @{ Expression = { $_.StartedAt }; Descending = $true } |
        Select-Object -First 1
    if ($null -eq $best) {
        return ''
    }
    return $best.Title
}

function Get-UrlBytes {
    param([string]$Url)

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return $null
    }

    try {
        $client = New-Object System.Net.WebClient
        try {
            $client.Headers.Add('User-Agent', 'audio-player-helper')
            return $client.DownloadData($Url)
        } finally {
            $client.Dispose()
        }
    } catch {
        return $null
    }
}

function Get-QQMusicCacheRoot {
    $configPath = Join-Path $env:APPDATA 'Tencent\QQMusic\WebkitCachePath.ini'
    if (Test-Path $configPath) {
        try {
            $match = Select-String -Path $configPath -Pattern '^Path=(.+)$' -ErrorAction Stop | Select-Object -First 1
            if ($null -ne $match) {
                $webkitCachePath = $match.Matches[0].Groups[1].Value.Trim()
                if (-not [string]::IsNullOrWhiteSpace($webkitCachePath)) {
                    $parent = Split-Path -Parent $webkitCachePath
                    if (-not [string]::IsNullOrWhiteSpace($parent)) {
                        return $parent
                    }
                }
            }
        } catch {
        }
    }

    return 'C:\QQMusicCache'
}

function Get-QQMusicCachedArtwork {
    $cacheRoot = Get-QQMusicCacheRoot
    $pictureDir = Join-Path $cacheRoot 'QQMusicPicture'
    if (-not (Test-Path $pictureDir)) {
        return $null
    }

    $recentImages = Get-ChildItem $pictureDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' } |
        Sort-Object LastWriteTime -Descending

    $candidates = @(
        $recentImages | Where-Object { $_.Name -match '^T002R500x500' } | Select-Object -First 1
        $recentImages | Select-Object -First 1
    ) | Where-Object { $null -ne $_ }

    foreach ($candidate in $candidates) {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($candidate.FullName)
            if ($null -eq $bytes -or $bytes.Length -eq 0) {
                continue
            }
            return New-ArtPayload -Bytes $bytes -ArtSource $candidate.FullName
        } catch {
            continue
        }
    }

    return $null
}

function Get-CloudMusicPlayingListRaw {
    $path = Join-Path $env:LOCALAPPDATA 'Netease\CloudMusic\webdata\file\playingList'
    if (-not (Test-Path $path)) {
        return ''
    }

    try {
        return [System.IO.File]::ReadAllText($path)
    } catch {
        return ''
    }
}

function Get-CloudMusicCoverUrl {
    param(
        [string]$Title,
        [string]$Artist
    )

    $raw = Get-CloudMusicPlayingListRaw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return ''
    }

    $escapedTitle = [regex]::Escape((Normalize-Text $Title))
    if ([string]::IsNullOrWhiteSpace($escapedTitle)) {
        return ''
    }

    $artistParts = @((Normalize-Text $Artist) -split '/' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $escapedArtist = ''
    if ($artistParts.Count -gt 0) {
        $escapedArtist = [regex]::Escape($artistParts[0])
    }

    $patterns = @()
    if ($escapedArtist) {
        $patterns += ('"name":"' + $escapedTitle + '".{0,1200}?"artists":\[(?:(?!\]).)*?"name":"' + $escapedArtist + '"(?:(?!\]).)*?\].{0,2000}?"picUrl":"(?<url>https?://[^"\\]+)"')
    }
    $patterns += ('"name":"' + $escapedTitle + '".{0,2400}?"picUrl":"(?<url>https?://[^"\\]+)"')

    foreach ($pattern in $patterns) {
        $match = [regex]::Match($raw, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($match.Success) {
            return (Normalize-Text $match.Groups['url'].Value)
        }
    }

    return ''
}

function Get-CloudMusicArtwork {
    param(
        [string]$Title,
        [string]$Artist
    )

    $coverUrl = Get-CloudMusicCoverUrl -Title $Title -Artist $Artist
    if ([string]::IsNullOrWhiteSpace($coverUrl)) {
        return $null
    }

    $bytes = Get-UrlBytes -Url $coverUrl
    if ($null -eq $bytes -or $bytes.Length -eq 0) {
        return $null
    }

    return New-ArtPayload -Bytes $bytes -ArtSource $coverUrl
}

function Get-QQMusicWindowFallback {
    $windowTitle = Get-BestWindowTitleForProcessName -ProcessName 'QQMusic' -Player 'qqmusic'

    if ([string]::IsNullOrWhiteSpace($windowTitle)) {
        return $null
    }

    $trackInfo = Get-WindowTrackInfo -WindowTitle $windowTitle
    $cachedArtwork = Get-QQMusicCachedArtwork
    return [ordered]@{
        active = $true
        matched_player = $true
        source_app_id = 'QQMusic.exe'
        title = $trackInfo.title
        artist = $trackInfo.artist
        album_title = ''
        art_data_url = if ($null -ne $cachedArtwork) { $cachedArtwork.art_data_url } else { $null }
        art_mime_type = if ($null -ne $cachedArtwork) { $cachedArtwork.art_mime_type } else { $null }
        art_hash = if ($null -ne $cachedArtwork) { $cachedArtwork.art_hash } else { $null }
        accent_hue = if ($null -ne $cachedArtwork) { $cachedArtwork.accent_hue } else { $null }
        track_key = Get-TrackKey -Title $trackInfo.title -Artist $trackInfo.artist
        position_ms = 0
        duration_ms = 0
        playback_state = 'playing-fallback'
        timeline_updated_at_ms = 0
        updated_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        error = if ($null -ne $cachedArtwork) {
            'windows media session unavailable; using QQMusic window title + local artwork cache fallback'
        } else {
            'windows media session unavailable; using QQMusic window title fallback'
        }
    }
}

function Get-CloudMusicWindowFallback {
    $windowTitle = Get-BestWindowTitleForProcessName -ProcessName 'cloudmusic' -Player 'netease'

    if ([string]::IsNullOrWhiteSpace($windowTitle)) {
        return $null
    }

    $trackInfo = Get-WindowTrackInfo -WindowTitle $windowTitle
    $artwork = $null
    if (-not [string]::IsNullOrWhiteSpace($trackInfo.title)) {
        $artwork = Get-CloudMusicArtwork -Title $trackInfo.title -Artist $trackInfo.artist
    }

    return [ordered]@{
        active = $true
        matched_player = $true
        source_app_id = 'cloudmusic.exe'
        title = $trackInfo.title
        artist = $trackInfo.artist
        album_title = ''
        art_data_url = if ($null -ne $artwork) { $artwork.art_data_url } else { $null }
        art_mime_type = if ($null -ne $artwork) { $artwork.art_mime_type } else { $null }
        art_hash = if ($null -ne $artwork) { $artwork.art_hash } else { $null }
        accent_hue = if ($null -ne $artwork) { $artwork.accent_hue } else { $null }
        track_key = Get-TrackKey -Title $trackInfo.title -Artist $trackInfo.artist
        position_ms = 0
        duration_ms = 0
        playback_state = 'playing-fallback'
        timeline_updated_at_ms = 0
        updated_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        error = if ($null -ne $artwork) {
            'windows media session unavailable; using CloudMusic window title + playingList artwork fallback'
        } else {
            'windows media session unavailable; using CloudMusic window title fallback'
        }
    }
}

function Get-WindowTitleFallback {
    param([string]$Filter)

    $normalized = (Normalize-Text $Filter).ToLowerInvariant()
    switch ($normalized) {
        'qqmusic' {
            return Get-QQMusicWindowFallback
        }
        'netease' {
            return Get-CloudMusicWindowFallback
        }
        default {
            return $null
        }
    }
}

function New-DefaultResult {
    param([string]$ErrorMessage)

    return [ordered]@{
        active = $false
        matched_player = $false
        source_app_id = ''
        title = ''
        artist = ''
        album_title = ''
        art_data_url = $null
        art_mime_type = $null
        art_hash = $null
        accent_hue = $null
        track_key = ''
        position_ms = 0
        duration_ms = 0
        playback_state = ''
        timeline_updated_at_ms = 0
        updated_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        error = $ErrorMessage
    }
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Drawing
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows, ContentType = WindowsRuntime]
    $script:AsTaskMethod = Get-AsTaskMethod

    $result = New-DefaultResult ''

    try {
        $manager = Await-WinRtOperation ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    } catch {
        $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        (New-DefaultResult $_.Exception.Message) | ConvertTo-Json -Compress
        exit 0
    }

    if ($null -eq $manager) {
        $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        (New-DefaultResult 'system media session manager unavailable') | ConvertTo-Json -Compress
        exit 0
    }

    $session = $manager.GetCurrentSession()
    if ($null -eq $session) {
        $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        (New-DefaultResult 'no active media session') | ConvertTo-Json -Compress
        exit 0
    }

    $sourceAppId = Normalize-Text $session.SourceAppUserModelId
    $result.source_app_id = $sourceAppId
    $result.matched_player = Test-PlayerMatch -SourceAppId $sourceAppId -Filter $PlayerFilter

    $properties = Await-WinRtOperation ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if ($null -ne $properties) {
        $result.title = Normalize-Text $properties.Title
        $result.artist = Normalize-Text $properties.Artist
        $result.album_title = Normalize-Text $properties.AlbumTitle
        $result.track_key = Get-TrackKey -Title $result.title -Artist $result.artist

        $thumbnailBytes = Get-ThumbnailBytes $properties.Thumbnail
        if ($null -ne $thumbnailBytes -and $thumbnailBytes.Length -gt 0) {
            $artPayload = New-ArtPayload -Bytes $thumbnailBytes -ArtSource 'media-session-thumbnail'
            $result.art_mime_type = $artPayload.art_mime_type
            $result.art_hash = $artPayload.art_hash
            $result.art_data_url = $artPayload.art_data_url
            $result.accent_hue = $artPayload.accent_hue
        }
    }

    try {
        $playbackInfo = $session.GetPlaybackInfo()
        if ($null -ne $playbackInfo) {
            $result.playback_state = (Normalize-Text $playbackInfo.PlaybackStatus).ToLowerInvariant()
        }
    } catch {
    }

    try {
        $timeline = $session.GetTimelineProperties()
        if ($null -ne $timeline) {
            $result.position_ms = [int][Math]::Max(0, [Math]::Round($timeline.Position.TotalMilliseconds))
            $result.duration_ms = [int][Math]::Max(0, [Math]::Round($timeline.EndTime.TotalMilliseconds))
            if ($timeline.LastUpdatedTime) {
                $result.timeline_updated_at_ms = [DateTimeOffset]$timeline.LastUpdatedTime | ForEach-Object { $_.ToUnixTimeMilliseconds() }
            }
        }
    } catch {
    }

    if (-not $result.matched_player) {
        $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
    }

    $result.active = $result.matched_player -and -not [string]::IsNullOrWhiteSpace($result.title)
    if (-not $result.matched_player) {
        $result.error = 'current media session is not the selected player'
    } elseif (-not $result.art_data_url) {
        $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
        if ($null -ne $fallback -and $fallback.art_data_url) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        $result.error = 'matched player has no artwork'
    }

    $result | ConvertTo-Json -Compress
} catch {
    $fallback = Get-WindowTitleFallback -Filter $PlayerFilter
    if ($null -ne $fallback) {
        $fallback | ConvertTo-Json -Compress
        exit 0
    }
    (New-DefaultResult $_.Exception.Message) | ConvertTo-Json -Compress
    exit 0
}
