# Correção para os PDFs fiscais padrão

O caminho atual substitui os antigos espelhos de campos pelo DANFSe nacional v2.0, modelo NT 008, e pelo DACTE do CT-e modelo 57 versão 4.00. NF-e conserva seu DANFE. Falha ou leiaute sem suporte permanece pendente; não há relatório XML alternativo.

## Preparação e QA

NFS-e usa `%LOCALAPPDATA%\Energetica\Runtime\FiscalPdf\Scripts\python.exe`, com `danfe_renderer.py`, `fiscal_document.py` e `national_danfse.py`. Arial, Arial Bold e Microsoft Sans Serif vêm do Windows e são incorporadas ao PDF, sem copiar fontes para o servidor. As versões estão em `config/danfe-requirements.txt`. A geração local não depende da API de PDF do ADN. NF-e e CT-e continuam no renderizador pelo SSH existente.

Conferir XML original, chave, participantes, número, emissão, valores e hashes. Renderizar e inspecionar visualmente os documentos, inclusive observações e retenções. NFS-e cancelada/substituída recebe a marca da situação reconciliada. O líquido permanece o do XML, sem desconto adicional. Não gerar PDF de resumo ou modificar XML para contornar validação.

O instalador valida os 16 arquivos e pré-requisitos antes da promoção, conserva backup para rollback e verifica a preservação de configurações, cursores e dados. Conferir os hashes dos arquivos promovidos; sucesso na validação do pacote não comprova instalação nem correção de anexos.

## Substituição dos anexos

`scripts/build-pdf-repair-flow.mjs` prepara o receptor de correção 07, usando o transporte autenticado existente. Exige nota já cadastrada, chave, XML completo e hash vinculados, situação esperada e anexo existente. Atualiza exclusivamente o PDF do registro, baixa-o para comparar os bytes e verifica os vínculos novamente. O ACK deve corresponder exatamente à chave e ao hash do PDF enviado.

Não criar notas novas ou alterar campos fiscais durante a correção. Geração local, início de upload e sucesso HTTP não substituem o ACK exato. Em falha, conservar a pendência.

As notificações permanecem suspensas durante a troca controlada. Somente PDFs ainda não enviados podem ser substituídos na fila após reconciliação de chave, situação e hashes. Itens enviados ou em trânsito mantêm recibos e não são reenviados automaticamente. A retomada exige conferir anexos e pendências preservadas.

## Rotina posterior

NF-e, CT-e e NFS-e nacional têm rodadas diárias às **09h, 15h e 20h de Brasília**. Cada fonte conserva cursor, fila e limites. Verificar a fila Windows a cada minuto não equivale a consultar os serviços nesse intervalo. O corte configurado é **01/09/2026**, sem reiniciar NSUs ou histórico.

O computador deve permanecer ligado, conectado e com a sessão do usuário Windows e o A1 disponíveis. Android, iOS e Windows consultam os anexos da mesma base. A disponibilidade do ADN não comprova cobertura de todas as prefeituras ou recuperação integral do período.

XMLs/PDFs reais, filas, sessões, credenciais e evidências privadas ficam fora do overlay público. Uma correção só é concluída após QA e ACK de cada anexo; este guia não declara uma quantidade de reparos executados.
