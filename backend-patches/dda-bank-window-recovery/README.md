# Recuperação de consultas DDA ao Sicoob

Se uma janela da consulta histórica falhar por erro de transporte após as quatro tentativas existentes, o coletor a consulta uma única vez em duas janelas menores e consecutivas. Cada metade usa a política normal de tentativa e a mesma sessão bancária. Se alguma falhar, o coletor não emite um resultado parcial; o recibo registra o intervalo que falhou. Erros de autenticação, TLS e rejeições HTTP continuam seguindo suas regras atuais.

A instalação modifica apenas o módulo `DdaMonitor.psm1` do coletor OCI. A API, os clientes e os horários agendados permanecem compatíveis. O instalador exige o hash da versão base para não sobrepor alterações de outra publicação, testa uma cópia isolada e aplica a troca com a trava já usada pelo coletor.

Na VM OCI, em um diretório de preparação com os dois arquivos deste pacote:

```sh
sudo python3 install_dda_window_recovery.py Test-DdaWindowRecovery.ps1
sudo python3 install_dda_window_recovery.py Test-DdaWindowRecovery.ps1 --apply
```

O instalador informa o hash instalado e guarda a versão anterior em `/var/backups/energetica-dda-window-recovery/`. Para reverter, restaure essa versão com a mesma trava de sincronização e troca atômica. O módulo é carregado a cada execução do coletor, portanto a publicação e a reversão dispensam reiniciar a fila.

Para validar a publicação, acione uma consulta manual com a identidade autorizada e acompanhe o mesmo identificador até o recibo `succeeded`, com a contagem de itens verificados no SharePoint.
