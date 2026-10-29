# PDF e notificacao de NF-e, CT-e e NFS-e

Componente offline de renderizacao verificado em29/10/2026. Recebe XML e devolve PDF, sem acessar certificado ou consultar distribuicao fiscal. Os exemplos de teste sao ficticios, em homologacao, e foram rasterizados e inspecionados. A implantacao real, a correcao dos nove anexos e a retomada das pendencias estao descritas em `PDF-LAYOUT-REPAIR.md`.

## Arquivos e instalacao posterior

`fiscal_document.py` concentra a validacao do XML usada pelo renderizador e notificador. Copiar `fiscal_document.py`, `fiscal_pdf_layout.py`, `danfe_renderer.py` e `sefaz_whatsapp_dispatch.py` para o mesmo diretorio, instalando os auxiliares antes dos consumidores. A configuracao e os estados existentes permanecem preservados.

Nao ha dependencia nova: venv existente `.runtime/danfe-venv`, Python 3.12, BrazilFiscalReport 1.3.1, defusedxml 0.7.1, fpdf2 2.8.9, fonttools e python-barcode ja instalados. O espelho incorpora fonte Sans TrueType existente no host; se nao houver DejaVu Sans, Liberation Sans ou Arial, usa a fonte Unicode `barcode/fonts/DejaVuSansMono.ttf` ja instalada. Nao depende de fonte Windows no servidor Linux. `pypdf` e Poppler sao usados na verificacao local. Caracteres sem glifo disponivel provocam falha, em vez de alterar silenciosamente o texto fiscal.

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

O cabecalho identifica o espelho fiscal, tipo, ambiente e eventual situacao historica. Nao usa logotipo oficial nem se apresenta como DANFSe oficial. O corpo apresenta secoes de identificacao, prestador/transportadora, tomador, servico/transporte, valores, tributos, retencoes e observacoes. Nao imprime caminhos ou tags do XML. Entregas do CT-e simplificado permanecem separadas, com destino e valores proprios. A chave completa aparece no rodape de todas as paginas. Assinatura digital e demais dados completos permanecem no XML original.

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

A suite cobre NF-e existente, os tres tipos CT-e, NFSe, metadata falsificada, NSU19, chaves/modelo/ambiente/empresa divergentes, hash, XML invalido, corte mensal, recibo, deduplicacao e sequenciamento misto. Dacte foi exercitado de fato para o CT-e57 de teste. Quatro PDFs de exemplo foram abertos por rasterizacao: CT-e57 (1pagina), CT-eOS e CT-e simplificado; as previas atuais legiveis estao em `*-legivel-*.pdf`, substituindo o despejo tecnico de campos anterior. O PDF de teste nao e um documento fiscal emitido.
# Espelhos legíveis de NFS-e e transporte

`src/fiscal_pdf_layout.py` organiza o fallback de NFS-e, CT-e OS e CT-e simplificado em seções de leitura, sem despejar caminhos/tags do XML. A NF-e e a rota principal do DACTE modelo 57 continuam usando os renderizadores existentes.

O A4 usa identificação, prestador/transportadora e tomador, serviço/transporte, totais, tributos, retenções e observações. O valor líquido é o campo explícito do XML e não sofre nova dedução. Ausências aparecem como não informadas; ISS comum não é promovido a retenção. Endereço do emitente só completa o prestador quando os identificadores concordam; código IBGE sem nome continua código, com a UF literal quando presente.

O título identifica **ESPELHO DA NFS-e**, gerado do XML, sem logotipo ou QR oficial. Cabeçalho e rodapé se repetem nas páginas; cancelamento/substituição é marcado em todas. Descrições e observações têm quebra automática, sem corte. O corpo usa fonte de pelo menos 9 pt; rodapés de identificação são menores. Fontes TrueType existentes no host são incorporadas (DejaVu Sans, Liberation Sans ou Arial), com a fonte Unicode já fornecida por `python-barcode` como fallback; não há pacote novo.

Testes offline: `python -m unittest discover -s tests -p test_fiscal_pdf_layout.py -v` e `python -m unittest discover -s tests -p test_danfe_renderer.py -v`. Prévias fictícias ficam em `output/pdf/*-legivel-*.pdf`, e o caso multilinha cancelado em `output/pdf/nfse-multilinha-cancelada-ficticia.pdf`.
