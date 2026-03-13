param(
    [string]$PlayerFilter = 'qqmusic'
)

$ErrorActionPreference = 'Stop'

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
        $ageSeconds = ([DateTime]::Now - $candidate.LastWriteTime).TotalSeconds
        if ($ageSeconds -gt 900) {
            continue
        }

        try {
            $bytes = [System.IO.File]::ReadAllBytes($candidate.FullName)
            if ($null -eq $bytes -or $bytes.Length -eq 0) {
                continue
            }

            $mimeType = 'image/jpeg'
            $signature = [System.BitConverter]::ToString($bytes, 0, [Math]::Min(8, $bytes.Length))
            if ($signature.StartsWith('89-50-4E-47')) {
                $mimeType = 'image/png'
            } elseif ($signature.StartsWith('52-49-46-46')) {
                $mimeType = 'image/webp'
            }

            $sha1 = [System.Security.Cryptography.SHA1]::Create()
            try {
                return [ordered]@{
                    art_data_url = 'data:{0};base64,{1}' -f $mimeType, [Convert]::ToBase64String($bytes)
                    art_mime_type = $mimeType
                    art_hash = [System.BitConverter]::ToString($sha1.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
                    accent_hue = Get-AccentHue -Bytes $bytes
                    art_source = $candidate.FullName
                }
            } finally {
                $sha1.Dispose()
            }
        } catch {
            continue
        }
    }

    return $null
}

function Get-QQMusicWindowFallback {
    $process = Get-Process QQMusic -ErrorAction SilentlyContinue |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
        Select-Object -First 1

    if ($null -eq $process) {
        return $null
    }

    $title = Normalize-Text $process.MainWindowTitle
    $songTitle = $title
    $artist = ''
    if ($title -match '^(?<song>.+?)\s+-\s+(?<artist>.+)$') {
        $songTitle = $Matches.song.Trim()
        $artist = $Matches.artist.Trim()
    }

    $cachedArtwork = Get-QQMusicCachedArtwork
    return [ordered]@{
        active = $true
        matched_player = $true
        source_app_id = 'QQMusic.exe'
        title = $songTitle
        artist = $artist
        album_title = ''
        art_data_url = if ($null -ne $cachedArtwork) { $cachedArtwork.art_data_url } else { $null }
        art_mime_type = if ($null -ne $cachedArtwork) { $cachedArtwork.art_mime_type } else { $null }
        art_hash = if ($null -ne $cachedArtwork) { $cachedArtwork.art_hash } else { $null }
        accent_hue = if ($null -ne $cachedArtwork) { $cachedArtwork.accent_hue } else { $null }
        updated_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        error = if ($null -ne $cachedArtwork) {
            'windows media session unavailable; using QQMusic window title + local artwork cache fallback'
        } else {
            'windows media session unavailable; using QQMusic window title fallback'
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
        $fallback = Get-QQMusicWindowFallback
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        (New-DefaultResult $_.Exception.Message) | ConvertTo-Json -Compress
        exit 0
    }

    if ($null -eq $manager) {
        $fallback = Get-QQMusicWindowFallback
        if ($null -ne $fallback) {
            $fallback | ConvertTo-Json -Compress
            exit 0
        }
        (New-DefaultResult 'system media session manager unavailable') | ConvertTo-Json -Compress
        exit 0
    }

    $session = $manager.GetCurrentSession()
    if ($null -eq $session) {
        $fallback = Get-QQMusicWindowFallback
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

        $thumbnailBytes = Get-ThumbnailBytes $properties.Thumbnail
        if ($null -ne $thumbnailBytes -and $thumbnailBytes.Length -gt 0) {
            $mimeType = 'image/jpeg'
            $signature = [System.BitConverter]::ToString($thumbnailBytes, 0, [Math]::Min(8, $thumbnailBytes.Length))
            if ($signature.StartsWith('89-50-4E-47')) {
                $mimeType = 'image/png'
            } elseif ($signature.StartsWith('52-49-46-46')) {
                $mimeType = 'image/webp'
            }
            $sha1 = [System.Security.Cryptography.SHA1]::Create()
            try {
                $result.art_mime_type = $mimeType
                $result.art_hash = [System.BitConverter]::ToString($sha1.ComputeHash($thumbnailBytes)).Replace('-', '').ToLowerInvariant()
                $result.art_data_url = 'data:{0};base64,{1}' -f $mimeType, [Convert]::ToBase64String($thumbnailBytes)
                $result.accent_hue = Get-AccentHue -Bytes $thumbnailBytes
            } finally {
                $sha1.Dispose()
            }
        }
    }

    $result.active = $result.matched_player -and -not [string]::IsNullOrWhiteSpace($result.title)
    if (-not $result.matched_player) {
        $result.error = 'current media session is not QQ Music'
    } elseif (-not $result.art_data_url) {
        $result.error = 'matched QQ Music session has no artwork'
    }

    $result | ConvertTo-Json -Compress
} catch {
    $fallback = Get-QQMusicWindowFallback
    if ($null -ne $fallback) {
        $fallback | ConvertTo-Json -Compress
        exit 0
    }
    (New-DefaultResult $_.Exception.Message) | ConvertTo-Json -Compress
    exit 0
}
