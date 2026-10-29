# PDF e notificacao de NF-e, CT-e e NFS-e

Implementacao offline verificada em 29/10/2026. Nenhuma consulta fiscal, certificado ou envio real de WhatsApp foi usado nesta tarefa. Os exemplos em `output/pdf/*teste.pdf` sao inteiramente ficticios, em homologacao, e foram rasterizados com Poppler e inspecionados visualmente.

## Arquivos e instalacao posterior

`fiscal_document.py` concentra a validacao do XML usada por `danfe_renderer.py` e `sefaz_whatsapp_dispatch.py`. Na publicacao posterior, copiar os tres arquivos para o mesmo diretorio de execucao. Esta tarefa nao publica o servidor nem altera PowerShell, fluxos ou galeria.

Nao ha dependencia nova: venv existente `.runtime/danfe-venv`, Python 3.12, BrazilFiscalReport 1.3.1, defusedxml 0.7.1, fpdf2 2.8.9, fonttools e python-barcode ja instalados. O espelho incorpora a fonte `barcode/fonts/DejaVuSansMono.ttf`; nao depende de fonte Windows no servidor. `pypdf` e Poppler sao usados na verificacao local. Caracteres sem glifo disponivel provocam falha, em vez de alterar silenciosamente o texto fiscal.

## Entrada, validacao e nomes

O protocolo stdin/stdout JSON permanece:

```text
entrada: key, companyCnpj, xmlBase64, xmlSha256
saida: key, xmlSha256, fileName, pdfBase64, pdfSha256
```

`companyCnpj` deve ser o CNPJ configurado da Energetica. XML e base64 sao limitados; UTF-8 e estrito, inclusive com preservacao de BOM. Hash e calculado dos bytes originais. DTD, entidades, resumos, eventos isolados, chaves divergentes, modelo incorreto, protocolo rejeitado, ambiente invalido/inconsistente e empresa nao participante sao rejeitados. Nao ha validacao integral do XSD nem verificacao criptografica da assinatura XMLDSIG neste componente.

| Documento completo | Validacao principal | Geracao | Prefixo exato |
| --- | --- | --- | --- |
| `nfeProc`, modelo55 | chave44, protocolo100/150, ambientes iguais | Danfe existente | `DANFE` |
| `cteProc`, modelo57 | chave44/modelo57, protocolo100, ambientes iguais | Dacte; espelho se o renderer nao suportar o XML | `DACTE` |
| `cteOSProc`, modelo67 | chave44/modelo67, protocolo100, ambientes iguais | Espelho do XML | `DACTE` |
| `cteSimpProc`, modelo57 | chave44/modelo57, protocolo100, ambientes iguais, entregas presentes | Espelho do XML | `DACTE` |
| `NFSe` nacional | chave50, `infNFSe`, DPS, situacao100/102/103/107 e empresa em prest/toma/interm | Espelho do XML | `DANFSe` |

Nome deterministico: `<prefixo>-<chave>-<primeiros16SHA256XML>.pdf`. `DANFSe` respeita exatamente essa caixa; nao usar `DANFSE`. Saida PDF exige cabecalho, EOF, tamanho e hash validos. O CLI mantém erro generico sanitizado, sem XML, documento ou segredo nos diagnosticos.

Na NFS-e nacional, cStat102 significa decisao judicial,103 avulsa e107 MEI; nao sao codigos de cancelamento. O [XSD oficial nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip), tipo `TStat`, define esses estados. Cancelamento posterior depende da reconciliacao de eventos.

Para arquivar uma NFSe completa ja cancelada/substituida, o worker pode acrescentar `fiscalSituation: "CANCELADA"` ou `"SUBSTITUIDA"` ao request. Esse parametro somente acrescenta marca historica vermelha em todas as paginas; nao dispensa nenhuma validacao do XML original. Outros valores e uso desse parametro historico para NF-e/CT-e sao rejeitados. O worker deve obter a situacao de evidencia reconciliada, nao dos codigos102/103.

## Conteudo dos espelhos

Cabecalho identifica claramente `ESPELHO DO XML`, tipo, ambiente e eventual situacao historica. Nao usa logotipo oficial nem se apresenta como DANFSe oficial. Mostra fornecedor, chave, emissao com fuso literal, total, liquido quando explicito e SHA-256. A seguir lista valores e atributos literais com caminhos do XML, distinguindo grupos repetidos e entregas do CT-e simplificado. Assinatura digital permanece no XML original, sem imprimir seu bloco base64 no PDF.

Total do CT-e vem de `vPrest/vTPrest`; no simplificado, `total/vTPrest`. `vTRec`, `vRec` e `vTPrestLiq` nao substituem o total. NFS-e usa `DPS/infDPS/valores/vServPrest/vServ`; liquido e `infNFSe/valores/vLiq`, sem nova subtracao. Prestador vem de `prest`, nunca do tomador que eventualmente emitiu o documento. A emissao NFS-e usa `infNFSe/dhProc`, distinguindo a emissao anterior da DPS.

Este componente nao consulta o endpoint DANFSe. A indisponibilidade503 das docs oficiais foi registrada na investigacao do conector; o integrador pode tentar o servico oficial antes e recorrer ao espelho. A disponibilidade dos docs nao comprova o resultado de consulta de uma chave real. Referencias: [catalogo oficial de APIs](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao), [BrazilFiscalReport upstream](https://github.com/Engenere/BrazilFiscalReport).

## Notificacoes e fila existente

O recibo SharePoint, XML/hash, tipo, identidade do PDF e CNPJ participante continuam obrigatorios. IDs aceitam NSU de15a19digitos ate int64maximo, com sufixo hash16; chaves aceitam44/50posicoes. Fornecedor, valor e emissao sao extraidos novamente do XML original. `fields.Title`, valores ou datas fornecidos nao podem substituir os dados fiscais.

Notificacao permite somente ambiente de producao e documento completo atual. `fields.SITUACAO` ou `document.fiscalSituation` diferente de `AUTORIZADA`, quando informado, impede staging; eventos/cancelamentos/substituicoes nao geram aviso de nova nota. Um espelho de registro historico pode ser anexado a galeria sem se tornar notificacao nova.

Texto NF-e permanece identico. CT-e/CT-eOS/NFS-e passam a identificar o tipo, conservando fornecedor, valor e emissao em negrito, sem converter o dia/hora pelo fuso do servidor. O corte `minimumIssueDate` usa esse mesmo dia fiscal. A chave de deduplicacao, registro da baseline e bloqueio de conteudo alterado permanecem. A transacao SQLite e a ordem global **textoA → PDF_A → textoB → PDF_B** continuam compartilhadas com a fila `NOVO DDA`; nenhuma fase ultrapassa uma anterior sem ACK.

## Verificacao local

```powershell
& .runtime/danfe-venv/Scripts/python.exe -m unittest discover -s tests -p 'test_*.py'
```

A suite cobre NF-e existente, os tres tipos CT-e, NFSe, metadata falsificada, NSU19, chaves/modelo/ambiente/empresa divergentes, hash, XML invalido, corte mensal, recibo, deduplicacao e sequenciamento misto. Dacte foi exercitado de fato para o CT-e57 de teste. Quatro PDFs de exemplo foram abertos por rasterizacao: CT-e57 (1pagina), CT-eOS (4paginas), CT-e simplificado (4paginas) e NFS-e (2paginas). O PDF de teste nao e um documento fiscal emitido.
