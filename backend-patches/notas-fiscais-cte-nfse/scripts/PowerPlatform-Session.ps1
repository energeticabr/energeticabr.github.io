# Usa a sessao Microsoft ja autorizada no Power Platform CLI, somente em memoria.
# Nenhum token, refresh token ou cache descriptografado e impresso ou salvo.
function Get-PowerPlatformSessionToken {
    param([Parameter(Mandatory=$true)][string]$Resource)
    $cli=Join-Path $env:LOCALAPPDATA 'Microsoft/PowerAppsCLI'
    $tools=Get-ChildItem -LiteralPath $cli -Directory -Filter 'Microsoft.PowerApps.CLI.*' | Sort-Object Name -Descending | Select-Object -First 1
    if(-not $tools){throw 'Power Platform CLI nao localizado.'}
    Add-Type -Path (Join-Path $tools.FullName 'tools/Microsoft.Identity.Client.dll')
    Add-Type -Path (Join-Path $tools.FullName 'tools/Microsoft.Identity.Client.Extensions.Msal.dll')
    $builder=[Microsoft.Identity.Client.PublicClientApplicationBuilder]::Create('9cee029c-6210-4654-90bb-17e6e9d36617')
    $app=$builder.WithAuthority('https://login.microsoftonline.com/0c10f511-7ede-4702-a2d9-bedb26937e0e').WithRedirectUri('http://localhost').Build()
    # Biblioteca oficial gerencia bloqueio entre processos e persistencia DPAPI.
    # Renova a sessao existente sem copiar/registrar segredos em outro local.
    $storage=[Microsoft.Identity.Client.Extensions.Msal.StorageCreationPropertiesBuilder]::new('tokencache_msalv3.dat',$cli).Build()
    $cache=[Microsoft.Identity.Client.Extensions.Msal.MsalCacheHelper]::CreateAsync($storage).GetAwaiter().GetResult()
    $cache.RegisterCache($app.UserTokenCache)
    try{
        $accounts=$app.GetAccountsAsync().GetAwaiter().GetResult()
        $account=$accounts | Where-Object {$_.Username -eq 'bernardonotini@energeticabr.com'} | Select-Object -First 1
        if(-not $account){throw 'Conta autorizada nao encontrada no cache SDK.'}
        $result=$app.AcquireTokenSilent([string[]]@($Resource.TrimEnd('/')+'/.default'),$account).ExecuteAsync().GetAwaiter().GetResult()
        return $result.AccessToken
    }finally{$cache.UnregisterCache($app.UserTokenCache)}
}
