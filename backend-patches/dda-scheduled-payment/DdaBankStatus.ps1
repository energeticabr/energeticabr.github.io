function Get-DdaBankStatusCode($Row) {
 $code=0
 if(-not [int]::TryParse([string]$Row.codigoTipoSituacaoBoleto,[ref]$code)){return -1}
 if($code -in 1,2,3,4){return $code}
 $description=([string]$Row.descricaoSituacaoBoleto).Trim()
 if($code -eq 99 -and $description -eq 'Agendado'){return 2}
 if($code -eq 23 -and $description -eq 'Liquidado'){return 3}
 return -1
}
