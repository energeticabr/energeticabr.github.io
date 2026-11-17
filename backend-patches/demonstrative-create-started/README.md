# Criação de descritivo de etapa

O novo cadastro passa da data de início para a seleção da atividade. O resumo
exibe **ATIVIDADE INICIADA** e o envio ao SharePoint omite `DATAPREVISTO`.
Rascunhos salvos antes da mudança mantêm a posição no formulário e qualquer data
de finalização antiga é descartada antes do envio.

A alteração está no backend compartilhado de Android, iOS e Windows/web.
`patch_backend.py` deve ser aplicado às bases de produção e de build
independentemente. `test_regression.py` usa o motor real com um SharePoint
simulado. Para validar um candidato, aponte `ENERGETICO_WORKER_OVERLAY` para o
diretório que contém o `workflow.py` candidato e `WORKFLOW_CONFIG_PATH` para
o JSON candidato.
