# Conector oficial CT-e

`src/Cte.psm1` implementa o transporte e a normalização CT-e. Esta etapa não efetuou consulta fiscal de distribuição, manifestação, emissão ou cancelamento. Os únicos acessos autenticados foram GETs dos WSDLs oficiais de produção e homologação. Publicação, agendamento, persistência, SharePoint, DACTE/PDF e notificações pertencem ao worker de integração.

## Contratos

```powershell
Import-Module ./src/Cte.psm1 -Force -DisableNameChecking
# Exemplos de contratos; não executar distribuição para testar o módulo.
# $document = ConvertFrom-CteXml -Text $xmlBytes -Nsu $nsu -CompanyCnpj $cnpj
# $batch = ConvertFrom-CteDistributionResponse -Text $soapPersistido -CompanyCnpj $cnpj
# $soap = Invoke-CteDistribution -Config $config -LastNsu $cursorPersistido
```

- `ConvertFrom-CteXml(Text, Nsu, CompanyCnpj)`: aceita string UTF-8 ou `byte[]`. Retorna `id`, `nsu` de 15 dígitos, `key`, `kind`, `fields` como `IDictionary`, `xmlBase64`, `fileName` e `sha256`. O identificador é `NSU15-SHA256[0..15]`; o arquivo é `chave-id.xml`.
- `ConvertFrom-CteDistributionResponse(Text, CompanyCnpj)`: retorna `status`, `lastNsu`, `maxNsu`, `documents` e `unhandledDocuments` (sempre arrays), `reason` e `responseAt`. Cada documento recebe também o atributo `schema` distribuído. O parser não grava estado nem consulta a rede. `lastNsu` abrange ambos os arrays; o worker precisa persistir ambos antes de avançar.
- `Invoke-CteDistribution(Config, LastNsu)`: requer cursor de 15 dígitos, `companyCnpj`, `ufCode`, `environment`, `certificateStore` e `certificateThumbprint`. Reutiliza `Get-CompanyCertificate` do módulo SEFAZ, sem exportar A1. Efetua exatamente um POST, sem retry automático nem redirecionamento, com TLS 1.2 e validação normal do servidor. Retorna SOAP bruto.

O descompactador conserva os bytes exatos do `docZip`, inclusive BOM. XML, base64 e SHA são derivados desses bytes, sem reserializar o DOM. A entrada string é codificada uma única vez em UTF-8; quem já possui bytes deve passá-los diretamente. DTD/entidades externas são proibidos, com limites por XML e por descompactação.

## Documentos e valores

As raízes oficiais cobertas são `cteProc/CTe` e `cteSimpProc/CTeSimp` (modelo 57), `cteOSProc/CTeOS` (67) e `procEventoCTe`. Modelo, chave do documento e chave do protocolo precisam coincidir; XML completo exige protocolo de autorização `100` com número real. Os identificadores permanecem texto, incluindo CNPJ alfanumérico conforme pacote de esquemas de 16/10/2026.

| Campo da galeria | Fonte |
|---|---|
| `Title`, `CNPJ_FORNECEDOR`, `UF_FORNECEDOR` | Emitente do transporte |
| `NUMERO_NOTA`, `SERIE`, `MODELO`, `DATA_EMISSAO`, `NATUREZA_OPERACAO` | `ide/nCT`, `serie`, `mod`, `dhEmi`, `natOp` |
| `DATA_EMISSAO_ORIGINAL` | `dhEmi` literal, com o fuso original |
| `VALOR_TOTAL_NOTA` | `vPrest/vTPrest`; simplificado: `total/vTPrest` |
| `VALOR_LIQUIDO` | `vPrest/vRec`; simplificado: `total/vTRec`, sem nova dedução |
| `DESCONTOS`, `DESCONTO_FATURA` | Apenas `cobr/fat/vDesc` explicitamente informado |
| `TOMADOR`, `CNPJ_TOMADOR` | CT-e: `ide/toma3` resolve rem/exped/receb/dest; `ide/toma4` cadastra terceiro. CT-eOS e simplificado: `infCte/toma` |
| `DESTINATARIO`, `CNPJ_DESTINATARIO` | Grupo `dest` real, quando presente |
| `ICMS`, `ICMS_ST` | `imp/ICMS/*/vICMS` ou `vICMSOutraUF`; `vICMSSTRet` |
| `OBSERVACOES_NOTA` | `compl/xObs` e `compl/ObsCont` |
| `INFORMACOES_FISCO` | `imp/infAdFisco` e `compl/ObsFisco` |

`TIPO_FISCAL='CT-e'`; o XML completo recebe `STATUS_IMPORTACAO='XML_COMPLETO'`. O campo compartilhado `STATUS_DANFE='PENDENTE_GERACAO'` indica a fila de PDF existente; o gerador deve selecionar **DACTE** para CT-e, nunca DANFE NF-e. Tributos e dados não mapeados continuam integralmente preservados no XML.

`PAPEL_EMPRESA` registra todos os papéis efetivamente encontrados, separados por `;`, por exemplo `TOMADOR;REMETENTE`. A interface deve verificar o token `TOMADOR`, sem exigir igualdade da string inteira. Emitente recebe `DIRECAO='SAIDA'`; empresa tomadora recebe `ENTRADA`; os demais casos recebem `TERCEIROS`. Ser destinatário ou autorizado a baixar XML não comprova tomada do transporte. CT-eOS pode omitir tomador nos casos admitidos pelo leiaute, sem criar um cadastro fictício.

No simplificado, `toma/toma` declara o papel cadastral do próprio tomador (0 remetente, 1 expedidor, 2 recebedor, 3 destinatário, 4 terceiro). Se for 3, `DESTINATARIO` e `CNPJ_DESTINATARIO` refletem esse cadastro explícito. O XSD atual não inclui cadastros individuais de destinatários em cada `det`; não se deduzem destinatários pelas chaves de NF-e, pois essas chaves identificam seus emitentes. Múltiplos destinos/prestações são listados literalmente em `OBSERVACOES_NOTA`, preservando ordem e referências, sem eleger um destino único.

O objeto normalizado inclui `deliveries` (array vazio para as outras raízes). No simplificado, cada item conserva `number`, `originCode`, `originName`, `destinationCode`, `destinationName`, `total`, `receivable`, `nfeKeys`, `cteKeys` e `netWithoutTaxes` apenas quando informado. Os totais da nota vêm do grupo `total`, sem recomputar ou distribuir diferenças entre entregas. `vTPrestLiq` e `vPrestLiq` são valores sem tributos; não substituem `vTRec`/`vRec` como valor a receber. O XML completo preserva todos os detalhes adicionais.

Eventos conservam a chave, o tipo, a sequência, a data e o protocolo do evento. Recebem `EVENTO_SEM_XML`, sem fornecedor ou valores inventados. Somente cancelamento `110111` registrado/vinculado com `cStat=135` e protocolo define `SITUACAO='CANCELADA'`. Desacordo, carta de correção e evento rejeitado não são tratados como cancelamento do CT-e. O worker deve atualizar a chave existente; evento isolado não é uma nota completa.

## Sequência e integração segura

A [NT 2015.002 v1.04](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%2FVPENnM7j8s%3D) descreve lotes de até 50 documentos, em NSU crescente, com disponibilidade por até três meses após recepção. A ordenação é de recepção, não de emissão. NSU inicial antigo pode começar no primeiro disponível; lacunas internas exigem recuperação pontual. Ao esgotar a distribuição (`137` ou `ultNSU=maxNSU`), a espera mínima é uma hora. Documentos próprios emitidos normalmente não são distribuídos de volta ao emitente; essa fonte não comprova cobertura de saídas.

O worker precisa ter estado e exclusão mútua **separados de NF-e**. Antes do POST, persistir a reserva/cooldown; depois da resposta, arquivar SOAP bruto antes de interpretar. Persistir todos os documentos normalizados e não interpretados antes de avançar o cursor. Conferir que o primeiro NSU da união dos arrays é posterior ao cursor solicitado e registrar qualquer salto inicial. O parser verifica ordem, duplicidade, lacunas internas, quantidade, schema compatível dos documentos interpretados e correspondência do último documento com `ultNSU`. Falha deixa o lote inteiro pendente.

O módulo repassa `656` e demais rejeições para o worker, sem avançar estado ou repetir a consulta. Cursors ausentes permanecem `$null`. Em rejeições, `lastNsu` pode ser apenas uma indicação de retomada, inclusive com `maxNSU=0`; não representa documentos importados. Adotar cooldown conservador de pelo menos 65 minutos após fim da fila, rejeição ou falha, persistindo-o mesmo se parsing/upload falhar. Só continuar imediatamente um lote `138` integralmente durável e confirmado que ainda tenha NSUs disponíveis.

O corte de emissão é `2026-10-01`, aplicado à data literal do XML, e a rotina prevista é 09h/15h/20h BRT no worker. A consulta continua pelo NSU salvo, inclusive em lote fora do período; não reiniciar NSU para filtrar o mês. Evento sem evidência da emissão do CT-e relacionado aguarda reconciliação. Este módulo não altera tarefas agendadas.

GTV-e (modelo 64) e documentos/eventos do namespace MDF-e pertencem a outros tipos fiscais. São devolvidos em `unhandledDocuments`, com `reason='OUT_OF_SCOPE'`, sem `fields` de CT-e. Outro documento do namespace CT-e sem parser recebe `reason='UNSUPPORTED_CTE_SCHEMA'` e `pendingInterpretation=true`; namespace desconhecido recebe `UNKNOWN_DISTRIBUTED_SCHEMA` com a mesma pendência. Esses pacotes conservam `id`, `nsu`, `schema`, `kind`, chave quando explicitamente identificada, `xmlBase64`, `sha256`, `fileName`, `reason`, `message` e `pendingInterpretation`. A chave é lida de protocolo/evento próprio, sem aproveitar referências de documentos anteriores.

Preservar esses pacotes em fila durável de documentos não interpretados, juntamente com o SOAP bruto, permite continuar a sequência sem perder XML. O worker não deve publicá-los na galeria CT-e nem notificá-los como notas importadas. Avanço de cursor só pode ocorrer depois de confirmada essa preservação. Documento reconhecido com XML/protocolo inválido, schema conflitante, base64/gzip inválido ou sequência inconsistente continua gerando erro, sem disfarçar falha como documento fora de escopo.

## Endpoints e fontes verificadas

O [Portal Nacional, relação de serviços](https://www.cte.fazenda.gov.br/portal/WebServices.aspx) publica o serviço AN de distribuição 1.00. Os WSDLs autenticados confirmaram:

| Ambiente | Serviço |
|---|---|
| Produção | `https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx` |
| Homologação | `https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx` |

[WSDL produção](https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx?WSDL) e [WSDL homologação](https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx?WSDL): SOAP 1.2, wrapper `cteDistDFeInteresse/cteDadosMsg`, namespace de serviço `http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe` e action com sufixo `/cteDistDFeInteresse`. O payload é `distDFeInt` versão `1.00` no namespace `http://www.portalfiscal.inf.br/cte`, contendo `tpAmb`, `cUFAutor`, `CNPJ` e `distNSU/ultNSU`. Não há envio de evento fiscal.

Foram lidos diretamente em memória os [esquemas de distribuição 1.00](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=l6I2ehbBicE%3D) e os [esquemas CT-e NT 2026.004 v1.00 republicados em 16/10/2026](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=zeylq8Ib5E0%3D), publicados na [lista oficial de esquemas](https://www.cte.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0xlG1bdBass%3D). Não há dúvida de wrapper, endpoint, raiz CT-eOS ou posição do tomador após essa leitura. O módulo faz verificações estruturais necessárias à integração; não substitui validação XSD ou criptográfica completa independente do XML.

## Verificação local

```powershell
pwsh -NoProfile -File tests/Cte-Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/Cte-Tests.ps1
```

141 asserções sintéticas: CT-e/CT-eOS/simplificado, códigos de tomador, papéis, totais/ausências, entregas e referências múltiplas, desconto explícito, observações, eventos, chave alfanumérica, DTD, bytes/BOM/SHA, gzip, sequência/schema do lote, documentos fora de escopo e futuros, erros/656 e construção do SOAP/endpoints com rede substituída no teste. As duas versões de PowerShell executam o mesmo contrato. Testes não provam captura fiscal real, publicação, anexação ou envio de mensagens.
