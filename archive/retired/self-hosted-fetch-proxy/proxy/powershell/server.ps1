param(
  [int]$Port = [int]($env:PORT ?? 8787)
)

$DefaultAllowedOrigins = @("*")

$BlockedHeaders = @(
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "transfer-encoding"
)

function Get-AllowedOrigins {
  if ([string]::IsNullOrWhiteSpace($env:WASMACS_PROXY_ALLOWED_ORIGINS)) {
    return $DefaultAllowedOrigins
  }
  return $env:WASMACS_PROXY_ALLOWED_ORIGINS.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_.Length -gt 0 }
}

function Assert-AllowedUrl {
  param([string]$RawUrl)

  try {
    $Target = [Uri]::new($RawUrl)
  } catch {
    throw "invalid URL"
  }
  if ($Target.Scheme -ne "http" -and $Target.Scheme -ne "https") {
    throw "unsupported URL scheme: $($Target.Scheme)"
  }
  $Origin = "$($Target.Scheme)://$($Target.Authority)"
  $Origins = Get-AllowedOrigins
  if (($Origins -notcontains '*') -and ($Origins -notcontains $Origin)) {
    throw "URL origin is not allowed: $Origin"
  }
  return $Target
}

function ConvertTo-ProxyHeaders {
  param($Headers)

  $Normalized = @{}
  if ($null -eq $Headers) {
    return $Normalized
  }
  if ($Headers -is [System.Array]) {
    foreach ($Pair in $Headers) {
      if ($Pair.Count -lt 2) {
        continue
      }
      $Name = [string]$Pair[0]
      $Value = [string]$Pair[1]
      $Lower = $Name.ToLowerInvariant()
      if ($Lower.Length -eq 0 -or $BlockedHeaders -contains $Lower) {
        continue
      }
      $Normalized[$Lower] = $Value
    }
    return $Normalized
  }
  foreach ($Property in $Headers.PSObject.Properties) {
    $Lower = $Property.Name.ToLowerInvariant()
    if ($Lower.Length -eq 0 -or $BlockedHeaders -contains $Lower) {
      continue
    }
    $Normalized[$Lower] = [string]$Property.Value
  }
  return $Normalized
}

function Get-RequestBody {
  param($Payload, [string]$Method)

  if ($Method -eq "GET" -or $Method -eq "HEAD") {
    return $null
  }
  if ($Payload.PSObject.Properties.Name -contains "bodyBase64" -and $Payload.bodyBase64 -is [string]) {
    return [System.Convert]::FromBase64String($Payload.bodyBase64)
  }
  if ($Payload.PSObject.Properties.Name -contains "body") {
    return [System.Text.Encoding]::UTF8.GetBytes([string]$Payload.body)
  }
  return $null
}

function Set-CorsHeaders {
  param($Context)

  $Origin = $Context.Request.Headers.Get("Origin")
  if ([string]::IsNullOrWhiteSpace($Origin)) {
    $Origin = "*"
  } else {
    $Context.Response.Headers.Set("Vary", "Origin")
  }
  $Context.Response.Headers.Set("Access-Control-Allow-Headers", "content-type")
  $Context.Response.Headers.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
  $Context.Response.Headers.Set("Access-Control-Allow-Origin", $Origin)
  $Context.Response.Headers.Set("Access-Control-Allow-Private-Network", "true")
}

function Write-JsonResponse {
  param($Context, [int]$Status, $Payload)

  $Json = $Payload | ConvertTo-Json -Depth 8 -Compress
  $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $Context.Response.StatusCode = $Status
  Set-CorsHeaders $Context
  $Context.Response.Headers.Set("Cache-Control", "no-store")
  $Context.Response.ContentType = "application/json; charset=utf-8"
  $Context.Response.ContentLength64 = $Bytes.Length
  $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  $Context.Response.Close()
}

$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
$Listener.Start()
Write-Output "wasmacs fetch proxy listening at http://127.0.0.1:$Port/"

try {
  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    if ($Context.Request.HttpMethod -eq "OPTIONS") {
      $Context.Response.StatusCode = 204
      Set-CorsHeaders $Context
      $Context.Response.Headers.Set("Cache-Control", "no-store")
      $Context.Response.Close()
      continue
    }
    if ($Context.Request.HttpMethod -ne "POST") {
      $Bytes = [System.Text.Encoding]::UTF8.GetBytes("method not allowed")
      $Context.Response.StatusCode = 405
      Set-CorsHeaders $Context
      $Context.Response.Headers.Set("Allow", "POST")
      $Context.Response.ContentLength64 = $Bytes.Length
      $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
      $Context.Response.Close()
      continue
    }

    try {
      $Reader = [System.IO.StreamReader]::new($Context.Request.InputStream, [System.Text.Encoding]::UTF8)
      $Payload = $Reader.ReadToEnd() | ConvertFrom-Json
      $Target = Assert-AllowedUrl ([string]$Payload.url)
      $Method = ([string]($Payload.method ?? "GET")).ToUpperInvariant()
      $Headers = ConvertTo-ProxyHeaders $Payload.headers
      $Body = Get-RequestBody $Payload $Method
      $Options = @{
        Uri = $Target
        Method = $Method
        Headers = $Headers
        MaximumRedirection = 5
      }
      if ($null -ne $Body) {
        $Options.Body = $Body
      }
      $Upstream = Invoke-WebRequest @Options
      $ResponseHeaders = @()
      foreach ($Name in $Upstream.Headers.Keys) {
        $ResponseHeaders += @{ name = $Name.ToLowerInvariant(); value = [string]$Upstream.Headers[$Name] }
      }
      $ContentBytes = if ($null -ne $Upstream.RawContentStream) {
        $Memory = [System.IO.MemoryStream]::new()
        $Upstream.RawContentStream.CopyTo($Memory)
        $Memory.ToArray()
      } else {
        [System.Text.Encoding]::UTF8.GetBytes([string]$Upstream.Content)
      }
      Write-JsonResponse $Context 200 @{
        url = $Target.AbsoluteUri
        status = [int]$Upstream.StatusCode
        statusText = [string]$Upstream.StatusDescription
        headers = $ResponseHeaders
        bodyBase64 = [System.Convert]::ToBase64String($ContentBytes)
      }
    } catch {
      Write-JsonResponse $Context 400 @{ error = $_.Exception.Message }
    }
  }
} finally {
  $Listener.Stop()
  $Listener.Close()
}
