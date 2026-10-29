# Conector de distribuicao NFS-e nacional

Verificacao tecnica: 29/10/2026. Este modulo so consulta distribuicao quando o worker chama explicitamente `Invoke-NfseDistribution`. Durante a implementacao foram acessados documentos e Swagger oficiais com o certificado existente; nenhuma consulta fiscal `/DFe` foi realizada por esta tarefa. Nao houve exportacao do A1.

## Fontes oficiais e endpoints

- [Catalogo oficial de APIs](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao): producao `https://adn.nfse.gov.br/contribuintes`; homologacao `https://adn.producaorestrita.nfse.gov.br/contribuintes`.
- [Swagger contribuinte em producao](https://adn.nfse.gov.br/contribuintes/swagger/v1/swagger.json), obtido via mTLS: `GET /DFe/{NSU}`, query `cnpjConsulta` e `lote=true`. JSON, TLS 1.2+, A1/A3 ICP-Brasil com autenticacao de cliente, XML UTF-8 compactado em GZip/base64. O modulo reutiliza `Get-CompanyCertificate` de `Sefaz.psm1`, conservando a verificacao local de CNPJ e validade.
- [Manual do contribuinte ADN, versao inicial 12/02/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf): consulta de documentos em que o contribuinte e prestador, tomador ou intermediario; aceita certificado de mesmo CNPJ raiz usando `cnpjConsulta`. O certificado local atual corresponde exatamente ao CNPJ consultado.
- [XSD oficial v1.01, 09/02/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip): `tiposComplexos_v1.01.xsd`, `tiposSimples_v1.01.xsd`, `tiposEventos_v1.01.xsd`. Namespace `http://www.sped.fazenda.gov.br/nfse`; `infNFSe/@Id = NFS` mais chave de **50 digitos**. Nao e a chave NF-e de 44 posicoes.

## Contrato do modulo

```powershell
Import-Module ./src/Nfse.psm1 -Force -DisableNameChecking
Get-NfseDistributionUri -Config $config -LastNsu $lastNsu # puro, sem rede
$raw = Invoke-NfseDistribution -Config $config -LastNsu $lastNsu
# O chamador deve gravar $raw em armazenamento duravel antes de interpretar.
$batch = ConvertFrom-NfseDistributionResponse -Text $raw -CompanyCnpj $config.companyCnpj
$document = ConvertFrom-NfseXml -Text $xmlText -Nsu $nsu -CompanyCnpj $config.companyCnpj
```

`Invoke-NfseDistribution` faz um GET autenticado, sem repeticao automatica, sem redirecionamentos e com timeout de 90 segundos. Retorna texto bruto tambem nos HTTP 400/404 com corpo. Outros erros HTTP/rede propagam a excecao; o worker deve ter armado seu bloqueio de novas consultas antes da chamada. `environment` e `companyCnpj` usam a configuracao existente: ambiente `1` producao, `2` homologacao. O certificado nunca segue para Android/iOS/navegador.

O JSON oficial possui nomes PascalCase:

```text
StatusProcessamento: DOCUMENTOS_LOCALIZADOS | NENHUM_DOCUMENTO_LOCALIZADO | REJEICAO
LoteDFe[]: NSU (int64), ChaveAcesso, TipoDocumento (NFSE ou EVENTO),
           TipoEvento, ArquivoXml (GZip/base64), DataHoraGeracao
Erros[], Alertas[], TipoAmbiente, VersaoAplicativo, DataHoraProcessamento
```

O retorno normalizado contem `status`, `lastNsu`, `hasMore`, `documents[]`, `retryAfterSeconds`, `retryPolicy`, `cursorSource`, `errors[]`, `alerts[]`, `environment`, `processedAt` e `applicationVersion`. `lastNsu` e somente o maior NSU efetivamente recebido e validado; e `null` em vazio/rejeicao. Nao existe `ultNSU`, `maxNSU` nem indicador de pagina seguinte no Swagger contribuinte consultado. `hasMore=true` significa autorizar outra sondagem apos persistir o lote; nao promete documentos adicionais. `hasMore=false` encerra a varredura ao receber vazio/rejeicao. Nunca substituir o cursor persistido por zero ou `null`, nem somar 1 ao NSU passado para o modo lote.

NSU usa todo o intervalo positivo de int64, inclusive 19 digitos; normalizacao adiciona zeros somente ate largura minima de 15. Duplicacao, ordem decrescente, falta de NSU, divergencia entre chave/tipo externo e XML, tipo nao suportado ou XML invalido interrompem o parsing do lote inteiro. O chamador conserva o cursor anterior e a resposta bruta para recuperacao.

Cada documento retorna `id`, `nsu`, `key`, `kind`, `fields` (`IDictionary`), `xmlBase64`, `sha256` e `fileName`. O ID e `NSU com minimo15 digitos` + `-` + primeiros16 caracteres SHA-256. O XML original recebido como texto UTF-8 e preservado sem reserializacao. A analise nao e validacao criptografica de XMLDSIG nem validacao integral do XSD.

## Campos fiscais e retencoes

NFSe usa prestador de `DPS/infDPS/prest`, tomador de `toma` e, somente para completar nome ausente, emitente com identificacao igual ao prestador. Isso evita classificar tomador emitente como fornecedor. `TIPO_FISCAL` e `MODELO` sao `NFS-e`; `FONTE_FISCAL=ADN_NACIONAL_NFSE`. `PAPEL_EMPRESA` distingue `TOMADOR`, `PRESTADOR`, `INTERMEDIARIO` e `TERCEIROS`. `DIRECAO=ENTRADA` exige empresa tomadora, `SAIDA` exige prestadora; intermediario permanece `TERCEIROS`.

`DATA_EMISSAO` e `DATA_EMISSAO_ORIGINAL` preservam `infNFSe/dhProc`, geracao da NFS-e, inclusive fuso. `DATA_EMISSAO_DPS` conserva a emissao da declaracao `DPS/infDPS/dhEmi` separadamente. `NUMERO_NOTA` usa `nNFSe`. A serie da DPS nao e apresentada como serie NFS-e: conserva-se em `SERIE_DPS`, junto de `NUMERO_DPS`. O corte de 01/10/2026 deve ser aplicado pelo worker apos esta normalizacao, com tratamento de eventos vinculados a notas conhecidas.

`VALOR_TOTAL_NOTA` e `vServ`; `VALOR_LIQUIDO` e o `vLiq` literal da NFS-e. Descontos condicionado/incondicionado explicitos ficam separados e somados em `DESCONTOS`. Bases tributarias e totais de retencao nao viram impostos retidos. Observacoes unem descricao de servico e informacao complementar; `xOutInf` permanece em `INFORMACOES_FISCO`.

Aliases compartilhados: `VALOR_SERVICOS` conserva o mesmo `vServ` explicito; `ISS` conserva `infNFSe/valores/vISSQN`, independentemente de ser retido, sem alterar `ISS_RETIDO`. `CODIGO_SERVICO` e o literal `DPS/infDPS/serv/cServ/cTribNac` (codigo nacional de seis digitos, mantendo zeros iniciais), sem substituir pelo codigo municipal `cTribMun` ou NBS. `MUNICIPIO_PRESTACAO` usa `infNFSe/xLocPrestacao` quando o grupo `DPS/infDPS/serv/locPrest` possui `cLocPrestacao` IBGE; na ausencia de descricao, conserva esse codigo literal. O ramo `cPaisPrestacao` representa exterior e nao cria municipio brasileiro. Os tipos oficiais `TCServ`, `TCLocPrest` e `TCCServ` do XSDv1.01 definem esses caminhos. Elemento opcional ausente permanece ausente; zero monetario somente quando explicito.

| Campo compartilhado | Origem explicita e condicao |
| --- | --- |
| `ISS_RETIDO` | `infNFSe/valores/vISSQN`, somente `tpRetISSQN=2` (tomador). Codigo3, intermediario, nao alimenta este campo. |
| `PIS_RETIDO` | `tribFed/piscofins/vPis`, somente `tpRetPisCofins` em 1,3,4,5,9. |
| `COFINS_RETIDA` | `tribFed/piscofins/vCofins`, somente codigos1,3,4,6,7. |
| `CSLL_RETIDA` | `tribFed/vRetCSLL`, valor explicito. |
| `IRRF_RETIDO` | `tribFed/vRetIRRF`, valor explicito. |
| `INSS_RETIDO` | `tribFed/vRetCP`, contribuicao previdenciaria retida explicita. |

Os codigos PIS/COFINS de0a9 seguem `TSTipoRetPISCofins` do XSD atual; sem indicador, `vPis`/`vCofins` permanecem tributos proprios e nao retencao. Codigo de retencao sem valor nao gera numero. Ausencia permanece ausente; zero explicito permanece zero. `STATUS_RETENCOES=RETENCAO_INFORMADA_XML` exige ao menos um desses seis valores positivo; nos demais casos `NAO_INFORMADA_XML`, sem concluir dispensa tributaria. Nao se recalcula enquadramento fiscal ou liquido.

`kind=evento` exige `infEvento` registrado e correspondencia da chave com `EVT + chave50 + tipo6 + sequencial3`. Apenas eventos101101,105102,105104,305101 definem `SITUACAO=CANCELADA`. Solicitacao de analise fiscal101103 nao cancela a nota. Eventos nao criam data de emissao, valores, papel da empresa ou analise de retencoes. O worker deve atualizar somente a nota conhecida e preservar seus dados completos.

## Limites, agendamento e cobertura

O [manual oficial ADN municipal, §1.4.2b](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-municipios-apis-adn-sistema-nacional-nfs-e-v1-2-out21025.pdf/@@download/file) descreve distribuicao de ate50 documentos em ordem de NSU e espera minima de uma hora apos esgotamento. O Swagger contribuinte atual nao repete teto de lote nem intervalo. Como guarda conservadora local, este modulo rejeita lotes acima de50 e sugere65 minutos (`3900` segundos) apos vazio/rejeicao; lote com documentos sugere0. Isso e politica local, nao cabecalho `Retry-After` do governo. Se o servico evoluir, revisar a guarda antes de prosseguir com o cursor.

O modulo nao agenda nem persiste. O worker deve usar NSU **ADN separado do NSU SEFAZ NF-e**, lock exclusivo, journal bruto, outbox e checkpoint atomico, e aplicar os horarios09/15/20 BRT. Nao usar cursor NF-e para NFS-e. A ausencia no ADN nao comprova ausencia de notas municipais; so se recupera documento compartilhado no padrao nacional em que o CNPJ figure no papel permitido. Nao ha busca universal por periodo neste endpoint. O corte local nao deve provocar saltos de cursor.

## PDF/DANFSe

O [manual oficial ADN municipal, §1.5](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-municipios-apis-adn-sistema-nacional-nfs-e-v1-2-out21025.pdf/@@download/file) documenta `GET /danfse/{chaveAcesso}` para gerar PDF de NFS-e compartilhada no ADN, inclusive por sistema municipal. O [catalogo oficial](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao) aponta docs `https://adn.nfse.gov.br/danfse/docs/index.html`. Em29/10/2026 essas docs e Swagger retornaram HTTP503 em producao e404 em homologacao, mesmo com mTLS. A distribuicao contribuinte e seu Swagger estavam acessiveis. Nao foi feita consulta de PDF de chave real. Assim, disponibilidade do DANFSe deve ser verificada no momento da integracao; nao presumir que este modulo entrega PDF ou que nota municipal nao compartilhada possa ser recuperada por ele.

## Testes locais

```powershell
pwsh -NoProfile -File tests/Nfse-Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/Nfse-Tests.ps1
```

Fixtures sao ficticias e exercitam parser e transporte interceptado: nao contem XML fiscal real, senha ou chave privada e nao fazem consultas governamentais. O worker e a entrega SharePoint/PDF/notificacoes sao integrados separadamente.
