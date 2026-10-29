# Fluxos fiscais unificados - fontes locais

Fontes regeneradas em29/10/2026, sem publicar fluxo nem chamar API real. Mantidos mesma lista `NOTAS_FISCAIS_SEFAZ`, biblioteca, conexao `shared_sharepointonline` e receiver03. Nomes dos arquivos historicos com `NFe` continuam para compatibilidade, embora recebam NF-e, CT-e e NFS-e.

## Arquivos para integrar

Geradores: `scripts/build-flows.mjs`, `scripts/build-live-flows.mjs`, `scripts/danfe-flow.mjs`.

Resultados gerados: `powerautomate/01-Provisionar-SharePoint.definition.json`, `02-Sincronizar-NFe.definition.json`, `03-Receber-NFe.definition.json`, `04-Provisionar-Fila.definition.json`, `05-Agendar-Coleta.definition.json` e `schema-sharepoint.json`.

Testes/helpers que devem acompanhar o backpatch: `tests/flow-contract.test.mjs`, `tests/unified-flow.test.mjs`, `tests/flow-fixture.mjs` e **`tests/wdl.mjs`**. A fixture copia explicitamente os tres geradores e o interpretador WDL, cria configuracao ficticia em pasta temporaria e funciona a partir de qualquer cwd. Nao copia configuracao real nem usa conexoes do tenant.

## CHAVE_ACESSO - migracao existente e verificacao

Na criacao, SchemaXml passa a usar:

```xml
<Field Type="Text" Name="CHAVE_ACESSO" StaticName="CHAVE_ACESSO" DisplayName="CHAVE_ACESSO" Indexed="TRUE" EnforceUniqueValues="TRUE" Required="TRUE" MaxLength="64" />
```

Para a coluna existente, acao **`Atualizar_chave_unica`** faz:

```http
POST _api/web/lists/getbytitle('NOTAS_FISCAIS_SEFAZ')/fields/getbyinternalnameortitle('CHAVE_ACESSO')
Accept: application/json;odata=nometadata
Content-Type: application/json;odata=nometadata
X-HTTP-Method: MERGE
IF-MATCH: *

{"MaxLength":64,"Indexed":true,"EnforceUniqueValues":true,"Required":true}
```

**`Verificar_chave_unica`** relê a coluna com:

```http
GET _api/web/lists/getbytitle('NOTAS_FISCAIS_SEFAZ')/fields/getbyinternalnameortitle('CHAVE_ACESSO')?$select=InternalName,TypeAsString,MaxLength,Indexed,EnforceUniqueValues,Required
```

**`Conferir_chave_unica`** aplica ParseJson exigindo `InternalName=CHAVE_ACESSO`, `TypeAsString=Text`, `MaxLength=64`, `Indexed=true`, `EnforceUniqueValues=true` e `Required=true`. `Habilitar_anexos` depende do sucesso dessa verificacao. Assim, apenas executar o MERGE nao e considerado comprovacao da migracao. `Verificar_campos` relê todos os nomes/tipos; os campos Note tambem possuem GET de RichText.

## Colunas novas esperadas

Os27campos abaixo somam79campos no schema completo, incluindo Title. Sao opcionais; ausencia fiscal nao vira zero ou texto inventado.

| Tipo SharePoint | Nomes exatos |
| --- | --- |
| Text - solicitados | `TIPO_FISCAL`, `ORIGEM_FISCAL`, `TOMADOR`, `CNPJ_TOMADOR`, `PAPEL_EMPRESA`, `MUNICIPIO_PRESTACAO`, `CODIGO_SERVICO`, `DATA_EMISSAO_DPS`, `SERIE_DPS` |
| Text - dados existentes dos parsers | `FONTE_FISCAL`, `NUMERO_DPS`, `ORIGEM_DATA_EMISSAO`, `REMETENTE`, `CNPJ_REMETENTE`, `EXPEDIDOR`, `CNPJ_EXPEDIDOR`, `RECEBEDOR`, `CNPJ_RECEBEDOR`, `PROTOCOLO_EVENTO`, `SEQUENCIA_EVENTO`, `STATUS_EVENTO` |
| Note - texto simples | `DESCRICAO_SERVICO` |
| Currency - solicitados | `ISS`, `VALOR_SERVICOS` |
| Currency - dados existentes dos parsers | `DESCONTO_CONDICIONADO`, `DESCONTO_INCONDICIONADO`, `VALOR_LIQUIDO_FATURA` |

Criacao via mesma conexao, com POST em `/fields/createfieldasxml`, corpo `{"parameters":{"SchemaXml":"<Field ... />","Options":8}}`. SchemaXml por tipo:

```xml
<Field Type="Text" Name="TIPO_FISCAL" StaticName="TIPO_FISCAL" DisplayName="TIPO_FISCAL" />
<Field Type="Note" Name="DESCRICAO_SERVICO" StaticName="DESCRICAO_SERVICO" DisplayName="DESCRICAO_SERVICO" RichText="FALSE" NumLines="6" />
<Field Type="Currency" Name="ISS" StaticName="ISS" DisplayName="ISS" Decimals="2" LCID="1046" />
```

As demais colunas seguem o mesmo molde substituindo os tres atributos de nome. Para cada uma ha `Localizar_<nome>`, `Garantir_<nome>` e, quando ausente, `Criar_<nome>`. Campos existentes de valores, retencoes, observacoes e `DATA_EMISSAO_ORIGINAL` permanecem no schema. Datas originais/DPS sao Text para conservar o fuso literal; `DATA_EMISSAO` continua DateTime.

## Receiver e validacao antes da escrita

O trigger continua `Request/kind=Button`, chamado pela API Microsoft autenticada. Nao e criado webhook anonimo/SAS. O lote exige `source=SEFAZ`, `companyCnpj` igual a configuracao e documentos. Os kinds aceitos sao:

```text
nfeProc, resNFe, procEventoNFe, resEvento,
cteProc, cteOSProc, cteSimpProc, procEventoCTe,
NFSe, evento
```

Chave:44posicoes com CNPJ alfanumerico no contrato NF-e/CT-e, ou50digitos nacionais para NFSe/evento. NSU permanece **string de15a19digitos**, valido como int64. ID e `nsu-sha16`; XML filename deve ser exatamente `key-id.xml`; sha256 deve ter64caracteres hexadecimais minusculos. Campos `CHAVE_ACESSO` e `ULTIMO_NSU` devem corresponder ao documento.

O conector de fluxos nao aceita `pattern` no schema do trigger. Os geradores removem esse atributo e aplicam **`Conferir_identidade`** em WDL antes de qualquer escrita, verificando formato e vinculos sem truncar. O cliente continua responsavel por validar XML original, assinatura de identidade/hash e PDF antes do POST. O fluxo nao calcula SHA-256 do XML por WDL.

Cadeia de execucao por documento: `Conferir_identidade` → `Conferir_DANFE` → `Gravar_XML` → gravacao do item → anexo/conferencia PDF → ACK. A mesma barreira e aplicada ao fluxo02 PAD legado.

## PDFs e replay

`nfeProc`, `cteProc`, `cteOSProc`, `cteSimpProc` e `NFSe` exigem objeto PDF com nome/base64/hash. Dentro de `Conferir_DANFE`, `Validar_pdf` valida a presenca e limites; **`Conferir_identidade_pdf`** exige nome com prefixo correto e vinculo a chave/hashXML:

```text
DANFE-<chave44>-<shaXML16>.pdf
DACTE-<chave44>-<shaXML16>.pdf
DANFSe-<chave50>-<shaXML16>.pdf
```

`Anexar_DANFE` usa `CreateAttachment` ou `UpdateFile`, preservando os parametros binarios nativos. `Baixar_pdf` relê o anexo e `Conferir_integridade_pdf` compara o base64 integral antes de marcar `STATUS_DANFE=DISPONIVEL`. Descricao e generica: `PDF - espelho do documento fiscal`.

Eventos/resumos pulam a exigencia/geracao de PDF e conservam os valores, tipo fiscal, XML completo e URL/statusPDF da nota existente. Situacao antiga `CANCELADA` ou `SUBSTITUIDA` nao regride em replay. Metadados proprios de evento podem ser atualizados. `ULTIMO_NSU` usa `int()` do WDL para comparar int64 e retorna a string original maior. O interpretador de testes usa BigInt quando o valor ultrapassa a precisao segura JavaScript; cobre NSUs adjacentes proximos de int64maximo. A [referencia Microsoft WDL](https://learn.microsoft.com/en-us/azure/logic-apps/expression-functions-reference) documenta as funcoes utilizadas.

O gate `Anexar_DANFE` tambem confere a situacao relida em `Nota_gravada`: se for terminal (`CANCELADA`/`SUBSTITUIDA`), permite anexo somente quando a situacao recebida coincide. Replay autorizado nao substitui PDF terminal por versao sem marca; NFSe recebida realmente terminal com PDF marcado ainda pode anexar. Notas autorizadas e registros legados sem situacao continuam elegiveis.

## Testes e limites desta entrega

```powershell
node --test tests/flow-contract.test.mjs tests/unified-flow.test.mjs tests/retencoes-flow.test.mjs tests/observacoes-flow.test.mjs
```

17testes locais passaram. Tambem foram executados por caminho absoluto, a partir de uma pasta externa, os14testes portaveis de `flow-contract` e `unified-flow`. Fixtures sao isoladas e nao fazem chamadas Microsoft. Os JSONs gerados ainda precisam ser aplicados e ter colunas/anexos verificados no ambiente pelo integrador. A revisao pre-deploy cabe ao root/revisor atual; esta tarefa nao executa implantacao nem API real.
