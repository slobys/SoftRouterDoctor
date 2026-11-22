[CmdletBinding()]
param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$target = '1.1.1.1'
$path = @(Find-NetRoute -RemoteIPAddress $target)
$route = $path | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_NetRoute' } | Select-Object -First 1
$source = $path | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_NetIPAddress' } | Select-Object -First 1
if (!$source -or !$route) { throw 'Windows could not identify the IPv4 route and source address.' }

$adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
$trace = @(tracert.exe -4 -d -h 5 -w 650 $target)
$hops = [Collections.Generic.List[string]]::new()
$firstHop = ''
foreach ($line in $trace) {
    if ($line -match '^\s*([1-5])\s+.*\s((?:\d{1,3}\.){3}\d{1,3})\s*$') {
        $index = [int]$Matches[1]
        $address = [IPAddress]::None
        if ([IPAddress]::TryParse($Matches[2], [ref]$address)) {
            $hops.Add($address.IPAddressToString)
            if ($index -eq 1) { $firstHop = $address.IPAddressToString }
        }
    }
}

# Wireshark is optional. When it is already available, listen on the selected adapter only.
$neighbors = @()
$tshark = (Get-Command tshark.exe -ErrorAction SilentlyContinue).Source
if (!$tshark -and $env:ProgramFiles) {
    $candidate = Join-Path $env:ProgramFiles 'Wireshark\tshark.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $tshark = $candidate }
}
if ($tshark -and $adapter.InterfaceGuid) {
    $captureInterface = '\Device\NPF_' + ([Guid]$adapter.InterfaceGuid).ToString('B')
    $previousEncoding = [Console]::OutputEncoding
    $previousPreference = $ErrorActionPreference
    try {
        [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
        $ErrorActionPreference = 'Continue'
        $captured = @(& $tshark -p -i $captureInterface -a duration:35 -c 6 `
            -f 'ether proto 0x88cc and ether dst 01:80:c2:00:00:0e' -T fields -E occurrence=f `
            -e eth.src -e lldp.tlv.system.name -e lldp.mgn.addr.ip4 `
            -e lldp.tlv.enable_system_cap -e lldp.port.desc 2>$null)
        if ($LASTEXITCODE -eq 0) {
            $neighbors = @($captured | ForEach-Object {
                $fields = $_.Split([char]9)
                if ($fields.Count -eq 5 -and $fields[0] -match '^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$') {
                    $capabilities = @()
                    if ($fields[3] -match '^0x[0-9a-f]{1,4}$') {
                        $flags = [Convert]::ToInt32($fields[3].Substring(2), 16)
                        if ($flags -band 4) { $capabilities += 'Bridge' }
                        if ($flags -band 8) { $capabilities += 'WLAN AP' }
                        if ($flags -band 16) { $capabilities += 'Router' }
                    }
                    [pscustomobject]@{
                        mac = $fields[0]
                        name = $fields[1] -replace '\uFFFD.*$', ''
                        address = $fields[2]
                        capabilities = $capabilities -join ', '
                        advertised_port = $fields[4]
                    }
                }
            } | Sort-Object mac -Unique)
        }
    }
    finally {
        [Console]::OutputEncoding = $previousEncoding
        $ErrorActionPreference = $previousPreference
    }
}

$json = [ordered]@{
    schema = 'srd-windows-path-1'
    captured_at = [DateTime]::UtcNow.ToString('o')
    source_ipv4 = [string]$source.IPAddress
    gateway = [string]$route.NextHop
    first_hop = $firstHop
    mac = ([string]$adapter.MacAddress).Replace('-', ':').ToLowerInvariant()
    adapter = [string]$route.InterfaceAlias
    hops = @($hops.ToArray())
    link_neighbors = $neighbors
} | ConvertTo-Json -Depth 4

if ($OutputPath) {
    $file = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    [IO.File]::WriteAllText($file, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
$json
