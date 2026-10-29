# PDFs padrão de NF-e, CT-e e NFS-e

O renderizador recebe XML completo e devolve PDF sem consultar distribuição fiscal ou acessar o certificado A1. Usa os leiautes do BrazilFiscalReport 1.3.1: DANFE de NF-e, DACTE do CT-e modelo 57 versão 4.00 e DANFSe nacional v2.0, modelo NT 008. Falha ou leiaute sem suporte deixa o documento pendente; não há fallback para relatório ou espelho de campos do XML.

## Execução e dependências

| Documento completo | Execução | Módulos |
| --- | --- | --- |
| NF-e modelo 55 | Python no servidor, pelo SSH existente | `danfe_renderer.py`, `fiscal_document.py` |
| CT-e modelo 57 versão 4.00 | Mesmo Python e SSH da NF-e | Os mesmos módulos |
| NFS-e nacional | Python local do Windows | Os anteriores e `national_danfse.py` |

O Python local fica em `%LOCALAPPDATA%\Energetica\Runtime\FiscalPdf\Scripts\python.exe`. As versões estão fixadas em `config/danfe-requirements.txt`. O DANFSe incorpora os subconjuntos necessários de Arial, Arial Bold e Microsoft Sans Serif presentes no Windows (`arial.ttf`, `arialbd.ttf`, `micross.ttf`). Nenhuma fonte Windows é exportada ou enviada ao servidor. Fontes ausentes interrompem a geração.

NFS-e identifica o PDF gerado do XML como `LOCAL_DANFSE_NACIONAL` e não depende da API de PDF do ADN nem do portal. O utilitário separado de download oficial conserva sua origem e os bytes baixados; PDF local não é rotulado como download oficial.

## Identidade e conteúdo

Entrada JSON: `key, companyCnpj, xmlBase64, xmlSha256`. Saída: `key, xmlSha256, fileName, pdfBase64, pdfSha256`. O hash usa os bytes originais do XML, com UTF-8 estrito. DTD, entidades externas, resumos, eventos isolados, chave divergente, autorização/modelo/ambiente inconsistentes e empresa ausente dos atores aceitos são rejeitados. Este componente não substitui validação integral do XSD ou da assinatura XMLDSIG. Entrada e saída são limitadas e erros não expõem conteúdo fiscal.

Os prefixos exatos são `DANFE`, `DACTE` e `DANFSe`. Nome: `<prefixo>-<chave>-<primeiros16SHA256XML>.pdf`. Cabeçalho PDF, EOF, limite de 2 MB e SHA-256 dos bytes são conferidos. CT-e OS, simplificado ou versão incompatível pode ser preservado pelo conector, mas não recebe um PDF alternativo inventado.

CT-e usa `vPrest/vTPrest` e `vPrest/vRec`; NFS-e usa `DPS/infDPS/valores/vServPrest/vServ` e `infNFSe/valores/vLiq`, sem nova subtração de retenções. A identidade NFS-e inclui número, prestador, participantes, valores exatos e hash. O emitente só completa nome/endereço do prestador quando os identificadores coincidem. Observações do CT-e permanecem no DACTE.

Os códigos NFS-e 102, 103 e 107 não significam cancelamento. A situação reconciliada `fiscalSituation: "CANCELADA"` ou `"SUBSTITUIDA"` produz a marca correspondente no DANFSe padrão, sem dispensar a validação do XML. Outros valores ou uso desse parâmetro para NF-e/CT-e são rejeitados.

## Rotina diária

As três fontes — NF-e, CT-e e NFS-e nacional — têm rodadas diárias às **09h, 15h e 20h de Brasília**, com cursores próprios. A tarefa Windows verifica a fila a cada minuto; isso não significa consultar cada serviço a cada minuto. Pendências, bloqueios e cooldowns continuam respeitados. O corte configurado é **01/09/2026**, pela emissão original, sem reiniciar NSUs, filas ou deduplicação.

O computador precisa permanecer ligado, conectado e com a sessão do usuário Windows ativa. O A1 válido e sua chave privada devem estar disponíveis no repositório de certificados desse usuário. A janela do Energético pode ficar fechada. Android, iOS e Windows exibem os anexos da mesma base SharePoint; a coleta continua no Windows.

O instalador unificado prepara 16 arquivos de código, incluindo os três módulos Python, valida pré-requisitos e hashes antes da promoção e preserva configurações e dados. Instalação, geração e upload confirmado são etapas distintas. Correções seguem [PDF-LAYOUT-REPAIR.md](PDF-LAYOUT-REPAIR.md).

## Verificação offline

```powershell
$python = Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/FiscalPdf/Scripts/python.exe'
& $python -B -m unittest discover -s tests -p 'test_danfe_renderer.py'
& $python -B -m unittest discover -s tests -p 'test_national_danfse.py'
pwsh -NoProfile -File tests/OfficialNfsePdf-Tests.ps1
pwsh -NoProfile -File tests/LocalPdfInstaller-Tests.ps1
```

Os testes usam documentos fictícios e cobrem identidade, centavos, hashes, marcas de situação, fontes e rejeição de relatório XML como fallback. A QA visual e a conferência dos anexos continuam necessárias. XMLs/PDFs reais, evidências de produção e credenciais não integram o overlay.
