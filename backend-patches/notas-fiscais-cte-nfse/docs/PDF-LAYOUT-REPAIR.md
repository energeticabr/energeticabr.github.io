# Espelhos fiscais legíveis

O renderizador de NFS-e e dos formatos CT-e sem DACTE disponível usa blocos legíveis com emitente/prestador, tomador, identificação, emissão original, serviço/transporte, valores, tributos e observações. O corpo não reproduz caminhos técnicos do XML. A fonte utiliza Sans Unicode já instalada no Windows ou Linux, incluindo os caminhos DejaVu Sans do Oracle Linux. `src/fiscal_pdf_layout.py` precisa acompanhar `danfe_renderer.py`; instalar o auxiliar antes do consumidor. NF-e e o caminho principal DACTE do CT-e57 permanecem inalterados.

Valores vêm dos campos literais. Ausência não vira zero; o líquido permanece o informado no XML, sem novo desconto de tributos. Os rótulos de retenção distinguem tomador/intermediário conforme os indicadores declarados. Nomes e endereços alternativos só vêm do emitente quando a identidade coincide. Descrições longas continuam nas páginas seguintes, com cabeçalho, chave, paginação e marca de cancelamento/substituição em todas as páginas.

O documento se identifica como espelho do XML. O endpoint oficial de DANFSe retornou503 na verificação de29/10/2026; nenhum PDF oficial foi obtido nesse teste. O espelho não reproduz logomarca ou QR de autorização inventados.

## Correção de anexos já existentes

`build-pdf-repair-flow.mjs` gera o fluxo07. O receptor autenticado aceita somente NFS-e existentes com XML completo, mesma chave, hash/arquivo vinculado e situação esperada. Confere os bytes do XML arquivado, atualiza exclusivamente o arquivo PDF já anexado, baixa o PDF para conferir igualdade de bytes e verifica novamente chave/situação/link. Não altera campos fiscais, não cria notas e não envia mensagens. O ACK confirma chave e hash do PDF. `Deploy-PdfRepairFlow.ps1` usa a conexão já autorizada e conserva os runs em `.runtime`; não é um webhook público.

Na correção real, nove anexos foram substituídos;500campos foram comparados sem diferenças. Os envios SEFAZ foram suspensos durante a correção. Apenas quatro NFS-e ainda sem PDF enviado tiveram arquivo/hash atualizados na fila do servidor e na fila nativa. Documentos enviados ou em trânsito foram preservados; não houve reenvio automático de históricos. A retomada ocorreu somente após conferir os hashes e a situação dos documentos pendentes. As evidências ficam em `evidence/pdf-layout-repair-live.json`, `pdf-layout-pending-server.json` e `pdf-layout-dispatch-resumed.json`.

Validação:45testes Python,18contratos Node, nove PDFs reais com fornecedor/chave/serviço/valores/emissão conferidos e cancelamento marcado. Oito notas couberam em uma página e uma em duas. As provas de produção têm somente contagens, estados e identificadores de execução; XMLs/PDFs reais e filas ficam fora do pacote de código.
