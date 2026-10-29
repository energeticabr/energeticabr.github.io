$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-cooldown-'+[guid]::NewGuid().ToString('N'))
$path=Join-Path $root '38626750000146-1'
[IO.Directory]::CreateDirectory($path)|Out-Null
$previous=[Threading.Thread]::CurrentThread.CurrentCulture
try{
    [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo('pt-BR')
    [IO.File]::WriteAllText((Join-Path $path 'state.json'),'{"lastNsu":"000000000000000","nextAllowedAt":"2030-10-29T13:05:00.0000000+00:00","status":"656"}')
    $output=& (Join-Path $PSScriptRoot '../scripts/Invoke-Collector.ps1') -Command Collect -DataRoot $root
    $result=($output -join [Environment]::NewLine)|ConvertFrom-Json
    if($result.status -ne 'COOLDOWN' -or @($result.documents).Count -ne 0){throw 'Cooldown nao respeitado.'}
    Write-Host 'PASS cooldown em pt-BR respeitado sem consulta fiscal.'
}finally{
    [Threading.Thread]::CurrentThread.CurrentCulture=$previous
    $resolved=[IO.Path]::GetFullPath($root)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
    if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'sefaz-cooldown-*'){throw 'Pasta temporaria fora do alvo.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
