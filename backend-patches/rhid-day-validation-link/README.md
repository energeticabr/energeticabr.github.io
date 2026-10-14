# Validação de presenças pelo relatório RHID

O relatório diário autenticado devolve `pendingValidationCount`: IDs distintos
com `PRESENCA=PENDENTE` e `DATA` igual ao dia consultado. A contagem independe
do vínculo nominal com a pessoa RHID; nenhuma presença é validada pela consulta.

`rhid_day_validation_start` aceita somente `action` e `date`, exige data ISO
exata, dono da sessão e ausência de anexos pendentes. Reconsulta a lista
SharePoint antes de abrir o fluxo existente `attendance_validation` na etapa
`registro_presenca_pendente`, com o filtro da data escolhido. Se todas as
presenças foram validadas entretanto, recusa o início sem mudar o fluxo.

`patch_bridge.py` recusa âncoras ausentes/duplicadas. `deploy.py` exige o
SHA-256 atual dos dois `channel_bridge.py`, faz dry-run por padrão, segura
os dois locks de publicação, usa troca atômica sem janela de arquivo ausente,
mantém backups e bytes deslocados em diretório recuperável e exige saúde HTTP 200
após reinício.

Testes: `python -m unittest discover -s backend-patches/rhid-day-validation-link -v`.
O teste Linux `test_deploy.py` usa somente diretórios temporários e também
verifica restauração caso a cópia recuperável falhe após a troca.
